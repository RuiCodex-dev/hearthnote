// Skills are small declarative files (skills/*.json): what context to gather, which Nemotron
// tier to use, what to write. The same runner executes the built-in skills and any skill a
// family writes for itself in the app. Every run goes through the privacy gate and leaves a
// receipt in the household ledger.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { createRedactor } from "../privacy/redact.js";
import { applyCapture, personById, pushLedger, redactorPeople, uid } from "./household.js";
import { retrieve } from "./search.js";

const CATEGORIES = ["mobility", "sleep", "appetite", "mood", "pain", "medication", "cognition", "hygiene", "social", "other"];

export const SCHEMAS = {
  capture: {
    type: "object",
    required: ["summary", "observations", "medications", "tasks", "routines", "appointments", "memory", "mood"],
    properties: {
      summary: { type: "string", maxLength: 200 },
      mood: { type: "string", enum: ["good", "mixed", "low", "unknown"], default: "unknown" },
      observations: {
        type: "array", maxItems: 12,
        items: { type: "object", required: ["category", "text", "severity"], properties: {
          category: { type: "string", enum: CATEGORIES, default: "other" },
          text: { type: "string", maxLength: 240 },
          severity: { type: "integer", minimum: 0, maximum: 3 },
        } },
      },
      medications: {
        type: "array", maxItems: 8,
        items: { type: "object", required: ["name", "change"], properties: {
          name: { type: "string", maxLength: 60 },
          change: { type: "string", enum: ["started", "stopped", "dose_changed", "taken", "missed", "mentioned"], default: "mentioned" },
          detail: { type: "string", maxLength: 160, nullable: true },
        } },
      },
      tasks: {
        type: "array", maxItems: 8,
        items: { type: "object", required: ["title"], properties: {
          title: { type: "string", maxLength: 140 },
          due: { type: "string", nullable: true },
          assignee: { type: "string", nullable: true },
        } },
      },
      routines: {
        type: "array", maxItems: 6,
        items: { type: "object", required: ["title"], properties: {
          title: { type: "string", maxLength: 120 },
          time: { type: "string", nullable: true },
          days: { type: "string", maxLength: 40, nullable: true },
          assignee: { type: "string", nullable: true },
        } },
      },
      appointments: {
        type: "array", maxItems: 4,
        items: { type: "object", required: ["title"], properties: {
          title: { type: "string", maxLength: 120 },
          date: { type: "string", nullable: true },
          time: { type: "string", nullable: true },
          with: { type: "string", maxLength: 80, nullable: true },
        } },
      },
      memory: {
        type: "array", maxItems: 6,
        items: { type: "object", required: ["fact", "kind"], properties: {
          fact: { type: "string", maxLength: 200 },
          kind: { type: "string", enum: ["preference", "medical", "contact", "routine", "history", "other"], default: "other" },
        } },
      },
    },
  },
  brief: {
    type: "object",
    required: ["headline", "sections", "questions", "followUps"],
    properties: {
      headline: { type: "string", maxLength: 220 },
      sections: {
        type: "array", maxItems: 6,
        items: { type: "object", required: ["heading", "items"], properties: {
          heading: { type: "string", maxLength: 80 },
          items: {
            type: "array", maxItems: 8,
            items: { type: "object", required: ["text", "cites", "flag"], properties: {
              text: { type: "string", maxLength: 400 },
              cites: { type: "array", maxItems: 8, items: { type: "string", maxLength: 8 } },
              flag: { type: "string", enum: ["none", "good", "watch", "ask_clinician"], default: "none" },
            } },
          },
        } },
      },
      questions: {
        type: "array", maxItems: 8,
        items: { type: "object", required: ["text", "cites"], properties: {
          text: { type: "string", maxLength: 300 },
          cites: { type: "array", maxItems: 8, items: { type: "string", maxLength: 8 } },
        } },
      },
      followUps: {
        type: "array", maxItems: 8,
        items: { type: "object", required: ["title"], properties: {
          title: { type: "string", maxLength: 160 },
          assignee: { type: "string", nullable: true },
          due: { type: "string", nullable: true },
        } },
      },
    },
  },
  answer: {
    type: "object",
    required: ["answer", "cites", "confidence"],
    properties: {
      answer: { type: "string", maxLength: 900 },
      cites: { type: "array", maxItems: 10, items: { type: "string", maxLength: 8 } },
      confidence: { type: "string", enum: ["high", "medium", "low"], default: "low" },
      missing: { type: "string", maxLength: 300, nullable: true },
    },
  },
};

const SYSTEM = `You are Hearthnote, a careful assistant for a family that looks after someone at home.
You work only from what the family wrote. People appear as tokens such as [P1]; keep every token exactly as written and never guess real names.
You are not a clinician: you never diagnose, never recommend starting, stopping or changing a medication or dose, and you turn medical concerns into questions for the GP, nurse or pharmacist.
Respond with a single JSON object that matches the schema. No prose outside the JSON.`;

export function loadBuiltinSkills(dir = join(ROOT, "skills")) {
  const skills = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    skills[s.id] = s;
  }
  return skills;
}

export function makeCustomSkill({ title, instructions, tier = "fast", days = 7 }) {
  const t = String(title || "").trim().slice(0, 60);
  const ins = String(instructions || "").trim().slice(0, 1200);
  if (t.length < 3 || ins.length < 10) throw new Error("a skill needs a title and instructions");
  return {
    id: `custom-${uid("")}`,
    title: t,
    description: ins.slice(0, 160),
    tier: tier === "deep" ? "deep" : "fast",
    output: "brief",
    builtin: false,
    context: { days: Math.min(60, Math.max(1, Number(days) || 7)), include: ["notes", "observations", "medications", "memory", "routines", "appointments", "tasks"] },
    instructions: `${ins}\nCite note ids on every item. Follow the safety rules.`,
  };
}

const dayName = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const dateOnly = (iso) => String(iso).slice(0, 10);

// Gather the context a skill asked for, as text, for a time window ending at `now`.
export function buildContext(h, skill, { now = new Date(), question = null, noteId = null, references = [] } = {}) {
  const days = skill.context?.days ?? 7;
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const inc = new Set(skill.context?.include || []);
  const parts = [];
  const who = (id) => `[${personById(h, id)?.id || "P?"}]`;
  parts.push(`TODAY: ${dateOnly(now.toISOString())} (${dayName(now.toISOString())})`);
  parts.push(`PEOPLE:\n${[h.recipient, ...h.members].map((p) => `[${p.id}] = ${p.id === "P1" ? "the person being cared for" : "care circle"}; ${p.role}`).join("\n")}`);
  if (inc.has("memory")) {
    const facts = h.memory.filter((m) => m.status === "confirmed").map((m) => `- ${m.fact}`);
    parts.push(`KNOWN FACTS (confirmed by the family):\n${facts.join("\n") || "- none yet"}`);
  }
  if (inc.has("medications")) {
    const meds = h.medications.filter((m) => m.change !== "taken").map((m) => `- ${dateOnly(m.at)}: ${m.name} ${m.change}${m.detail ? ` (${m.detail})` : ""} [${m.noteId}]`);
    parts.push(`MEDICATION HISTORY:\n${meds.join("\n") || "- none recorded"}`);
  }
  if (inc.has("routines")) {
    const r = h.routines.filter((x) => x.status === "active").map((x) => `- ${x.title}${x.time ? ` at ${x.time}` : ""} (${x.days || "daily"})${x.assigneeId ? ` - ${who(x.assigneeId)}` : ""}`);
    parts.push(`ROUTINES:\n${r.join("\n") || "- none yet"}`);
  }
  if (inc.has("appointments")) {
    const a = h.appointments.map((x) => `- ${x.date || "date unknown"}${x.time ? ` ${x.time}` : ""}: ${x.title}${x.with ? ` with ${x.with}` : ""} [${x.noteId}]`);
    parts.push(`APPOINTMENTS:\n${a.join("\n") || "- none"}`);
  }
  if (inc.has("tasks")) {
    const t = h.tasks.filter((x) => !x.done).map((x) => `- ${x.title}${x.due ? ` (due ${x.due})` : ""}${x.assigneeId ? ` - ${who(x.assigneeId)}` : ""} [${x.noteId}]`);
    parts.push(`OPEN TASKS:\n${t.join("\n") || "- none"}`);
  }
  if (inc.has("observations")) {
    const o = h.observations.filter((x) => x.at >= since).map((x) => `- ${dateOnly(x.at)} ${x.category} (severity ${x.severity}): ${x.text} [${x.noteId}]`);
    parts.push(`STRUCTURED OBSERVATIONS (last ${days} days):\n${o.join("\n") || "- none"}`);
  }
  let notes = [];
  if (inc.has("notes")) notes = h.notes.filter((n) => n.at >= since && n.id !== noteId);
  if (inc.has("retrieved") && question) notes = retrieve(h.notes, question, 10);
  if (notes.length) {
    const lines = notes.map((n) => `[${n.id} · ${dayName(n.at)} ${dateOnly(n.at)} · by ${who(n.authorId)}] ${n.text}`);
    parts.push(`NOTES:\n${lines.join("\n")}`);
  }
  if (references.length) {
    parts.push(`REFERENCE SNIPPETS (from public sources, cite as S-ids):\n${references.map((r) => `[${r.id}] ${r.title} (${r.url}): ${r.content}`).join("\n")}`);
  }
  if (noteId) {
    const n = h.notes.find((x) => x.id === noteId);
    parts.push(`NEW NOTE [${n.id} · ${dayName(n.at)} ${dateOnly(n.at)} · by ${who(n.authorId)}]:\n${n.text}`);
  }
  if (question) parts.push(`QUESTION:\n${question}`);
  return parts.join("\n\n");
}

function schemaHint(schema) {
  return JSON.stringify(schema, (k, v) => (k === "maxLength" || k === "maxItems" || k === "default" || k === "nullable" ? undefined : v));
}

export class SkillRunner {
  constructor({ provider, builtins = loadBuiltinSkills(), tools = {}, guard = async () => {} }) {
    this.provider = provider;
    this.builtins = builtins;
    this.tools = tools;
    this.guard = guard; // throws when a call budget is exhausted
  }

  list(h) {
    return [...Object.values(this.builtins), ...(h.customSkills || [])];
  }

  get(h, id) {
    return this.builtins[id] || (h.customSkills || []).find((s) => s.id === id) || null;
  }

  async call(h, skill, { now, question, noteId, budgetKey, guard, references = [] }) {
    await (guard || this.guard)(budgetKey);
    const redactor = createRedactor({ people: redactorPeople(h), privateTerms: h.privateTerms });
    const context = buildContext(h, skill, { now, question, noteId, references });
    const { text: outbound, found } = redactor.redact(context);
    const schema = SCHEMAS[skill.output];
    const user = `${outbound}\n\nTASK (${skill.title}):\n${skill.instructions}\n\nJSON SCHEMA:\n${schemaHint(schema)}`;
    const result = await this.provider.complete({
      tier: skill.tier,
      system: SYSTEM,
      user,
      schema,
      schemaName: skill.output,
      hint: { skill: skill.id, output: skill.output, household: h, noteId, question, now, references },
    });
    const restore = redactor.restorer(found);
    const json = restore(result.json);
    pushLedger(h, {
      skillId: skill.id,
      skillTitle: skill.title,
      outbound: user,
      redactions: found.length,
      receipt: result.receipt,
    });
    return { json, receipt: result.receipt, redactions: found };
  }

  async capture(h, note, { now = new Date(note.at), budgetKey, guard } = {}) {
    const skill = this.builtins.capture;
    try {
      const { json, receipt } = await this.call(h, skill, { now, noteId: note.id, budgetKey, guard });
      note.receipt = receipt;
      applyCapture(h, note, json);
    } catch (err) {
      note.status = "error";
      note.error = err.message;
      throw err;
    }
    return note;
  }

  async brief(h, skillId, { now = new Date(), trigger = "manual", budgetKey, guard } = {}) {
    const skill = this.get(h, skillId);
    if (!skill || skill.output !== "brief") throw new Error("unknown skill");
    let references = [];
    if (skill.tool === "reference-lookup" && this.tools.lookup) {
      const med = [...h.medications].reverse().find((m) => ["started", "dose_changed"].includes(m.change));
      if (med) references = await this.tools.lookup(med.name);
    }
    const { json, receipt } = await this.call(h, skill, { now, budgetKey, guard, references });
    const known = new Set([...h.notes.map((n) => n.id), ...references.map((r) => r.id)]);
    const keep = (cites) => (cites || []).map((c) => String(c).replace(/[[\]\s]/g, "")).filter((c) => known.has(c));
    for (const s of json.sections) for (const it of s.items) it.cites = keep(it.cites);
    for (const q of json.questions) q.cites = keep(q.cites);
    const brief = { id: uid("b_"), skillId: skill.id, title: skill.title, at: now.toISOString(), trigger, receipt, brief: json, references };
    h.briefs.push(brief);
    if (h.briefs.length > 30) h.briefs.shift();
    return brief;
  }

  async ask(h, question, { now = new Date(), budgetKey, guard } = {}) {
    const q = String(question || "").trim().slice(0, 400);
    if (q.length < 3) throw new Error("question is empty");
    const { json, receipt } = await this.call(h, this.builtins.ask, { now, question: q, budgetKey, guard });
    const known = new Set(h.notes.map((n) => n.id));
    json.cites = (json.cites || []).map((c) => String(c).replace(/[[\]\s]/g, "")).filter((c) => known.has(c));
    return { question: q, ...json, receipt };
  }
}
