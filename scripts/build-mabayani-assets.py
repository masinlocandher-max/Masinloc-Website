#!/usr/bin/env python3
"""Build the responsive MABAYANI artwork from the supplied originals.

MABAYANI shipped as a page of pure text. The project has now supplied its
wordmark and two finished designs, and this derives the sizes the page serves.

Two kinds of file, handled differently on purpose:

A DESIGN carries its own copy — a headline, a signature, a tagline set inside
the image. So this only ever changes the pixel dimensions. Never the crop,
never the aspect ratio, and never a portrait variant invented by cropping,
because cropping a design cuts the words it exists to show.

THE WORDMARK is navy letterforms on transparency, and it stays that way. It
is derived as WebP and PNG only: a JPEG has no alpha channel, so every
transparent pixel around and inside the letters would flatten to black. That
is why `alpha` in the manifest decides the format list rather than a global
constant deciding it for every file.

The originals live in Drive, not in this repository — they are 2-4 MB PNGs
and nothing on the site serves them. Point this at a local copy:

    python3 scripts/build-mabayani-assets.py <folder-with-originals>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "mabayani-assets.json"
OUT = ROOT / "assets" / "mabayani"

QUALITY = {"avif": 55, "webp": 82, "jpg": 84}
# Transparency survives WebP and PNG. It does not survive JPEG or, in the
# encoder available here, AVIF — so a wordmark is never offered as either.
OPAQUE_FORMATS = ["avif", "webp", "jpg"]
ALPHA_FORMATS = ["webp", "png"]


def avif_available() -> bool:
    try:
        Image.new("RGB", (8, 8)).save(Path("/dev/null"), format="AVIF")
    except Exception:
        return False
    return True


def find_original(folder: Path, name: str) -> Path | None:
    direct = folder / name
    if direct.is_file():
        return direct
    wanted = name.lower()
    for path in folder.iterdir():
        if path.is_file() and path.name.lower() == wanted:
            return path
    return None


def save(image: Image.Image, target: Path, fmt: str) -> None:
    params: dict = {}
    if fmt == "jpg":
        params.update(format="JPEG", quality=QUALITY[fmt], optimize=True, progressive=True)
    elif fmt == "webp":
        params.update(format="WEBP", quality=QUALITY[fmt], method=6)
    elif fmt == "avif":
        params.update(format="AVIF", quality=QUALITY[fmt])
    else:
        params.update(format="PNG", optimize=True)
    image.save(target, **params)


def derive(original: Path, entry: dict, formats: list[str]) -> list[str]:
    written: list[str] = []
    with Image.open(original) as source:
        source = source.convert("RGBA" if entry["alpha"] else "RGB")
        for width in entry["widths"]:
            if width > source.width:
                continue
            height = round(source.height * width / source.width)
            resized = source.resize((width, height), Image.LANCZOS)
            for fmt in formats:
                target = OUT / f"{entry['slug']}-{width}.{fmt}"
                save(resized, target, fmt)
                written.append(target.name)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="folder holding the supplied originals")
    args = parser.parse_args()

    if not args.folder.is_dir():
        sys.exit(f"not a folder: {args.folder}")

    payload = json.loads(DATA.read_text(encoding="utf-8"))
    have_avif = avif_available()
    OUT.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    total = 0
    for entry in payload["artwork"]:
        original = find_original(args.folder, entry["source"])
        if original is None:
            missing.append(f"{entry['slug']}: {entry['source']}")
            continue
        if entry["alpha"]:
            formats = list(ALPHA_FORMATS)
        else:
            formats = [f for f in OPAQUE_FORMATS if f != "avif" or have_avif]
        written = derive(original, entry, formats)
        total += len(written)
        print(f"{entry['slug']:20s} {original.name:26s} -> {len(written)} files "
              f"({', '.join(formats)})")

    if missing:
        print()
        print("MISSING ORIGINALS — nothing was written for these:")
        for name in missing:
            print(f"  {name}")
        return 1

    if not have_avif:
        print()
        print("AVIF is unavailable in this Pillow build; WebP and JPEG were written.")
    print()
    print(f"{total} file(s) in {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
