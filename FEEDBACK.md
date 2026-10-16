# Feedback on Nebius Token Factory and NVIDIA Nemotron

Written while building Hearthnote for the Nebius x NVIDIA Global AI Hackathon (October 2026),
as a solo developer in Belgium. Each item says what happened, why it matters and what would fix
it. Items marked **(live)** come from the end-to-end run in
[`evidence/LIVE_CHECK.md`](evidence/LIVE_CHECK.md); the rest are from onboarding and the docs.

## 1. Onboarding: the hackathon credit cannot be used without a payment card

**What happened.** The account was created with Google sign-in in a minute. The promo form
(activation code `NEBIUS-DEVPOST-GLOBAL26`) worked and the USD 25 code arrived by e-mail the
same day. But redeeming any credit first requires completing billing details, and that modal
asks for a payment card for a temporary $0 authorisation. Every model call is blocked until the
card holder completes that step, which for a company account means the developer builds against
a mock and waits.

**Why it matters.** Hackathon participants are exactly the people who want to try before they
commit a card, and many build on a company account where the developer is not the card holder.
The FAQ already lists billing-country gaps as the most common blocker; the card step is the
same wall for people in supported countries.

**Suggestion.** Let a promo code be redeemed into a capped, card-less "trial" balance (hard stop
at zero, no overage), and ask for a card only when the user wants to go beyond it. Show the
promo-code field *before* the billing form.

## 2. The Builders Program requires a GitHub ID

The second USD 25 (Builders Program) form makes a GitHub ID mandatory. Some participants cannot
link a personal or company GitHub account to a third party (ours has a policy against it without
separate approval). An e-mail-only path, or GitLab/Bitbucket as alternatives (the hackathon
itself accepts all three), would include them.

## 3. Nemotron model ids are hard to find

**What happened.** The Quickstart uses `deepseek-ai/DeepSeek-R1-0528`; the structured-output
page uses Qwen, Mistral and gpt-oss. The hackathon page names "Nemotron 3 Ultra, Super and Nano"
but no API ids. We found `nvidia/nemotron-3-super-120b-a12b` and
`nvidia/Nemotron-3-Ultra-550b-a55b` on third-party integration pages, and the casing is
inconsistent between the two (`nemotron` vs `Nemotron`, `120b` vs `550b-a55b`).

**Why it matters.** A wrong-case id is a 404 at the first request, and every participant of a
Nemotron hackathon makes this lookup.

**Suggestion.** A "Nemotron on Token Factory" page with copy-paste ids, context length, price,
and which features each one supports; and case-insensitive model ids (or a redirect from the
lowercase form). Hearthnote works around it by calling `GET /v1/models` at start-up and matching
case-insensitively, falling back to the closest Nemotron.

## 4. Capability metadata is not machine-readable

The docs say structured output support varies and to "look for the JSON mode tag on a model
card". That tag lives in the web UI. A client cannot ask `/v1/models` whether a model supports
`json_schema`, tool calling or a reasoning toggle, so every app ends up probing with a request
and handling a 400. Adding `capabilities` (e.g. `json_schema`, `tools`, `reasoning_toggle`,
`max_context`) to the `/v1/models` objects would remove that guesswork. Hearthnote's client
remembers, per model, which `response_format` the endpoint accepted after the first call.

## 5. Bug in the structured-output Python example

On *Structured output & JSON*, the JSON-schema example does not run as printed: inside
`client.chat.completions.create(...)` the `response_format` dict is missing a comma between
`"type": "json_schema"` and `"json_schema": ...`, and there is no comma after the closing brace
before `messages=`. It also passes `Film.model_json_schema()` directly where the OpenAI-style
shape is `{"name": ..., "schema": ...}`. Small, but it is the page people copy from first.

## 6. Hybrid reasoning: how to switch thinking off is not documented

Nemotron 3 models can reason or answer directly. For high-volume calls (Hearthnote reads every
note) thinking adds latency and tokens without improving extraction. The Token Factory docs do
not say how to turn it off per request. We send `chat_template_kwargs: {"enable_thinking":
false}` and fall back gracefully if the endpoint rejects it, but a documented, supported switch
(and a statement of whether reasoning tokens are billed as completion tokens) would help every
app that mixes fast and deep calls, which is exactly what the Best Apps track recommends.

## 7. Things that were good

- **OpenAI compatibility is real**: a 150-line `fetch` client with no SDK was enough.
- **The rate-limit page is excellent**: the dynamic scale-up rule and the
  `x-ratelimit-remaining-*` headers are clearly explained; more providers should document
  limits this honestly.
- **The model catalogue endpoint** made it possible to resolve models at runtime instead of
  hard-coding them.
- **Nemotron's open licence** is the reason a privacy-first product can promise families a path
  to self-hosting the same model later (Nebius AI Cloud or their own hardware) without changing
  the prompts.

## 8. Observations from the live runs **(live)**

Three runs against Token Factory on 15 and 16 October 2026: the live check (17 calls), the
end-to-end QA over HTTP (10 calls, [`qa/e2e-live-2026-10-16.json`](qa/e2e-live-2026-10-16.json))
and the recordings for the demo video. All of it together cost **USD 0.19** by the Token Factory usage
page (16 October, 11:00 UTC: Ultra USD 0.17, Super USD 0.02), drawn from the USD 1 trial credit;
the USD 25 promo balance was not touched. The deep tier is where the money goes.

- **Nemotron 3 Super is fast enough to sit behind a "Save" button.** 15 note captures took
  0.8 to 1.9 s each (about 1,000 prompt and 80 to 230 completion tokens), including a
  4,000-character note at 1.2 s. With reasoning off, the family never waits.
- **Nemotron 3 Ultra with reasoning on takes 8 to 31 s per brief** and writes 2,900 to 4,200
  completion tokens for a one-page result, most of it reasoning. Reasoning is billed as
  completion tokens, which is fair, but the docs should say so: at USD 3 per million output
  tokens that is about one cent per weekly brief, which makes the deep tier affordable for a
  weekly job and too slow for anything interactive. Splitting by tier is the right pattern and
  worth showing in the docs.
- **`response_format: json_schema` and `chat_template_kwargs.enable_thinking` were both
  accepted on the first request** (probed on Super; the client's degrade path never fired).
  Across all 27 structured calls the validator recorded **0 schema warnings** and **no repair
  round was needed**. That is better adherence than we expected from an open model.
- **Citations held up.** Every brief cited real note ids; the server drops any id that does not
  exist, and in these runs it dropped none.
- **Errors are clean.** A wrong key returns 401 in about 30 ms with a JSON body, so a client can
  tell "your key" from "our outage" instantly.
- **One surprise worth a docs line:** Super is conservative about long-term facts. Over twelve
  notes it proposed only two durable facts (a coffee preference and a penicillin allergy) where a
  rule-based extractor proposed many. For a consent-based memory that is the right behaviour,
  but it changed how we seed the demo.
