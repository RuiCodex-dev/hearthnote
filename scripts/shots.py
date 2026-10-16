"""Screenshot the running app in headless Chromium (Playwright): every view, then the main
flows (write a note, run the weekly brief, ask a question, open the privacy ledger).
Used for design review and the README/Devpost gallery.

    python scripts/shots.py [base_url] [out_dir]
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8731"
out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/screens")
out.mkdir(parents=True, exist_ok=True)
errors = []
NOTE = "Took Mum to the market with Bram. She was tired after twenty minutes and a bit dizzy getting off the bus, so we sat at the cafe. She ate a whole croissant. Eye drops done at nine. We need to buy new batteries for her hearing aid."

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1480, "height": 960}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    for view in ["today", "notes", "briefs", "memory", "privacy"]:
        page.goto(f"{base}/#{view}")
        page.wait_for_timeout(800)
        page.screenshot(path=str(out / f"{view}.png"))

    page.goto(f"{base}/#today")
    page.wait_for_timeout(500)
    page.click("button[data-author='P3']")
    page.fill("#note-text", NOTE)
    page.click("#save-note")
    page.wait_for_selector(".capture", timeout=180_000)
    page.wait_for_timeout(400)
    page.screenshot(path=str(out / "capture.png"))

    page.goto(f"{base}/#briefs")
    page.wait_for_timeout(400)
    page.click("button[data-action='run-skill'][data-id='weekly-digest']")
    page.wait_for_selector(".brief", timeout=240_000)
    page.wait_for_timeout(600)
    # Viewport shots only: the sidebar and composer are sticky, which a full-page capture
    # stitches into the middle of the page.
    page.evaluate("window.scrollTo(0, document.querySelector('.brief').getBoundingClientRect().top + window.scrollY - 24)")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / "brief.png"))
    page.evaluate("window.scrollTo(0, document.querySelector('.brief .questions').getBoundingClientRect().top + window.scrollY - 200)")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / "brief-questions.png"))

    page.goto(f"{base}/#today")
    page.wait_for_timeout(400)
    page.fill("#ask-input", "When did the dizziness start?")
    page.click("#ask-form button")
    page.wait_for_selector(".answer", timeout=120_000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "ask.png"))

    page.goto(f"{base}/#privacy")
    page.wait_for_timeout(500)
    page.click("button[data-action='show-outbound']")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / "outbound.png"))

    mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    m = mobile.new_page()
    for view in ["today", "briefs"]:
        m.goto(f"{base}/#{view}")
        m.wait_for_timeout(700)
        m.screenshot(path=str(out / f"mobile-{view}.png"))
    browser.close()
print("\n".join(errors) or "no console errors")
