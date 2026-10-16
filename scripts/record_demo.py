"""Record real screen captures of the running app for the demo video.

Uses the Chrome DevTools screencast (JPEG frames with timestamps) instead of Playwright's
built-in recorder, whose VP8 output is too soft for 1080p. Each take is written as
video/work/<take>.mp4 (constant 30 fps) plus <take>.json with timed markers, so the
composition can cut out model waiting time and label it honestly.

    python scripts/record_demo.py http://127.0.0.1:8731 video/work
"""
import base64
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8731"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "video/work")
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1600, 900

NOTE = ("Took Mum to the market with Anouk. She was tired after twenty minutes and a bit dizzy "
        "getting off the bus, so we sat at the cafe. She ate a whole croissant. Eye drops done at nine. "
        "We need to buy new batteries for her hearing aid.")


class Take:
    def __init__(self, page, name):
        self.page, self.name = page, name
        self.dir = OUT / f"_{name}"
        shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True)
        self.frames, self.marks = [], []
        self.cdp = page.context.new_cdp_session(page)
        self.cdp.on("Page.screencastFrame", self.on_frame)

    def on_frame(self, ev):
        path = self.dir / f"{len(self.frames):05d}.jpg"
        path.write_bytes(base64.b64decode(ev["data"]))
        self.frames.append((ev["metadata"]["timestamp"], path))
        self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})

    def start(self):
        self.t0 = time.time()
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})
        self.idle(0.6)

    def mark(self, label):
        self.marks.append({"t": round(time.time() - self.t0, 2), "mark": label})

    def idle(self, seconds):
        # Keep the page painting so the screencast keeps delivering frames while nothing moves.
        end = time.time() + seconds
        while time.time() < end:
            self.page.evaluate("document.body.dataset.tick = String(Math.random())")
            self.page.wait_for_timeout(60)

    def stop(self):
        self.idle(0.4)
        end = time.time()
        self.cdp.send("Page.stopScreencast")
        self.page.wait_for_timeout(300)
        frames = sorted(self.frames)
        first = frames[0][0]
        # The screencast only sends frames when something repaints; hold the last frame until
        # the moment the take ended so static endings keep their length.
        tail = max(0.05, end - frames[-1][0])
        lines = []
        for (t, p), nxt in zip(frames, frames[1:] + [(frames[-1][0] + tail, None)]):
            lines.append(f"file '{p.name}'\nduration {max(0.001, nxt[0] - t):.4f}")
        lines.append(f"file '{frames[-1][1].name}'")
        (self.dir / "list.txt").write_text("\n".join(lines), encoding="utf-8")
        mp4 = OUT / f"{self.name}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt",
                        "-vf", f"fps=30,scale={W}:{H}:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "16",
                        "-preset", "slow", str(mp4.resolve())], cwd=self.dir, check=True)
        dur = frames[-1][0] + tail - first
        (OUT / f"{self.name}.json").write_text(json.dumps({"duration": round(dur, 2), "screencast_start": round(first - self.t0, 2), "marks": self.marks}, indent=2))
        shutil.rmtree(self.dir, ignore_errors=True)
        print(f"{self.name}: {dur:.1f}s, {len(frames)} frames, marks {[m['mark'] for m in self.marks]}")


def slow_scroll(take, page, to_y, seconds=3.0, selector=None):
    steps = int(seconds * 30)
    js_get = f"document.querySelector('{selector}').scrollTop" if selector else "window.scrollY"
    start = page.evaluate(js_get)
    for i in range(1, steps + 1):
        k = i / steps
        ease = k * k * (3 - 2 * k)
        y = start + (to_y - start) * ease
        if selector:
            page.evaluate(f"document.querySelector('{selector}').scrollTop = {y}")
        else:
            page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(33)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, color_scheme="light", reduced_motion="no-preference")
    page = ctx.new_page()
    page.goto(f"{BASE}/#today")
    page.wait_for_timeout(1200)

    # 1. Writing a note and watching it get filed.
    t = Take(page, "a_write")
    t.start()
    t.idle(1.0)
    page.click("button[data-author='P3']")
    t.idle(0.5)
    page.click("#note-text")
    page.keyboard.type(NOTE, delay=22)
    t.idle(0.6)
    t.mark("save")
    page.click("#save-note")
    page.wait_for_selector(".capture", timeout=240_000)
    t.mark("filed")
    t.idle(1.2)
    page.evaluate("document.querySelector('.composer-col').scrollTo({top: 9999, behavior: 'smooth'})")
    t.idle(3.5)
    t.stop()

    # 2. The privacy ledger: exactly what was sent.
    page.goto(f"{BASE}/#privacy")
    page.wait_for_timeout(800)
    t = Take(page, "b_privacy")
    t.start()
    t.idle(1.2)
    slow_scroll(t, page, 640, 2.2)
    t.idle(0.8)
    page.click("button[data-action='show-outbound']")
    t.mark("dialog")
    t.idle(2.2)
    slow_scroll(t, page, 380, 5.0, selector=".outbound")
    t.idle(1.0)
    t.stop()
    page.keyboard.press("Escape")

    # 3. The weekly brief on the deep tier.
    page.goto(f"{BASE}/#briefs")
    page.wait_for_timeout(800)
    t = Take(page, "c_brief")
    t.start()
    t.idle(1.4)
    t.mark("run")
    page.click("button[data-action='run-skill'][data-id='weekly-digest']")
    page.wait_for_selector(".brief", timeout=300_000)
    page.wait_for_timeout(300)
    t.mark("brief")
    t.idle(0.8)
    top = page.evaluate("document.querySelector('.brief').getBoundingClientRect().top + window.scrollY - 24")
    slow_scroll(t, page, top, 1.8)
    t.idle(2.5)
    slow_scroll(t, page, top + 520, 5.0)
    t.idle(2.0)
    slow_scroll(t, page, top + 1000, 4.0)
    t.idle(1.5)
    cite = page.query_selector(".brief .questions .cite") or page.query_selector(".brief .cite")
    if cite:
        cite.scroll_into_view_if_needed()
        t.idle(0.4)
        cite.click()
        t.mark("cite")
        t.idle(2.8)
        page.keyboard.press("Escape")
    t.idle(0.6)
    t.stop()

    # 4. Asking the log.
    page.goto(f"{BASE}/#today")
    page.wait_for_timeout(800)
    t = Take(page, "d_ask")
    t.start()
    t.idle(0.8)
    page.click("#ask-input")
    page.keyboard.type("When did the dizziness start?", delay=45)
    t.idle(0.4)
    t.mark("ask")
    page.click("#ask-form button")
    page.wait_for_selector(".answer", timeout=180_000)
    t.mark("answer")
    t.idle(5.0)
    t.stop()

    # 5. Memory with consent and the calendar feed.
    page.goto(f"{BASE}/#memory")
    page.wait_for_timeout(800)
    t = Take(page, "e_memory")
    t.start()
    t.idle(1.6)
    yes = page.query_selector("button[data-action='fact-yes']") or page.query_selector("button[data-action='routine-yes']")
    if yes:
        yes.click()
        t.mark("confirmed")
    t.idle(1.6)
    y = page.evaluate("document.querySelector('#cal-url').getBoundingClientRect().top + window.scrollY - 420")
    slow_scroll(t, page, y, 3.0)
    page.click("button[data-action='copy-cal']")
    t.idle(2.4)
    t.stop()

    # 6. The offline emergency check.
    page.goto(f"{BASE}/#today")
    page.wait_for_timeout(800)
    t = Take(page, "f_emergency")
    t.start()
    t.idle(0.6)
    page.click("button[data-author='P4']")
    page.click("#note-text")
    page.keyboard.type("Found her on the bathroom floor, she fell and hit her head on the sink.", delay=24)
    t.mark("save")
    page.click("#save-note")
    page.wait_for_selector("#capture-result .emergency", timeout=30_000)
    t.mark("flag")
    t.idle(3.5)
    page.wait_for_selector(".capture", timeout=240_000)
    t.idle(1.0)
    t.stop()

    browser.close()
