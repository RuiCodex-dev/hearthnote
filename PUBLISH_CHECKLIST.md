# Publish checklist: Hearthnote

Deadline: **Friday 30 October 2026, 10:00 PDT = 18:00 Belgian time (CET; clocks go back on
25 October)**. Target: everything live by **Wednesday 28 October**.

Step 1 is done. Steps 2-5 each need the owner's approval, in this order.

## 0. Before every step

- [ ] `npm test` passes (29 tests, offline) and `npm run e2e` passes (40 checks, real API).
- [ ] `npm run secret-scan` is clean (tracked + untracked files and the whole git history,
      checked against every value in `~/.ruicodex-keys/*.json` and common key shapes).
- [ ] `git ls-files data .env design/gen video/work` prints nothing.

## 1. Token Factory key and real-model video - DONE (15-16 October 2026, see qa/QA-2026-10-16.md)

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

Same pattern as Hostwise (`infra.json` -> `side_services.hostwise`): a Docker container on the
Linux side-services host, nginx in front of it on an internal port, and an IIS site on the
Windows web server that proxies the public hostname to it with a win-acme certificate.

| Piece | Hostwise (model) | Hearthnote (proposed) |
| --- | --- | --- |
| Public URL | https://hostwise.ruicodex.com | **https://hearthnote.ruicodex.com** |
| DNS (GoDaddy) | A `hostwise` -> 38.110.4.148, TTL 600 | A `hearthnote` -> 38.110.4.148, TTL 600 (snapshot the zone before and after) |
| IIS site | `hostwise.ruicodex.com` (id 76), pool No Managed Code, `web.config` rewrite to `http://10.50.1.12:9084` | `hearthnote.ruicodex.com`, own pool, rewrite to `http://10.50.1.12:9085`; `appcmd backup` first |
| TLS | win-acme, self-hosting http-01, store WebHosting | same, new renewal for `hearthnote.ruicodex.com` |
| Linux host 10.50.1.12 | nginx `listen 9084` -> `127.0.0.1:8790`, `ufw allow 9084/tcp from 10.50.1.3` | nginx `listen 9085` -> `127.0.0.1:8792`, `ufw allow 9085/tcp from 10.50.1.3` (check both ports are free first) |
| Container | `hostwise` (image `hostwise:current`), `/opt/hostwise/run.sh` | `hearthnote` (image `hearthnote:current`), `/opt/hearthnote/run.sh`, `--restart unless-stopped` |

`/opt/hearthnote/run.sh` (keys come from a root-only env file on the host, never from the repo):

```sh
docker build -t hearthnote:current /opt/hearthnote/src
docker rm -f hearthnote 2>/dev/null
docker run -d --name hearthnote --restart unless-stopped -p 127.0.0.1:8792:8080   --env-file /opt/hearthnote/hearthnote.env   -e HEARTH_MODE=demo -e LLM_PROVIDER=nebius -e TRUST_PROXY_HEADER=x-real-ip   -e HEARTH_SECURE_COOKIES=1 hearthnote:current
# hearthnote.env (chmod 600): NEBIUS_API_KEY=..., TAVILY_API_KEY=...
```

- Copy only `package.json server skills public Dockerfile` to `/opt/hearthnote/src` (or clone the
  public repo once it exists). No `node_modules`: the app has no dependencies.
- Health: `curl https://hearthnote.ruicodex.com/api/health` must show `"provider":"nebius"`; then
  run `npm run e2e` locally against nothing (it starts its own server) and click through the
  hosted demo once (`python scripts/ui_check.py https://hearthnote.ruicodex.com qa/ui-hosted`;
  about 4 model calls).
- Budgets (defaults): 40 model calls per visitor sandbox, 1,500 per day, sandboxes expire after
  3 hours. A sandbox that uses all 40 calls costs about USD 0.15; the USD 25 credit covers
  roughly 150 heavy visitors, far more than judging needs. Tavily: free plan, 1,000 credits a
  month, and lookups are cached per medication name. Watch usage in the Token Factory console.
- Keep it running until at least **15 December 2026, 21:00 Belgian time** (end of judging, 12:00
  PT); the rules require free access until then. Removal afterwards mirrors Hostwise: `docker rm
  -f hearthnote`, remove the nginx site and the ufw rule, remove the IIS site and pool, `wacs
  --cancel` the renewal, delete the DNS record. Record all of it in `infra.json` ->
  `side_services.hearthnote`.

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
