#!/usr/bin/env python3
"""Derive every raster image the site serves from the masters in images/src/.

    python3 scripts/make-images.py

The masters are the only hand-made files. Everything else under images/ that
this script writes is a build product, committed so the site needs no build
step on the host, and regenerated here so a new master propagates everywhere
with one command rather than four separate exports.

Requires Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "images" / "src"
OUT = ROOT / "images"

MARK_COLOUR = (26, 28, 35)  # --text in css/styles.css


def mark_with_alpha(master: Image.Image) -> Image.Image:
    """Lift the dark mark off its white background onto transparency.

    The master is a dark mark on a flat white square. Luminance maps straight to
    alpha: white is fully transparent, the mark is fully opaque, and the
    anti-aliased edge in between keeps its softness.
    """
    grey = master.convert("L")
    lo, hi = 40, 250
    alpha = grey.point(lambda v: 255 if v <= lo else 0 if v >= hi else round(255 * (hi - v) / (hi - lo)))
    out = Image.new("RGBA", master.size, MARK_COLOUR + (0,))
    out.putalpha(alpha)
    bbox = alpha.getbbox()
    pad = round(0.06 * max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
    return out.crop((bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad))


def fit_height(im: Image.Image, h: int) -> Image.Image:
    w = round(im.width * h / im.height)
    return im.resize((w, h), Image.LANCZOS)


def main() -> None:
    logo = Image.open(SRC / "logo.png").convert("RGB")
    mark = mark_with_alpha(logo)

    # Nav brand mark: displayed at 80px tall, shipped at 2x for high-DPI screens.
    fit_height(mark, 160).save(OUT / "logo-mark.png", optimize=True)

    # Home-screen / legacy favicon: the full square master, white background.
    logo.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)

    # Social card: mark centred on white at the 1200x630 size every platform accepts.
    og = Image.new("RGB", (1200, 630), (255, 255, 255))
    m = fit_height(mark, 260)
    og.paste(m, ((1200 - m.width) // 2, (630 - m.height) // 2), m)
    og.save(OUT / "og-image.png", optimize=True)

    # Zannex Travels card logo: displayed at 88px tall, shipped at 3x.
    zannex = Image.open(SRC / "zannex-logo.png").convert("RGBA")
    fit_height(zannex, 264).save(OUT / "zannex-logo.png", optimize=True)

    for f in sorted(OUT.glob("*.png")):
        print(f"{f.relative_to(ROOT)}  {Image.open(f).size}  {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
