// Offline provider. Deterministic, rule-based stand-in for Nemotron so the whole app (and the
// test suite) runs without a Token Factory key. It is deliberately plain: every receipt it
// produces says provider "mock", and the UI shows an "offline mock" badge while it is active.
import { retrieve } from "../care/search.js";

const MEDS = ["amlodipine", "paracetamol", "metformin", "furosemide", "donepezil", "lisinopril", "atorvastatin", "omeprazole", "levothyroxine", "warfarin", "apixaban", "bisoprolol", "ramipril", "vitamin d", "eye drops", "insulin", "sertraline", "melatonin", "ibuprofen", "macrogol"];
const CATS = [
  ["cognition", /\b(forgot|forgetful|confus\w*|memory|repeat\w*|disorient\w*)\b/i],
  ["mobility", /\b(walk\w*|walker|fell|fall|stairs|balance|dizz\w*|unsteady|steps|garden|physio\w*)\b/i],
  ["sleep", /\b(slept|sleep\w*|night|woke|nap\w*|tired)\b/i],
  ["appetite", /\b(ate|eat\w*|lunch|dinner|breakfast|appetite|soup|drank|drink\w*|water|meal)\b/i],
  ["pain", /\b(pain|ache\w*|sore|hurt\w*)\b/i],
  ["hygiene", /\b(shower\w*|wash\w*|bath\w*)\b/i],
  ["social", /\b(visit\w*|called|neighbou?r|friend|phone|chat\w*)\b/i],
  ["mood", /\b(happy|sad|cheerful|low|anxious|laugh\w*|upset|quiet|smil\w*|grumpy|mood)\b/i],
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const sentences = (t) => String(t).replace(/\b(Dr|Mr|Mrs|Ms|St)\. /g, "$1 ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const iso = (d) => d.toISOString().slice(0, 10);

function resolveDay(sentence, now) {
  const s = sentence.toLowerCase();
  if (/\btomorrow\b/.test(s)) return iso(new Date(now.getTime() + 86400_000));
  if (/\btoday\b/.test(s)) return iso(now);
  const m = s.match(/\b(?:next\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[1]);
    let diff = (target - now.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return iso(new Date(now.getTime() + diff * 86400_000));
  }
  const d = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return d ? d[1] : null;
}
const timeOf = (s) => {
  const m = s.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};
const assigneeOf = (s, household) => {
  for (const p of household.members) if (p.name && new RegExp(`\\b${p.name}\\b`, "i").test(s)) return p.name;
  return null;
};

export function mockCapture({ household, noteId, now }) {
  const note = household.notes.find((n) => n.id === noteId);
  const out = { summary: "", mood: "unknown", observations: [], medications: [], tasks: [], routines: [], appointments: [], memory: [] };
  const sents = sentences(note.text);
  out.summary = sents[0]?.slice(0, 160) || "";
  for (const s of sents) {
    const lower = s.toLowerCase();
    for (const med of MEDS) {
      if (!lower.includes(med)) continue;
      let change = "mentioned";
      if (/\b(start\w*|new|began|prescribed)\b/.test(lower)) change = "started";
      else if (/\b(stop\w*)\b/.test(lower)) change = "stopped";
      else if (/\b(increas\w*|reduc\w*|lower\w*|dose)\b/.test(lower)) change = "dose_changed";
      else if (/\b(forgot|missed)\b/.test(lower)) change = "missed";
      else if (/\b(took|gave|given|taken)\b/.test(lower)) change = "taken";
      out.medications.push({ name: med.replace(/\b\w/g, (c) => c.toUpperCase()), change, detail: s.slice(0, 140) });
    }
    if (/\bevery (morning|evening|day|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bdaily\b|\beach (morning|evening)\b/.test(lower)) {
      out.routines.push({ title: s.replace(/[.!]$/, "").slice(0, 110), time: timeOf(s), days: /\bevery (mon|tue|wed|thu|fri|sat|sun)\w*/.test(lower) ? lower.match(/\bevery (\w+day)/)[1] : "daily", assignee: assigneeOf(s, household) });
      continue;
    }
    if (/\b(appointment|gp|doctor|physio\w*|dentist|podiatrist|cardiolog\w*|nurse)\b/.test(lower) && resolveDay(s, now) && !/\b(need to|remember to|book)\b/.test(lower)) {
      out.appointments.push({ title: s.replace(/[.!]$/, "").slice(0, 110), date: resolveDay(s, now), time: timeOf(s), with: (lower.match(/\b(gp|doctor|physio\w*|dentist|podiatrist|cardiolog\w*|nurse)\b/) || [])[1] || null });
      continue;
    }
    if (/\b(need to|needs to|remember to|must|book|pick up|buy|order|call the|ask the)\b/.test(lower)) {
      out.tasks.push({ title: s.replace(/[.!]$/, "").slice(0, 120), due: resolveDay(s, now), assignee: assigneeOf(s, household) });
      continue;
    }
    if (/\b(likes|loves|prefers|doesn'?t like|does not like|hates|allergic|always has)\b/.test(lower)) {
      out.memory.push({ fact: s.replace(/[.!]$/, "").slice(0, 180), kind: /allergic/.test(lower) ? "medical" : "preference" });
    }
    const cat = CATS.find(([, re]) => re.test(s));
    if (cat || out.medications.length) {
      let severity = 1;
      if (/\b(fell|fall|dizz\w*|confus\w*|worr\w*|refused|didn'?t eat|did not eat|vomit\w*|unsteady)\b/.test(lower)) severity = 2;
      if (/\b(good|well|better|lovely|enjoyed|happy|cheerful|fine|great)\b/.test(lower) && severity < 2) severity = 0;
      out.observations.push({ category: cat ? cat[0] : "medication", text: s.replace(/[.!]$/, "").slice(0, 200), severity });
    }
  }
  const sev = out.observations.map((o) => o.severity);
  out.mood = !sev.length ? "unknown" : sev.every((v) => v === 0) ? "good" : sev.some((v) => v >= 2) ? "low" : "mixed";
  return out;
}

function brief({ household: h, now, skill, references = [] }) {
  const since = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const obs = h.observations.filter((o) => o.at >= since);
  const good = obs.filter((o) => o.severity === 0).slice(-3);
  const worry = obs.filter((o) => o.severity >= 2);
  const started = h.medications.filter((m) => m.change === "started" || m.change === "dose_changed");
  const linked = [];
  for (const m of started) {
    const until = new Date(new Date(m.at).getTime() + 10 * 86400_000).toISOString();
    const after = obs.filter((o) => o.at > m.at && o.at <= until && o.severity >= 1 && ["mobility", "pain", "sleep", "cognition", "appetite"].includes(o.category));
    if (after.length) linked.push({ m, after });
  }
  const sections = [
    { heading: "This week at a glance", items: good.map((o) => ({ text: o.text, cites: [o.noteId], flag: "good" })) },
    { heading: "Changes worth noticing", items: linked.map(({ m, after }) => ({ text: `${after.length} note(s) mention ${[...new Set(after.map((a) => a.category))].join(", ")} after ${m.name} was ${m.change.replace("_", " ")} on ${m.at.slice(0, 10)}.`, cites: [...new Set([m.noteId, ...after.map((a) => a.noteId)])], flag: "ask_clinician" })) },
    { heading: "Keep an eye on", items: worry.slice(-4).map((o) => ({ text: o.text, cites: [o.noteId], flag: "watch" })) },
    { heading: "Who does what next", items: h.tasks.filter((t) => !t.done).slice(0, 4).map((t) => ({ text: t.title, cites: [t.noteId], flag: "none" })) },
  ];
  if (references.length) sections.push({ heading: "What the reference sources say", items: references.slice(0, 3).map((r) => ({ text: r.content.slice(0, 200), cites: [r.id], flag: "none" })) });
  return {
    headline: `Offline mock: ${obs.length} observations from ${new Set(obs.map((o) => o.noteId)).size} notes in the last two weeks.`,
    sections: sections.filter((s) => s.items.length),
    questions: linked.map(({ m, after }) => ({ text: `Could the ${after[0].category} noted since ${m.at.slice(0, 10)} be related to ${m.name}?`, cites: [m.noteId, after[0].noteId] })),
    followUps: h.tasks.filter((t) => !t.done).slice(0, 3).map((t) => ({ title: t.title, assignee: null, due: t.due })),
  };
}

function answer({ household, question }) {
  const hits = retrieve(household.notes, question, 3);
  const top = hits[hits.length - 1];
  return {
    answer: top ? `The closest note (${top.id}) says: "${top.text.slice(0, 220)}"` : "Nothing in the log answers that yet.",
    cites: hits.map((n) => n.id),
    confidence: "low",
    missing: "Offline mock: no language model is connected, so this only quotes the most relevant notes.",
  };
}

export function createMockProvider(cfg) {
  return {
    name: "mock",
    async resolveModels() {
      return { fast: cfg.fastModel, deep: cfg.deepModel, available: [] };
    },
    async complete({ tier = "fast", hint }) {
      const started = Date.now();
      const now = hint.now instanceof Date ? hint.now : new Date();
      let json;
      if (hint.output === "capture") json = mockCapture({ ...hint, now });
      else if (hint.output === "brief") json = brief({ ...hint, now });
      else json = answer({ ...hint, now });
      return {
        json,
        text: JSON.stringify(json),
        receipt: { provider: "mock", model: `mock (${tier === "deep" ? cfg.deepModel : cfg.fastModel})`, tier, thinking: false, promptTokens: null, completionTokens: null, latencyMs: Date.now() - started },
      };
    },
  };
}
