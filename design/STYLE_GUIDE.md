# Hearthnote style guide

Hearthnote is read at a kitchen table, on a phone in a hospital corridor, and by an 81-year-old
with reading glasses. The design is **quiet, warm and legible**: an editorial notebook, not a
dashboard. Nothing glows, nothing pulses for attention unless it is an emergency.

## Palette (7 tokens)

| Token | Hex | Use |
| --- | --- | --- |
| `--linen` | `#F4EFE6` | Page background, the paper of the notebook |
| `--paper` | `#FBF8F2` | Cards, composer, briefs |
| `--ink` | `#22302F` | Body text and headings (contrast 12.9:1 on linen) |
| `--slate` | `#5B6865` | Secondary text, metadata (5.4:1 on linen) |
| `--sage` | `#4F7259` | Primary actions, "went well", confirmed memory (5.2:1 on paper) |
| `--clay` | `#A9462F` | Brand mark, "ask the clinician", emergency (5.6:1 on paper) |
| `--ochre` | `#B07F1F` | "Keep an eye on", proposals waiting for a person (only on large text or with an icon) |

Supporting neutrals: `--rule #E2DACB` (hairlines), `--dusk #26303D` (the privacy ledger, the
one dark surface, so "what left the server" reads as a different, technical layer).

Dark mode swaps linen/paper for `#161C1F`/`#1E2629` and keeps hue roles.

## Typography

- **Newsreader** (OFL) - headings, the date line, and the body of generated briefs. Optical
  size axis on; italics for the wordmark and for quoted notes.
- **Atkinson Hyperlegible Next** (OFL) - all interface text, inputs and metadata. Designed
  for low-vision readers.
- Base size 17px, line-height 1.55. Scale: 13 / 15 / 17 / 21 / 28 / 40. Never below 13px.
- Numbers in receipts use `font-variant-numeric: tabular-nums`.

## Spacing and shape

4px base: 4, 8, 12, 16, 24, 32, 48, 72. Cards radius 14px, chips 999px, inputs 12px.
Hairline rules instead of shadows; one soft shadow (`0 1px 0 rgba(34,48,47,.06), 0 8px 24px -16px rgba(34,48,47,.25)`) for floating layers only.

## Iconography

One hand-built family, inline SVG sprite in `public/index.html`: 24px grid, 1.6px stroke,
round caps and joins, no fills except the brand dot. Icons always sit next to a word; flags
use icon + colour + label so meaning never depends on colour alone.

## Motion

- 160-220ms, `cubic-bezier(.2,.7,.2,1)`. Things settle; they do not bounce.
- A note being read shows a calm three-step progress line ("Withholding names", "Reading on
  Nemotron", "Filing it away"), not a spinner.
- `prefers-reduced-motion` removes every transition except opacity.

## Imagery

Documentary still-life photographs of an older person's home in Flanders, morning daylight,
Kodak Portra palette (sage, oatmeal linen, oak, terracotta, faded enamel blue), film grain,
**never people, faces or hands**, never text. Generated with Google Flow (Nano Banana Pro),
curated and graded consistently (`design/grade.py`); every asset logged in
`design/GENERATED_ASSETS.md`. Imagery is mood only: empty states, the landing, the video. It
never stands in for product UI.

## Voice

Plain, warm, specific. "Ask the GP whether..." not "Consult your healthcare provider". No
exclamation marks, no "AI magic". The model is named exactly once per surface, in the
receipt, because that is where it is useful.
