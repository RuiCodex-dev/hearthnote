# Publish checklist: Hearthnote

Deadline: **Friday 30 October 2026, 10:00 PDT = 18:00 Belgian time (CET; clocks go back on
25 October)**. Target: everything live by **Wednesday 28 October**.

Nothing below has been done. Each numbered step needs the owner's approval, in this order.

## 0. Before every step

- [ ] `npm test` passes (18 tests, offline).
- [ ] `npm run secret-scan` is clean (tracked + untracked files and the whole git history,
      checked against every value in `~/.ruicodex-keys/*.json` and common key shapes).
- [ ] `git ls-files data .env design/gen video/work` prints nothing.

## 1. Token Factory key (owner: add the card)

1. Owner signs in to <https://tokenfactory.nebius.com> (Google, info@ruicodex.com), completes
   billing (card for the $0 authorisation), and redeems the USD 25 promo code from the e-mail
   (`hackathons-2026.json` -> `nebius.promo_code`).
2. Create an API key in the project `default-project`; store it as `nebius.api_key` in
   `C:\Users\Admin\.ruicodex-keys\hackathons-2026.json`. Never paste it anywhere else.
3. Live check, at most 20 calls (about USD 0.10-0.30):
   ```powershell
   $env:HEARTH_USE_LOCAL_KEYS="1"; $env:LLM_PROVIDER="nebius"; node scripts/live-check.mjs
   ```
   It writes `evidence/LIVE_CHECK.md`, `evidence/live-check-<date>.json` and bakes
   `server/seed/demo-captures.json` (the demo then starts from real Nemotron captures).
   Fill in section 8 of `FEEDBACK.md` from the evidence.
4. Re-record the video with the real model (the current render is a draft made with the
   offline mock and must not be published):
   ```powershell
   $env:HEARTH_USE_LOCAL_KEYS="1"; $env:LLM_PROVIDER="nebius"; $env:PORT="8731"; node server/main.js   # terminal 1
   python scripts/shots.py http://127.0.0.1:8731 docs/screens
   python scripts/record_demo.py http://127.0.0.1:8731 video/work
   python video/make_audio.py; python video/build_composition.py
   cd video/hyperframes; npx --yes hyperframes@0.8.162 check; npx --yes hyperframes@0.8.162 render -o ../hearthnote-demo.mp4
   python ../make_extras.py
   ```
   (about 10 more model calls). Stop the server afterwards.

## 2. Publish the repository (owner approval A)

```sh
gh repo create RuiCodex-dev/hearthnote --public --source . --remote origin --push \
  --description "Hearthnote: a private notebook for families caring for someone at home. NVIDIA Nemotron on Nebius Token Factory."
gh repo edit RuiCodex-dev/hearthnote --add-topic nvidia-nemotron,nebius,token-factory,personal-ai,caregiving,hackathon
```

GitHub detects `LICENSE` (MIT) and shows it in the About panel, as the rules require. The repo
contains only fictional demo data.

## 3. Host the demo (owner approval B)

Same pattern as Hostwise: a Docker container on the owner's server behind the existing reverse
proxy, at **https://hearthnote.ruicodex.com**.

```sh
docker build -t hearthnote:1 .
docker run -d --name hearthnote --restart unless-stopped -p 127.0.0.1:8095:8080 \
  -e HEARTH_MODE=demo -e LLM_PROVIDER=nebius -e TRUST_PROXY_HEADER=x-real-ip \
  -e HEARTH_SECURE_COOKIES=1 -e NEBIUS_API_KEY="<type it, do not paste into a file>" \
  hearthnote:1
```

- DNS: `hearthnote.ruicodex.com` -> the server; reverse-proxy rule to `127.0.0.1:8095` with
  `X-Real-IP`; Let's Encrypt certificate.
- Health: `curl https://hearthnote.ruicodex.com/api/health` must show `"provider":"nebius"`.
- Budgets (defaults): 40 model calls per visitor sandbox, 1,500 per day, sandboxes expire after
  3 hours. At roughly USD 0.002-0.02 per call the USD 25 credit covers the judging period
  (until 15 December). Watch usage in the Token Factory console during judging.
- Keep it running until at least **15 December 2026** (end of judging); the rules require the
  demo to be available free of charge until then.

## 4. YouTube (owner approval C)

- File: `video/hearthnote-demo.mp4` (re-rendered in step 1.4; under 3 minutes).
- Title: `Hearthnote - a private notebook for families caring at home (NVIDIA Nemotron on Nebius Token Factory)`
- Visibility: **Public** (the rules require a public video). Thumbnail: `video/thumbnail.png`.
- Description: see `video/YOUTUBE.md`.

## 5. Devpost submission (owner approval D)

- <https://nebiusglobalaihackathon.devpost.com/> -> Enter a submission (account `ruicodex`).
- Paste fields from `DEVPOST.md`; track **Personal AI**; links from steps 2-4; gallery images
  from `docs/screens/`; feedback field from `FEEDBACK.md`.
- Do **not** link a GitHub account to Devpost (the repo URL is just pasted).
- Submit before **28 October**; the form can be edited until the deadline.

## Prize note

A cash prize would be professional income of the eenmanszaak (Rui Codex); no action now.
