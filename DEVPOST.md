# Devpost submission: Hearthnote

Copy-ready text for the "Enter a submission" form of the Nebius x NVIDIA Global AI Hackathon.
Deadline: **Friday 30 October 2026, 10:00 PDT = 18:00 Belgian time (CET)**.

| Field | Value |
| --- | --- |
| Project name | Hearthnote |
| Tagline (elevator pitch) | A private notebook for families caring for someone at home: notes in, routines, reminders and a weekly brief out, with names withheld from the model. Powered by NVIDIA Nemotron on Nebius Token Factory. |
| Track | **Personal AI Track** |
| Demo URL | https://hearthnote.ruicodex.com *(after hosting is approved)* |
| Repository | https://github.com/RuiCodex-dev/hearthnote *(after publishing is approved; MIT licence)* |
| Video | YouTube link *(after upload is approved)*, 2:3x |
| Built with | nvidia-nemotron, nebius-token-factory, node.js, javascript, html, css, icalendar, aes-gcm, playwright, hyperframes |
| City event | none attended |
| Existed before the submission period? | No. Written from scratch in October 2026 for this hackathon. |
| Team | Rui Codex (solo) |

## Inspiration

When a parent starts needing care, what we know about them scatters across people. The daughter
knows about the new blood-pressure tablet, the son saw her hold the stair rail with both hands,
the home nurse wrote the eye-drop schedule on a sticky note. Nobody notices that the dizziness
started two days after the new tablet, and nobody remembers to ask the GP. In Belgium 12.2 % of
people over 15 give informal care every week; they coordinate in group chats that forget
everything.

A general chatbot is the wrong shape for this. Families will not paste their mother's name,
address and medication list into one, and they should not have to.

## What it does

Anyone in the care circle writes what happened, the way they would text a sibling, or dictates
it. Hearthnote:

- **checks the note for emergencies first, offline** (fall with a head injury, stroke signs,
  chest pain) and tells you to call 112 before any model is involved;
- **files it** with NVIDIA Nemotron: observations with category and severity, medication
  changes, one-off tasks, repeating routines, appointments, and facts worth remembering;
- **asks before it remembers**: long-term facts and new routines are proposals a person
  confirms, edits or forgets;
- **runs skills**: a weekly family brief, a one-page brief for the doctor's visit, a
  medication-change check, a handover for whoever visits next, and any skill the family writes
  themselves. Every line cites the notes it rests on;
- **answers questions** from the log, with citations ("When did the dizziness start?");
- **puts reminders where people already look**: a private calendar feed for every member;
- **writes the weekly brief by itself** every Sunday evening in a private install;
- **shows its work**: a privacy ledger lists every request that left the server, with model,
  tokens, latency and the exact redacted prompt.

In the demo household (fictional), three different people mention dizziness and swollen ankles
in the ten days after the GP started amlodipine. No single note says anything alarming; the
weekly brief lines them up by date and turns them into a question for Tuesday's GP appointment,
without ever telling the model who Mireille is.

## How we built it

- **Two Nemotron tiers on Token Factory**, as the track suggests: Nemotron 3 Super with
  reasoning off reads every note, answers questions and writes handovers; Nemotron 3 Ultra with
  reasoning on writes the weekly brief, the doctor's-visit brief and the medication check.
- **A privacy gate** in front of every call: care-circle names become `[P1]`, `[P2]` with a
  role; private words, phone numbers, e-mails, Belgian national register numbers, IBANs,
  addresses and birth dates become placeholders. Output is re-identified on the server.
- **Declarative skills** (`skills/*.json`): context sources and window, tier, instructions,
  JSON Schema. One runner executes built-in and family-written skills.
- **Structured output** with `json_schema`, graceful fallback to `json_object`, a repair round
  and a validator; every brief's citations are checked against real note ids.
- **Runtime model resolution** from `GET /v1/models`, so a catalogue change does not break the
  app.
- **Plain Node.js 22, zero npm dependencies**, a strict Content Security Policy, an AES-256-GCM
  vault for private installs, per-visitor sandboxes and call budgets for the public demo, and an
  iCalendar feed. 18 automated tests.

## Challenges

- Making a reasoning model useful for *bookkeeping*: the note reader needs to be fast, literal
  and schema-exact; the weekly brief needs to compare dates across a dozen notes. Splitting the
  work by tier and switching thinking off for the fast tier was the answer.
- Redaction that does not break the model's reasoning: placeholders carry a role ("daughter,
  visits most weekdays") so the model can still say who should do what.
- Safety without paternalism: the model never diagnoses or suggests dose changes; it turns
  concerns into questions for the GP, pharmacist or nurse.

## Accomplishments we are proud of

- A model that reads a family's private notes without learning anyone's name.
- Briefs where every sentence links to the note it came from.
- Reminders that reach a brother in another city through the calendar he already uses.

## What we learned

That the most valuable thing a language model does for a care circle is not conversation but
*connecting dates across people*, and that consent (propose, then confirm) makes long-term
memory something families can trust.

## What's next

Shared circles with per-member logins, a Dutch and French interface for Belgian families,
on-device transcription, and an option to run Nemotron on the family's own Nebius AI Cloud
endpoint.

## Testing instructions

Open the demo URL: no login. You get your own sandbox with a fictional household (Mireille, 81,
and her family), reset with **Start over**.

1. **Write a note** in the right-hand panel (or tap *Write* on a phone), for example: *"Took Mum
   to the market. She was dizzy getting off the bus. Eye drops done at nine. We need to buy
   batteries for her hearing aid."* Watch it get filed, with the Nemotron receipt underneath.
2. **Briefs -> Weekly family brief** (Nemotron Ultra, 20-60 s). Click any `N` chip to see the
   note behind a sentence.
3. **Today -> Ask**: *"When did the dizziness start?"*
4. **Memory**: confirm or forget proposed facts; copy the calendar link.
5. **Privacy -> What was sent**: the exact prompt, with names replaced.
6. Write *"She fell and hit her head"* to see the offline emergency check.

## Feedback on Nebius Token Factory and NVIDIA Nemotron

See `FEEDBACK.md` in the repository (also pasted into the feedback field): card-less promo
credits, GitHub-free Builders Program, a findable list of Nemotron ids, machine-readable model
capabilities, a fix for the structured-output example, and a documented reasoning toggle.
