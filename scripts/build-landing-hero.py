#!/usr/bin/env python3
"""Build the landing page hero from the approved original.

From Drive → Masinloc Website Asset → Hero landing page. Unlike the Connect,
Discover and 404 artwork, this one arrives as a plain photograph: no logo, no
geometric ribbons, no baked-in text. Binabayani performers crossing the plaza in
front of San Andres Church, bunting overhead, the crowd along the left.

That difference matters for one reason. The branded pieces cannot be cropped,
because a crop would cut the logo or the footer off somebody's finished artwork.
This is a photograph, and the homepage hero is a full-bleed frame that has to
survive every viewport from a phone to an ultrawide, so it is placed with
object-fit and object-position like any other editorial photograph. Nothing is
altered — only which part of it the frame lands on.

Nothing is upscaled: the ladder stops at the original's own width.

Usage
-----
    python3 scripts/build-landing-hero.py [folder-with-original]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "hero"
MANIFEST = ROOT / "data" / "discover-assets.json"
STEM = "landing-hero"
ORIGINAL = "landing-hero.png"

WIDTHS = [640, 960, 1280, 1672]
QUALITY = {"avif": 52, "webp": 80, "jpg": 84}


def build(originals: Path) -> dict:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required: pip install Pillow")

    source = originals / ORIGINAL
    if not source.is_file():
        sys.exit(f"missing original: {source}")

    OUT.mkdir(parents=True, exist_ok=True)
    widths = []
    with Image.open(source) as image:
        image = image.convert("RGB")
        native = (image.width, image.height)
        for width in WIDTHS:
            if width > image.width:
                continue
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.LANCZOS)
            for ext in ("avif", "webp", "jpg"):
                target = OUT / f"{STEM}-{width}.{ext}"
                try:
                    if ext == "jpg":
                        resized.save(target, "JPEG", quality=QUALITY[ext],
                                     optimize=True, progressive=True)
                    else:
                        resized.save(target, ext.upper(), quality=QUALITY[ext])
                except (OSError, KeyError, ValueError) as err:
                    if ext == "avif":
                        print(f"note: no AVIF encoder ({err})")
                        continue
                    raise
            widths.append(width)
    print(f"{STEM}: {native[0]}x{native[1]} native, widths {widths}")
    return {"source": ORIGINAL,
            "native": {"width": native[0], "height": native[1]},
            "ratio": round(native[0] / native[1], 4),
            "widths": widths}


def main() -> int:
    if len(sys.argv) > 1:
        built = build(Path(sys.argv[1]).expanduser())
        existing = {}
        if MANIFEST.is_file():
            existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
        existing[STEM] = built
        MANIFEST.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8")
    files = sorted(OUT.glob(f"{STEM}-*")) if OUT.is_dir() else []
    if not files:
        print("nothing built yet")
        return 1
    total = sum(p.stat().st_size for p in files) / 1024
    print(f"{len(files)} files, {total:.0f} KB total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
