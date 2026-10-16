// HTTP API. Framework-free on purpose: the whole server is Node's standard library, so the
// container has no third-party runtime dependencies to audit.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { publicConfig } from "./config.js";
import { addMember, addNote, snapshot, uid } from "./care/household.js";
import { buildIcs } from "./care/ics.js";
import { makeCustomSkill } from "./care/skills.js";
import { EMERGENCY_ADVICE } from "./privacy/safety.js";
import { LlmError } from "./llm/provider.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A model call that fails (timeout, Token Factory unavailable, a rejected key) is reported as
// 502 with a sentence a family can act on; the cause stays in the server log, never a key.
export function modelFailure(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof LlmError) {
    console.warn(`[hearthnote] model call failed: ${err.message}`);
    const why = err.kind === "timeout" ? "Nemotron took too long to answer" : err.kind === "auth" ? "the Token Factory key was refused" : "Nemotron on Token Factory could not be reached";
    return new HttpError(502, `${why}. Nothing was lost; please try again in a moment.`);
  }
  return err;
}

// Input problems found below the HTTP layer (an empty note, a skill without instructions)
// become 400s instead of a generic 500.
function badInput(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err.message);
  }
}

const json = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }, body: JSON.stringify(body) });

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

export function createApp({ config, runner, store, resolved }) {
  const daily = { day: new Date().toISOString().slice(0, 10), calls: 0 };
  const authSecret = randomBytes(32);
  const passcode = process.env.HEARTH_PASSCODE || null;

  const signAuth = () => createHmac("sha256", authSecret).update("ok").digest("base64url");
  const authed = (cookies) => {
    if (!passcode) return true;
    const want = Buffer.from(signAuth());
    const got = Buffer.from(cookies.hn_auth || "");
    return got.length === want.length && timingSafeEqual(got, want);
  };

  // Budget guard: protects Token Factory credits in the public demo.
  function guardFor(session) {
    return async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (daily.day !== today) Object.assign(daily, { day: today, calls: 0 });
      if (daily.calls >= config.limits.callsPerDay) throw new HttpError(429, "The demo has used today's model budget. Please try again tomorrow.");
      if (session && session.calls >= config.limits.callsPerSession) throw new HttpError(429, "This demo sandbox has used its model calls. Reset the demo to start over.");
      daily.calls += 1;
      if (session) session.calls += 1;
    };
  }

  function stateBody(h, session) {
    return {
      ...snapshot(h),
      skills: runner.list(h).filter((s) => !s.hidden).map(({ id, title, description, tier, builtin, tool, schedule }) => ({ id, title, description, tier, builtin, tool: tool || null, schedule: schedule || null })),
      budget: session ? { used: session.calls, limit: config.limits.callsPerSession } : null,
      calendarPath: `/cal/${h.calendarToken}.ics`,
      emergency: EMERGENCY_ADVICE,
      config: { ...publicConfig(config), models: resolved() },
    };
  }

  return async function handle(req, { body, ip }) {
    const url = new URL(req.url, "http://local");
    const path = url.pathname;
    const method = req.method;
    const cookies = parseCookies(req.headers.cookie);

    if (path === "/api/health") return json(200, { ok: true, provider: config.llm.provider, mode: config.mode });

    // Calendar feeds are fetched by calendar apps, so they authenticate with the URL token.
    const cal = path.match(/^\/cal\/([A-Za-z0-9_-]{20,})\.ics$/);
    if (cal && method === "GET") {
      const h = store.byCalendarToken(cal[1]);
      if (!h) throw new HttpError(404, "not found");
      return { status: 200, headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" }, body: buildIcs(h, { timezone: config.timezone, name: `Hearthnote - ${h.recipient.name || "care"}` }) };
    }

    if (!path.startsWith("/api/")) return null;

    if (path === "/api/login" && method === "POST") {
      if (!passcode) return json(200, { ok: true });
      const ok = typeof body?.passcode === "string" && body.passcode.length === passcode.length && timingSafeEqual(Buffer.from(body.passcode), Buffer.from(passcode));
      if (!ok) throw new HttpError(401, "Wrong passcode");
      return json(200, { ok: true }, { "set-cookie": `hn_auth=${signAuth()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${config.secureCookies ? "; Secure" : ""}` });
    }
    if (!authed(cookies)) throw new HttpError(401, "passcode required");

    // Resolve the household for this request.
    const headers = {};
    const { household: h, session } = store.forRequest(cookies, (cookie) => (headers["set-cookie"] = cookie));
    const guard = guardFor(session);
    const opts = { budgetKey: session?.id, guard };
    const reply = (status, data) => json(status, data, headers);
    const done = (extra = {}) => {
      store.save(h);
      return reply(200, { ...extra, state: stateBody(h, session) });
    };

    if (path === "/api/state" && method === "GET") return reply(200, stateBody(h, session));

    if (path === "/api/notes" && method === "POST") {
      // Two steps on purpose: the note is saved and checked for red flags instantly, offline;
      // reading it with the model is a second request the client makes right after.
      const note = badInput(() => addNote(h, { text: body?.text, authorId: body?.authorId, source: body?.source === "voice" ? "voice" : "text" }));
      return done({ noteId: note.id, flags: note.flags });
    }

    let m;
    if ((m = path.match(/^\/api\/notes\/(N\d+)\/capture$/)) && method === "POST") {
      const note = h.notes.find((n) => n.id === m[1]);
      if (!note) throw new HttpError(404, "no such note");
      if (note.status === "done") return done({ noteId: note.id });
      try {
        await runner.capture(h, note, opts);
      } catch (err) {
        store.save(h);
        if (err instanceof HttpError) throw err;
        return reply(200, { noteId: note.id, error: "The note is saved, but it could not be read just now. You can try again.", state: stateBody(h, session) });
      }
      return done({ noteId: note.id });
    }

    if ((m = path.match(/^\/api\/memory\/([\w-]+)$/)) && method === "POST") {
      const f = h.memory.find((x) => x.id === m[1]);
      if (!f) throw new HttpError(404, "no such fact");
      if (!["confirmed", "rejected", "proposed"].includes(body?.status)) throw new HttpError(400, "bad status");
      f.status = body.status;
      if (typeof body.fact === "string" && body.fact.trim().length > 2) f.fact = body.fact.trim().slice(0, 200);
      return done();
    }

    if ((m = path.match(/^\/api\/routines\/([\w-]+)$/)) && method === "POST") {
      const r = h.routines.find((x) => x.id === m[1]);
      if (!r) throw new HttpError(404, "no such routine");
      if (!["active", "archived"].includes(body?.status)) throw new HttpError(400, "bad status");
      r.status = body.status;
      return done();
    }

    if ((m = path.match(/^\/api\/tasks\/([\w-]+)$/)) && method === "POST") {
      const t = h.tasks.find((x) => x.id === m[1]);
      if (!t) throw new HttpError(404, "no such task");
      t.done = Boolean(body?.done);
      return done();
    }

    if ((m = path.match(/^\/api\/skills\/([\w-]+)\/run$/)) && method === "POST") {
      if (!runner.get(h, m[1]) || runner.get(h, m[1]).output !== "brief") throw new HttpError(404, "no such skill");
      let brief;
      try {
        brief = await runner.brief(h, m[1], opts);
      } catch (err) {
        store.save(h);
        throw modelFailure(err);
      }
      return done({ briefId: brief.id });
    }

    if (path === "/api/skills" && method === "POST") {
      if ((h.customSkills || []).length >= 12) throw new HttpError(400, "That is a lot of skills already.");
      const skill = badInput(() => makeCustomSkill(body || {}));
      h.customSkills.push(skill);
      return done({ skillId: skill.id });
    }

    if ((m = path.match(/^\/api\/skills\/(custom-[\w-]+)$/)) && method === "DELETE") {
      h.customSkills = h.customSkills.filter((s) => s.id !== m[1]);
      return done();
    }

    if (path === "/api/ask" && method === "POST") {
      const question = String(body?.question || "").trim();
      if (question.length < 3) throw new HttpError(400, "Please type a question.");
      let answer;
      try {
        answer = await runner.ask(h, question, opts);
      } catch (err) {
        store.save(h);
        throw modelFailure(err);
      }
      store.save(h);
      return reply(200, { answer, state: stateBody(h, session) });
    }

    if ((m = path.match(/^\/api\/ledger\/([\w-]+)$/)) && method === "GET") {
      const e = h.ledger.find((x) => x.id === m[1]);
      if (!e) throw new HttpError(404, "no such entry");
      return reply(200, e);
    }

    if (path === "/api/members" && method === "POST") {
      if (h.members.length >= 10) throw new HttpError(400, "The circle is full.");
      const name = String(body?.name || "").trim();
      if (name.length < 2) throw new HttpError(400, "A name is needed.");
      addMember(h, { name, role: body?.role });
      return done();
    }

    if (path === "/api/recipient" && method === "POST") {
      const name = String(body?.name || "").trim().slice(0, 60);
      if (name.length < 2) throw new HttpError(400, "A name is needed.");
      h.recipient.name = name;
      if (body?.role) h.recipient.role = String(body.role).trim().slice(0, 80);
      return done();
    }

    if (path === "/api/private-terms" && method === "POST") {
      const text = String(body?.text || "").trim().slice(0, 80);
      if (text.length < 2) throw new HttpError(400, "Too short.");
      if (h.privateTerms.length >= 40) throw new HttpError(400, "Too many private terms.");
      h.privateTerms.push({ text, token: `PRIVATE${h.privateTerms.length + 1}` });
      return done();
    }

    if (path === "/api/demo/reset" && method === "POST") {
      if (!session) throw new HttpError(400, "not a demo");
      store.reset(session);
      return reply(200, { state: stateBody(session.household, session) });
    }

    if (path === "/api/export" && method === "GET") {
      const { ledger, ...rest } = h;
      return { status: 200, headers: { ...headers, "content-type": "application/json", "content-disposition": `attachment; filename="hearthnote-export-${uid("")}.json"`, "cache-control": "no-store" }, body: JSON.stringify(rest, null, 2) };
    }

    throw new HttpError(404, "not found");
  };
}
