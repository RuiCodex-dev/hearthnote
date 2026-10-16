// End-to-end QA over HTTP against the real Nebius Token Factory API: every route the web app
// uses, every built-in skill, a custom skill, and the edge cases (empty input, very long input,
// red flags, an unanswerable question, a refused key). Capped at 14 model calls.
//
//   HEARTH_USE_LOCAL_KEYS=1 node scripts/e2e-live.mjs        (real Nemotron, about USD 0.05)
//   node scripts/e2e-live.mjs --mock                          (same flow, offline)
//
// Writes qa/e2e-live-<date>.json (receipts, statuses, timings - never a key) and prints a
// PASS/FAIL line per check. Exit code 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "../server/config.js";
import { buildServer } from "../server/main.js";
import { createProvider } from "../server/llm/provider.js";

const MAX_CALLS = 14;
const PRICES = { // USD per million tokens, Token Factory public catalogue (2026-10-16)
  "nvidia/nemotron-3-super-120b-a12b": [0.3, 0.9],
  "nvidia/Nemotron-3-Ultra-550b-a55b": [1, 3],
};
const mock = process.argv.includes("--mock");
const env = { ...process.env, HEARTH_MODE: "demo", HEARTH_CALLS_PER_SESSION: String(MAX_CALLS), ...(mock ? { LLM_PROVIDER: "mock" } : { LLM_PROVIDER: "nebius" }) };
const config = loadConfig(env);
const { server, resolved } = await buildServer(config);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
let cookie = "";
const NAMES = /Mireille|Anouk|Bram|Sofie|Peeters|Claes|Vaartstraat|016 23 45 67|Josiane|Kessel-Lo/;

async function call(path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers || {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.startsWith("hn_sid")) cookie = sc.split(";")[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, ms: Date.now() - t0, headers: res.headers };
}

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  - ${detail}` : ""}`);
}

const receipts = [];
const keep = (step, r) => r && receipts.push({ step, model: r.model, tier: r.tier, thinking: r.thinking, latencyMs: r.latencyMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens, schemaWarnings: r.schemaWarnings ?? 0 });

console.log(`provider ${config.llm.provider}; fast ${resolved.fast}; deep ${resolved.deep}\n`);

// 1. Health, state, static, security headers.
const health = await call("/api/health");
check("health reports the provider", health.status === 200 && health.body.provider === config.llm.provider, JSON.stringify(health.body));
const st = await call("/api/state");
check("a new visitor gets a seeded sandbox (12 notes, no model call)", st.status === 200 && st.body.notes.length === 12 && st.body.ledger.length === 0);
check("seeded captures come from the bake, not the mock", mock || st.body.notes.every((n) => n.receipt?.provider === "nebius"), st.body.notes[0]?.receipt?.model);
check("no key material in the state", !/apiKey|Bearer/.test(JSON.stringify(st.body)) && (!config.llm.apiKey || !JSON.stringify(st.body).includes(config.llm.apiKey)));
check("strict CSP on every response", /default-src 'self'/.test(st.headers.get("content-security-policy") || ""));
const page = await fetch(base + "/");
check("the web app loads", page.status === 200 && (await page.text()).includes("Hearthnote"));

// 2. Edge cases that must not reach the model.
const empty = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "   " }) });
check("empty note -> 400", empty.status === 400, empty.body.error);
const emptyQ = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) });
check("empty question -> 400", emptyQ.status === 400, emptyQ.body.error);
const badSkill = await call("/api/skills/nope/run", { method: "POST" });
check("unknown skill -> 404", badSkill.status === 404);
const huge = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "x".repeat(70 * 1024) }) });
check("oversized body -> 413", huge.status === 413);
check("edge cases spent no model calls", (await call("/api/state")).body.budget.used === 0);

// 3. Write a note -> capture (fast tier, real model).
const NOTE = "Took Mum to the market with Anouk. She was a bit dizzy getting off the bus, so we sat at the cafe. She ate a whole croissant. Eye drops done at nine. We need to buy new batteries for her hearing aid before Friday.";
const saved = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: NOTE, authorId: "P3" }) });
check("note saved instantly without the model", saved.status === 200 && saved.body.flags.length === 0 && saved.ms < 1000, `${saved.ms} ms`);
const cap = await call(`/api/notes/${saved.body.noteId}/capture`, { method: "POST" });
const capNote = cap.body.state?.notes.find((n) => n.id === saved.body.noteId);
keep("capture (ordinary note)", capNote?.receipt);
check("capture files the note", cap.status === 200 && capNote?.status === "done", `${cap.ms} ms; obs ${capNote?.capture?.observations.length}, tasks ${capNote?.capture?.tasks.length}, meds ${capNote?.capture?.medications.length}`);
check("capture finds the hearing-aid task", (cap.body.state?.tasks || []).some((t) => /batter/i.test(t.title)));
check("capture records a mobility/dizziness observation", (capNote?.capture?.observations || []).some((o) => /dizz/i.test(o.text)));

// 4. Red flag: offline warning before any model call, then capture.
const flagged = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "Mum fell in the bathroom and hit her head on the sink. Bram is with her now.", authorId: "P2" }) });
check("emergency flagged offline before the model", flagged.status === 200 && flagged.body.flags.some((f) => f.id === "head"), JSON.stringify(flagged.body.flags));
const flagCap = await call(`/api/notes/${flagged.body.noteId}/capture`, { method: "POST" });
const fn = flagCap.body.state?.notes.find((n) => n.id === flagged.body.noteId);
keep("capture (red-flag note)", fn?.receipt);
check("red-flag note is still filed", flagCap.status === 200 && fn?.status === "done", `${flagCap.ms} ms`);

// 5. Very long note (truncated to 4,000 characters) still captures.
const longText = Array.from({ length: 40 }, (_, i) => `Day ${i + 1}: she walked to the corner with the frame, ate soup at lunch, slept after dinner and asked about the garden.`).join(" ");
const longSaved = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: longText, authorId: "P4" }) });
const longCap = await call(`/api/notes/${longSaved.body.noteId}/capture`, { method: "POST" });
const ln = longCap.body.state?.notes.find((n) => n.id === longSaved.body.noteId);
keep("capture (4,000-character note)", ln?.receipt);
check("long note truncated to 4,000 chars and filed", ln?.text.length === 4000 && ln?.status === "done", `${longCap.ms} ms`);

// 6. Memory consent, routines, tasks.
let s = (await call("/api/state")).body;
const fact = s.memory.find((m) => m.status === "proposed") || s.memory[0];
if (fact) {
  const c = await call(`/api/memory/${fact.id}`, { method: "POST", body: JSON.stringify({ status: "confirmed", fact: fact.fact + " (checked)" }) });
  check(`a ${fact.status} fact can be confirmed and edited`, c.status === 200 && c.body.state.memory.find((m) => m.id === fact.id)?.status === "confirmed");
} else check("the household has facts to confirm", false);
const rej = s.memory.find((m) => m.status === "proposed" && m.id !== fact?.id);
if (rej) check("a fact can be forgotten", (await call(`/api/memory/${rej.id}`, { method: "POST", body: JSON.stringify({ status: "rejected" }) })).body.state.memory.every((m) => m.id !== rej.id));
const routine = s.routines.find((r) => r.status === "proposed") || s.routines[0];
if (routine) check("a routine can be accepted", (await call(`/api/routines/${routine.id}`, { method: "POST", body: JSON.stringify({ status: "active" }) })).status === 200);
const task = s.tasks.find((t) => !t.done);
check("a task can be ticked off", (await call(`/api/tasks/${task.id}`, { method: "POST", body: JSON.stringify({ done: true }) })).body.state.tasks.find((t) => t.id === task.id).done === true);
check("bad status values are refused", (await call(`/api/memory/${s.memory[0].id}`, { method: "POST", body: JSON.stringify({ status: "hacked" }) })).status === 400);

// 7. Circle, private words, calendar, export.
check("a member can join the circle", (await call("/api/members", { method: "POST", body: JSON.stringify({ name: "Josiane", role: "neighbour, has a key" }) })).body.state.members.some((m) => m.name === "Josiane"));
check("a private word can be added", (await call("/api/private-terms", { method: "POST", body: JSON.stringify({ text: "Kessel-Lo" }) })).status === 200);
s = (await call("/api/state")).body;
const ics = await fetch(base + s.calendarPath);
const icsText = await ics.text();
check("calendar feed serves VEVENTs", ics.status === 200 && /BEGIN:VCALENDAR/.test(icsText) && /BEGIN:VEVENT/.test(icsText), `${(icsText.match(/BEGIN:VEVENT/g) || []).length} events`);
check("a wrong calendar token is 404", (await fetch(base + "/cal/aaaaaaaaaaaaaaaaaaaaaaaa.ics")).status === 404);
const exp = await fetch(base + "/api/export", { headers: { cookie } });
check("export downloads the household without the ledger", exp.status === 200 && /attachment/.test(exp.headers.get("content-disposition") || "") && !(await exp.text()).includes('"outbound"'));

// 8. Skills on both tiers.
for (const id of ["weekly-digest", "visit-prep", "med-check", "handover"]) {
  const r = await call(`/api/skills/${id}/run`, { method: "POST" });
  const b = r.body.state?.briefs.find((x) => x.id === r.body.briefId);
  keep(`skill ${id}`, b?.receipt);
  const ids = new Set(r.body.state?.notes.map((n) => n.id));
  const cites = (b?.brief.sections || []).flatMap((x) => x.items.flatMap((i) => i.cites));
  check(`skill ${id} writes a cited brief`, r.status === 200 && b && cites.length > 0 && cites.every((c) => ids.has(c) || /^S\d+$/.test(c)), `${r.ms} ms, ${b?.brief.sections.length} sections, ${cites.length} citations, ${b?.brief.questions.length} questions`);
}
const sk = await call("/api/skills", { method: "POST", body: JSON.stringify({ title: "Physio summary", instructions: "Summarise mobility, dizziness, falls and walking distance for the physiotherapist. Note what got easier and what got harder.", tier: "fast", days: 14 }) });
check("a family-written skill can be saved", sk.status === 200);
const runCustom = await call(`/api/skills/${sk.body.skillId}/run`, { method: "POST" });
const cb = runCustom.body.state?.briefs.find((x) => x.id === runCustom.body.briefId);
keep("custom skill", cb?.receipt);
check("the custom skill runs on the fast tier", runCustom.status === 200 && cb?.receipt?.tier === "fast", `${runCustom.ms} ms`);
check("a custom skill can be deleted", (await call(`/api/skills/${sk.body.skillId}`, { method: "DELETE" })).body.state.skills.every((x) => x.id !== sk.body.skillId));

// 9. Ask: answerable and unanswerable.
const ask = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "When did the dizziness start?" }) });
keep("ask (answerable)", ask.body.answer?.receipt);
check("ask answers from the notes with citations", ask.status === 200 && ask.body.answer.cites.length > 0, `${ask.ms} ms: ${String(ask.body.answer?.answer).slice(0, 140)}`);
const ask2 = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "What is her favourite film?" }) });
keep("ask (unanswerable)", ask2.body.answer?.receipt);
check("ask admits when the notes do not say", ask2.status === 200 && (ask2.body.answer.confidence === "low" || /not|no (note|mention|record)/i.test(ask2.body.answer.answer)), `${ask2.body.answer?.confidence}: ${String(ask2.body.answer?.answer).slice(0, 140)}`);

// 10. Privacy: every outbound prompt checked for real names.
s = (await call("/api/state")).body;
let leaks = 0, withheld = 0;
for (const e of s.ledger) {
  const full = await call(`/api/ledger/${e.id}`);
  if (NAMES.test(full.body.outbound)) leaks += 1;
  withheld += e.redactions;
}
check("no real name, street or phone number in any outbound prompt", leaks === 0, `${s.ledger.length} prompts, ${withheld} names/identifiers withheld`);
check("budget counter matches the calls made", s.budget.used === s.ledger.length, `${s.budget.used} used, ${s.ledger.length} ledger entries`);

// 11. Reset.
const reset = await call("/api/demo/reset", { method: "POST" });
check("Start over restores the demo household", reset.status === 200 && reset.body.state.notes.length === 12);

// 12. A refused key against the real endpoint (no tokens are spent on a 401).
if (!mock) {
  const bad = createProvider({ ...config.llm, apiKey: "not-a-real-key", timeoutMs: 20000 });
  const t0 = Date.now();
  let err = null;
  try { await bad.complete({ system: "s", user: "Say OK as JSON {\"ok\":true}", schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } }); } catch (e) { err = e; }
  check("a refused key fails fast with an auth error", err && err.kind === "auth", `${err?.message} in ${Date.now() - t0} ms`);
}

server.close();
const cost = receipts.reduce((sum, r) => {
  const p = PRICES[r.model] || [1, 3];
  return sum + ((r.promptTokens || 0) * p[0] + (r.completionTokens || 0) * p[1]) / 1e6;
}, 0);
const out = {
  ranAt: new Date().toISOString(),
  provider: config.llm.provider,
  models: { fast: resolved.fast, deep: resolved.deep },
  checks: results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  modelCalls: receipts.length,
  tokens: { prompt: receipts.reduce((a, r) => a + (r.promptTokens || 0), 0), completion: receipts.reduce((a, r) => a + (r.completionTokens || 0), 0) },
  estimatedCostUsd: Number(cost.toFixed(4)),
  receipts,
};
const dir = join(ROOT, "qa");
mkdirSync(dir, { recursive: true });
const file = join(dir, `e2e-live-${mock ? "mock" : out.ranAt.slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n${out.passed} passed, ${out.failed} failed; ${out.modelCalls} model calls; tokens ${out.tokens.prompt}/${out.tokens.completion}; ~USD ${out.estimatedCostUsd}; ${file}`);
process.exit(out.failed ? 1 : 0);
