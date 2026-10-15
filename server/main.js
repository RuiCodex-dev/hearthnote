// Entry point: config -> provider -> skills -> store -> HTTP. Also runs the always-on weekly
// brief in private mode.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ROOT } from "./config.js";
import { createProvider } from "./llm/provider.js";
import { SkillRunner } from "./care/skills.js";
import { emptyHousehold } from "./care/household.js";
import { createReferenceLookup } from "./tools/reference.js";
import { DemoSessions, PrivateVault } from "./store/vault.js";
import { demoHousehold } from "./seed/demo.js";
import { createApp, HttpError } from "./app.js";

const PUBLIC = join(ROOT, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};
const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), geolocation=(), microphone=(self)",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function makeStore(config) {
  if (config.mode === "private") {
    const vault = new PrivateVault({ dataDir: config.dataDir, secret: config.vaultKey });
    let household = vault.load();
    if (!household) {
      household = process.env.HEARTH_PRIVATE_SEED === "demo" ? demoHousehold() : emptyHousehold();
      vault.save(household);
    }
    return {
      vault,
      forRequest: () => ({ household, session: null }),
      save: (h) => vault.save(h),
      reset: () => {},
      byCalendarToken: (t) => (t === household.calendarToken ? household : null),
      all: () => [household],
    };
  }
  const sessions = new DemoSessions({ seed: () => demoHousehold(), ttlMinutes: config.limits.sessionTtlMinutes, max: config.limits.maxSessions });
  return {
    sessions,
    forRequest(cookies, setCookie) {
      let s = sessions.get(cookies.hn_sid);
      if (!s) {
        s = sessions.create();
        setCookie(`hn_sid=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.limits.sessionTtlMinutes * 60}${config.secureCookies ? "; Secure" : ""}`);
      }
      return { household: s.household, session: s };
    },
    save: () => {},
    reset: (s) => {
      sessions.reset(s.id);
      s.calls = Math.min(s.calls, Math.floor(config.limits.callsPerSession / 2));
    },
    byCalendarToken: (t) => [...sessions.map.values()].find((s) => s.household.calendarToken === t)?.household || null,
    all: () => [...sessions.map.values()].map((s) => s.household),
  };
}

// ISO week key in the household's timezone, used so the weekly brief runs once per week.
export function weekKey(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((p) => [p.type, p.value]));
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function localClock(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), hour: Number(parts.hour) };
}

export async function buildServer(config = loadConfig()) {
  config.secureCookies = process.env.HEARTH_SECURE_COOKIES === "1";
  const provider = createProvider(config.llm);
  let resolved = { fast: config.llm.fastModel, deep: config.llm.deepModel, available: [] };
  try {
    resolved = await provider.resolveModels();
  } catch (err) {
    console.warn(`[hearthnote] could not list Token Factory models (${err.message}); using configured ids`);
  }
  const lookup = createReferenceLookup({ apiKey: config.tavilyKey });
  const runner = new SkillRunner({ provider, tools: lookup ? { lookup } : {} });
  const store = makeStore(config);
  const app = createApp({ config, runner, store, resolved: () => ({ fast: resolved.fast, deep: resolved.deep }) });

  const server = createServer(async (req, res) => {
    try {
      const body = req.method === "POST" || req.method === "PUT" ? await readJson(req) : null;
      const out = await app(req, { body, ip: req.socket.remoteAddress });
      if (out) {
        res.writeHead(out.status, { ...SECURITY, ...out.headers });
        return res.end(out.body);
      }
      return await serveStatic(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err.status === 429 ? 429 : 500;
      if (status === 500) console.error(`[hearthnote] ${req.method} ${req.url.split("?")[0]}: ${err.message}`);
      res.writeHead(status, { ...SECURITY, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: status === 500 ? "Something went wrong on our side." : err.message }));
    }
  });

  // Always-on: in private mode the weekly family brief writes itself on the configured
  // weekday and hour (default Sunday 18:00 in the household's timezone).
  let timer = null;
  if (config.mode === "private") {
    const tick = async () => {
      for (const h of store.all()) {
        const { weekday, hour } = localClock(new Date(), config.timezone);
        const want = h.settings.weeklyDigest;
        const key = weekKey(new Date(), config.timezone);
        if (weekday === want.weekday && hour >= want.hour && h.settings.lastDigestWeek !== key && h.notes.length) {
          h.settings.lastDigestWeek = key;
          try {
            await runner.brief(h, "weekly-digest", { trigger: "schedule" });
            console.log(`[hearthnote] weekly brief written for ${key}`);
          } catch (err) {
            console.warn(`[hearthnote] weekly brief failed: ${err.message}`);
          }
          store.save(h);
        }
      }
    };
    timer = setInterval(tick, 5 * 60_000);
    timer.unref();
  }
  server.on("close", () => timer && clearInterval(timer));
  return { server, config, resolved, store, runner };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new HttpError(413, "too large");
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/" || !extname(rel)) rel = "/index.html";
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) throw new HttpError(404, "not found");
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, "not found");
  }
  if (!info.isFile()) throw new HttpError(404, "not found");
  const type = TYPES[extname(file)] || "application/octet-stream";
  const cache = /\.(woff2|webp|png|jpg|svg)$/.test(file) ? "public, max-age=86400" : "no-cache";
  res.writeHead(200, { ...SECURITY, "content-type": type, "cache-control": cache });
  if (req.method === "HEAD") return res.end();
  res.end(await readFile(file));
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || "")) {
  const { server, config, resolved } = await buildServer();
  server.listen(config.port, config.host, () => {
    console.log(`[hearthnote] ${config.mode} mode on http://localhost:${config.port} - provider ${config.llm.provider}, fast ${resolved.fast}, deep ${resolved.deep}`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}
