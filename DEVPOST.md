# Devpost submission: Hearthnote

**Submitted 16 October 2026: <https://devpost.com/software/hearthnote>** (submission 1240452; editable until the deadline).

Copy-ready text for the "Enter a submission" form of the Nebius x NVIDIA Global AI Hackathon.
Deadline: **Friday 30 October 2026, 10:00 PDT = 18:00 Belgian time (CET; clocks go back on
25 October)**.

| Field | Value |
| --- | --- |
| Project name | Hearthnote |
| Tagline (elevator pitch, max 200 characters) | A private notebook for families caring for someone at home. Nemotron files every note, writes the weekly brief and asks the GP's questions, without learning anyone's name. |
| Track | **Personal AI Track** |
| Demo URL | https://hearthnote.ruicodex.com *(no login, fictional household)* |
| Repository | https://github.com/RuiCodex-dev/hearthnote *(MIT licence)* |
| Video | https://www.youtube.com/watch?v=oRDZvi5sso0 (2:19) |
| Built with | nvidia-nemotron, nemotron-3-super, nemotron-3-ultra, nebius-token-factory, tavily, node.js, javascript, html5, css3, icalendar, aes-256-gcm, docker, playwright, hyperframes |
| City event | none attended |
| Existed before the submission period? | No. Written from scratch in October 2026 for this hackathon. |
| Team | Rui Codex (solo) |

## Inspiration

When a parent starts needing care, what the family knows about her scatters across people. The
daughter knows about the new blood-pressure tablet. The home nurse noticed her ankles were
puffy. The son saw her hold the stair rail with both hands. Nobody notices that all three
started in the week after the new tablet, and nobody remembers to ask the GP. In Belgium, 12.2 %
of people aged 15 and over give informal care every week (Sciensano, Health Interview Survey
2018); they coordinate in group chats that forget everything.

A general chatbot is the wrong shape for this. Families will not paste their mother's name,
address and medication list into one, and they should not have to. The Personal AI track asks
for an always-on assistant with persistent memory and reusable skills that keeps your data under
your control; a care circle is the clearest case we know where that matters.

## What it does

Anyone in the care circle writes what happened, the way they would text a sibling, or dictates
it. Hearthnote:

- **checks the note for emergencies first, offline** (a fall with a head injury, stroke signs,
  chest pain) and says "call 112" before any model is involved;
- **files it** with NVIDIA Nemotron 3 Super in about 1 to 2 seconds: observations with category
  and severity, medication changes, tasks, repeating routines, appointments and facts worth
  remembering, each linked to its note;
- **asks before it remembers**: long-term facts and new routines are proposals a person
  confirms, edits or forgets;
- **runs skills**: a weekly family brief, a one-page brief for the doctor's visit, a
  medication-change check, a handover for whoever visits next, and any skill the family writes
  in plain English. The deep ones run on Nemotron 3 Ultra with reasoning on, and every line
  cites the notes it rests on;
- **looks things up safely**: the medication check asks Tavily for public reference pages
  (MedlinePlus, NHS, drugs.com) using the medication name only, never a note or a person, and
  cites them as S1, S2 next to the family's own N-numbers;
- **answers questions** from the log, with citations, and says so when the notes do not cover
  it ("The log does not mention her favourite film.");
- **puts reminders where people already look**: a private calendar feed for Google Calendar,
  Outlook or an iPhone;
- **works while nobody is looking**: in a private install the weekly brief writes itself every
  Sunday at 18:00 in the household's timezone;
- **shows its work**: the privacy page lists every request that left the server, with model,
  tokens, latency and the exact redacted prompt.

In the demo household (fictional), three people mention dizziness and puffy ankles in the days
after the GP started amlodipine. No single note is alarming. The weekly brief lines them up by
date and turns them into a question for Tuesday's GP appointment, and the model never learns who
Mireille is.

## How we built it

- **Two Nemotron tiers on Nebius Token Factory**, chosen per skill. Nemotron 3 Super
  (`nvidia/nemotron-3-super-120b-a12b`) with thinking off reads every note, answers questions
  and writes handovers; Nemotron 3 Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`) with reasoning
  on writes the weekly brief, the doctor's-visit brief and the medication check.
- **A privacy gate in front of every call.** Care-circle names become `[P1]`, `[P2]` with a role
  ("daughter, visits most weekdays"), so the model can still reason about who should do what.
  Private words, phone numbers, e-mail addresses, Belgian national register numbers, IBANs,
  street addresses and birth dates become placeholders. Output is re-identified on the server.
- **Declarative skills** (`skills/*.json`): context sources and window, tier, tool, instructions
  and a JSON Schema. One runner executes the built-in skills and the ones a family writes.
- **Structured output** with `response_format: json_schema`, a fallback to `json_object`, one
  repair round and a validator. The server keeps only citations that point at real notes or
  real reference pages.
- **Runtime model resolution** from `GET /v1/models`, so a catalogue change does not break the
  app.
- **Plain Node.js 22 with zero npm dependencies**, a strict Content Security Policy, an
  AES-256-GCM vault and a household passcode for private installs, per-visitor sandboxes and call
  budgets for the public demo, an iCalendar feed, and a Docker image.
- **Tested on the real thing**: 29 offline tests (including a local stand-in for Token Factory
  that produces timeouts, refused keys, outages and broken JSON on demand), a 40-check end-to-end
  run over HTTP against the live API, and a 34-check browser click-through on desktop and phone
  sizes.

## Challenges we ran into

- **Making a reasoning model useful for bookkeeping.** The note reader must be fast, literal and
  schema-exact; the weekly brief must compare dates across a dozen notes from different people.
  Splitting the work by tier, with thinking off for the fast tier, gave captures in about 1.5 s
  and briefs in 10 to 30 s.
- **Redaction that does not break reasoning.** Bare placeholders confused who was who; giving
  each placeholder a role fixed it.
- **Safety without paternalism.** The model never diagnoses or suggests dose changes; concerns
  become questions for the GP, pharmacist or nurse, and emergencies never wait for a model.
- **Failing gracefully.** A timeout used to be retried four times (up to six minutes). Now a
  note is always saved first, a slow or refused model call returns a plain sentence, and the
  family can retry.

## Accomplishments that we're proud of

- A model that reads a family's private notes without learning anyone's name: 0 real names in
  any outbound prompt across every live run, with 61 to 79 names and identifiers withheld per run.
- Briefs where every sentence links to the note or the public source it came from.
- 0 schema warnings and no repair round needed across 27 structured Nemotron calls.
- Reminders that reach a brother in another city through the calendar he already uses.

## What we learned

The most valuable thing a language model does for a care circle is not conversation but
connecting dates across people. And consent (propose, then confirm) is what makes long-term
memory something a family can trust. Nemotron turned out to be conservative about what it
proposes to remember, which is exactly right for that.

## What's next for Hearthnote

Shared circles with a login per member, a Dutch and French interface for Belgian families,
on-device transcription, and an option to run Nemotron on the family's own Nebius AI Cloud
endpoint so nothing leaves their infrastructure at all.

## Testing instructions

Open the demo URL: no login. You get your own sandbox with a fictional household (Mireille, 81,
and her family); **Start over** resets it. Each sandbox has 40 model calls.

1. **Write a note** in the right-hand panel (or tap *Write* on a phone), for example: *"Took Mum
   to the market. She was dizzy getting off the bus. Eye drops done at nine. We need to buy
   batteries for her hearing aid."* Watch it being filed, with the Nemotron receipt underneath.
2. **Briefs -> Weekly family brief** (Nemotron 3 Ultra, 10 to 40 s). Click any `N` chip to see
   the note behind a sentence.
3. **Briefs -> Medication change check**: the `S` chips open the public reference pages found by
   medication name.
4. **Today -> Ask**: *"When did the dizziness start?"*
5. **Memory**: confirm or forget a proposed fact; copy the calendar link into a calendar app.
6. **Privacy -> What was sent**: the exact prompt, with names replaced.
7. Write *"She fell and hit her head"* to see the offline emergency check.

To run it yourself: `npm test`, then `NEBIUS_API_KEY=... npm start` (Node.js 22, no
dependencies). Without a key it falls back to an offline mock and says so.

## Feedback on Nebius Token Factory and NVIDIA Nemotron

Paste `FEEDBACK.md` into the feedback field. Summary: card-less promo credits, an e-mail path for
the Builders Program, a findable list of Nemotron ids, machine-readable model capabilities, a fix
for the structured-output example, a documented reasoning toggle and a note that reasoning is
billed as completion tokens; plus measured latency, schema adherence and cost from the live runs.

## Gallery

`docs/gallery/01-hero.png` to `05-phone.png` (3:2, 1800 x 1200) and the thumbnail
`docs/gallery/thumbnail.png`. Every screen is the real running app on Nemotron; the backgrounds
are Google Flow still lifes (no people, no text), listed in `design/GENERATED_ASSETS.md`.

## AI disclosure

The app's language features are NVIDIA Nemotron on Nebius Token Factory, by design. Code and
documents were written with the help of an AI coding assistant. Background photographs in the
app, gallery and video are AI-generated still lifes (Google Flow, Nano Banana Pro) and contain no
people. The narration is Microsoft Edge neural text-to-speech. Every product screen is a real
capture of the running app; nothing in the video is generated footage.
