"""Devpost gallery (3:2, 1800x1200) and thumbnail from real screenshots of the running app,
the graded Google Flow still lifes in design/art/, and real typography (Newsreader, Atkinson
Hyperlegible Next). The image model never renders text; every word here is HTML.

    python design/gallery.py            (reads docs/screens/, writes docs/gallery/)
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "docs" / "screens"
OUT = ROOT / "docs" / "gallery"
OUT.mkdir(parents=True, exist_ok=True)
F = (ROOT / "public" / "fonts").as_uri()
ART = (ROOT / "design" / "art").as_uri()
S = SCREENS.as_uri()

BASE = f"""
@font-face {{ font-family: N; src: url({F}/newsreader.woff2); }}
@font-face {{ font-family: NI; src: url({F}/newsreader-italic.woff2); font-style: italic; }}
@font-face {{ font-family: A; src: url({F}/atkinson-next.woff2); }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; width: W; height: H; overflow: hidden; background: #F4EFE6; color: #22302F; font-family: A, sans-serif; position: relative; }}
.bg {{ position: absolute; inset: 0; background-size: cover; background-position: center; }}
.grain {{ position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 20%, rgba(251,248,242,0) 0, rgba(34,48,47,.10) 100%); }}
.eyebrow {{ font: 700 20px/1 A; letter-spacing: .14em; text-transform: uppercase; color: #A9462F; }}
h1 {{ font: 500 92px/1 NI; font-style: italic; margin: 0; letter-spacing: -.015em; }}
h2 {{ font: 500 64px/1.04 N; margin: 18px 0 0; letter-spacing: -.01em; }}
h2 em {{ font-family: NI; font-style: italic; color: #A9462F; }}
p.lede {{ font: 400 27px/1.45 A; color: #5B6865; margin: 22px 0 0; }}
.chips {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }}
.chip {{ font: 700 17px/1 A; letter-spacing: .06em; text-transform: uppercase; padding: 11px 16px; border-radius: 999px; background: #22302F; color: #FBF8F2; }}
.chip.light {{ background: #FBF8F2; color: #22302F; border: 1px solid #E2DACB; }}
.win {{ position: absolute; border-radius: 16px; overflow: hidden; background: #FBF8F2; box-shadow: 0 2px 0 rgba(34,48,47,.06), 0 50px 90px -40px rgba(34,48,47,.55); border: 1px solid #E2DACB; }}
.win .bar {{ height: 38px; background: #EFE8DC; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #E2DACB; }}
.win .bar i {{ width: 11px; height: 11px; border-radius: 50%; background: #D9CFBF; display: block; }}
.win .bar span {{ margin-left: 18px; font: 15px/1 A; color: #5B6865; }}
.win img {{ display: block; width: 100%; }}
.phone {{ position: absolute; width: 360px; border-radius: 46px; padding: 12px; background: #22302F; box-shadow: 0 60px 90px -40px rgba(20,28,27,.65); }}
.phone img {{ display: block; width: 100%; border-radius: 34px; }}
.foot {{ position: absolute; left: 90px; bottom: 56px; font: 18px/1.4 A; color: #5B6865; }}
.mark {{ width: 54px; height: 54px; }}
"""

MARK = '<svg class="mark" viewBox="0 0 32 32"><path d="M6 27V15.5C6 9.7 10.5 5 16 5s10 4.7 10 10.5V27" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3.5 27h25" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16 23.2c-2.4 0-3.8-1.6-3.8-3.6 0-2.6 2.6-3.6 3.8-6.4 1.2 2.8 3.8 3.8 3.8 6.4 0 2-1.4 3.6-3.8 3.6z" fill="#D98C72"/></svg>'


def win(src, x, y, w, crop_h=None, url="hearthnote.ruicodex.com"):
    style = f"left:{x}px; top:{y}px; width:{w}px;"
    inner = f'<img src="{S}/{src}" alt="">'
    if crop_h:
        inner = f'<div style="height:{crop_h}px; overflow:hidden">{inner}</div>'
    return f'<div class="win" style="{style}"><div class="bar"><i></i><i></i><i></i><span>{url}</span></div>{inner}</div>'


PAGES = {
    "01-hero": (1800, 1200, f"""
<div class="bg" style="background-image:url({ART}/hero.png); filter: saturate(.95)"></div>
<div style="position:absolute; inset:0; background: linear-gradient(90deg, rgba(244,239,230,.97) 0, rgba(244,239,230,.93) 38%, rgba(244,239,230,.35) 62%, rgba(244,239,230,0) 80%)"></div>
<div style="position:absolute; left:90px; top:200px; width:540px; color:#22302F">
  <div style="color:#A9462F">{MARK}</div>
  <h1 style="margin-top:22px">Hearthnote</h1>
  <h2 style="font-size:50px">The care circle's <em>notebook.</em></h2>
  <p class="lede">The family writes what happened. NVIDIA Nemotron files it, writes the weekly brief and asks the GP's questions, without learning anyone's name.</p>
  <div class="chips"><span class="chip">NVIDIA Nemotron 3</span><span class="chip">Nebius Token Factory</span><span class="chip light">Personal AI</span></div>
</div>
{win("today.png", 680, 230, 1060)}
<div class="foot">Real app on Nemotron 3 Super and Ultra. Demo household and names are fictional.</div>
"""),
    "02-write": (1800, 1200, f"""
<div style="position:absolute; left:90px; top:240px; width:540px">
  <div class="eyebrow">1 · Write a note</div>
  <h2>Write it like a text. <em>It gets filed.</em></h2>
  <p class="lede">Saved instantly and checked for emergencies offline. Then Nemotron 3 Super reads it in about a second and a half: observations, medication changes, tasks, routines, things worth remembering.</p>
  <p class="lede" style="font-size:22px">Every item links back to its note, and every call leaves a receipt: model, tokens, latency.</p>
</div>
{win("capture.png", 680, 225, 1060)}
"""),
    "03-brief": (1800, 1200, f"""
<div class="bg" style="background-image:url({ART}/evening.png)"></div>
<div style="position:absolute; inset:0; background: linear-gradient(90deg, rgba(244,239,230,.97) 0, rgba(244,239,230,.95) 36%, rgba(244,239,230,.45) 60%, rgba(244,239,230,.15) 100%)"></div>
<div style="position:absolute; left:90px; top:240px; width:540px">
  <div class="eyebrow">2 · The weekly family brief</div>
  <h2>Dates lined up <em>across people.</em></h2>
  <p class="lede">Nemotron 3 Ultra reasons over the week: the dizziness and the puffy ankles began after the new tablet. Not a diagnosis, a question for the GP, and every line cites the note it came from.</p>
</div>
{win("brief-questions.png", 680, 225, 1060)}
"""),
    "04-privacy": (1800, 1200, f"""
<div style="position:absolute; inset:0; background:#26303D"></div>
<div style="position:absolute; left:90px; top:240px; width:540px; color:#E9E4DA">
  <div class="eyebrow" style="color:#D98C72">3 · Privacy you can see</div>
  <h2 style="color:#FBF8F2">Names <em style="color:#D98C72">stay home.</em></h2>
  <p class="lede" style="color:#B9C2C8">People become [P1], [P2] with a role. Streets, phone numbers, national register numbers and private words become placeholders before anything leaves the server. The family can read every word that was sent.</p>
  <div class="chips"><span class="chip light">0 real names sent</span><span class="chip light">AES-256-GCM vault</span></div>
</div>
{win("outbound.png", 680, 225, 1060)}
"""),
    "05-phone": (1800, 1200, f"""
<div class="bg" style="background-image:url({ART}/walk.png)"></div>
<div style="position:absolute; inset:0; background: linear-gradient(90deg, rgba(244,239,230,.97) 0, rgba(244,239,230,.92) 40%, rgba(244,239,230,.25) 72%, rgba(244,239,230,.1) 100%)"></div>
<div style="position:absolute; left:90px; top:150px; width:620px">
  <div class="eyebrow">4 · Wherever the family is</div>
  <h2>On the phone, <em>in the corridor.</em></h2>
  <p class="lede">Today's routines, the next appointment and the tasks that are open. Reminders go out as a private calendar feed, so the brother in Ghent sees them in the calendar he already uses.</p>
  <p class="lede" style="font-size:22px">And in a private install, the weekly brief writes itself every Sunday at 18:00.</p>
</div>
<div class="phone" style="left:880px; top:110px; transform: rotate(-2deg)"><img src="{S}/mobile-today.png" alt=""></div>
<div class="phone" style="left:1290px; top:180px; transform: rotate(2.5deg)"><img src="{S}/mobile-briefs.png" alt=""></div>
"""),
    "thumbnail": (1200, 800, f"""
<div class="bg" style="background-image:url({ART}/hero.png)"></div>
<div style="position:absolute; inset:0; background: linear-gradient(90deg, rgba(34,48,47,.92) 0, rgba(34,48,47,.75) 48%, rgba(34,48,47,.05) 85%)"></div>
<div style="position:absolute; left:70px; top:150px; width:640px; color:#FBF8F2">
  <div style="color:#FBF8F2">{MARK}</div>
  <h1 style="font-size:110px; margin-top:18px">Hearthnote</h1>
  <p class="lede" style="color:#EDE6D8; font-size:32px">The family's notes in, the GP's questions out. Names stay home.</p>
  <div class="chips"><span class="chip light">NVIDIA Nemotron on Nebius</span></div>
</div>
"""),
}

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, (w, h, body) in PAGES.items():
        page = b.new_page(viewport={"width": w, "height": h})
        css = BASE.replace("W;", f"{w}px;").replace("H;", f"{h}px;")
        src = ROOT / "design" / "gen" / f"gallery-{name}.html"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text(f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>", encoding="utf-8")
        page.goto(src.as_uri())
        page.wait_for_timeout(700)
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(OUT / f"{name}.png"))
        page.close()
        print(name)
    b.close()
