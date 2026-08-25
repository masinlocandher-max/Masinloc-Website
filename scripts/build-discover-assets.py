#!/usr/bin/env python3
"""Build the Discover hero images from the approved originals.

These are not raw photographs. Every original in the Drive "Additional image"
folder arrives with the branded hero treatment already applied by the project:
the real photograph full-bleed, the official logo at the upper left, the
translucent geometric ribbons in yellow, red and blue running in from the lower
left, and — where the project added one — a map-pin location label and the
footer line.

That has one consequence which governs this whole script: NOTHING IS CROPPED.
Not to a common ratio, not to fit a layout, not by a pixel. Cropping would cut
the logo, the location label or the footer off somebody else's finished
artwork. Each image keeps its own native aspect ratio and the page is built
around whatever that turns out to be.

Enhancement is also deliberately absent. The originals are already colour
balanced; re-encoding is the only thing that happens here.

Nothing is upscaled: the ladder stops at each original's own width.

Usage
-----
    python3 scripts/build-discover-assets.py [folder-with-originals]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "discover"
MANIFEST = ROOT / "data" / "discover-assets.json"

WIDTHS = [640, 960, 1280, 1672]
QUALITY = {"avif": 58, "webp": 84, "jpg": 88}

# source filename -> the name it takes in the repository
ORIGINALS = {
    "Pamislat.png": "pamislat",
    "8EB59CBA-5F46-4CF6-AA24-91FBA38FA635.png": "mangoes-masinloc",
    "Dinamulag Mango.png": "dinamulag-mango",
    # Supplied 2026-08-25, the four that finished the first round of Discover
    # subjects. Pamislat and Dinamulag Mango above are re-exports of the same
    # photographs at full resolution: the originals were 12-23 MB and could not
    # be retrieved when the section was first built, so the pages have been
    # running on smaller crops until now.
    "Binabayani Feastival.png": "binabayani-festival",
    "Suman and Mango.png": "suman-and-mango",
    "Powerplant in bani.png": "powerplant-bani",
}


def build(originals: Path) -> dict:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required: pip install Pillow")

    OUT.mkdir(parents=True, exist_ok=True)
    built = {}

    for filename, stem in ORIGINALS.items():
        source = originals / filename
        if not source.is_file():
            print(f"note: {filename} not present, skipping")
            continue

        with Image.open(source) as image:
            image = image.convert("RGB")
            native = (image.width, image.height)
            widths = []
            for width in WIDTHS:
                if width > image.width:
                    continue
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.LANCZOS)
                for ext in ("avif", "webp", "jpg"):
                    target = OUT / f"{stem}-{width}.{ext}"
                    try:
                        if ext == "jpg":
                            resized.save(target, "JPEG", quality=QUALITY[ext],
                                         optimize=True, progressive=True,
                                         subsampling=0)
                        else:
                            resized.save(target, ext.upper(), quality=QUALITY[ext])
                    except (OSError, KeyError, ValueError) as err:
                        if ext == "avif":
                            print(f"note: no AVIF encoder ({err})")
                            continue
                        raise
                widths.append(width)

            built[stem] = {
                "source": filename,
                "native": {"width": native[0], "height": native[1]},
                "ratio": round(native[0] / native[1], 4),
                "widths": widths,
            }
            print(f"{stem}: {native[0]}x{native[1]} native, widths {widths}, uncropped")

    return built


def main() -> int:
    if len(sys.argv) > 1:
        built = build(Path(sys.argv[1]).expanduser())
        if built:
            existing = {}
            if MANIFEST.is_file():
                existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
            existing.update(built)
            MANIFEST.write_text(
                json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8")
            print(f"\nrecorded native sizes in {MANIFEST.relative_to(ROOT)}")
    if MANIFEST.is_file():
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        print(f"{len(data)} Discover hero(es) built")
        return 0
    print("nothing built yet")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
