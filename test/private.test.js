import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server/main.js";
import { loadConfig } from "../server/config.js";

let server, base, dir, cookie = "";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hearthnote-"));
  process.env.HEARTH_PASSCODE = "kitchen-table-42";
  const config = loadConfig({ LLM_PROVIDER: "mock", HEARTH_MODE: "private", HEARTH_DATA_DIR: dir, HEARTH_VAULT_KEY: "a long test passphrase that is not real" });
  ({ server } = await buildServer(config));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  delete process.env.HEARTH_PASSCODE;
  rmSync(dir, { recursive: true, force: true });
});

const call = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers || {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("private mode needs the passcode and stores the household encrypted", async () => {
  assert.equal((await call("/api/state")).status, 401);
  assert.equal((await call("/api/login", { method: "POST", body: JSON.stringify({ passcode: "wrong-passcode-00" }) })).status, 401);
  assert.equal((await call("/api/login", { method: "POST", body: JSON.stringify({ passcode: "kitchen-table-42" }) })).status, 200);
  assert.equal((await call("/api/recipient", { method: "POST", body: JSON.stringify({ name: "Josephine", role: "grandmother" }) })).status, 200);
  assert.equal((await call("/api/members", { method: "POST", body: JSON.stringify({ name: "Lotte", role: "granddaughter" }) })).status, 200);
  const saved = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "Josephine slept well and ate her soup.", authorId: "P2" }) });
  assert.equal(saved.status, 200);
  const vault = readFileSync(join(dir, "household.vault"));
  assert.equal(vault.subarray(0, 3).toString(), "HN1");
  assert.ok(!vault.toString("latin1").includes("Josephine"), "plaintext name found in the vault file");
  const st = await call("/api/state");
  assert.equal(st.body.budget, null);
  assert.equal(st.body.notes.length, 1);
});

test("the always-on weekly brief runs once, on Sunday evening in the household's timezone", async () => {
  const { runScheduledBriefs } = await import("../server/main.js");
  const { SkillRunner } = await import("../server/care/skills.js");
  const { createMockProvider } = await import("../server/llm/mock.js");
  const { demoHousehold } = await import("../server/seed/demo.js");
  const h = demoHousehold();
  const store = { all: () => [h], save: () => {} };
  const runner = new SkillRunner({ provider: createMockProvider({}) });
  const at = (iso) => () => new Date(iso);
  // Saturday 2026-10-17 20:00 Brussels: not the day.
  assert.deepEqual(await runScheduledBriefs({ store, runner, timezone: "Europe/Brussels", now: at("2026-10-17T18:00:00Z") }), []);
  // Sunday 2026-10-18 17:30 Brussels (15:30Z): too early.
  assert.deepEqual(await runScheduledBriefs({ store, runner, timezone: "Europe/Brussels", now: at("2026-10-18T15:30:00Z") }), []);
  // Sunday 18:05 Brussels: written once, marked as a scheduled brief.
  assert.deepEqual(await runScheduledBriefs({ store, runner, timezone: "Europe/Brussels", now: at("2026-10-18T16:05:00Z") }), ["2026-W42"]);
  assert.equal(h.briefs.at(-1).trigger, "schedule");
  // Later the same evening: not again.
  assert.deepEqual(await runScheduledBriefs({ store, runner, timezone: "Europe/Brussels", now: at("2026-10-18T20:00:00Z") }), []);
  // Next Sunday (after the clocks go back to CET): the next week's brief.
  assert.deepEqual(await runScheduledBriefs({ store, runner, timezone: "Europe/Brussels", now: at("2026-10-25T17:10:00Z") }), ["2026-W43"]);
});
