# Live check against Nebius Token Factory - 2026-10-15
Run by `scripts/live-check.mjs`. 17 model calls (cap 20). Started 2026-10-15T20:23:41.162Z, finished 2026-10-15T20:24:31.530Z.
- Fast tier: `nvidia/nemotron-3-super-120b-a12b`
- Deep tier: `nvidia/Nemotron-3-Ultra-550b-a55b`
- NVIDIA models listed by the catalogue: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3.5-Super-VL`
- Tokens: 20,066 prompt, 13,678 completion
- Names and identifiers withheld from the model: 61; real names found in outbound prompts: **0**
| Step | Model | Tier | Latency | Tokens in / out |
| --- | --- | --- | ---: | ---: |
| capture N1 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.7 s | 1002 / 162 |
| capture N2 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.4 s | 1004 / 233 |
| capture N3 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.5 s | 986 / 112 |
| capture N4 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.6 s | 1002 / 180 |
| capture N5 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.1 s | 990 / 168 |
| capture N6 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.2 s | 990 / 165 |
| capture N7 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.8 s | 995 / 176 |
| capture N8 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.3 s | 1006 / 176 |
| capture N9 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.1 s | 998 / 140 |
| capture N10 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.1 s | 989 / 133 |
| capture N11 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.6 s | 1016 / 180 |
| capture N12 | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.9 s | 996 / 193 |
| weekly-digest | `nvidia/Nemotron-3-Ultra-550b-a55b` | deep | 9.3 s | 1531 / 3456 |
| visit-prep | `nvidia/Nemotron-3-Ultra-550b-a55b` | deep | 11.1 s | 2232 / 4226 |
| med-check | `nvidia/Nemotron-3-Ultra-550b-a55b` | deep | 8.1 s | 2172 / 3339 |
| handover | `nvidia/nemotron-3-super-120b-a12b` | fast | 2.9 s | 1129 / 540 |
| ask | `nvidia/nemotron-3-super-120b-a12b` | fast | 1.2 s | 1028 / 99 |
## Weekly brief headline
> Weekly brief 2026-10-09 to 2026-10-15
## Questions it raised for the GP
- Could the dizziness and spinning sensation when standing be related to the new amlodipine or her blood pressure? (N8, N9, N10)
- Is the ankle puffiness a known side effect of amlodipine or should it be investigated further? (N8, N12)
- Is the blood pressure reading of 138/84 within the target range for her? (N10)
- Has the penicillin allergy been recorded at the new pharmacy? (N10)
- Should the eye drops continue for the full prescribed month? (N10, N12)
## Answer to "When did the dizziness start?"
> The first mention of dizziness was on 2026-10-09 when Sofie noted dizzy again when standing up quickly. Since then, Anouk reported on 2026-10-11 that she still says the room spins a little when she gets up, indicating the dizziness persisted.
Full outputs: `evidence/live-check-2026-10-15.json`. The household is the fictional demo household; no real person's data was sent.
