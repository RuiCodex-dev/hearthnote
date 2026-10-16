import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server/main.js";
import { loadConfig } from "../server/config.js";

let server, base, cookie = "";
const NAMES = /Mireille|Anouk|Bram|Sofie|Claes|Vaartstraat|016 23 45 67/;

async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers || {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.startsWith("hn_sid")) cookie = sc.split(";")[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

before(async () => {
  const config = loadConfig({ LLM_PROVIDER: "mock", HEARTH_MODE: "demo", HEARTH_CALLS_PER_SESSION: "6" });
  ({ server } = await buildServer(config));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("a visitor gets a seeded sandbox with security headers", async () => {
  const r = await call("/api/state");
  assert.equal(r.status, 200);
  assert.equal(r.body.notes.length, 12);
  assert.equal(r.body.config.provider, "mock");
  assert.ok(!JSON.stringify(r.body.config).match(/key/i) || !JSON.stringify(r.body.config).includes("apiKey"));
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.ok(cookie.startsWith("hn_sid="));
});

test("adding a note captures it, flags emergencies and never sends names", async () => {
  const saved = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "Mireille fell near the stairs and hit her head. Anouk needs to call Dr. Claes tomorrow.", authorId: "P2" }) });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.flags.some((f) => f.id === "head"), "red flag is returned before any model call");
  assert.equal(saved.body.state.ledger.length, 0);
  const r = await call(`/api/notes/${saved.body.noteId}/capture`, { method: "POST" });
  assert.equal(r.status, 200);
  const note = r.body.state.notes[0];
  assert.equal(note.status, "done");
  assert.ok(note.flags.some((f) => f.id === "head"));
  const entry = r.body.state.ledger[0];
  const full = await call(`/api/ledger/${entry.id}`);
  assert.ok(!NAMES.test(full.body.outbound), "outbound prompt contains a real name");
  assert.ok(entry.redactions >= 3);
});

test("skills run, cite real notes and respect the per-sandbox budget", async () => {
  const r = await call("/api/skills/weekly-digest/run", { method: "POST" });
  assert.equal(r.status, 200);
  const brief = r.body.state.briefs[0];
  const ids = new Set(r.body.state.notes.map((n) => n.id));
  for (const s of brief.brief.sections) for (const it of s.items) for (const c of it.cites) assert.ok(ids.has(c));
  const a = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "Is she dizzy?" }) });
  assert.equal(a.status, 200);
  // budget is 6 per sandbox: 1 note + 1 brief + 1 ask used, three more allowed, then 429
  for (let i = 0; i < 3; i++) assert.equal((await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "Sleep?" }) })).status, 200);
  assert.equal((await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "Sleep?" }) })).status, 429);
});

test("memory confirmation, custom skills and calendar feed", async () => {
  const st = (await call("/api/state")).body;
  const proposed = st.memory.find((m) => m.status === "proposed") || st.memory[0];
  const r = await call(`/api/memory/${proposed.id}`, { method: "POST", body: JSON.stringify({ status: "confirmed" }) });
  assert.equal(r.status, 200);
  const s = await call("/api/skills", { method: "POST", body: JSON.stringify({ title: "Physio summary", instructions: "Summarise mobility and exercises for the physiotherapist.", tier: "fast" }) });
  assert.equal(s.status, 200);
  assert.ok(s.body.state.skills.some((k) => k.title === "Physio summary"));
  const ics = await fetch(base + st.calendarPath).then((x) => x.text());
  assert.match(ics, /BEGIN:VEVENT/);
  assert.equal((await fetch(base + "/cal/not-a-real-token-at-all-xx.ics")).status, 404);
});

test("static files are served and path traversal is refused", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/..%2f..%2fpackage.json")).status, 404);
});
