#!/usr/bin/env python3
"""Build responsive location photography from the project's original files.

The originals are 1.3-4 MB camera files. Shipping them as-is would make the
locations page unusable on a phone connection, which is exactly the audience
this page is for. This produces AVIF/WebP/JPEG derivatives at four widths and
names them from the slug in data/locations.json.

The photograph-to-place mapping is fixed by the project. This script only
reads it; it never reassigns a photograph, and it fails rather than guessing
if a named original is missing.

Usage
-----
    python3 scripts/build-locations.py <folder-with-originals>

The folder must contain the exact filenames listed as "source" in
data/locations.json. Files may also be pre-renamed to "<slug>.jpg"; both are
accepted, and the slug name wins if both are present.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "locations.json"
OUT = ROOT / "assets" / "locations"

# Widths chosen for the resolutions the project's originals actually carry
# (798px to 2048px). Nothing is upscaled, so a smaller original simply stops
# earlier in the ladder.
WIDTHS = [480, 768, 1120, 1536, 2048]

# The 1:1 pubmat is the social share image and the downloadable card. It is
# used whole, never cropped, and never has type laid over it.
CARD_WIDTHS = [600, 1200]

# Quality per format. AVIF and WebP carry the page; JPEG is the last resort
# for browsers that support neither.
QUALITY = {"avif": 52, "webp": 78, "jpg": 82}


def load_locations() -> list[dict]:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    return payload["locations"]


def find_original(folder: Path, location: dict, key: str = "photo") -> Path | None:
    """Locate one of a location's originals by slug name or supplied filename.

    `key` is "photo" for the raw photograph or "card" for the 1:1 pubmat.
    """
    suffix = "-card" if key == "card" else ""
    candidates = [f"{location['slug']}{suffix}{extension}"
                  for extension in (".jpg", ".jpeg", ".png")]
    candidates.append(location[key])

    for candidate in candidates:
        path = folder / candidate
        if path.is_file():
            return path

    # Be tolerant of case differences in the supplied filenames.
    wanted = location[key].lower()
    for path in folder.iterdir():
        if path.is_file() and path.name.lower() == wanted:
            return path
    return None


def formats_available() -> list[str]:
    """Which output formats this Pillow build can actually write."""
    available = ["webp", "jpg"]
    try:
        Image.new("RGB", (8, 8)).save(Path("/dev/null"), format="AVIF")
    except Exception:
        pass
    else:
        available.insert(0, "avif")
    return available


def derive(original: Path, slug: str, formats: list[str],
           widths: list[int] | None = None, suffix: str = "") -> list[str]:
    """Write every width/format derivative for one image."""
    widths = widths or WIDTHS
    written = []
    with Image.open(original) as source:
        # Honour the camera's orientation tag, then drop it: a rotated image
        # with a stale EXIF flag gets re-rotated by some browsers.
        source = ImageOps.exif_transpose(source)
        source = source.convert("RGB")

        for width in widths:
            if width > source.width:
                # Never upscale. A smaller original simply stops earlier.
                continue
            height = round(source.height * width / source.width)
            resized = source.resize((width, height), Image.LANCZOS)

            for fmt in formats:
                target = OUT / f"{slug}{suffix}-{width}.{fmt}"
                params = {"quality": QUALITY[fmt]}
                if fmt == "jpg":
                    params.update(format="JPEG", optimize=True, progressive=True)
                elif fmt == "webp":
                    params.update(format="WEBP", method=6)
                else:
                    params.update(format="AVIF")
                resized.save(target, **params)
                written.append(target.name)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path,
                        help="folder holding the original photographs")
    args = parser.parse_args()

    if not args.folder.is_dir():
        sys.exit(f"not a folder: {args.folder}")

    locations = load_locations()
    formats = formats_available()
    OUT.mkdir(parents=True, exist_ok=True)

    missing = []
    total = 0
    for location in locations:
        photo = find_original(args.folder, location, "photo")
        if photo is None:
            missing.append(f"{location['name']}: photograph {location['photo']} "
                           f"(or {location['slug']}.jpg)")
        else:
            written = derive(photo, location["slug"], formats)
            total += len(written)
            print(f"{location['name']:32s} {photo.name:44s} -> {len(written)} files")

        card = find_original(args.folder, location, "card")
        if card is None:
            missing.append(f"{location['name']}: card {location['card']} "
                           f"(or {location['slug']}-card.jpg)")
        else:
            written = derive(card, location["slug"], formats,
                             widths=CARD_WIDTHS, suffix="-card")
            total += len(written)
            print(f"{'':32s} {card.name:44s} -> {len(written)} files (card)")

    if missing:
        print("\nMISSING ORIGINALS")
        for line in missing:
            print(f"- {line}")
        print("\nNo photograph was substituted. Add the missing originals and "
              "run this again.")
        return 1

    print(f"\nwrote {total} files to {OUT.relative_to(ROOT)}")
    print(f"photographs: {', '.join(formats)} at "
          f"{', '.join(str(w) for w in WIDTHS)}px")
    print(f"cards: {', '.join(formats)} at "
          f"{', '.join(str(w) for w in CARD_WIDTHS)}px")
    return 0


if __name__ == "__main__":
    sys.exit(main())
