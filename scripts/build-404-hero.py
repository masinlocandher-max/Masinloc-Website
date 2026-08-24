#!/usr/bin/env python3
"""Build the 404 page's artwork from the approved original.

The original comes from Drive → Masinloc Website Asset → 404, and like the
Connect and Discover heroes it arrives finished: Binabayani performers
photographed at a fiesta, darkened, with the official logo centred, the
tricolour rule beneath it, its own message, and the footer strip.

So, as everywhere else in this repository: nothing is cropped. The artwork is
1536x1024 and the page is built around that ratio rather than the ratio being
forced onto the artwork. A crop here would cut the logo or the footer.

One thing about this file is worth writing down, because it decided the layout.
The message baked into the artwork is "Maintenance on going / We are currently
improving your experience. We'll be back soon." That is not what a 404 means. A
visitor who followed a stale link has not arrived during maintenance.

The page therefore shows the artwork whole and puts its own message underneath,
where the two agree rather than compete: the site says this corner is not built
yet, which is true both of a missing page and of a site still being assembled.
What the artwork cannot do on its own is give somebody somewhere to go, and the
links below it do that.

Usage
-----
    python3 scripts/build-404-hero.py [folder-with-original]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "notfound"
STEM = "notfound"
ORIGINAL = "404-hero.png"

WIDTHS = [640, 960, 1280, 1536]
QUALITY = {"avif": 55, "webp": 82, "jpg": 86}


def build(originals: Path) -> list[int]:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required: pip install Pillow")

    source = originals / ORIGINAL
    if not source.is_file():
        sys.exit(f"missing original: {source}")

    OUT.mkdir(parents=True, exist_ok=True)
    built = []
    with Image.open(source) as image:
        image = image.convert("RGB")
        print(f"native {image.width}x{image.height}, ratio "
              f"{image.width / image.height:.3f} — kept, not cropped")
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
                                     optimize=True, progressive=True, subsampling=0)
                    else:
                        resized.save(target, ext.upper(), quality=QUALITY[ext])
                except (OSError, KeyError, ValueError) as err:
                    if ext == "avif":
                        print(f"note: no AVIF encoder ({err})")
                        continue
                    raise
            built.append(width)
    return built


def main() -> int:
    if len(sys.argv) > 1:
        widths = build(Path(sys.argv[1]).expanduser())
        print(f"widths built: {widths}")
    if OUT.is_dir() and any(OUT.glob(f"{STEM}-*.jpg")):
        total = sum(p.stat().st_size for p in OUT.glob(f"{STEM}-*")) / 1024
        print(f"{len(list(OUT.glob(f'{STEM}-*')))} files, {total:.0f} KB total")
        return 0
    print("nothing built yet")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
