import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor } from "../server/privacy/redact.js";
import { redFlags } from "../server/privacy/safety.js";
import { extractJson, stripReasoning, validate } from "../server/llm/json.js";
import { createProvider } from "../server/llm/provider.js";
import { rrule, buildIcs } from "../server/care/ics.js";
import { demoAnchor, demoHousehold } from "../server/seed/demo.js";
import { open, seal, deriveKey } from "../server/store/vault.js";
import { retrieve } from "../server/care/search.js";
import { weekKey } from "../server/main.js";
import { randomBytes } from "node:crypto";

const people = [
  { token: "P1", names: ["Mireille"], display: "Mireille", role: "mum" },
  { token: "P2", names: ["Anouk"], display: "Anouk", role: "daughter" },
];

test("redactor replaces names, private terms and identifiers, and restores them", () => {
  const r = createRedactor({ people, privateTerms: [{ text: "Claes", token: "PRIVATE1" }] });
  const src = "Anouk took Mireille to Dr. Claes. Call 016 23 45 67 or +32 470 12 34 56, mail mireille.p@example.be, NRN 44.03.12-123.45, IBAN BE68 5390 0754 7034, home Vaartstraat 12.";
  const { text, found } = r.redact(src);
  for (const leak of ["Anouk", "Mireille", "Claes", "016 23", "+32 470", "example.be", "44.03.12", "BE68", "Vaartstraat"]) assert.ok(!text.includes(leak), `leaked ${leak}: ${text}`);
  assert.match(text, /\[P2\] took \[P1\] to Dr\. \[PRIVATE1\]/);
  const restore = r.restorer(found);
  assert.equal(restore(text), src.replace("mireille.p@example.be", "mireille.p@example.be"));
});

test("redactor handles possessives and leaves ordinary words alone", () => {
  const r = createRedactor({ people: [{ token: "P3", names: ["Bram"], role: "son" }] });
  assert.equal(r.redact("Bram's car. Brambles in the garden.").text, "[P3]'s car. Brambles in the garden.");
});

test("red flags fire on emergencies and stay quiet on ordinary notes", () => {
  assert.deepEqual(redFlags("She fell in the kitchen and hit her head").map((f) => f.id), ["head"]);
  assert.ok(redFlags("Her speech was slurred and her face drooping").some((f) => f.id === "stroke"));
  assert.deepEqual(redFlags("Lovely afternoon, she ate well and slept better."), []);
});

test("reasoning is stripped and JSON is found in fenced or noisy output", () => {
  assert.equal(stripReasoning("<think>plan</think> hello"), "hello");
  assert.deepEqual(extractJson("<think>x</think>```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJson("Sure: {\"a\": [1,2]} done"), { a: [1, 2] });
});

test("validator coerces drift and fills required arrays", () => {
  const schema = { type: "object", required: ["xs", "n"], properties: { xs: { type: "array", items: { type: "string" } }, n: { type: "integer", minimum: 0, maximum: 3 }, e: { type: "string", enum: ["a", "b"], default: "a" } } };
  const { value } = validate(schema, { n: "7", e: "zzz" });
  assert.deepEqual(value, { xs: [], n: 3, e: "a" });
});

test("provider degrades json_schema to json_object after a 400 and returns a receipt", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.response_format?.type === "json_schema") return new Response("response_format json_schema unsupported", { status: 400 });
    return new Response(JSON.stringify({ model: body.model, usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: "<think>hm</think>{\"answer\":\"ok\",\"cites\":[],\"confidence\":\"high\"}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const p = createProvider({ provider: "nebius", apiKey: "test-key-not-real", baseUrl: "https://example.invalid/v1/", fastModel: "nvidia/fast", deepModel: "nvidia/deep", timeoutMs: 5000, fastThinking: false, deepThinking: true }, { fetchImpl: fakeFetch });
  const schema = { type: "object", required: ["answer"], properties: { answer: { type: "string" }, cites: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["high", "low"] } } };
  const out = await p.complete({ tier: "fast", system: "s", user: "u", schema });
  assert.equal(out.json.answer, "ok");
  assert.equal(out.receipt.model, "nvidia/fast");
  assert.equal(calls[1].response_format.type, "json_object");
  assert.deepEqual(calls[0].chat_template_kwargs, { enable_thinking: false });
});

test("provider resolves models from the catalogue and falls back to a Nemotron", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ data: [{ id: "meta/llama" }, { id: "nvidia/Nemotron-3-Ultra-550b-a55b" }, { id: "nvidia/nemotron-3-super-120b-a12b" }] }), { status: 200 });
  const p = createProvider({ provider: "nebius", apiKey: "k-not-real", baseUrl: "https://example.invalid/v1", fastModel: "nvidia/does-not-exist", deepModel: "nvidia/Nemotron-3-Ultra-550b-a55b", timeoutMs: 1000 }, { fetchImpl: fakeFetch });
  const r = await p.resolveModels();
  assert.equal(r.fast, "nvidia/nemotron-3-super-120b-a12b");
  assert.equal(r.deep, "nvidia/Nemotron-3-Ultra-550b-a55b");
});

test("ics recurrence rules and feed", () => {
  assert.equal(rrule("daily"), "FREQ=DAILY");
  assert.equal(rrule("every Monday and Thursday"), "FREQ=WEEKLY;BYDAY=MO,TH");
  const h = demoHousehold(new Date("2026-10-15T12:00:00Z"));
  const ics = buildIcs(h, { now: new Date("2026-10-15T12:00:00Z") });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
});

test("demo anchor keeps the bake weekday", () => {
  const anchor = demoAnchor(new Date("2026-10-20T10:00:00Z"), "2026-10-15");
  assert.equal(new Date(anchor).getUTCDay(), new Date("2026-10-15T00:00:00Z").getUTCDay());
  assert.ok(anchor <= Date.parse("2026-10-20T00:00:00Z"));
});

test("vault seal/open round trip and tamper detection", () => {
  const key = deriveKey("correct horse battery staple", randomBytes(16));
  const box = seal({ a: 1, note: "private" }, key);
  assert.ok(!box.toString("utf8").includes("private"));
  assert.deepEqual(open(box, key), { a: 1, note: "private" });
  box[box.length - 1] ^= 1;
  assert.throws(() => open(box, key));
});

test("retrieval finds the relevant notes", () => {
  const h = demoHousehold(new Date("2026-10-15T12:00:00Z"));
  const hits = retrieve(h.notes, "dizzy when standing up", 3).map((n) => n.text);
  assert.ok(hits.some((t) => /dizzy/i.test(t)));
});

test("week key is ISO", () => {
  assert.equal(weekKey(new Date("2026-10-15T12:00:00Z"), "Europe/Brussels"), "2026-W42");
  assert.equal(weekKey(new Date("2027-01-01T12:00:00Z"), "Europe/Brussels"), "2026-W53");
});

test("the demo opens with at least one fact waiting for a person's OK", async () => {
  const { demoHousehold } = await import("../server/seed/demo.js");
  for (const day of ["2026-10-15T09:00:00Z", "2026-10-16T09:00:00Z", "2026-10-21T20:00:00Z"]) {
    const h = demoHousehold(new Date(day));
    assert.ok(h.memory.some((f) => f.status === "proposed"), `no proposed fact on ${day}`);
    assert.ok(h.memory.some((f) => f.status === "confirmed"), `no confirmed fact on ${day}`);
  }
});

test("re-identification also restores tokens the model wrote without brackets", () => {
  const r = createRedactor({ people: [{ token: "P1", names: ["Mireille"], role: "mum" }, { token: "P3", names: ["Bram"], role: "son" }], privateTerms: [{ text: "Dr. Claes", token: "PRIVATE1" }] });
  const restore = r.restorer([]);
  assert.equal(restore("Fix the rug - P3 (2026-10-08)"), "Fix the rug - Bram (2026-10-08)");
  assert.equal(restore({ assignee: "P3", text: "[P1] sees PRIVATE1 on Tuesday" }).text, "Mireille sees Dr. Claes on Tuesday");
  assert.equal(restore("P9 is unknown, MP3 and P1x stay"), "P9 is unknown, MP3 and P1x stay");
});
