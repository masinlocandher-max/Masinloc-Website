#!/usr/bin/env python3
"""Build Marketplace business logos from the approved originals.

From Drive -> Masinloc Website Asset -> Marketplace Logo. These are brand
marks a business supplied for publication, not photographs, and that changes
two things about how they are handled.

NOTHING IS CROPPED. A logo is somebody's finished artwork: it has its own
ground, its own margins and its own lockup, and trimming any of that produces
a mark the business did not design. So each one keeps its native square and is
placed contained rather than covered. That is the same rule the branded heroes
in this repository already follow, for the same reason.

NOTHING IS UPSCALED. The ladder stops at the original's own width.

WHY A LOGO IS READ BEFORE IT IS PUBLISHED

Adaler's Grazing Delights supplied a logo with two mobile numbers set into the
artwork: "ZAMBALES, 0950-417-2222/ 0909-184-6669". One of those is the number
this site was explicitly asked to stop publishing; the other had never appeared
in the submission data at all.

A number printed inside an image is invisible to every text-based check here —
check-marketplace-privacy.py reads markup, not pixels — but it is not invisible
to a reader, and image search and OCR index it perfectly well. Publishing it
would undo the removal it was asked to make, in a form nothing would notice.

So a logo is not published on the strength of being in the folder. It is looked
at first, and one carrying contact details set into the artwork stays out until
somebody decides. That decision belongs to the business and the site owner, not
to a build script, which is why this refuses rather than crops: cropping the
strip away would also take "ZAMBALES" and the tagline with it, and would hand
back a mark they did not design.

Usage
-----
    python3 scripts/build-marketplace-logos.py <folder-with-originals>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "marketplace"
MANIFEST = ROOT / "data" / "marketplace-logos.json"

WIDTHS = [160, 320, 480, 640]
QUALITY = {"avif": 58, "webp": 84, "jpg": 88}

# Originals, and whether the artwork itself is clear to publish.
#
# `blocked` is not a build failure. It records a decision that has not been
# made yet, so the file can sit here fully prepared and be released by deleting
# one line once somebody answers.
LOGOS = {
    "diwan-coffee": {
        "file": "Diwan.JPG",
        "alt": "Diwan Coffee logo: a stylised coffee cup with a coffee bean and rising steam",
    },
    "adalers-grazing-delights": {
        "file": "Adalers.JPG",
        "alt": "Adaler's Grazing Delights logo: an orange pretzel above the business name",
        "blocked": ("the artwork has two mobile numbers set into it "
                    "(ZAMBALES, 0950-417-2222/ 0909-184-6669), and this site was "
                    "asked to publish no phone numbers"),
    },
}


def build(originals: Path) -> dict:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required: pip install Pillow")

    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}

    for slug, spec in LOGOS.items():
        if spec.get("blocked"):
            print(f"{slug}: HELD BACK — {spec['blocked']}")
            continue

        source = originals / spec["file"]
        if not source.is_file():
            print(f"{slug}: missing original {source}")
            continue

        widths: list[int] = []
        with Image.open(source) as image:
            image = image.convert("RGB")
            native = (image.width, image.height)
            for width in WIDTHS:
                if width > image.width:
                    continue
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.LANCZOS)
                for ext in ("avif", "webp", "jpg"):
                    target = OUT / f"{slug}-{width}.{ext}"
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
                widths.append(width)

        manifest[slug] = {
            "source": spec["file"],
            "alt": spec["alt"],
            "native": {"width": native[0], "height": native[1]},
            "ratio": round(native[0] / native[1], 4),
            "widths": widths,
        }
        print(f"{slug}: {native[0]}x{native[1]} native, widths {widths}")

    return manifest


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip().split("Usage")[0])
        held = [s for s, v in LOGOS.items() if v.get("blocked")]
        if held:
            print(f"held back: {', '.join(held)}")
        return 0 if OUT.is_dir() and any(OUT.glob("*.jpg")) else 1

    built = build(Path(sys.argv[1]).expanduser())
    if built:
        existing = {}
        if MANIFEST.is_file():
            existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
        existing.update(built)
        MANIFEST.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8")
        files = sorted(OUT.glob("*"))
        total = sum(p.stat().st_size for p in files) / 1024
        print(f"{len(files)} files, {total:.0f} KB total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
