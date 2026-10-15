// End-to-end check against the real Nebius Token Factory API, capped at 20 model calls.
//
//   HEARTH_USE_LOCAL_KEYS=1 LLM_PROVIDER=nebius node scripts/live-check.mjs
//   node scripts/live-check.mjs --mock          (same flow, offline, to test the script)
//
// What it does:
//   1. lists the Token Factory catalogue and resolves both Nemotron tiers (not a model call);
//   2. reads all 12 demo notes with the fast tier (12 calls) and bakes the results into
//      server/seed/demo-captures.json, so visitors of the hosted demo start from real captures;
//   3. runs the weekly brief, visit prep and medication check on the deep tier, the handover
//      and one question on the fast tier (5 calls);
//   4. verifies that no real name, street or phone number appears in any outbound prompt;
//   5. writes evidence/live-check-<date>.json and evidence/LIVE_CHECK.md (receipts only: model,
//      tokens, latency - never a key).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "../server/config.js";
import { createProvider } from "../server/llm/provider.js";
import { SkillRunner } from "../server/care/skills.js";
import { addMember, addNote, emptyHousehold } from "../server/care/household.js";
import { noteTimes } from "../server/seed/demo.js";
import { createReferenceLookup } from "../server/tools/reference.js";

const MAX_CALLS = 20;
const mock = process.argv.includes("--mock");
const env = { ...process.env, ...(mock ? { LLM_PROVIDER: "mock" } : {}) };
const config = loadConfig(env);
if (!mock && config.llm.provider !== "nebius") {
  console.error("No Token Factory key configured. Set NEBIUS_API_KEY or HEARTH_USE_LOCAL_KEYS=1 with nebius.api_key in the keys file.");
  process.exit(2);
}

const inner = createProvider(config.llm);
let calls = 0;
const provider = {
  name: inner.name,
  resolveModels: () => inner.resolveModels(),
  async complete(args) {
    if (++calls > MAX_CALLS) throw new Error(`call cap of ${MAX_CALLS} reached`);
    const t0 = Date.now();
    try {
      return await inner.complete(args);
    } finally {
      console.log(`  call ${String(calls).padStart(2)} ${args.tier.padEnd(4)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  },
};

const started = new Date();
const resolved = await provider.resolveModels();
console.log(`provider ${provider.name}; fast ${resolved.fast}; deep ${resolved.deep}`);
if (resolved.available?.length) console.log(`NVIDIA models in the catalogue: ${resolved.available.join(", ")}`);

const lookup = createReferenceLookup({ apiKey: config.tavilyKey });
const runner = new SkillRunner({ provider, tools: lookup ? { lookup } : {} });

// Fresh household from the fixture, with no captures.
const fixture = JSON.parse(readFileSync(join(ROOT, "server/seed/demo-notes.json"), "utf8"));
const today = new Date();
const anchor = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
const h = emptyHousehold({ recipientName: fixture.recipient.name, recipientRole: fixture.recipient.role });
for (const m of fixture.members) addMember(h, m);
h.privateTerms = fixture.privateTerms.map((text, i) => ({ text, token: `PRIVATE${i + 1}` }));
const times = noteTimes(anchor);

const evidence = { startedAt: started.toISOString(), provider: provider.name, models: resolved, steps: [], leaks: [] };
const captures = [];
console.log("\n1) reading the 12 demo notes (fast tier)");
for (const [i, n] of fixture.notes.entries()) {
  const author = h.members.find((m) => m.name === n.by);
  const note = addNote(h, { text: n.text, authorId: author.id, at: times[i] });
  await runner.capture(h, note, { now: new Date(note.at) });
  captures.push({ capture: note.capture, receipt: note.receipt });
  evidence.steps.push({ step: `capture ${note.id}`, receipt: note.receipt, summary: note.capture.summary, counts: Object.fromEntries(["observations", "medications", "tasks", "routines", "appointments", "memory"].map((k) => [k, note.capture[k].length])) });
}

// Same steady state as the demo: older proposals reviewed by the family.
const cutoff = new Date(anchor - 2 * 86400_000).toISOString();
for (const f of h.memory) if (f.at < cutoff) f.status = "confirmed";
for (const r of h.routines) if ((h.notes.find((x) => x.id === r.noteId)?.at || "") < cutoff) r.status = "active";

console.log("\n2) skills");
const briefs = {};
for (const id of ["weekly-digest", "visit-prep", "med-check", "handover"]) {
  const b = await runner.brief(h, id, { now: today });
  briefs[id] = b;
  evidence.steps.push({ step: id, receipt: b.receipt, headline: b.brief.headline, sections: b.brief.sections.map((s) => `${s.heading} (${s.items.length})`), questions: b.brief.questions.map((q) => q.text), references: b.references.map((r) => r.url) });
}
const answer = await runner.ask(h, "When did the dizziness start, and has anything changed since?", { now: today });
evidence.steps.push({ step: "ask", receipt: answer.receipt, answer: answer.answer, cites: answer.cites });

// Privacy check over every outbound prompt.
const real = [fixture.recipient.name, ...fixture.members.map((m) => m.name), ...fixture.privateTerms, "016 23 45 67"];
for (const e of h.ledger) for (const r of real) if (e.outbound.includes(r)) evidence.leaks.push({ skill: e.skillId, term: r });
evidence.calls = calls;
evidence.finishedAt = new Date().toISOString();
evidence.totals = {
  promptTokens: h.ledger.reduce((s, e) => s + (e.receipt?.promptTokens || 0), 0),
  completionTokens: h.ledger.reduce((s, e) => s + (e.receipt?.completionTokens || 0), 0),
  withheld: h.ledger.reduce((s, e) => s + (e.redactions || 0), 0),
};

const day = today.toISOString().slice(0, 10);
const dir = join(ROOT, "evidence");
mkdirSync(dir, { recursive: true });
const tag = mock ? "mock" : day;
writeFileSync(join(dir, `live-check-${tag}.json`), JSON.stringify({ ...evidence, briefs, answer, captures }, null, 2));
if (!mock) {
  writeFileSync(join(ROOT, "server/seed/demo-captures.json"), JSON.stringify({ bakeDate: day, fastModel: resolved.fast, captures }, null, 2));
  const md = [
    `# Live check against Nebius Token Factory - ${day}`,
    "",
    `Run by \`scripts/live-check.mjs\`. ${calls} model calls (cap ${MAX_CALLS}). Started ${evidence.startedAt}, finished ${evidence.finishedAt}.`,
    "",
    `- Fast tier: \`${resolved.fast}\``,
    `- Deep tier: \`${resolved.deep}\``,
    resolved.available?.length ? `- NVIDIA models listed by the catalogue: ${resolved.available.map((m) => `\`${m}\``).join(", ")}` : "",
    `- Tokens: ${evidence.totals.promptTokens.toLocaleString()} prompt, ${evidence.totals.completionTokens.toLocaleString()} completion`,
    `- Names and identifiers withheld from the model: ${evidence.totals.withheld}; real names found in outbound prompts: **${evidence.leaks.length}**`,
    "",
    "| Step | Model | Tier | Latency | Tokens in / out |",
    "| --- | --- | --- | ---: | ---: |",
    ...evidence.steps.map((s) => `| ${s.step} | \`${s.receipt.model}\` | ${s.receipt.tier} | ${(s.receipt.latencyMs / 1000).toFixed(1)} s | ${s.receipt.promptTokens ?? "-"} / ${s.receipt.completionTokens ?? "-"} |`),
    "",
    "## Weekly brief headline",
    "",
    `> ${briefs["weekly-digest"].brief.headline}`,
    "",
    "## Questions it raised for the GP",
    "",
    ...briefs["weekly-digest"].brief.questions.map((q) => `- ${q.text} (${q.cites.join(", ")})`),
    "",
    "## Answer to \"When did the dizziness start?\"",
    "",
    `> ${answer.answer}`,
    "",
    `Full outputs: \`evidence/live-check-${day}.json\`. The household is the fictional demo household; no real person's data was sent.`,
  ].filter((l) => l !== "").join("\n").replace(/\n(#|>|\||-)/g, "\n$1");
  writeFileSync(join(dir, "LIVE_CHECK.md"), md + "\n");
}
console.log(`\n${calls} calls; leaks ${evidence.leaks.length}; tokens ${evidence.totals.promptTokens}/${evidence.totals.completionTokens}; evidence in evidence/live-check-${tag}.json`);
if (evidence.leaks.length) process.exit(1);
