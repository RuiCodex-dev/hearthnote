# Demo video

Built with HyperFrames (HTML -> MP4) from **real captures of the running app**, narrated with
Edge neural TTS, captions burned in, music synthesised in code. Target length 2:20 (rules: under
3 minutes, public on YouTube). Large binaries (MP4s, captures, audio) are git-ignored; this
folder holds everything needed to rebuild them.

1. Start the app against Token Factory (see `PUBLISH_CHECKLIST.md` step 1):
   `HEARTH_USE_LOCAL_KEYS=1 LLM_PROVIDER=nebius PORT=8731 node server/main.js`
2. Gallery screenshots: `python scripts/shots.py http://127.0.0.1:8731 docs/screens`
3. Record the takes (Chrome DevTools screencast, real speed, markers for model waits):
   `python scripts/record_demo.py http://127.0.0.1:8731 video/work`
4. Narration, captions, music: `python video/make_audio.py` (script in `narration.json`)
5. Composition: `python video/build_composition.py` (writes `hyperframes/index.html`)
6. `cd video/hyperframes && npx --yes hyperframes@0.8.162 check && npx --yes hyperframes@0.8.162 render -o ../hearthnote-demo.mp4`
7. Thumbnail and vertical teaser: `python video/make_extras.py video/hearthnote-demo.mp4`

Editing rules, stated on screen: model waiting time is cut and labelled with the real number of
seconds ("Nemotron 3 Ultra reasoned for 41 s"); a take shown faster than real time carries a
speed chip ("1.3x"). No Veo or other generated video; the only generated visuals are the mood
stills listed in `design/GENERATED_ASSETS.md`.

`work/draft-mock.mp4` is a **draft rendered with the offline mock provider** (the sidebar says
"Offline mock"). It exists to review pacing and must not be published; re-record with the real
model first.
