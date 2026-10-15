"""Write video/hyperframes/index.html from the narration timing and the recorded takes.

Inputs: video/work/timing.json (make_audio.py), video/work/<take>.mp4 + .json
(scripts/record_demo.py), the graded stills in public/assets/img, and the app screenshot
docs/screens/today.png. Model waiting time inside a take is cut and labelled with the real
number of seconds; a take shorter than its scene holds its last frame; a longer one is sped up
(at most 1.6x, labelled).

    python video/build_composition.py
"""
import html
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJ = ROOT.parent
HF = ROOT / "hyperframes"
ASSETS = HF / "assets"
WORK = ROOT / "work"
for d in ("clips", "img", "fonts"):
    (ASSETS / d).mkdir(parents=True, exist_ok=True)

timing = json.loads((WORK / "timing.json").read_text(encoding="utf-8"))
S = {s["id"]: s for s in timing["scenes"]}
TOTAL = timing["duration"]
models = {"fast": "nvidia/nemotron-3-super-120b-a12b", "deep": "nvidia/Nemotron-3-Ultra-550b-a55b"}
ev = sorted((PROJ / "evidence").glob("live-check-2*.json"))
if ev:
    m = json.loads(ev[-1].read_text(encoding="utf-8"))["models"]
    models = {"fast": m["fast"], "deep": m["deep"]}

for f in ("atkinson-next.woff2", "newsreader.woff2", "newsreader-italic.woff2"):
    shutil.copy(PROJ / "public" / "fonts" / f, ASSETS / "fonts" / f)
for f in ("hero", "walk", "evening", "privacy", "visit"):
    shutil.copy(PROJ / "public" / "assets" / "img" / f"{f}.webp", ASSETS / "img" / f"{f}.webp")
shutil.copy(PROJ / "public" / "assets" / "mark.svg", ASSETS / "img" / "mark.svg")

esc = html.escape
FRAME = {"x": 240, "y": 78, "w": 1440, "h": 810}


def take(name):
    meta = json.loads((WORK / f"{name}.json").read_text())
    shutil.copy(WORK / f"{name}.mp4", ASSETS / "clips" / f"{name}.mp4")
    return meta


def last_frame(name, at):
    out = ASSETS / "clips" / f"{name}_hold.jpg"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.1", "-i", str(WORK / f"{name}.mp4"), "-frames:v", "1", "-q:v", "2", str(out)], check=True)
    return f"assets/clips/{out.name}"


clips, overlays, tl = [], [], []
uid = [0]


def nid(p):
    uid[0] += 1
    return f"{p}{uid[0]}"


def place_take(name, scene, wait_pair=None, wait_label=None, start_at=0.0, zoom=None):
    """Lay a recorded take into a scene slot. Returns html for the video clips."""
    meta = take(name)
    sc = S[scene]
    slot_start, slot_end = sc["start"] + 0.25, sc["end"]
    off = meta.get("screencast_start", 0)
    marks = {m["mark"]: m["t"] - off for m in meta["marks"]}
    segs = [[start_at, meta["duration"]]]
    skip = None
    if wait_pair and wait_pair[0] in marks and wait_pair[1] in marks:
        a, b = marks[wait_pair[0]] + 1.0, marks[wait_pair[1]] - 0.5
        if b - a > 2.5:
            segs = [[start_at, a], [b, meta["duration"]]]
            skip = round(marks[wait_pair[1]] - marks[wait_pair[0]], 1)
    content = sum(e - s for s, e in segs)
    room = slot_end - slot_start
    rate = 1.0
    if content > room:
        rate = min(1.6, round(content / room + 0.005, 2))
    out, t = [], slot_start
    seg_starts = []
    for s0, e0 in segs:
        seg_starts.append((s0, e0, t))
        t += round((e0 - s0) / rate, 2)
    t = slot_start
    for i, (s, e) in enumerate(segs):
        d = round((e - s) / rate, 2)
        d = min(d, round(slot_end - t, 2))
        if d <= 0.05:
            break
        vid = nid("v")
        out.append(f'<video id="{vid}" src="assets/clips/{name}.mp4" muted playsinline data-start="{t:.2f}" data-duration="{d:.2f}" data-media-start="{s:.2f}"{f" data-playback-rate={chr(34)}{rate}{chr(34)}" if rate != 1.0 else ""} data-track-index="1"></video>')
        if i == 1 and skip:
            chip = nid("skip")
            overlays.append(f'<div id="{chip}" class="clip chip-skip" data-start="{t - 0.1:.2f}" data-duration="3.2" data-track-index="5"><span class="dot"></span>{esc(wait_label.format(s=skip))}</div>')
            tl.append(f'tl.fromTo("#{chip}", {{opacity: 0, y: 10}}, {{opacity: 1, y: 0, duration: 0.35, ease: "power2.out"}}, {t - 0.1:.2f});')
            tl.append(f'tl.to("#{chip}", {{opacity: 0, duration: 0.4}}, {t + 2.6:.2f});')
        t += d
    if slot_end - t > 0.1:
        hold = last_frame(name, None)
        out.append(f'<img id="{nid("hold")}" class="clip" src="{hold}" alt="" data-start="{t:.2f}" data-duration="{slot_end - t:.2f}" data-track-index="1">')
    if rate != 1.0:
        chip = nid("rate")
        overlays.append(f'<div id="{chip}" class="clip chip-rate" data-start="{slot_start:.2f}" data-duration="{room:.2f}" data-track-index="5">{rate:g}x</div>')
    ids = [f"fs-{name}-{i}" for i in range(len(out))]
    if zoom and zoom[0] in marks:
        mt = marks[zoom[0]] + zoom[1]
        ct = None
        for s0, e0, c0 in seg_starts:
            if s0 <= mt <= e0:
                ct = c0 + (mt - s0) / rate
        if ct is None:
            ct = seg_starts[-1][2] + (mt - seg_starts[-1][0]) / rate
        ct = min(ct, slot_end - 3.0)
        sel = ", ".join(f"#{x}" for x in ids)
        tl.append(f'tl.fromTo("{sel}", {{scale: 1}}, {{scale: {zoom[4]}, transformOrigin: "{zoom[2]}% {zoom[3]}%", duration: 0.9, ease: "power2.inOut"}}, {ct:.2f});')
        back = min(slot_end - 0.9, ct + 0.9 + zoom[5])
        tl.append(f'tl.to("{sel}", {{scale: 1, duration: 0.8, ease: "power2.inOut"}}, {back:.2f});')
    return "\n".join(f'<div class="frame-slot"><div class="zoomer" id="{i}">{o}</div></div>' for i, o in zip(ids, out))


def label(scene, eyebrow, title, note=""):
    sc = S[scene]
    i = nid("lab")
    overlays.append(f'<section id="{i}" class="clip scene-label" data-start="{sc["start"]:.2f}" data-duration="{sc["end"] - sc["start"]:.2f}" data-track-index="4"><span class="eyebrow">{esc(eyebrow)}</span><span class="title">{esc(title)}</span>{f"<span class={chr(34)}note{chr(34)}>{esc(note)}</span>" if note else ""}</section>')
    tl.append(f'tl.fromTo("#{i} > span", {{opacity: 0, y: 8}}, {{opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power2.out"}}, {sc["start"] + 0.15:.2f});')


def cap_at(phrase):
    # Time at which the narration starts saying `phrase` (word-boundary timing from TTS).
    want = [w.lower().strip(".,:;!?") for w in phrase.split()]
    words = timing["words"]
    for i in range(len(words) - len(want) + 1):
        if [w["w"].lower().strip(".,:;!?") for w in words[i:i + len(want)]] == want:
            return words[i]["t"]
    raise KeyError(phrase)


# ---------- scenes ----------
scenes = []
o = S["open"]
scenes.append(f'''<section id="s-open" class="clip full" data-start="0" data-duration="{o["end"]:.2f}" data-track-index="0">
  <div class="kb"><img id="open-img" src="assets/img/hero.webp" alt=""></div>
  <div class="open-veil"></div>
  <div class="open-text"><svg class="mark" viewBox="0 0 32 32"><path d="M6 27V15.5C6 9.7 10.5 5 16 5s10 4.7 10 10.5V27" fill="none" stroke="#FBF8F2" stroke-width="2.2" stroke-linecap="round"/><path d="M3.5 27h25" fill="none" stroke="#FBF8F2" stroke-width="2.2" stroke-linecap="round"/><path d="M16 23.2c-2.4 0-3.8-1.6-3.8-3.6 0-2.6 2.6-3.6 3.8-6.4 1.2 2.8 3.8 3.8 3.8 6.4 0 2-1.4 3.6-3.8 3.6z" fill="#D98C72"/></svg><h1 id="open-title">Hearthnote</h1><p id="open-sub">For families who look after someone at home.</p></div>
</section>''')
tl.append('tl.fromTo("#open-img", {scale: 1.0}, {scale: 1.08, duration: %.2f, ease: "none"}, 0);' % o["end"])
tl.append('tl.fromTo(".open-text > *", {opacity: 0, y: 14}, {opacity: 1, y: 0, duration: 0.9, stagger: 0.18, ease: "power3.out"}, 0.4);')

p = S["problem"]
cards = [("Anouk", "daughter", "Dr. Claes started amlodipine 5 mg once a day in the morning for her blood pressure.", "Monday", cap_at("Her daughter")),
         ("Sofie", "home nurse", "She mentioned her ankles feel a bit puffy.", "Tuesday", cap_at("The home nurse")),
         ("Bram", "son", "Mum was a bit unsteady on the stairs and held the rail with both hands.", "Thursday", cap_at("Her son"))]
card_html = "".join(f'<article class="pcard" id="pc{i}"><header><span class="av av{i}">{n[0]}</span><b>{esc(n)}</b><span>{esc(r)} · {esc(d)}</span></header><p>{esc(t)}</p></article>' for i, (n, r, t, d, _) in enumerate(cards))
scenes.append(f'''<section id="s-problem" class="clip full" data-start="{p["start"]:.2f}" data-duration="{p["end"] - p["start"]:.2f}" data-track-index="0">
  <div class="kb"><img id="prob-img" src="assets/img/walk.webp" alt=""></div><div class="veil-dark"></div>
  <div class="pcards">{card_html}</div>
  <p class="prob-line" id="prob-line">Three people. Three chats. No one sees the pattern.</p>
</section>''')
tl.append('tl.fromTo("#prob-img", {scale: 1.06}, {scale: 1.0, duration: %.2f, ease: "none"}, %.2f);' % (p["end"] - p["start"], p["start"]))
for i, c in enumerate(cards):
    tl.append(f'tl.fromTo("#pc{i}", {{opacity: 0, y: 30}}, {{opacity: 1, y: 0, duration: 0.7, ease: "power3.out"}}, {c[4] - 0.1:.2f});')
nob = cap_at("Nobody puts")
tl.append(f'tl.to(".pcard", {{opacity: 0.35, duration: 0.6}}, {nob:.2f});')
tl.append(f'tl.fromTo("#prob-line", {{opacity: 0, y: 12}}, {{opacity: 1, y: 0, duration: 0.6, ease: "power2.out"}}, {nob + 0.2:.2f});')

it = S["intro"]
shutil.copy(PROJ / "docs" / "screens" / "today.png", ASSETS / "img" / "today.png")
scenes.append(f'''<section id="s-intro" class="clip full paper" data-start="{it["start"]:.2f}" data-duration="{it["end"] - it["start"]:.2f}" data-track-index="0">
  <div class="intro-text"><span class="eyebrow">Introducing</span><h2 id="intro-h">Hearthnote</h2><p>The care circle's notebook. Write what happened; it keeps the routines, the reminders and the weekly brief.</p></div>
  <div class="intro-shot"><img id="intro-img" src="assets/img/today.png" alt=""></div>
</section>''')
tl.append(f'tl.fromTo(".intro-text > *", {{opacity: 0, x: -20}}, {{opacity: 1, x: 0, duration: 0.7, stagger: 0.12, ease: "power3.out"}}, {it["start"] + 0.2:.2f});')
tl.append(f'tl.fromTo(".intro-shot", {{opacity: 0, y: 40}}, {{opacity: 1, y: 0, duration: 0.9, ease: "power3.out"}}, {it["start"] + 0.4:.2f});')
tl.append(f'tl.fromTo("#intro-img", {{y: 0}}, {{y: -140, duration: {it["end"] - it["start"] - 1:.2f}, ease: "sine.inOut"}}, {it["start"] + 1:.2f});')

# Capture scenes on the paper background.
cap_bg = []
for sid in ("write", "privacy", "brief", "ask", "memory", "emergency"):
    sc = S[sid]
    cap_bg.append(f'<section id="bg-{sid}" class="clip full paper" data-start="{sc["start"]:.2f}" data-duration="{sc["end"] - sc["start"]:.2f}" data-track-index="0"><div class="frame-shadow"></div></section>')
videos = []
label("write", "1 · Write a note", "Saved, checked offline, then read", f"fast tier · {models['fast']}")
videos.append(place_take("a_write", "write", ("save", "filed"), "Nemotron 3 Super read the note in {s} s", zoom=("filed", 0.6, 90, 72, 1.6, 6.0)))
label("privacy", "2 · Privacy", "Exactly what left the server", "names, streets and numbers become placeholders")
videos.append(place_take("b_privacy", "privacy", zoom=("dialog", 0.6, 50, 45, 1.4, 7.0)))
label("brief", "3 · Weekly family brief", "Dates lined up across people", f"deep tier · {models['deep']} · reasoning on")
videos.append(place_take("c_brief", "brief", ("run", "brief"), "Nemotron 3 Ultra reasoned for {s} s"))
label("ask", "4 · Ask the log", "Answers from what was written", "cited, never from outside knowledge")
videos.append(place_take("d_ask", "ask", ("ask", "answer"), "answered in {s} s", zoom=("answer", 0.2, 34, 90, 1.55, 4.0)))
label("memory", "5 · Memory by consent", "Proposed by the model, confirmed by a person", "and reminders in everyone's own calendar")
videos.append(place_take("e_memory", "memory"))
label("emergency", "6 · Safety", "Red flags are checked before any model", "no inference between a family and 112")
videos.append(place_take("f_emergency", "emergency", zoom=("flag", 0.2, 90, 62, 1.7, 4.0)))

hw = S["how"]
scenes.append(f'''<section id="s-how" class="clip full paper" data-start="{hw["start"]:.2f}" data-duration="{hw["end"] - hw["start"]:.2f}" data-track-index="0">
  <span class="eyebrow how-eyebrow">How it works</span>
  <div class="how">
    <div class="box home" id="how-home"><span class="tag">The family's server</span><ul><li>Notes and memory in an AES-256-GCM vault</li><li>Red-flag check, offline</li><li>Privacy gate: names and identifiers out</li><li>Answers re-identified, citations checked</li></ul></div>
    <div class="wire" id="how-wire"><span>[P1] [P2] [PRIVATE1]</span></div>
    <div class="box tf" id="how-tf"><span class="tag">Nebius Token Factory</span><div class="tier" id="tier-fast"><b>Nemotron 3 Super</b><span>fast tier · every note, questions, handovers</span></div><div class="tier" id="tier-deep"><b>Nemotron 3 Ultra</b><span>deep tier · weekly brief, doctor's visit, medication check</span></div></div>
  </div>
  <p class="how-foot" id="how-foot">Node.js, zero dependencies · skills as small JSON recipes · MIT licence</p>
</section>''')
tl.append(f'tl.fromTo("#how-home", {{opacity: 0, x: -30}}, {{opacity: 1, x: 0, duration: 0.7, ease: "power3.out"}}, {hw["start"] + 0.3:.2f});')
tl.append(f'tl.fromTo("#how-wire", {{opacity: 0, scaleX: 0.2}}, {{opacity: 1, scaleX: 1, duration: 0.6, ease: "power2.out"}}, {hw["start"] + 1.2:.2f});')
tl.append(f'tl.fromTo("#how-tf", {{opacity: 0, x: 30}}, {{opacity: 1, x: 0, duration: 0.7, ease: "power3.out"}}, {hw["start"] + 1.8:.2f});')
tl.append(f'tl.fromTo("#tier-fast", {{opacity: 0, y: 10}}, {{opacity: 1, y: 0, duration: 0.5}}, {cap_at("Two Nemotron") + 1.6:.2f});')
tl.append(f'tl.fromTo("#tier-deep", {{opacity: 0, y: 10}}, {{opacity: 1, y: 0, duration: 0.5}}, {cap_at("Two Nemotron") + 3.2:.2f});')
tl.append(f'tl.fromTo("#how-foot", {{opacity: 0}}, {{opacity: 1, duration: 0.6}}, {hw["start"] + 6:.2f});')

cl = S["close"]
scenes.append(f'''<section id="s-close" class="clip full" data-start="{cl["start"]:.2f}" data-duration="{TOTAL - cl["start"]:.2f}" data-track-index="0">
  <div class="kb"><img id="close-img" src="assets/img/evening.webp" alt=""></div><div class="open-veil right"></div>
  <div class="close-text"><svg class="mark" viewBox="0 0 32 32"><path d="M6 27V15.5C6 9.7 10.5 5 16 5s10 4.7 10 10.5V27" fill="none" stroke="#FBF8F2" stroke-width="2.2" stroke-linecap="round"/><path d="M3.5 27h25" fill="none" stroke="#FBF8F2" stroke-width="2.2" stroke-linecap="round"/><path d="M16 23.2c-2.4 0-3.8-1.6-3.8-3.6 0-2.6 2.6-3.6 3.8-6.4 1.2 2.8 3.8 3.8 3.8 6.4 0 2-1.4 3.6-3.8 3.6z" fill="#D98C72"/></svg><h1>Hearthnote</h1><p class="tag">The care circle's notebook.</p><p class="small">NVIDIA Nemotron on Nebius Token Factory · Personal AI track</p><p class="by">Rui Codex</p></div>
</section>''')
tl.append(f'tl.fromTo("#close-img", {{scale: 1.0}}, {{scale: 1.06, duration: {TOTAL - cl["start"]:.2f}, ease: "none"}}, {cl["start"]:.2f});')
tl.append(f'tl.fromTo(".close-text > *", {{opacity: 0, y: 14}}, {{opacity: 1, y: 0, duration: 0.8, stagger: 0.16, ease: "power3.out"}}, {cl["start"] + 0.3:.2f});')

caps = []
for i, c in enumerate(timing["captions"]):
    d = round(min(c["end"], timing["captions"][i + 1]["start"] if i + 1 < len(timing["captions"]) else TOTAL) - c["start"], 2)
    caps.append(f'<div id="cap{i}" class="clip caption" data-start="{c["start"]:.2f}" data-duration="{max(0.4, d):.2f}" data-track-index="6"><span>{esc(c["text"])}</span></div>')

CSS = f"""
@font-face {{ font-family: "Atkinson"; src: url(assets/fonts/atkinson-next.woff2) format("woff2"); font-weight: 200 800; }}
@font-face {{ font-family: "Newsreader"; src: url(assets/fonts/newsreader.woff2) format("woff2"); font-weight: 200 800; }}
@font-face {{ font-family: "Newsreader"; src: url(assets/fonts/newsreader-italic.woff2) format("woff2"); font-weight: 200 800; font-style: italic; }}
body {{ margin: 0; background: #F4EFE6; }}
#root {{ position: relative; width: 100%; height: 100%; overflow: hidden; background: #F4EFE6; font-family: "Atkinson", sans-serif; color: #22302F; }}
.full {{ width: 100%; height: 100%; overflow: hidden; }}
.paper {{ background: #F4EFE6; }}
.kb {{ position: absolute; inset: 0; overflow: hidden; }}
.kb img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
.open-veil {{ position: absolute; inset: 0; background: linear-gradient(90deg, rgba(20,28,27,.78) 0%, rgba(20,28,27,.45) 38%, rgba(20,28,27,0) 70%); }}
.open-veil.right {{ background: linear-gradient(270deg, rgba(20,28,27,.72) 0%, rgba(20,28,27,.35) 42%, rgba(20,28,27,0) 72%); }}
.veil-dark {{ position: absolute; inset: 0; background: rgba(18,24,24,.58); }}
.open-text {{ position: absolute; left: 140px; top: 330px; width: 820px; color: #FBF8F2; }}
.close-text {{ position: absolute; right: 140px; top: 300px; width: 760px; color: #FBF8F2; text-align: right; }}
.close-text .mark {{ margin-left: auto; }}
.mark {{ width: 72px; height: 72px; display: block; margin-bottom: 18px; }}
.open-text h1, .close-text h1 {{ font: italic 500 132px/1 "Newsreader", serif; margin: 0; letter-spacing: -.02em; }}
.open-text p {{ font: 400 40px/1.3 "Newsreader", serif; margin: 22px 0 0; color: #EDE6D8; }}
.close-text .tag {{ font: italic 400 46px/1.25 "Newsreader", serif; margin: 18px 0 30px; color: #EDE6D8; }}
.close-text .small {{ font-size: 26px; margin: 0; color: #D8D0C0; }}
.close-text .by {{ font-size: 30px; font-weight: 700; margin: 20px 0 0; letter-spacing: .04em; color: #FBF8F2; }}
.pcards {{ position: absolute; left: 160px; right: 160px; top: 210px; display: flex; gap: 36px; }}
.pcard {{ flex: 1; background: #FBF8F2; border-radius: 22px; padding: 34px 36px; box-shadow: 0 20px 60px -30px rgba(0,0,0,.6); }}
.pcard header {{ display: flex; align-items: center; gap: 14px; font-size: 24px; color: #5B6865; margin-bottom: 18px; }}
.pcard header b {{ color: #22302F; font-size: 27px; }}
.pcard p {{ font: 400 34px/1.38 "Newsreader", serif; margin: 0; }}
.av {{ width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 22px; }}
.av0 {{ background: #DCE8DE; color: #2E5A3C; }} .av1 {{ background: #F1E3CB; color: #6B4A12; }} .av2 {{ background: #DCE4EF; color: #2C4766; }}
.prob-line {{ position: absolute; left: 0; right: 0; top: 700px; text-align: center; font: italic 400 54px/1.2 "Newsreader", serif; color: #FBF8F2; margin: 0; }}
.intro-text {{ position: absolute; left: 140px; top: 300px; width: 600px; }}
.intro-text h2 {{ font: italic 500 112px/1 "Newsreader", serif; margin: 14px 0 22px; }}
.intro-text p {{ font-size: 32px; line-height: 1.45; color: #5B6865; margin: 0; }}
.intro-shot {{ position: absolute; left: 820px; top: 110px; width: 1000px; height: 860px; border-radius: 24px; overflow: hidden; box-shadow: 0 40px 90px -40px rgba(34,48,47,.55); border: 1px solid #E2DACB; }}
.intro-shot img {{ width: 100%; display: block; }}
.eyebrow {{ font-size: 22px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: #A9462F; }}
.frame-shadow {{ position: absolute; left: {FRAME["x"]}px; top: {FRAME["y"]}px; width: {FRAME["w"]}px; height: {FRAME["h"]}px; border-radius: 18px; box-shadow: 0 30px 80px -36px rgba(34,48,47,.5), 0 0 0 1px #E2DACB; }}
.zoomer {{ width: 100%; height: 100%; }}
.frame-slot {{ position: absolute; overflow: hidden; border-radius: 18px; left: {FRAME["x"]}px; top: {FRAME["y"]}px; width: {FRAME["w"]}px; height: {FRAME["h"]}px; }}
.frame-slot video, .frame-slot img {{ width: 100%; height: 100%; object-fit: cover; border-radius: 18px; display: block; }}
.scene-label {{ position: absolute; left: 0; right: 0; top: 0; height: 78px; display: flex; align-items: center; gap: 22px; padding: 0 240px; }}
.scene-label .eyebrow {{ font-size: 19px; }}
.scene-label .title {{ font: 500 30px/1 "Newsreader", serif; }}
.scene-label .note {{ margin-left: auto; font-size: 18px; color: #5B6865; font-family: "Atkinson", sans-serif; }}
.chip-skip {{ position: absolute; left: auto; top: 112px; right: 270px; width: auto; height: auto; padding: 14px 24px; border-radius: 999px; background: #22302F; color: #FBF8F2; font-size: 24px; display: flex; align-items: center; gap: 12px; box-shadow: 0 16px 40px -20px rgba(0,0,0,.6); }}
.chip-skip .dot {{ width: 12px; height: 12px; border-radius: 50%; background: #D98C72; }}
.chip-rate {{ position: absolute; left: auto; top: 834px; right: 270px; width: auto; height: auto; padding: 6px 14px; border-radius: 10px; background: rgba(34,48,47,.75); color: #FBF8F2; font-size: 20px; font-weight: 700; }}
.how-eyebrow {{ position: absolute; left: 160px; top: 120px; }}
.how {{ position: absolute; left: 160px; right: 160px; top: 210px; display: flex; align-items: center; gap: 0; }}
.box {{ background: #FBF8F2; border: 1px solid #E2DACB; border-radius: 26px; padding: 40px 44px; box-shadow: 0 30px 70px -40px rgba(34,48,47,.45); }}
.box .tag {{ display: block; font-size: 22px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: #4F7259; margin-bottom: 18px; }}
.home {{ width: 560px; }}
.home ul {{ margin: 0; padding-left: 28px; font: 400 33px/1.6 "Newsreader", serif; }}
.wire {{ flex: 1; height: 4px; background: #A9462F; position: relative; margin: 0 10px; }}
.wire span {{ position: absolute; left: 50%; top: -58px; transform: translateX(-50%); white-space: nowrap; font: 600 22px/1 ui-monospace, Consolas, monospace; color: #A9462F; background: #F4EFE6; padding: 4px 8px; }}
.tf {{ width: 600px; background: #26303D; border-color: #26303D; color: #E9E4DA; }}
.tf .tag {{ color: #D98C72; }}
.tier {{ border-top: 1px solid rgba(255,255,255,.14); padding: 20px 0; }}
.tier b {{ display: block; font: 500 40px/1.15 "Newsreader", serif; color: #FBF8F2; }}
.tier span {{ font-size: 24px; color: #B9C2C8; }}
.how-foot {{ position: absolute; left: 0; right: 0; top: 860px; text-align: center; font-size: 26px; color: #5B6865; margin: 0; }}
.caption {{ position: absolute; left: 0; right: 0; top: auto; bottom: 34px; height: auto; display: flex; justify-content: center; pointer-events: none; }}
.caption span {{ max-width: 1500px; background: rgba(28,36,36,.86); color: #FBF8F2; font-size: 36px; line-height: 1.3; padding: 10px 26px; border-radius: 12px; text-align: center; }}
"""

doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<title>Hearthnote - demo</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>{CSS}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{TOTAL:.2f}">
{chr(10).join(scenes)}
{chr(10).join(cap_bg)}
{chr(10).join(videos)}
{chr(10).join(overlays)}
{chr(10).join(caps)}
<audio id="voice" src="assets/audio/voice.wav" data-start="0" data-duration="{TOTAL:.2f}" data-track-index="8" data-volume="1"></audio>
<audio id="music" src="assets/audio/music.wav" data-start="0" data-duration="{TOTAL:.2f}" data-track-index="9" data-volume="0.22"></audio>
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(tl)}
window.__timelines["main"] = tl;
</script>
</body>
</html>
"""
(HF / "index.html").write_text(doc, encoding="utf-8")
print(f"wrote index.html: {TOTAL}s, {len(videos)} takes, {len(caps)} captions, models {models}")
