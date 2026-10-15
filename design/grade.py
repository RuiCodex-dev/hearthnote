"""Grade the curated Flow picks into one consistent look and export web sizes.

Same treatment for every image so they read as one series: tiny edge trim, lifted blacks,
a soft S-curve, sage shadows / oatmeal highlights split tone, saturation 0.92, and a seeded
fine grain. Masters go to design/art/<slug>.png, web copies to public/assets/img/<slug>.webp.

    python design/grade.py
"""
import random
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "gen" / "raw"
ART = ROOT / "art"
WEB = ROOT.parent / "public" / "assets" / "img"
ART.mkdir(exist_ok=True)
WEB.mkdir(parents=True, exist_ok=True)

# slug -> suffix of the chosen variant (picked by eye from the contact sheets)
PICKS = {"hero": "_3", "evening": "_1", "routine": "_1", "walk": "_2", "memory": "_2", "privacy": "_2", "visit": "_2"}


def curve(v):
    # Lift blacks to 10, soft S-curve, roll off highlights at 248.
    x = v / 255
    s = x * x * (3 - 2 * x)
    y = 0.62 * x + 0.38 * s
    return int(10 + y * 238)


def split_tone(img):
    r, g, b = img.split()
    lut = [curve(i) for i in range(256)]
    r, g, b = r.point(lut), g.point(lut), b.point(lut)
    # Shadows lean sage (a little green/blue), highlights lean oatmeal (a little red).
    r = r.point(lambda i: min(255, int(i + 6 * (i / 255) ** 2)))
    g = g.point(lambda i: min(255, int(i + 4 * (1 - i / 255) ** 2)))
    b = b.point(lambda i: max(0, int(i - 5 * (i / 255) ** 2 + 2 * (1 - i / 255) ** 2)))
    return Image.merge("RGB", (r, g, b))


def grain(img, seed, amount=7):
    rnd = random.Random(seed)
    noise = Image.effect_noise(img.size, 40).filter(ImageFilter.GaussianBlur(0.5))
    noise = noise.point(lambda i: 128 + (i - 128) * amount // 40)
    noise_rgb = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(img, Image.composite(noise_rgb, img, Image.new("L", img.size, 40 + rnd.randint(0, 6))), 0.18)


for slug, suffix in PICKS.items():
    src = next(f for f in (RAW / slug).iterdir() if f.stem.endswith(suffix))
    img = Image.open(src).convert("RGB")
    w, h = img.size
    t = int(min(w, h) * 0.006)
    img = img.crop((t, t, w - t, h - t))
    img = split_tone(img)
    img = ImageEnhance.Color(img).enhance(0.92)
    img = grain(img, seed=slug)
    if img.width > 2400:
        img = img.resize((2400, round(img.height * 2400 / img.width)), Image.LANCZOS)
    img.save(ART / f"{slug}.png", optimize=True)
    ww = min(1600, img.width)
    web = img.resize((ww, round(img.height * ww / img.width)), Image.LANCZOS)
    web.save(WEB / f"{slug}.webp", quality=82, method=6)
    print(slug, src.name, img.size, (WEB / f"{slug}.webp").stat().st_size // 1024, "KB")
