// An iCalendar feed of the household's routines, appointments and dated tasks, so reminders
// land in whatever calendar each member already uses (phone, Outlook, Google) with no app
// install and no push service in between. The URL carries an unguessable token.
const DAYS = { monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH", friday: "FR", saturday: "SA", sunday: "SU", mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
};

export function rrule(days) {
  const d = String(days || "daily").toLowerCase();
  if (/daily|every day|each day/.test(d)) return "FREQ=DAILY";
  if (/weekday/.test(d)) return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  const by = [...new Set((d.match(/[a-z]+/g) || []).map((w) => DAYS[w]).filter(Boolean))];
  return by.length ? `FREQ=WEEKLY;BYDAY=${by.join(",")}` : "FREQ=DAILY";
}

export function buildIcs(h, { now = new Date(), timezone = "Europe/Brussels", name = "Hearthnote" } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rui Codex//Hearthnote//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${timezone}`];
  const dtstamp = stamp(now);
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  for (const r of h.routines.filter((x) => x.status === "active")) {
    const t = (r.time || "09:00").replace(":", "");
    lines.push("BEGIN:VEVENT", `UID:${r.id}@hearthnote`, `DTSTAMP:${dtstamp}`, `DTSTART;TZID=${timezone}:${today}T${t}00`, "DURATION:PT15M", `RRULE:${rrule(r.days)}`, `SUMMARY:${esc(r.title)}`, `DESCRIPTION:${esc(`Routine from note ${r.noteId}`)}`, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(r.title)}`, "TRIGGER:-PT5M", "END:VALARM", "END:VEVENT");
  }
  for (const a of h.appointments.filter((x) => x.date)) {
    const d = a.date.replace(/-/g, "");
    if (a.time) lines.push("BEGIN:VEVENT", `UID:${a.id}@hearthnote`, `DTSTAMP:${dtstamp}`, `DTSTART;TZID=${timezone}:${d}T${a.time.replace(":", "")}00`, "DURATION:PT1H", `SUMMARY:${esc(a.title)}`, "END:VEVENT");
    else lines.push("BEGIN:VEVENT", `UID:${a.id}@hearthnote`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(a.title)}`, "END:VEVENT");
  }
  for (const t of h.tasks.filter((x) => x.due && !x.done)) {
    lines.push("BEGIN:VEVENT", `UID:${t.id}@hearthnote`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${t.due.replace(/-/g, "")}`, `SUMMARY:${esc(`To do: ${t.title}`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
