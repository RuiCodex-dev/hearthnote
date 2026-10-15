// Builds the fictional demo household for a new visitor sandbox. Note captures were produced
// once by Nemotron on Token Factory (scripts/bake-demo.mjs) and stored in demo-captures.json,
// so a new visitor does not spend twelve model calls before seeing anything. If that file is
// missing, the offline mock fills in.
import { existsSync, readFileSync } from "node:fs";
import { mockCapture } from "../llm/mock.js";
import { addMember, addNote, applyCapture, emptyHousehold } from "../care/household.js";

const NOTES = JSON.parse(readFileSync(new URL("./demo-notes.json", import.meta.url), "utf8"));
const CAPTURES_URL = new URL("./demo-captures.json", import.meta.url);
const DAY = 86400_000;

function loadCaptures() {
  if (!existsSync(CAPTURES_URL)) return null;
  try {
    return JSON.parse(readFileSync(CAPTURES_URL, "utf8"));
  } catch {
    return null;
  }
}

const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Anchor the story to the most recent day with the same weekday as the bake day, so "next
// Tuesday" in a note still lands on a Tuesday whenever the demo is opened.
export function demoAnchor(now = new Date(), bakeDate = null) {
  const today = utcDay(now);
  if (!bakeDate) return today;
  const bake = Date.parse(bakeDate + "T00:00:00Z");
  const diff = Math.round((today - bake) / DAY);
  return today - (((diff % 7) + 7) % 7) * DAY;
}

function shiftDates(value, days) {
  if (!days) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(Date.parse(value + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  return value;
}

export function noteTimes(anchor) {
  // Times are Brussels wall-clock; stored as UTC with a one-hour offset (close enough for a demo).
  return NOTES.notes.map((n) => {
    const [hh, mm] = n.time.split(":").map(Number);
    return new Date(anchor + n.day * DAY + (hh - 1) * 3600_000 + mm * 60_000).toISOString();
  });
}

export function demoHousehold(now = new Date()) {
  const baked = loadCaptures();
  const anchor = demoAnchor(now, baked?.bakeDate);
  const shift = baked?.bakeDate ? Math.round((anchor - Date.parse(baked.bakeDate + "T00:00:00Z")) / DAY) : 0;
  const h = emptyHousehold({ recipientName: NOTES.recipient.name, recipientRole: NOTES.recipient.role });
  h.demo = true;
  for (const m of NOTES.members) addMember(h, m);
  h.privateTerms = NOTES.privateTerms.map((text, i) => ({ text, token: `PRIVATE${i + 1}` }));
  const times = noteTimes(anchor);
  NOTES.notes.forEach((n, i) => {
    const author = h.members.find((m) => m.name === n.by);
    const note = addNote(h, { text: n.text, authorId: author?.id, at: times[i] });
    const cap = baked?.captures?.[i];
    if (cap) {
      applyCapture(h, note, shiftDates(cap.capture, shift));
      note.receipt = cap.receipt;
    } else {
      applyCapture(h, note, mockCapture({ household: h, noteId: note.id, now: new Date(times[i]) }));
      note.receipt = { provider: "mock", model: "offline mock", tier: "fast" };
    }
  });
  // Steady state: older proposals have been reviewed by the family; the last few days are
  // still waiting, so a visitor sees both confirmed memory and the confirm flow.
  const cutoff = new Date(anchor - 2 * DAY).toISOString();
  for (const f of h.memory) if (f.at < cutoff) f.status = "confirmed";
  for (const r of h.routines) if ((h.notes.find((n) => n.id === r.noteId)?.at || "") < cutoff) r.status = "active";
  for (const t of h.tasks) if (/pick up the second box/i.test(t.title)) t.done = true;
  return h;
}
