// Hearthnote client. No framework: one state object from /api/state, a render function per
// view, and delegated event handlers (the CSP forbids inline handlers).

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const TZ = "Europe/Brussels";

let S = null; // server state
let view = "today";
let author = null;
let lastAnswer = null;
let openBriefId = null;
const busy = new Set();

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  if (body.state) S = body.state;
  else if (body.notes) S = body;
  return body;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3600);
}

// ---------- formatting ----------
const fmt = (iso, opts) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, ...opts });
const dayKey = (iso) => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
const timeOf = (iso) => fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const todayKey = () => dayKey(new Date().toISOString());
function relDay(iso) {
  const k = dayKey(iso);
  if (k === todayKey()) return "Today";
  if (k === dayKey(new Date(Date.now() - 86400_000).toISOString())) return "Yesterday";
  return fmt(iso, { weekday: "long", day: "numeric", month: "long" });
}
const dateFromYmd = (ymd) => new Date(ymd + "T12:00:00Z");
const people = () => (S ? [S.recipient, ...S.members] : []);
const person = (id) => people().find((p) => p.id === id);
const nameOf = (id) => person(id)?.name || "Someone";
const hue = (id) => ({ P1: 18, P2: 145, P3: 210, P4: 40, P5: 280, P6: 340 })[id] ?? 100;
const avatar = (id) => {
  const p = person(id);
  return `<span class="avatar" data-hue="${hue(id)}" aria-hidden="true">${esc((p?.name || "?").slice(0, 1))}</span>`;
};
const shortModel = (m) => String(m || "").replace(/^nvidia\//i, "").replace(/-/g, " ").replace(/\b(\d+)b\b/gi, "$1B").replace(/\bnemotron\b/i, "Nemotron");
const tierModel = (tier) => (tier === "deep" ? S?.config.models.deep : S?.config.models.fast);
const isMock = () => S?.config.provider === "mock";

// The avatar hue is a CSS custom property set through the CSSOM after render, because the
// CSP blocks inline style attributes.
function applyHues(root = document) {
  root.querySelectorAll(".avatar[data-hue]").forEach((el) => el.style.setProperty("--hue", el.dataset.hue));
}

function receiptLine(r, extra = "") {
  if (!r) return "";
  const tokens = r.promptTokens != null ? `<span>${r.promptTokens.toLocaleString()} in · ${(r.completionTokens ?? 0).toLocaleString()} out</span>` : "";
  return `<div class="receipt">${icon("chip")}<span><b>${esc(r.provider === "mock" ? "Offline mock" : shortModel(r.model))}</b></span><span>${r.tier === "deep" ? "deep tier" : "fast tier"}${r.thinking ? ", reasoning on" : ""}</span><span>${(r.latencyMs / 1000).toFixed(1)} s</span>${tokens}${extra}</div>`;
}

// ---------- chrome ----------
function renderChrome() {
  document.body.dataset.view = view;
  document.querySelectorAll("[data-view]").forEach((a) => (a.dataset.view === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (!S) return;
  const r = S.recipient;
  $("#circle-card").innerHTML = `<div class="eyebrow">Caring for</div><div class="who-for">${esc(r.name || "Someone")}</div><div class="role">${esc(r.role)}</div><div class="avatars">${S.members.map((m) => `<span title="${esc(m.name)} - ${esc(m.role)}">${avatar(m.id)}</span>`).join("")}</div>`;
  const pending = S.memory.filter((m) => m.status === "proposed").length + S.routines.filter((x) => x.status === "proposed").length;
  const mc = $("#memory-count");
  mc.hidden = !pending;
  mc.textContent = pending;
  const c = S.config;
  $("#engine").innerHTML = c.provider === "mock"
    ? `<div><span class="dot mock"></span><strong>Offline mock</strong></div><div>No Token Factory key is configured, so a rule-based stand-in answers. Set <code>LLM_PROVIDER=nebius</code>.</div>`
    : `<div><span class="dot"></span><strong>Nebius Token Factory</strong></div><div>Fast: <code>${esc(c.models.fast)}</code></div><div>Deep: <code>${esc(c.models.deep)}</code></div>${S.budget ? `<div>${S.budget.used} of ${S.budget.limit} demo calls used</div>` : ""}`;
  const banner = $("#demo-banner");
  if (S.budget) {
    banner.hidden = false;
    banner.innerHTML = `${icon("leaf")}<span><strong>A demo household.</strong> ${esc(r.name)} and her family are fictional. Write a note, run a brief, ask a question. Nothing you type is kept after a few hours.</span><button class="btn small ghost" data-action="reset-demo">${icon("refresh")}Start over</button>`;
  } else banner.hidden = true;
  renderWho();
  applyHues($("#circle-card"));
}

function renderWho() {
  const box = $("#who");
  if (!S) return;
  if (!author || !person(author)) author = S.members[0]?.id || "P1";
  box.innerHTML = `<span class="sr">Writing as</span>` + S.members.map((m) => `<button type="button" role="radio" aria-checked="${m.id === author}" data-author="${m.id}">${avatar(m.id)}${esc(m.name)}</button>`).join("");
  applyHues(box);
}

// ---------- views ----------
function viewToday() {
  const now = new Date();
  const weekday = fmt(now.toISOString(), { weekday: "long" });
  const wd = weekday.toLowerCase();
  const due = S.routines
    .filter((r) => r.status === "active")
    .filter((r) => { const d = String(r.days || "daily").toLowerCase(); return /daily|every day|each/.test(d) || d.includes(wd) || d.includes(wd.slice(0, 3)) || (/weekday/.test(d) && !/saturday|sunday/.test(wd)); })
    .sort((a, b) => String(a.time || "99").localeCompare(String(b.time || "99")));
  const todayYmd = now.toISOString().slice(0, 10);
  const appts = S.appointments.filter((a) => a.date && a.date >= todayYmd).slice(0, 3);
  const tasks = S.tasks.filter((t) => !t.done).slice(0, 5);
  const proposals = [...S.memory.filter((m) => m.status === "proposed").map((m) => ({ kind: "fact", ...m })), ...S.routines.filter((r) => r.status === "proposed").map((r) => ({ kind: "routine", ...r }))];
  const recent = S.notes.slice(0, 3);
  const twoDays = S.notes.filter((n) => Date.now() - Date.parse(n.at) < 2 * 86400_000).length;
  const latestBrief = S.briefs[0];

  return `
    <p class="eyebrow">${esc(fmt(now.toISOString(), { weekday: "long", day: "numeric", month: "long" }))}</p>
    <h1 class="page-title">${esc(S.recipient.name || "Your")}'s <em>${esc(weekday)}</em></h1>
    <p class="lede">${twoDays} note${twoDays === 1 ? "" : "s"} in the last two days${proposals.length ? `, and ${proposals.length} thing${proposals.length === 1 ? "" : "s"} Hearthnote noticed that need${proposals.length === 1 ? "s" : ""} your OK` : ""}.</p>
    <div class="hero-img"><img src="/assets/img/hero.webp" alt="" width="1600" height="700"></div>

    <form class="ask" id="ask-form" role="search">
      ${icon("search")}
      <label class="sr" for="ask-input">Ask the care log</label>
      <input id="ask-input" name="q" placeholder="Ask the log - when did the dizziness start?" maxlength="400">
      <button class="btn primary small" type="submit">Ask</button>
    </form>
    <div id="answer">${lastAnswer ? answerHtml(lastAnswer) : ""}</div>

    <div class="grid2 section">
      <div class="card">
        <div class="section-head"><h2>Today's routines</h2><a class="aside" href="#memory">All</a></div>
        ${due.length ? `<ul class="list">${due.map((r) => `<li><span class="time">${esc(r.time || "-")}</span><div class="grow">${esc(r.title)}<div class="meta">${r.assigneeId ? esc(nameOf(r.assigneeId)) + " · " : ""}${esc(r.days || "daily")}</div></div></li>`).join("")}</ul>` : `<p class="muted">No routines yet. When a note says something should repeat, Hearthnote proposes it here.</p>`}
      </div>
      <div class="card">
        <div class="section-head"><h2>Coming up</h2></div>
        ${appts.map((a) => { const d = dateFromYmd(a.date); return `<div class="appt"><div class="date"><span>${esc(fmt(d.toISOString(), { weekday: "short" }))}</span><b>${d.getUTCDate()}</b></div><div><div>${esc(a.title)}</div><div class="meta muted">${a.time ? esc(a.time) + " · " : ""}${esc(fmt(d.toISOString(), { month: "long" }))}</div></div></div>`; }).join("")}
        ${tasks.length ? `<ul class="list">${tasks.map((t) => `<li><button class="icon-btn" data-action="task-done" data-id="${t.id}" title="Mark done">${icon("check")}</button><div class="grow">${esc(t.title)}<div class="meta">${t.due ? "due " + esc(fmt(dateFromYmd(t.due).toISOString(), { weekday: "short", day: "numeric", month: "short" })) : "no date"}${t.assigneeId ? " · " + esc(nameOf(t.assigneeId)) : ""}</div></div></li>`).join("")}</ul>` : ""}
        ${!appts.length && !tasks.length ? `<p class="muted">Nothing scheduled.</p>` : ""}
      </div>
    </div>

    ${proposals.length ? `<section class="section"><div class="section-head"><h2>Waiting for your OK</h2><span class="aside">Nothing becomes a routine or a remembered fact until a person agrees.</span></div><div class="card"><ul class="list">${proposals.map(proposalHtml).join("")}</ul></div></section>` : ""}

    ${latestBrief ? `<section class="section"><div class="section-head"><h2>Latest brief</h2><a class="aside" href="#briefs">All briefs</a></div><a class="card skill" href="#briefs" data-open-brief="${latestBrief.id}"><span class="eyebrow">${esc(latestBrief.title)} · ${esc(relDay(latestBrief.at))}</span><h3>${esc(latestBrief.brief.headline)}</h3></a></section>` : ""}

    <section class="section"><div class="section-head"><h2>Latest notes</h2><a class="aside" href="#notes">All notes</a></div>${recent.map(noteHtml).join("")}</section>`;
}

function proposalHtml(p) {
  const what = p.kind === "fact" ? `<span class="chip watch">${icon("memory")}Remember</span>` : `<span class="chip watch">${icon("cal")}Routine</span>`;
  const text = p.kind === "fact" ? p.fact : `${p.title}${p.time ? ` · ${p.time}` : ""} · ${p.days || "daily"}`;
  return `<li class="proposal">${what}<div class="grow">${esc(text)} <button class="cite" data-cite="${esc(p.noteId || p.noteIds?.[0])}">${esc(p.noteId || p.noteIds?.[0])}</button></div><div class="actions"><button class="icon-btn yes" data-action="${p.kind}-yes" data-id="${p.id}" title="Yes, keep it">${icon("check")}</button><button class="icon-btn no" data-action="${p.kind}-no" data-id="${p.id}" title="No, discard">${icon("x")}</button></div></li>`;
}

function noteChips(n) {
  const c = n.capture;
  if (!c) return "";
  const chips = [];
  const cats = new Map();
  for (const o of c.observations || []) cats.set(o.category, Math.max(cats.get(o.category) ?? 0, o.severity));
  for (const [cat, sev] of cats) chips.push(`<span class="chip ${sev >= 2 ? "watch" : sev === 0 ? "good" : ""}">${esc(cat)}</span>`);
  for (const m of c.medications || []) if (m.change !== "mentioned") chips.push(`<span class="chip ${m.change === "started" || m.change === "dose_changed" ? "ask" : ""}">${icon("pill")}${esc(m.name)} ${esc(m.change.replace("_", " "))}</span>`);
  if ((c.tasks || []).length) chips.push(`<span class="chip">${icon("check")}${c.tasks.length} to-do</span>`);
  if ((c.routines || []).length) chips.push(`<span class="chip">${icon("cal")}${c.routines.length} routine</span>`);
  if ((c.appointments || []).length) chips.push(`<span class="chip">${icon("cal")}appointment</span>`);
  if ((c.memory || []).length) chips.push(`<span class="chip">${icon("memory")}${c.memory.length} to remember</span>`);
  return `<div class="note-chips">${chips.join("")}</div>`;
}

function emergencyHtml(flags) {
  if (!flags?.length) return "";
  return `<div class="emergency" role="alert">${icon("alert")}<div><strong>Possible emergency: ${esc(flags.map((f) => f.label).join(", "))}.</strong> ${esc(S.emergency.text)}</div></div>`;
}

function noteHtml(n) {
  const foot = n.status === "done"
    ? `${icon("chip")}<span>${esc(n.receipt?.provider === "mock" ? "Offline mock" : shortModel(n.receipt?.model))}${n.receipt?.latencyMs ? ` · ${(n.receipt.latencyMs / 1000).toFixed(1)} s` : ""}</span>`
    : n.status === "error" ? `<span>Not read yet.</span><button class="btn small" data-action="retry" data-id="${n.id}">Try again</button>` : `<span>Waiting to be read</span>`;
  return `<article class="card note ${n.flags?.length ? "flagged" : ""}" id="note-${n.id}">
    <div class="note-head">${avatar(n.authorId)}<strong>${esc(nameOf(n.authorId))}</strong><span>${esc(relDay(n.at))}, ${esc(timeOf(n.at))}</span>${n.source === "voice" ? `<span class="chip">${icon("mic")}dictated</span>` : ""}<span class="muted">${n.id}</span></div>
    <p class="note-text">${esc(n.text)}</p>
    ${emergencyHtml(n.flags)}
    ${noteChips(n)}
    <div class="note-foot">${foot}</div>
  </article>`;
}

function viewNotes() {
  const groups = new Map();
  for (const n of S.notes) {
    const k = relDay(n.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  return `<p class="eyebrow">The journal</p><h1 class="page-title">Every note, <em>as written</em></h1>
    <p class="lede">Notes are never rewritten. What Hearthnote understood from each one is filed underneath, with the model that read it.</p>
    ${[...groups].map(([day, notes]) => `<h2 class="day-label">${esc(day)}</h2>${notes.map(noteHtml).join("")}`).join("")}`;
}

function briefHtml(b) {
  const flagIcon = { good: "leaf", watch: "eye", ask_clinician: "question", none: "notes" };
  const citeBtns = (cites) => (cites || []).map((c) => `<button class="cite" data-cite="${esc(c)}">${esc(c)}</button>`).join("");
  const br = b.brief;
  return `<article class="card brief" id="brief-${b.id}">
    <div class="brief-meta"><span>${esc(b.title)}</span><span>${esc(fmt(b.at, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}</span>${b.trigger === "schedule" ? "<span>written automatically</span>" : ""}</div>
    <p class="headline">${esc(br.headline)}</p>
    ${br.sections.map((s) => `<h3>${esc(s.heading)}</h3><ul>${s.items.map((it) => `<li class="${esc(it.flag)}">${icon(flagIcon[it.flag] || "notes")}<span>${esc(it.text)}${citeBtns(it.cites)}</span></li>`).join("")}</ul>`).join("")}
    ${br.questions.length ? `<div class="questions"><h3>Questions for the GP or nurse</h3><ul>${br.questions.map((q) => `<li>${icon("question")}<span>${esc(q.text)}${citeBtns(q.cites)}</span></li>`).join("")}</ul></div>` : ""}
    ${br.followUps.length ? `<h3>Follow-ups</h3><ul>${br.followUps.map((f) => `<li>${icon("check")}<span>${esc(f.title)}${f.assignee ? ` <span class="muted">- ${esc(f.assignee)}</span>` : ""}${f.due ? ` <span class="muted">(${esc(f.due)})</span>` : ""}</span></li>`).join("")}</ul>` : ""}
    ${b.references?.length ? `<div class="refs">Reference sources looked up by medication name only: ${b.references.map((r) => `<a href="${esc(r.url)}" rel="noopener noreferrer" target="_blank">[${esc(r.id)}] ${esc(r.title)}</a>`).join(" · ")}</div>` : ""}
    ${receiptLine(b.receipt)}
    <p class="disclaimer">Written from the family's notes. Hearthnote is not a medical service and does not give medical advice; questions are for your GP, nurse or pharmacist.</p>
  </article>`;
}

function viewBriefs() {
  const shown = S.briefs.find((b) => b.id === openBriefId) || S.briefs[0];
  return `<p class="eyebrow">Skills</p><h1 class="page-title">Briefs the family <em>can act on</em></h1>
    <p class="lede">Each skill is a small recipe: what to read, which model to use, what to write. Quick ones run on Nemotron Super; the weekly reasoning runs on Nemotron Ultra.</p>
    <div class="skills">
      ${S.skills.map((k) => `<button class="card skill ${busy.has(k.id) ? "running" : ""}" data-action="run-skill" data-id="${k.id}" ${busy.has(k.id) ? "disabled" : ""}>
        <h3>${esc(k.title)}</h3><p>${esc(k.description)}</p>
        <span class="tier">${icon("chip")}${busy.has(k.id) ? `Writing on ${esc(shortModel(tierModel(k.tier)))}...` : `${esc(shortModel(tierModel(k.tier)))}${k.tool ? " + reference lookup" : ""}${k.schedule ? " · also runs every Sunday" : ""}`}${!k.builtin ? ` · <span data-action="delete-skill" data-id="${k.id}" role="button" tabindex="0">remove</span>` : ""}</span>
      </button>`).join("")}
      <button class="card skill add" data-action="new-skill">${icon("plus")}<h3>Write your own skill</h3><p>"Summarise mobility for the physiotherapist", "A note for the neighbour who has a key"...</p></button>
    </div>
    ${shown ? briefHtml(shown) : `<div class="empty card"><img src="/assets/img/evening.webp" alt="" width="1368" height="760"><p>No briefs yet. Run the weekly brief to see what the last seven days add up to.</p></div>`}
    ${S.briefs.length > 1 ? `<div class="past">${S.briefs.map((b) => `<button class="btn small ${shown && b.id === shown.id ? "primary" : ""}" data-open-brief="${b.id}">${esc(b.title)} · ${esc(relDay(b.at))}</button>`).join("")}</div>` : ""}`;
}

function viewMemory() {
  const facts = S.memory;
  const proposed = facts.filter((f) => f.status === "proposed");
  const confirmed = facts.filter((f) => f.status === "confirmed");
  const calUrl = location.origin + S.calendarPath;
  return `<p class="eyebrow">Memory</p><h1 class="page-title">What Hearthnote <em>keeps</em></h1>
    <p class="lede">Long-term memory is proposed by the model and confirmed by a person. Every fact links back to the note it came from, and anything can be forgotten.</p>
    <div class="banner-img"><img src="/assets/img/memory.webp" alt="" width="1190" height="886"></div>
    ${proposed.length ? `<section class="section"><div class="section-head"><h2>Proposed</h2></div><div class="card"><ul class="list">${proposed.map((f) => `<li class="fact proposed"><span class="kind">${esc(f.kind)}</span><p>${esc(f.fact)} ${f.noteIds.map((c) => `<button class="cite" data-cite="${esc(c)}">${esc(c)}</button>`).join("")}</p><span class="actions"><button class="icon-btn yes" data-action="fact-yes" data-id="${f.id}" title="Keep">${icon("check")}</button> <button class="icon-btn no" data-action="fact-no" data-id="${f.id}" title="Forget">${icon("x")}</button></span></li>`).join("")}</ul></div></section>` : ""}
    <section class="section"><div class="section-head"><h2>Remembered</h2><span class="aside">${confirmed.length} facts</span></div><div class="card">${confirmed.length ? `<ul class="list">${confirmed.map((f) => `<li class="fact"><span class="kind">${esc(f.kind)}</span><p>${esc(f.fact)} ${f.noteIds.map((c) => `<button class="cite" data-cite="${esc(c)}">${esc(c)}</button>`).join("")}</p><button class="btn small ghost" data-action="fact-no" data-id="${f.id}">Forget</button></li>`).join("")}</ul>` : `<p class="muted">Nothing yet.</p>`}</div></section>
    <section class="section"><div class="section-head"><h2>Routines</h2><span class="aside">Reminders go to everyone's own calendar.</span></div><div class="card">
      <ul class="list">${S.routines.map((r) => `<li><span class="time">${esc(r.time || "-")}</span><div class="grow">${esc(r.title)}<div class="meta">${esc(r.days || "daily")}${r.assigneeId ? " · " + esc(nameOf(r.assigneeId)) : ""}${r.status === "proposed" ? " · waiting for OK" : ""}</div></div>${r.status === "proposed" ? `<button class="icon-btn yes" data-action="routine-yes" data-id="${r.id}" title="Make it a routine">${icon("check")}</button>` : ""}<button class="icon-btn no" data-action="routine-no" data-id="${r.id}" title="Stop this routine">${icon("x")}</button></li>`).join("") || `<li class="muted">No routines.</li>`}</ul>
      <div class="subscribe section"><label class="sr" for="cal-url">Calendar feed</label><input id="cal-url" readonly value="${esc(calUrl)}"><button class="btn small" data-action="copy-cal">${icon("cal")}Copy calendar link</button></div>
      <p class="meta muted">Subscribe in Google Calendar, Outlook or an iPhone. The link contains a private token; share it only with the care circle.</p>
    </div></section>
    <section class="section"><div class="section-head"><h2>The care circle</h2><button class="btn small" data-action="add-member">${icon("plus")}Add someone</button></div><div class="card"><ul class="list">${people().map((p) => `<li>${avatar(p.id)}<div class="grow"><strong>${esc(p.name || "Not set")}</strong><div class="meta">${esc(p.role)} · shown to the model only as [${p.id}]</div></div></li>`).join("")}</ul></div></section>`;
}

function viewPrivacy() {
  const sent = S.ledger.length;
  const withheld = S.ledger.reduce((s, e) => s + (e.redactions || 0), 0);
  return `<p class="eyebrow">Privacy</p><h1 class="page-title">What <em>left</em> this server</h1>
    <p class="lede">The model works for the family, so the family can see every word it was sent. ${sent ? `${sent} request${sent === 1 ? "" : "s"} in this household so far, with ${withheld} names and identifiers withheld.` : "Nothing has been sent yet."}</p>
    <div class="banner-img"><img src="/assets/img/privacy.webp" alt="" width="1190" height="886"></div>
    <div class="pillars">
      <div class="card">${icon("lock")}<h3>Names stay home</h3><p>People become [P1], [P2]; streets, phone numbers, national register numbers, IBANs and private words you list become placeholders before anything is sent. Answers are re-identified on this server.</p></div>
      <div class="card">${icon("alert")}<h3>Emergencies first, offline</h3><p>Every note is checked for red flags with plain rules before any model sees it. A language model is never what stands between you and 112.</p></div>
      <div class="card">${icon("chip")}<h3>Your server, your vault</h3><p>Self-hosted, the household lives in one AES-256-GCM encrypted file. Inference runs on NVIDIA Nemotron open models through Nebius Token Factory.</p></div>
    </div>
    <section class="section"><div class="section-head"><h2>Private words</h2><button class="btn small" data-action="add-term">${icon("plus")}Add a word</button></div>
      <div class="card"><p class="muted">Anything here is replaced before text leaves the server: a GP's name, a street, a nickname.</p><div class="terms">${S.privateTerms.map((t) => `<span class="chip">${icon("lock")}${esc(t.text)}</span>`).join("") || `<span class="muted">None yet.</span>`}</div></div></section>
    <section class="section"><div class="section-head"><h2>Request ledger</h2><span class="aside">Newest first</span></div>
      <div class="ledger"><ul class="list">${S.ledger.map((e) => `<li><div class="grow"><div>${esc(e.skillTitle)}</div><div class="meta"><code>${esc(e.receipt?.model)}</code> · ${e.receipt?.tier === "deep" ? "deep" : "fast"} · ${((e.receipt?.latencyMs || 0) / 1000).toFixed(1)} s${e.receipt?.promptTokens != null ? ` · ${e.receipt.promptTokens} in / ${e.receipt.completionTokens} out` : ""} · ${e.redactions} withheld · ${esc(relDay(e.at))} ${esc(timeOf(e.at))}</div></div><button class="btn small" data-action="show-outbound" data-id="${e.id}">${icon("eye")}What was sent</button></li>`).join("") || `<li class="meta">No requests yet. Write a note and it will appear here.</li>`}</ul></div></section>`;
}

function answerHtml(a) {
  return `<div class="card answer"><p>${esc(a.answer)}</p>${a.missing ? `<p class="muted meta">${esc(a.missing)}</p>` : ""}<div>${(a.cites || []).map((c) => `<button class="cite" data-cite="${esc(c)}">${esc(c)}</button>`).join("")}</div>${receiptLine(a.receipt, `<span>confidence: ${esc(a.confidence)}</span>`)}</div>`;
}

function render() {
  renderChrome();
  if (!S) return;
  const v = $("#view");
  const fn = { today: viewToday, notes: viewNotes, briefs: viewBriefs, memory: viewMemory, privacy: viewPrivacy, write: viewToday }[view] || viewToday;
  v.innerHTML = fn();
  applyHues(v);
  v.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => (img.closest(".hero-img, .banner-img") || img).remove(), { once: true }));
}

// ---------- composer ----------
const steps = () => [...document.querySelectorAll("#steps li")];
function setStep(i) {
  steps().forEach((li, k) => {
    li.classList.toggle("done", k < i);
    li.classList.toggle("on", k === i);
  });
}

async function saveNote(e) {
  e.preventDefault();
  const ta = $("#note-text");
  const text = ta.value.trim();
  if (text.length < 3) return ta.focus();
  const btn = $("#save-note");
  btn.disabled = true;
  $("#capture-result").innerHTML = "";
  $("#steps").hidden = false;
  $("#step-model").textContent = isMock() ? "the offline mock" : shortModel(S.config.models.fast);
  setStep(0);
  try {
    const saved = await api("/api/notes", { method: "POST", body: JSON.stringify({ text, authorId: author, source: ta.dataset.source || "text" }) });
    ta.value = "";
    delete ta.dataset.source;
    if (saved.flags?.length) $("#capture-result").innerHTML = emergencyHtml(saved.flags);
    render();
    setStep(1);
    const out = await api(`/api/notes/${saved.noteId}/capture`, { method: "POST" });
    setStep(2);
    const note = S.notes.find((n) => n.id === saved.noteId);
    if (out.error || note?.status !== "done") throw new Error(out.error || "The note is saved but could not be read.");
    await new Promise((r) => setTimeout(r, 250));
    setStep(3);
    $("#capture-result").innerHTML = emergencyHtml(note.flags) + captureHtml(note);
    render();
  } catch (err) {
    toast(err.message);
    $("#steps").hidden = true;
    render();
  } finally {
    btn.disabled = false;
  }
}

function captureHtml(n) {
  const c = n.capture;
  const group = (label, items) => (items.length ? `<div class="group"><div class="group-label">${label}</div><ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : "");
  const withheld = S.ledger[0]?.redactions ?? 0;
  return `<div class="card capture">
    <h3>Filed under ${esc(n.id)}</h3>
    <p class="summary">${esc(c.summary)}</p>
    ${group("Observed", (c.observations || []).map((o) => `${esc(o.text)} <span class="muted">(${esc(o.category)}${o.severity >= 2 ? ", worth watching" : ""})</span>`))}
    ${group("Medication", (c.medications || []).filter((m) => m.change !== "mentioned").map((m) => `${esc(m.name)}: ${esc(m.change.replace("_", " "))}${m.detail ? ` <span class="muted">- ${esc(m.detail)}</span>` : ""}`))}
    ${group("To do", (c.tasks || []).map((t) => `${esc(t.title)}${t.due ? ` <span class="muted">(${esc(t.due)})</span>` : ""}`))}
    ${group("Proposed routine", (c.routines || []).map((r) => `${esc(r.title)}${r.time ? ` at ${esc(r.time)}` : ""}`))}
    ${group("Appointment", (c.appointments || []).map((a) => `${esc(a.title)}${a.date ? ` <span class="muted">(${esc(a.date)}${a.time ? " " + esc(a.time) : ""})</span>` : ""}`))}
    ${group("To remember (needs OK)", (c.memory || []).map((f) => esc(f.fact)))}
    ${receiptLine(n.receipt, `<span>${withheld} withheld</span>`)}
  </div>`;
}

function setupDictation() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#dictate");
  if (!Rec) return (btn.hidden = true);
  let rec = null;
  btn.addEventListener("click", () => {
    if (rec) return rec.stop();
    rec = new Rec();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    try { rec.processLocally = true; } catch { /* older browsers */ }
    const ta = $("#note-text");
    const base = ta.value ? ta.value.trim() + " " : "";
    rec.onresult = (ev) => {
      let text = "";
      for (const r of ev.results) text += r[0].transcript;
      ta.value = base + text;
      ta.dataset.source = "voice";
    };
    rec.onend = () => { rec = null; btn.classList.remove("listening"); btn.querySelector("span").textContent = "Dictate"; };
    rec.onerror = () => toast("Dictation is not available in this browser.");
    rec.start();
    btn.classList.add("listening");
    btn.querySelector("span").textContent = "Stop";
  });
}

// ---------- dialogs ----------
function dialog(html) {
  const d = $("#dialog");
  $("#dialog-body").innerHTML = html;
  applyHues(d);
  d.showModal();
  return d;
}

function showCite(id) {
  const n = S.notes.find((x) => x.id === id);
  if (!n) return;
  dialog(`${noteHtml(n)}<div class="row"><button class="btn" data-action="close">Close</button></div>`);
}

function highlightTokens(text) {
  return esc(text).replace(/\[(P\d+|PRIVATE\d+|EMAIL\d+|IBAN\d+|NATIONAL_ID\d+|PHONE\d+|DOB\d+|ADDRESS\d+)\]/g, "<mark>[$1]</mark>");
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const cite = e.target.closest("[data-cite]");
  if (cite) { e.preventDefault(); return showCite(cite.dataset.cite); }
  const openB = e.target.closest("[data-open-brief]");
  if (openB) { openBriefId = openB.dataset.openBrief; if (view !== "briefs") location.hash = "#briefs"; else render(); return; }
  const who = e.target.closest("[data-author]");
  if (who) { author = who.dataset.author; return renderWho(); }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, id } = el.dataset;
  try {
    if (action === "close") return $("#dialog").close();
    if (action === "reset-demo") { await api("/api/demo/reset", { method: "POST" }); lastAnswer = null; openBriefId = null; render(); return toast("The demo household is back to its first day."); }
    if (action === "task-done") { await api(`/api/tasks/${id}`, { method: "POST", body: JSON.stringify({ done: true }) }); return render(); }
    if (action === "fact-yes" || action === "fact-no") { await api(`/api/memory/${id}`, { method: "POST", body: JSON.stringify({ status: action === "fact-yes" ? "confirmed" : "rejected" }) }); render(); return toast(action === "fact-yes" ? "Remembered." : "Forgotten."); }
    if (action === "routine-yes" || action === "routine-no") { await api(`/api/routines/${id}`, { method: "POST", body: JSON.stringify({ status: action === "routine-yes" ? "active" : "archived" }) }); render(); return toast(action === "routine-yes" ? "Added to the routines and the calendar feed." : "Routine removed."); }
    if (action === "retry") { el.disabled = true; await api(`/api/notes/${id}/capture`, { method: "POST" }); return render(); }
    if (action === "delete-skill") { e.stopPropagation(); await api(`/api/skills/${id}`, { method: "DELETE" }); return render(); }
    if (action === "run-skill") {
      if (busy.has(id)) return;
      busy.add(id);
      render();
      try {
        const out = await api(`/api/skills/${id}/run`, { method: "POST" });
        openBriefId = out.briefId;
      } finally {
        busy.delete(id);
        render();
      }
      $(`#brief-${openBriefId}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return;
    }
    if (action === "new-skill") {
      return dialog(`<h2>Write a skill</h2><p class="muted">A skill is a recipe Hearthnote can run whenever you like. It reads the notes, withholds names, and writes a cited brief.</p>
        <form id="skill-form"><label for="sk-title">Name</label><input id="sk-title" name="title" maxlength="60" placeholder="Physio summary" required>
        <label for="sk-ins">What should it write?</label><textarea id="sk-ins" name="instructions" maxlength="1200" placeholder="Summarise mobility, falls, walking distance and the exercises for the physiotherapist. Note what got easier and what got harder." required></textarea>
        <label for="sk-tier">Model</label><select id="sk-tier" name="tier"><option value="fast">Quick - ${esc(shortModel(S.config.models.fast))}</option><option value="deep">Careful reasoning - ${esc(shortModel(S.config.models.deep))}</option></select>
        <label for="sk-days">Look back</label><select id="sk-days" name="days"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select>
        <div class="row"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary" type="submit">Save skill</button></div></form>`);
    }
    if (action === "add-member") {
      return dialog(`<h2>Add someone to the circle</h2><form id="member-form"><label for="m-name">Name</label><input id="m-name" name="name" maxlength="60" required><label for="m-role">Role</label><input id="m-role" name="role" maxlength="80" placeholder="granddaughter, visits on Wednesdays"><p class="muted meta">The name is only ever stored here. The model sees a token and the role.</p><div class="row"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`);
    }
    if (action === "add-term") {
      return dialog(`<h2>Add a private word</h2><form id="term-form"><label for="t-text">Word or phrase</label><input id="t-text" name="text" maxlength="80" placeholder="Dr. Janssens, Kerkstraat, Bompa" required><div class="row"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`);
    }
    if (action === "copy-cal") { await navigator.clipboard.writeText($("#cal-url").value).catch(() => {}); return toast("Calendar link copied."); }
    if (action === "show-outbound") {
      const entry = await api(`/api/ledger/${id}`);
      return dialog(`<h2>Exactly what was sent</h2><p class="muted">${esc(entry.skillTitle)} · <code>${esc(entry.receipt?.model)}</code> · ${entry.redactions} names and identifiers withheld (highlighted tokens).</p><pre class="outbound">${highlightTokens(entry.outbound)}</pre><div class="row"><button class="btn" data-action="close">Close</button></div>`);
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.id === "composer") return saveNote(e);
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  try {
    if (f.id === "ask-form") {
      const q = (data.q || "").trim();
      if (q.length < 3) return;
      const btn = f.querySelector("button");
      btn.disabled = true;
      btn.textContent = "Reading...";
      const out = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: q }) });
      lastAnswer = out.answer;
      render();
      return;
    }
    if (f.id === "skill-form") { await api("/api/skills", { method: "POST", body: JSON.stringify(data) }); $("#dialog").close(); render(); return toast("Skill saved. Run it whenever you like."); }
    if (f.id === "member-form") { await api("/api/members", { method: "POST", body: JSON.stringify(data) }); $("#dialog").close(); return render(); }
    if (f.id === "term-form") { await api("/api/private-terms", { method: "POST", body: JSON.stringify(data) }); $("#dialog").close(); return render(); }
  } catch (err) {
    toast(err.message);
    render();
  }
});

$("#dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") e.target.close(); });

function route() {
  const h = (location.hash || "#today").slice(1);
  view = ["today", "notes", "briefs", "memory", "privacy", "write"].includes(h) ? h : "today";
  render();
  if (view === "write") $("#note-text").focus();
  else window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

(async function boot() {
  setupDictation();
  try {
    await api("/api/state");
  } catch (err) {
    $("#view").innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    return;
  }
  route();
})();
