// The household: one care circle, everything it has written down, and everything Hearthnote
// has learned from it. Plain data so it serialises straight into the encrypted vault.
import { randomBytes } from "node:crypto";
import { redFlags } from "../privacy/safety.js";

export const uid = (prefix) => `${prefix}${randomBytes(5).toString("hex")}`;

export function emptyHousehold({ recipientName = "", recipientRole = "the person being cared for" } = {}) {
  return {
    version: 1,
    id: uid("h_"),
    createdAt: new Date().toISOString(),
    calendarToken: randomBytes(18).toString("base64url"),
    recipient: { id: "P1", name: recipientName, role: recipientRole },
    members: [],
    privateTerms: [],
    seq: 0,
    notes: [],
    observations: [],
    medications: [],
    tasks: [],
    routines: [],
    appointments: [],
    memory: [],
    briefs: [],
    customSkills: [],
    ledger: [],
    settings: { weeklyDigest: { weekday: 0, hour: 18 }, lastDigestWeek: null },
  };
}

export function people(h) {
  return [h.recipient, ...h.members];
}

export function personById(h, id) {
  return people(h).find((p) => p.id === id) || null;
}

// Map a name or token the model gave back to a member of the circle.
export function resolvePerson(h, value) {
  if (!value || typeof value !== "string") return null;
  const v = value.replace(/[[\]]/g, "").trim().toLowerCase();
  if (!v) return null;
  return people(h).find((p) => p.id.toLowerCase() === v || (p.name && (p.name.toLowerCase() === v || v.includes(p.name.toLowerCase())))) || null;
}

export function redactorPeople(h) {
  return people(h)
    .filter((p) => p.name)
    .map((p) => ({ token: p.id, names: [p.name, ...(p.aliases || [])], display: p.name, role: p.role }));
}

export function addMember(h, { name, role }) {
  const n = h.members.length + 2;
  const member = { id: `P${n}`, name: String(name || "").trim().slice(0, 60), role: String(role || "family").trim().slice(0, 80) };
  h.members.push(member);
  return member;
}

export function addNote(h, { text, authorId, at = new Date().toISOString(), source = "text" }) {
  const clean = String(text || "").trim().slice(0, 4000);
  if (clean.length < 3) throw new Error("note is empty");
  h.seq += 1;
  const note = {
    id: `N${h.seq}`,
    at,
    authorId: personById(h, authorId) ? authorId : h.members[0]?.id || h.recipient.id,
    text: clean,
    source,
    flags: redFlags(clean),
    status: "pending",
    capture: null,
    receipt: null,
  };
  h.notes.push(note);
  return note;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Fold one capture result into the household. Everything the model proposes for the long term
// (routines, memory) lands as "proposed" until a person confirms it.
export function applyCapture(h, note, capture) {
  note.capture = capture;
  note.status = "done";
  const at = note.at;
  for (const o of capture.observations || []) {
    if (!o.text) continue;
    h.observations.push({ id: uid("o_"), noteId: note.id, at, category: o.category, text: o.text, severity: o.severity });
  }
  for (const m of capture.medications || []) {
    if (!m.name) continue;
    h.medications.push({ id: uid("m_"), noteId: note.id, at, name: m.name, change: m.change, detail: m.detail || "" });
  }
  for (const t of capture.tasks || []) {
    if (!t.title) continue;
    if (h.tasks.some((x) => !x.done && norm(x.title) === norm(t.title))) continue;
    h.tasks.push({ id: uid("t_"), noteId: note.id, title: t.title, due: t.due || null, assigneeId: resolvePerson(h, t.assignee)?.id || null, done: false, createdAt: at });
  }
  for (const r of capture.routines || []) {
    if (!r.title) continue;
    if (h.routines.some((x) => x.status !== "archived" && norm(x.title) === norm(r.title))) continue;
    h.routines.push({ id: uid("r_"), noteId: note.id, title: r.title, time: validTime(r.time), days: r.days || "daily", assigneeId: resolvePerson(h, r.assignee)?.id || null, status: "proposed" });
  }
  for (const a of capture.appointments || []) {
    if (!a.title) continue;
    if (h.appointments.some((x) => norm(x.title) === norm(a.title) && x.date === a.date)) continue;
    h.appointments.push({ id: uid("a_"), noteId: note.id, title: a.title, date: validDate(a.date), time: validTime(a.time), with: a.with || "" });
  }
  for (const f of capture.memory || []) {
    if (!f.fact) continue;
    const existing = h.memory.find((x) => norm(x.fact) === norm(f.fact));
    if (existing) {
      if (!existing.noteIds.includes(note.id)) existing.noteIds.push(note.id);
      continue;
    }
    h.memory.push({ id: uid("f_"), noteIds: [note.id], fact: f.fact, kind: f.kind, status: "proposed", at });
  }
}

export function validTime(t) {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
}
export function validDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
}

export function pushLedger(h, entry) {
  h.ledger.unshift({ id: uid("l_"), at: new Date().toISOString(), ...entry });
  h.ledger.length = Math.min(h.ledger.length, 60);
}

// A compact view for the client: everything except the bulky outbound prompt texts.
export function snapshot(h) {
  return {
    recipient: h.recipient,
    members: h.members,
    privateTerms: h.privateTerms.map((t) => ({ text: t.text })),
    notes: [...h.notes].reverse(),
    observations: h.observations,
    medications: h.medications,
    tasks: h.tasks,
    routines: h.routines.filter((r) => r.status !== "archived"),
    appointments: [...h.appointments].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    memory: h.memory.filter((m) => m.status !== "rejected"),
    briefs: [...h.briefs].reverse(),
    customSkills: h.customSkills,
    ledger: h.ledger.map(({ outbound, ...rest }) => ({ ...rest, outboundChars: outbound ? outbound.length : 0 })),
    settings: h.settings,
  };
}
