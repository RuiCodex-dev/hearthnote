# Generated assets log

Every AI-generated asset in this repository. Generated imagery is **mood only**: still lifes of
an (imaginary) older person's home. It never shows people, faces or hands, never contains
text, and never stands in for product UI. Every screen in the README, the gallery and the video
is the real running app.

## Images: Google Flow, Nano Banana Pro

- Tool: Google Flow through `gflow-cli`, `gflow image t2i --model nano-pro -n 3`, owner's Google
  AI Ultra account (Chrome profile `hesap5`, owner tag `hearthnote`). Date: 2026-10-15.
- Cost: 0 Flow credits (image generation only). **No Veo video was generated.**
- 7 prompts x 3 variants = 21 images; one chosen per prompt from contact sheets. Raw variants
  stay in `design/gen/raw/` (git-ignored, not published). Prompts: `design/prompts.json`;
  script: `design/generate.py`.
- Post-processing (`design/grade.py`): 0.6 % edge trim, lifted blacks and soft S-curve, sage
  shadow / oatmeal highlight split tone, saturation 0.92, seeded fine grain. Masters in
  `design/art/` (PNG), web copies in `public/assets/img/` (WebP, never upscaled).

Shared style suffix appended to every prompt (full text in `design/prompts.json`):

> Quiet documentary still-life photograph inside a lived-in older home in Flanders, 35mm film,
> 50mm lens, Kodak Portra 160, soft overcast north-window morning daylight, sage, oatmeal linen,
> warm oak, terracotta and faded enamel blue, fine grain, low contrast, no people, no faces, no
> hands, absolutely no text, no letters, no numbers, no logos, no screens.

| Asset | Subject (abridged) | Aspect | Chosen variant | Used in |
| --- | --- | --- | --- | --- |
| `hero` | Oak kitchen table by a window: blank notebook, reading glasses, coffee with milk, unmarked pill organiser, rosemary jar | 16:9 | `_3` (no newspaper, so no pseudo-text) | Today view, video open |
| `evening` | The same table in late-afternoon light, notebook closed, clementines | 16:9 | `_1` | Briefs empty state, video close |
| `walk` | Rollator in a tiled hallway, sage scarf, shopping bag | 4:3 | `_2` | Video "problem" scene |
| `memory` | Old photo prints face down tied with ribbon, shoebox, magnifier, tea | 4:3 | `_2` | Memory view banner |
| `privacy` | Closed wooden keepsake box, iron key, lavender | 4:3 | `_2` | Privacy view banner |
| `visit` | Front door ajar onto a cobbled street, tulips in paper, umbrella | 4:3 | `_2` | First-run setup (private mode) |
| `routine` | Bedside table at dusk, unlabeled dropper bottle, water, watch without numerals | 4:3 | `_1` | Spare (not used yet) |

## Narration: Microsoft Edge neural TTS

`video/make_audio.py`, voice `en-GB-SoniaNeural`, rate -4 %, script `video/narration.json`.
Synthetic voice; no person's voice was cloned.

## Music

Synthesised in `video/make_audio.py` with ffmpeg sine sources (a slow D major-seventh pad). No
third-party or AI-generated music.

## Code

The application, scripts and documents were written with an AI coding assistant (Claude Code)
under the direction of Rui Codex, as permitted by the rules ("technical assistance").
