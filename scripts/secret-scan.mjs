// Pre-commit secret scan. Looks at every file git would commit and at the whole history, for
// (a) the literal value of any key in the local keys folder and (b) common credential shapes.
// Prints file:line and a rule name only - never the matching value. Exit 1 on any finding.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const literals = new Set();
for (const v of [process.env.NEBIUS_API_KEY, process.env.TAVILY_API_KEY, process.env.HEARTH_VAULT_KEY, process.env.HEARTH_PASSCODE]) if (v && v.length >= 10) literals.add(v);
const keyDir = join(homedir(), ".ruicodex-keys");
if (existsSync(keyDir)) {
  for (const f of readdirSync(keyDir).filter((f) => f.endsWith(".json"))) {
    // Only values stored under secret-looking names (api_key, password, promo_code, ...): the
    // keys file also holds public notes and URLs that legitimately appear in docs.
    const SECRETISH = /(key|secret|password|token|pat|code|value|credential)/i;
    const walk = (o, name = "") => {
      if (typeof o === "string") {
        if (SECRETISH.test(name) && o.length >= 8 && !/\s/.test(o) && !/^https?:/.test(o)) literals.add(o);
      } else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, Array.isArray(o) ? name : k);
    };
    try {
      walk(JSON.parse(readFileSync(join(keyDir, f), "utf8")));
    } catch { /* not JSON */ }
  }
}

const RULES = [
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{24,}/],
  ["nebius-style-jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["tavily-key", /\btvly-[A-Za-z0-9]{16,}/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer-literal", /authorization["']?\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._-]{20,}/i],
  ["assigned-secret", /(api[_-]?key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/]{24,}["']/i],
];
const BINARY = /\.(png|jpe?g|webp|gif|woff2?|ttf|mp4|mp3|wav|m4a|ico|zip|pdf)$/i;

let findings = 0;
const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of files) {
  if (!existsSync(f) || BINARY.test(f) || statSync(f).size > 5_000_000) continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const lit of literals) if (line.includes(lit)) (findings++, console.log(`${f}:${i + 1}  configured-key-value`));
    for (const [name, re] of RULES) if (re.test(line)) (findings++, console.log(`${f}:${i + 1}  ${name}`));
  });
}

// History: every blob ever committed.
let history = "";
try {
  history = execSync("git log -p --all --no-color", { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
} catch { /* no commits yet */ }
for (const lit of literals) if (history.includes(lit)) (findings++, console.log("git history  configured-key-value"));

console.log(findings ? `secret-scan: ${findings} finding(s)` : `secret-scan: clean (${files.length} files + history, ${literals.size} configured values checked)`);
process.exit(findings ? 1 : 0);
