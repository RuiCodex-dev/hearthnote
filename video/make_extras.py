"""YouTube thumbnail (1280x720) and a 20 s vertical teaser (1080x1920) from the rendered film.

    python video/make_extras.py [rendered.mp4]
"""
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
PROJ = ROOT.parent
film = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hearthnote-demo.mp4"
fonts = (PROJ / "public" / "fonts").as_uri()
hero = (PROJ / "public" / "assets" / "img" / "hero.webp").as_uri()

THUMB = f"""<!doctype html><html><head><style>
@font-face {{ font-family: N; src: url({fonts}/newsreader.woff2); }}
@font-face {{ font-family: NI; src: url({fonts}/newsreader-italic.woff2); }}
@font-face {{ font-family: A; src: url({fonts}/atkinson-next.woff2); }}
body {{ margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #22302F; }}
.bg {{ position: absolute; inset: 0; background: url({hero}) 70% 60% / cover; }}
.veil {{ position: absolute; inset: 0; background: linear-gradient(90deg, rgba(20,28,27,.88), rgba(20,28,27,.55) 45%, rgba(20,28,27,0) 75%); }}
.t {{ position: absolute; left: 70px; top: 150px; width: 640px; color: #FBF8F2; }}
h1 {{ font: 500 118px/1 NI; margin: 0; letter-spacing: -.02em; }}
p {{ font: 40px/1.25 N; margin: 26px 0 0; color: #EDE6D8; }}
.tag {{ display: inline-block; margin-top: 34px; font: 700 22px/1 A; letter-spacing: .08em; text-transform: uppercase; color: #22302F; background: #F4EFE6; padding: 12px 18px; border-radius: 999px; }}
</style></head><body><div class="bg"></div><div class="veil"></div><div class="t"><h1>Hearthnote</h1><p>The family's notes in, the GP's questions out. Names stay home.</p><span class="tag">NVIDIA Nemotron on Nebius</span></div></body></html>"""

work = ROOT / "work"
work.mkdir(exist_ok=True)
(work / "thumb.html").write_text(THUMB, encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 720})
    page.goto((work / "thumb.html").as_uri())
    page.wait_for_timeout(600)
    page.screenshot(path=str(ROOT / "thumbnail.png"))
    b.close()
print("thumbnail.png")

if film.exists():
    # Teaser: the open and the weekly brief, the 16:9 frame centred on a blurred copy of itself.
    vf = ("[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.08[bg];"
          "[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p")
    parts = [(0, 7), (68, 13)]
    segs = []
    for i, (ss, d) in enumerate(parts):
        out = work / f"teaser_{i}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(ss), "-t", str(d), "-i", str(film), "-filter_complex", vf,
                        "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-b:a", "160k", str(out)], check=True)
        segs.append(out)
    (work / "teaser.txt").write_text("\n".join(f"file '{s.name}'" for s in segs), encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "teaser.txt", "-c", "copy", str((ROOT / "teaser-vertical.mp4").resolve())], cwd=work, check=True)
    print("teaser-vertical.mp4")
