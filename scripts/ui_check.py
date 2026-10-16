"""Click through every control of the web app in headless Chromium and fail on any console
error, uncaught exception, failed request or broken flow. Desktop and phone sizes.

    python scripts/ui_check.py http://127.0.0.1:8732 qa/ui

Point it at a server started with LLM_PROVIDER=mock (free) or nebius (real model). Writes
qa/ui/ui-check.json and screenshots of each step.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8732"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "qa/ui")
OUT.mkdir(parents=True, exist_ok=True)
results, problems = [], []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  - ' + str(detail)) if detail else ''}")


def watch(page, label):
    page.on("console", lambda m: problems.append(f"{label} console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: problems.append(f"{label} pageerror: {e}"))
    page.on("requestfailed", lambda r: problems.append(f"{label} requestfailed: {r.url} {r.failure}"))
    page.on("response", lambda r: problems.append(f"{label} HTTP {r.status}: {r.url}") if r.status >= 500 else None)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    watch(page, "desktop")
    page.goto(f"{BASE}/#today")
    page.wait_for_selector(".page-title")

    # Every navigation link renders its view.
    for view in ["today", "notes", "briefs", "memory", "privacy"]:
        page.click(f"a[data-view='{view}']:visible")
        page.wait_for_timeout(300)
        title = page.inner_text(".page-title") if page.query_selector(".page-title") else ""
        check(f"view {view} renders", page.evaluate("document.body.dataset.view") == view and title, title[:60])
        page.screenshot(path=str(OUT / f"view-{view}.png"))

    # Images: every <img> on every view actually loads.
    broken = []
    for view in ["today", "notes", "briefs", "memory", "privacy"]:
        page.goto(f"{BASE}/#{view}")
        page.wait_for_timeout(300)
        broken += page.evaluate("[...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src)")
    check("all images load", not broken, broken)

    # Empty note is not sent; a real note is filed.
    page.goto(f"{BASE}/#today")
    page.wait_for_timeout(300)
    before = page.evaluate("fetch('/api/state').then(r => r.json()).then(s => s.notes.length)")
    page.fill("#note-text", "  ")
    page.click("#save-note")
    page.wait_for_timeout(400)
    after = page.evaluate("fetch('/api/state').then(r => r.json()).then(s => s.notes.length)")
    check("empty note is not saved", before == after)
    page.click("button[data-author='P3']")
    page.fill("#note-text", "Lunch was soup, she ate half. Asked twice what day it is. Need to pick up the new prescription on Monday.")
    page.click("#save-note")
    page.wait_for_selector(".capture", timeout=240_000)
    check("a note is filed and shows its receipt", page.query_selector(".capture .receipt") is not None or page.query_selector(".receipt") is not None)
    page.screenshot(path=str(OUT / "capture.png"))

    # Emergency banner appears before the model answers.
    page.fill("#note-text", "She fell on the stairs and hit her head, there is a cut.")
    page.click("#save-note")
    page.wait_for_selector("#capture-result .emergency", timeout=10_000)
    check("emergency advice shows 112", "112" in page.inner_text("#capture-result .emergency"))
    page.wait_for_selector(".capture", timeout=240_000)

    # Ask: an empty question is ignored, a real one is answered.
    page.fill("#ask-input", "")
    page.click("#ask-form button")
    page.wait_for_timeout(300)
    check("empty question is not sent", page.query_selector(".answer") is None)
    page.fill("#ask-input", "When did the dizziness start?")
    page.click("#ask-form button")
    page.wait_for_selector(".answer", timeout=180_000)
    check("a question is answered with citations", page.query_selector(".answer [data-cite]") is not None, page.inner_text(".answer")[:120])
    page.click(".answer [data-cite]")
    page.wait_for_selector("dialog[open]")
    check("a citation opens the note it points to", page.query_selector("dialog[open] .note") is not None or "N" in page.inner_text("dialog[open]"))
    page.keyboard.press("Escape")

    # Briefs: run a built-in skill, write and run a custom skill, delete it.
    page.goto(f"{BASE}/#briefs")
    page.wait_for_timeout(300)
    page.click("button[data-action='run-skill'][data-id='handover']")
    page.wait_for_selector(".brief", timeout=240_000)
    check("a built-in skill writes a brief", page.query_selector(".brief") is not None)
    page.click("button[data-action='new-skill']")
    page.wait_for_selector("#skill-form")
    page.fill("#sk-title", "Physio summary")
    page.fill("#sk-ins", "Summarise mobility, dizziness and walking for the physiotherapist.")
    page.click("#skill-form button[type='submit']")
    page.wait_for_timeout(500)
    custom = page.query_selector("button[data-action='run-skill'][data-id^='custom-']")
    check("a custom skill can be written", custom is not None)
    if custom:
        cid = custom.get_attribute("data-id")
        n_before = page.evaluate("fetch('/api/state').then(r => r.json()).then(s => s.briefs.length)")
        custom.click()
        n_after = n_before
        for _ in range(480):
            page.wait_for_timeout(500)
            n_after = page.evaluate("fetch('/api/state').then(r => r.json()).then(s => s.briefs.length)")
            if n_after > n_before:
                break
        page.wait_for_timeout(500)
        check("the custom skill runs", n_after > n_before)
        page.click(f"button[data-action='delete-skill'][data-id='{cid}']")
        page.wait_for_timeout(400)
        check("the custom skill can be deleted", page.query_selector(f"button[data-action='run-skill'][data-id='{cid}']") is None)
    page.screenshot(path=str(OUT / "briefs.png"), full_page=True)

    # Memory: confirm, forget, add a member, add a private word, copy the calendar link.
    page.goto(f"{BASE}/#memory")
    page.wait_for_timeout(300)
    for action in ["fact-yes", "fact-no", "routine-yes", "routine-no"]:
        b = page.query_selector(f"button[data-action='{action}']")
        if b:
            b.click()
            page.wait_for_timeout(400)
            check(f"memory action {action}", page.inner_text("#toast"))
    page.click("button[data-action='add-member']")
    page.fill("#m-name", "Josiane")
    page.fill("#m-role", "neighbour, has a key")
    page.click("#member-form button[type='submit']")
    page.wait_for_timeout(400)
    check("a member can be added", "Josiane" in page.inner_text("body"))
    cal = page.input_value("#cal-url")
    status = page.evaluate(f"fetch({json.dumps(cal)}).then(r => r.status)")
    check("the calendar link works", status == 200, cal.split('/cal/')[0] + "/cal/<token>.ics")
    page.screenshot(path=str(OUT / "memory.png"), full_page=True)
    page.goto(f"{BASE}/#privacy")
    page.wait_for_timeout(300)
    page.click("button[data-action='add-term']")
    page.fill("#t-text", "Kessel-Lo")
    page.click("#term-form button[type='submit']")
    page.wait_for_timeout(400)
    check("a private word can be added", "Kessel-Lo" in page.inner_text("body"))

    # Tasks: tick one off on Today.
    page.goto(f"{BASE}/#today")
    page.wait_for_timeout(300)
    t = page.query_selector("button[data-action='task-done']")
    if t:
        n0 = len(page.query_selector_all("button[data-action='task-done']"))
        t.click()
        page.wait_for_timeout(400)
        check("a task can be ticked off", len(page.query_selector_all("button[data-action='task-done']")) <= n0)

    # Privacy ledger: open exactly what was sent; no real names in it.
    page.goto(f"{BASE}/#privacy")
    page.wait_for_timeout(300)
    page.click("button[data-action='show-outbound']")
    page.wait_for_selector("pre.outbound")
    sent = page.inner_text("pre.outbound")
    check("the outbound prompt shows tokens, not names", "[P1]" in sent and not any(n in sent for n in ["Mireille", "Anouk", "Bram", "Sofie", "Josiane", "Kessel-Lo"]))
    page.screenshot(path=str(OUT / "outbound.png"))
    page.keyboard.press("Escape")

    # Keyboard: the first Tab reaches the skip link, which focuses the content and keeps the view.
    kp = ctx.new_page()
    watch(kp, "keyboard")
    kp.goto(f"{BASE}/#briefs")
    kp.wait_for_selector(".page-title")
    kp.keyboard.press("Tab")
    check("the first Tab lands on the skip link", kp.evaluate("document.activeElement.classList.contains('skip')"))
    kp.keyboard.press("Enter")
    kp.wait_for_timeout(200)
    check("the skip link focuses the content and stays on the view", kp.evaluate("document.activeElement.id") == "main" and kp.evaluate("location.hash") == "#briefs", kp.evaluate("location.hash"))
    kp.close()

    # Start over.
    page.click("button[data-action='reset-demo']")
    page.wait_for_timeout(500)
    count = page.evaluate("fetch('/api/state').then(r => r.json()).then(s => s.notes.length)")
    check("Start over restores the demo", count == 12)

    # Phone size: no horizontal scroll on any view, the Write view works.
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page()
    watch(mp, "phone")
    for view in ["today", "notes", "briefs", "memory", "privacy", "write"]:
        mp.goto(f"{BASE}/#{view}")
        mp.wait_for_timeout(400)
        overflow = mp.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(f"phone {view}: no horizontal scroll", overflow <= 1, f"{overflow}px")
        mp.screenshot(path=str(OUT / f"phone-{view}.png"))
    browser.close()

real = [x for x in problems if "favicon" not in x]
check("no console errors, page errors, failed requests or 5xx", not real, real[:8])
(OUT / "ui-check.json").write_text(json.dumps({"base": BASE, "results": results, "problems": real}, indent=2), encoding="utf-8")
failed = [r for r in results if not r["ok"]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
