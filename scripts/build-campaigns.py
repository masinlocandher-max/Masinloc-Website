#!/usr/bin/env python3
"""Build responsive campaign artwork from the approved originals.

The originals are 1.8-2.7 MB PNGs. Shipping them whole would put several
megabytes above the fold on a phone connection, which is the audience this
homepage is for.

Campaign artwork is not photography. Each file is a finished design carrying
its own logo, headline, URL and app-store badges, so this only ever changes
the pixel dimensions: never the crop, never the aspect ratio. The ambient
backdrop the homepage uses on very wide screens is derived here too, as a
heavily blurred copy, so the page never has to stretch or crop the artwork to
fill space.

Usage
-----
    python3 scripts/build-campaigns.py <folder-with-originals>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "campaigns.json"
OUT = ROOT / "assets" / "campaigns"

# The artwork is 1672px wide. Nothing is upscaled, so the ladder stops there.
WIDTHS = [480, 768, 1120, 1440, 1672]

# The ambient backdrop is blurred past recognition, so it can be tiny.
AMBIENT_WIDTH = 64
AMBIENT_BLUR = 18

QUALITY = {"avif": 55, "webp": 80, "jpg": 84}


def formats_available() -> list[str]:
    available = ["webp", "jpg"]
    try:
        Image.new("RGB", (8, 8)).save(Path("/dev/null"), format="AVIF")
    except Exception:
        pass
    else:
        available.insert(0, "avif")
    return available


def find_original(folder: Path, name: str) -> Path | None:
    direct = folder / name
    if direct.is_file():
        return direct
    wanted = name.lower()
    for path in folder.iterdir():
        if path.is_file() and path.name.lower() == wanted:
            return path
    return None


def derive(original: Path, slug: str, formats: list[str], suffix: str = "") -> list[str]:
    written: list[str] = []
    with Image.open(original) as source:
        source = source.convert("RGB")
        for width in WIDTHS:
            if width > source.width:
                continue
            height = round(source.height * width / source.width)
            resized = source.resize((width, height), Image.LANCZOS)
            for fmt in formats:
                target = OUT / f"{slug}{suffix}-{width}.{fmt}"
                params: dict = {"quality": QUALITY[fmt]}
                if fmt == "jpg":
                    params.update(format="JPEG", optimize=True, progressive=True)
                elif fmt == "webp":
                    params.update(format="WEBP", method=6)
                else:
                    params.update(format="AVIF")
                resized.save(target, **params)
                written.append(target.name)

        # Ambient backdrop: shrink hard, blur, and let CSS scale it back up.
        # Downsampling first is what makes it cheap and what removes every
        # legible trace of the campaign copy.
        ambient_height = round(source.height * AMBIENT_WIDTH / source.width)
        ambient = (source.resize((AMBIENT_WIDTH, ambient_height), Image.LANCZOS)
                         .filter(ImageFilter.GaussianBlur(AMBIENT_BLUR)))
        for fmt in formats:
            target = OUT / f"{slug}-ambient.{fmt}"
            params = {"quality": QUALITY[fmt]}
            if fmt == "jpg":
                params.update(format="JPEG", optimize=True)
            elif fmt == "webp":
                params.update(format="WEBP", method=6)
            else:
                params.update(format="AVIF")
            ambient.save(target, **params)
            written.append(target.name)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="folder holding the approved originals")
    args = parser.parse_args()

    if not args.folder.is_dir():
        sys.exit(f"not a folder: {args.folder}")

    payload = json.loads(DATA.read_text(encoding="utf-8"))
    campaigns = payload["campaigns"]
    formats = formats_available()
    OUT.mkdir(parents=True, exist_ok=True)

    missing, total = [], 0
    for campaign in campaigns:
        original = find_original(args.folder, campaign["source"])
        if original is None:
            missing.append(f"{campaign['slug']}: {campaign['source']}")
            continue
        written = derive(original, campaign["slug"], formats)
        total += len(written)
        print(f"{campaign['slug']:26s} {original.name:44s} -> {len(written)} files")

        # A portrait variant is used only if the project supplies one. None is
        # ever generated: cropping a designed campaign to portrait would cut
        # the copy it exists to show.
        mobile = campaign.get("mobileSource")
        if mobile:
            found = find_original(args.folder, mobile)
            if found is None:
                missing.append(f"{campaign['slug']}: mobile {mobile}")
            else:
                written = derive(found, campaign["slug"], formats, suffix="-mobile")
                total += len(written)
                print(f"{'':26s} {found.name:44s} -> {len(written)} files (mobile)")

    if missing:
        print("\nMISSING ORIGINALS")
        for line in missing:
            print(f"- {line}")
        print("\nNo campaign was substituted. Add the originals and run this again.")
        return 1

    print(f"\nwrote {total} files to {OUT.relative_to(ROOT)}")
    print(f"{', '.join(formats)} at {', '.join(str(w) for w in WIDTHS)}px, "
          f"plus a {AMBIENT_WIDTH}px ambient backdrop per campaign")
    return 0


if __name__ == "__main__":
    sys.exit(main())
