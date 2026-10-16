"""Narration, captions and music for the demo video.

- Narration: Microsoft Edge neural TTS (edge-tts), one file per scene, from narration.json.
- Captions: sentence-level cues timed from the TTS word boundaries.
- Music: a quiet pad synthesised here with ffmpeg sine sources (no third-party music, so no
  licence question), mixed low under the voice.

Writes video/hyperframes/assets/audio/{voice.wav,music.wav} and video/work/timing.json.

    python video/make_audio.py
"""
import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
AUD = ROOT / "hyperframes" / "assets" / "audio"
WORK.mkdir(exist_ok=True)
AUD.mkdir(parents=True, exist_ok=True)
spec = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))


async def tts(scene):
    mp3 = WORK / f"vo_{scene['id']}.mp3"
    comm = edge_tts.Communicate(scene["text"], spec["voice"], rate=spec["rate"], boundary="WordBoundary")
    words = []
    with open(mp3, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "w": chunk["text"]})
    return mp3, words


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def sentences(text, words, offset):
    # Group words into caption cues of at most ~9 words, breaking at punctuation.
    cues, cur = [], []
    tokens = text.replace("’", "'").split()
    wi = 0
    for tok in tokens:
        cur.append(tok)
        end = tok[-1] in ".,:;?!" and len(cur) >= 4
        if end or len(cur) >= 9:
            cues.append(" ".join(cur))
            cur = []
    if cur:
        cues.append(" ".join(cur))
    out = []
    for cue in cues:
        n = len(cue.split())
        seg = words[wi:wi + n]
        wi += n
        if not seg:
            continue
        out.append({"start": round(offset + seg[0]["t"], 2), "end": round(offset + seg[-1]["t"] + seg[-1]["d"] + 0.15, 2), "text": cue})
    return out


async def main():
    timing = {"scenes": [], "captions": [], "words": []}
    t = 0.0
    parts = []
    for scene in spec["scenes"]:
        mp3, words = await tts(scene)
        d = duration(mp3)
        lead = 0.35
        timing["scenes"].append({"id": scene["id"], "start": round(t, 2), "voice_start": round(t + lead, 2), "voice": round(d, 2), "end": round(t + lead + d + scene["pad"], 2)})
        timing["captions"] += sentences(scene["text"], words, t + lead)
        timing["words"] += [{"t": round(t + lead + w["t"], 2), "w": w["w"]} for w in words]
        parts.append((mp3, t + lead))
        t += lead + d + scene["pad"]
    total = round(t, 2)
    timing["duration"] = total

    # Voice track: every scene file placed at its start.
    inputs, filters = [], []
    for i, (mp3, start) in enumerate(parts):
        inputs += ["-i", str(mp3)]
        filters.append(f"[{i}:a]adelay={int(start * 1000)}|{int(start * 1000)},aresample=48000[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad,atrim=0:{total},loudnorm=I=-16:TP=-1.5:LRA=7[v]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters) + ";" + mix, "-map", "[v]", "-ac", "2", str(AUD / "voice.wav")], check=True)

    # Music: a slow major-seventh pad (D - F# - A - C#) with a gentle tremolo and long fades.
    notes = [146.83, 185.00, 220.00, 277.18, 293.66]
    expr = "+".join(f"{0.11 / (k + 1):.3f}*sin(2*PI*{f}*t)*(0.75+0.25*sin(2*PI*{0.07 + 0.03 * k:.2f}*t))" for k, f in enumerate(notes))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={total}",
                    "-af", f"lowpass=f=1800,aecho=0.8:0.7:420|780:0.25|0.18,afade=t=in:d=3,afade=t=out:st={max(0, total - 4)}:d=4,volume=0.55",
                    "-ac", "2", str(AUD / "music.wav")], check=True)
    (WORK / "timing.json").write_text(json.dumps(timing, indent=2), encoding="utf-8")

    # Sidecar captions for YouTube (the same cues are burned into the film).
    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    cues = timing["captions"]
    srt = []
    for i, c in enumerate(cues, 1):
        end = min(c["end"], cues[i]["start"] - 0.02) if i < len(cues) else c["end"]
        srt.append(f"{i}\n{ts(c['start'])} --> {ts(end)}\n{c['text']}\n")
    (ROOT / "hearthnote-demo.en.srt").write_text("\n".join(srt), encoding="utf-8", newline="\n")
    print(f"total {total}s, {len(timing['captions'])} captions")
    for s in timing["scenes"]:
        print(f"  {s['id']:<10} {s['start']:6.2f} -> {s['end']:6.2f}  voice {s['voice']:.2f}")


asyncio.run(main())
