// Edge cases and failure handling, offline. A tiny local HTTP server stands in for Token Factory
// so timeouts, refused keys and outages can be produced on demand without spending credits.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildServer } from "../server/main.js";
import { loadConfig } from "../server/config.js";
import { createProvider } from "../server/llm/provider.js";
import { createReferenceLookup } from "../server/tools/reference.js";

let fake, fakeBase, mode = "ok";
const seen = [];

function startFake() {
  return new Promise((resolve) => {
    fake = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      seen.push({ url: req.url, mode });
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "nvidia/nemotron-3-super-120b-a12b" }, { id: "nvidia/Nemotron-3-Ultra-550b-a55b" }] }));
      }
      if (mode === "hang") return; // never answers: the client must time out
      if (mode === "auth") { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"detail":"Invalid API key"}'); }
      if (mode === "down") { res.writeHead(503, { "retry-after": "0" }); return res.end("busy"); }
      if (mode === "garbage") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b", choices: [{ message: { content: "I am not JSON at all" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "nvidia/nemotron-3-super-120b-a12b", choices: [{ message: { content: '{"answer":"Since Thursday.","cites":["N8"],"confidence":"medium"}' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    });
    fake.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${fake.address().port}/v1/`));
  });
}

let server, base, cookie = "";
async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers || {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.startsWith("hn_sid")) cookie = sc.split(";")[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  fakeBase = await startFake();
  const config = loadConfig({ LLM_PROVIDER: "nebius", NEBIUS_API_KEY: "test-key-not-real", NEBIUS_BASE_URL: fakeBase, HEARTH_LLM_TIMEOUT_MS: "400", HEARTH_MODE: "demo" });
  ({ server } = await buildServer(config));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fake.close(); });

test("empty input is a 400, not a server error", async () => {
  await call("/api/state");
  for (const text of ["", "  ", "a"]) assert.equal((await call("/api/notes", { method: "POST", body: JSON.stringify({ text }) })).status, 400);
  assert.equal((await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) })).status, 400);
  assert.equal((await call("/api/ask", { method: "POST", body: "{}" })).status, 400);
  assert.equal((await call("/api/skills", { method: "POST", body: JSON.stringify({ title: "", instructions: "" }) })).status, 400);
  assert.equal((await call("/api/skills/does-not-exist/run", { method: "POST" })).status, 404);
  assert.equal((await call("/api/notes", { method: "POST", body: "{not json" })).status, 400);
});

test("very long input is bounded: 4,000 characters kept, oversized bodies refused", async () => {
  const long = "She walked to the bakery and back without the frame. ".repeat(120);
  const r = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: long }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.state.notes[0].text.length, 4000);
  const huge = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "x".repeat(70 * 1024) }) });
  assert.equal(huge.status, 413);
});

test("a model timeout returns quickly with a plain message and keeps the note", async () => {
  mode = "hang";
  const saved = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "Slept badly, up three times." }) });
  const t0 = Date.now();
  const cap = await call(`/api/notes/${saved.body.noteId}/capture`, { method: "POST" });
  assert.ok(Date.now() - t0 < 3000, "a timeout must not be retried for minutes");
  assert.equal(cap.status, 200);
  assert.match(cap.body.error, /saved/);
  assert.equal(cap.body.state.notes.find((n) => n.id === saved.body.noteId).status, "error");
  const ask = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "When did the dizziness start?" }) });
  assert.equal(ask.status, 502);
  assert.match(ask.body.error, /too long/);
});

test("a refused key and an outage become 502s that say what to do", async () => {
  mode = "auth";
  const a = await call("/api/skills/handover/run", { method: "POST" });
  assert.equal(a.status, 502);
  assert.match(a.body.error, /key was refused/);
  assert.ok(!/test-key/.test(JSON.stringify(a.body)), "the key never appears in a response");
  mode = "down";
  const d = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "How is her sleep?" }) });
  assert.equal(d.status, 502);
  assert.match(d.body.error, /try again/);
});

test("output that is not JSON gets one repair round, then a clean failure", async () => {
  mode = "garbage";
  const before = seen.length;
  const d = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "How is her appetite?" }) });
  assert.equal(d.status, 502);
  assert.equal(seen.length - before, 2, "one call plus exactly one repair call");
  mode = "ok";
  const ok = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "When did the dizziness start?" }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.answer.answer, "Since Thursday.");
});

test("no key: auto falls back to the offline mock, nebius refuses to start", () => {
  assert.equal(loadConfig({ LLM_PROVIDER: "auto" }).llm.provider, "mock");
  assert.equal(loadConfig({}).llm.provider, "mock");
  assert.throws(() => loadConfig({ LLM_PROVIDER: "nebius" }), /no NEBIUS_API_KEY/);
});

test("an unreachable endpoint fails fast", async () => {
  const p = createProvider({ provider: "nebius", apiKey: "x", baseUrl: "http://127.0.0.1:9/v1/", fastModel: "a", deepModel: "b", timeoutMs: 2000 });
  const t0 = Date.now();
  await assert.rejects(p.complete({ system: "s", user: "u" }), /network error/);
  assert.ok(Date.now() - t0 < 5000);
});

test("the reference lookup never breaks the medication check", async () => {
  const failing = createReferenceLookup({ apiKey: "x", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.deepEqual(await failing("amlodipine"), []);
  const refused = createReferenceLookup({ apiKey: "x", fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual(await refused("amlodipine"), []);
  assert.equal(createReferenceLookup({ apiKey: null }), null);
});
