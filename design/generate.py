"""Generate Hearthnote mood imagery with gflow-cli (Google Flow, Nano Banana Pro, 0 credits).

Runs prompts one at a time because the Flow browser profile is shared by several agents on
this machine; the lease wait lets other callers finish first. Raw variants go to
design/gen/raw/<slug>/ (git-ignored); curated picks are graded by grade.py.

    python design/generate.py [slug ...]
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "gen" / "raw"
spec = json.loads((ROOT / "prompts.json").read_text(encoding="utf-8"))
only = set(sys.argv[1:])
env = dict(os.environ, GFLOW_CLI_LEASE_WAIT_SECONDS="1800", GFLOW_CLI_UPDATE_CHECK="0", PYTHONUTF8="1")
RAW.mkdir(parents=True, exist_ok=True)
log = open(RAW.parent / "run.log", "a", encoding="utf-8")


def images(folder):
    return [f for f in folder.iterdir() if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]


for job in spec["jobs"]:
    slug = job["slug"]
    if only and slug not in only:
        continue
    out = RAW / slug
    out.mkdir(parents=True, exist_ok=True)
    if len(images(out)) >= 3:
        continue
    prompt = f'{job["subject"]} {spec["style_suffix"]}'
    for attempt in range(4):
        started = time.time()
        log.write(f"\n=== {slug} attempt {attempt + 1} {time.strftime('%H:%M:%S')} owner=hearthnote\n")
        log.flush()
        result = subprocess.run(
            ["gflow", "image", "t2i", prompt, "--model", "nano-pro", "--aspect", job["aspect"], "-n", "3", "--out", str(out)],
            env=env, stdout=log, stderr=log,
        )
        log.write(f"--- {slug} exit {result.returncode} in {time.time() - started:.0f}s, files {len(images(out))}\n")
        log.flush()
        if result.returncode == 0 and images(out):
            break
        time.sleep(75)
log.write("\nALL DONE\n")
log.close()
