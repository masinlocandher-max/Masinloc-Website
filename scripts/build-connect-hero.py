#!/usr/bin/env python3
"""Build the Masinloc Connect hero from its supplied original.

The Connect hero is not a photograph. It is a brand graphic: the Masinloc mark
on a dark navy field, circled by an orbit carrying the three palette colours as
nodes, with the left two-thirds deliberately left empty for the headline. That
emptiness is the composition, so the image is never cropped horizontally — a
centre crop would move the mark under the type.

Encoding is chosen for what the image is. Large flat gradients band badly in
JPEG at ordinary quality settings, and the whole left side of this one is a
single slow gradient, so the JPEG fallback is written at a higher quality than
a photograph would need. AVIF and WebP handle it comfortably.

Nothing is upscaled: the ladder stops at the original's own width.

Usage
-----
    python3 scripts/build-connect-hero.py [folder-with-original]

The original is not committed, matching every other image family here. Running
without an argument checks what is already built rather than rebuilding it.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "connect"
STEM = "connect-hero"
ORIGINAL = "connect-hero.png"

# A full-bleed hero at 1440 CSS pixels wants about that many device pixels at
# DPR 1. The original is 1672 wide, so that is where the ladder stops.
WIDTHS = [640, 960, 1280, 1672]
QUALITY = {"avif": 55, "webp": 82, "jpg": 88}

# A phone is portrait and the graphic is 16:9, so object-fit:cover shows about
# a third of its width — enough to turn the mark into an unrecognisable
# coloured fragment. The phone gets its own 4:5 crop instead, taken around the
# orbit so the whole mark survives, with the empty upper area kept for the
# headline. Cropping here rather than in CSS is the difference between a
# deliberate composition and whatever the viewport happens to leave.
PORTRAIT_RATIO = (4, 5)
PORTRAIT_WIDTHS = [390, 560, 753]
# Centre of the orbit in the original, measured from the artwork.
PORTRAIT_FOCUS_X = 1254


def build(originals: Path) -> dict[str, list[int]]:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required: pip install Pillow")

    source = originals / ORIGINAL
    if not source.is_file():
        sys.exit(f"missing original: {source}")

    OUT.mkdir(parents=True, exist_ok=True)
    produced: dict[str, list[int]] = {"avif": [], "webp": [], "jpg": []}

    def write(img, name: str, ext: str) -> bool:
        target = OUT / f"{name}.{ext}"
        try:
            if ext == "jpg":
                img.save(target, "JPEG", quality=QUALITY[ext],
                         optimize=True, progressive=True, subsampling=0)
            else:
                img.save(target, ext.upper(), quality=QUALITY[ext])
        except (OSError, KeyError, ValueError) as err:
            if ext == "avif":
                # Pillow may lack the AVIF encoder. WebP and JPEG still cover
                # every browser; AVIF is the bonus tier.
                print(f"note: no AVIF encoder ({err})")
                return False
            raise
        return True

    with Image.open(source) as image:
        image = image.convert("RGB")

        for width in WIDTHS:
            if width > image.width:
                continue
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.LANCZOS)
            for ext in ("avif", "webp", "jpg"):
                if write(resized, f"{STEM}-{width}", ext):
                    produced[ext].append(width)

        # The phone crop. Full height, 4:5, slid horizontally to sit over the
        # orbit and clamped so it never runs past an edge.
        crop_h = image.height
        crop_w = round(crop_h * PORTRAIT_RATIO[0] / PORTRAIT_RATIO[1])
        left = min(max(PORTRAIT_FOCUS_X - crop_w // 2, 0), image.width - crop_w)
        portrait = image.crop((left, 0, left + crop_w, crop_h))
        produced["portrait"] = []
        for width in PORTRAIT_WIDTHS:
            if width > portrait.width:
                continue
            height = round(portrait.height * width / portrait.width)
            resized = portrait.resize((width, height), Image.LANCZOS)
            for ext in ("avif", "webp", "jpg"):
                write(resized, f"{STEM}-portrait-{width}", ext)
            produced["portrait"].append(width)
        print(f"portrait crop: {crop_w}x{crop_h} from x={left}")
    return produced


def report() -> int:
    if not OUT.is_dir():
        print("nothing built yet")
        return 1
    files = sorted(OUT.glob(f"{STEM}-*"))
    if not files:
        print("nothing built yet")
        return 1
    for path in files:
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")
    return 0


def main() -> int:
    if len(sys.argv) > 1:
        produced = build(Path(sys.argv[1]).expanduser())
        for ext, widths in produced.items():
            if widths:
                print(f"{ext}: {widths}")
    return report()


if __name__ == "__main__":
    raise SystemExit(main())
