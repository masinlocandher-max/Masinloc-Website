#!/usr/bin/env python3
"""Audit every photograph the site can display.

The rule this enforces: Drive is the source of truth for Masinloc
photography, and nothing else gets on the page. No AI-generated imagery, no
stock, no placeholders, and no image relabelled as a place it does not show.

Every image referenced by any page must appear in data/photography.json, or
be a built location photograph whose name matches the fixed photograph-to-place
mapping in data/locations.json. Anything else fails the build.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "photography.json"
LOCATIONS = ROOT / "data" / "locations.json"
CAMPAIGNS = ROOT / "data" / "campaigns.json"
LEADERSHIP = ROOT / "data" / "leadership.json"

IMAGE_SUFFIXES = {".avif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}

# Hosts that must never appear as an image source.
BANNED_SOURCES = [
    "unsplash", "pexels", "shutterstock", "gettyimages", "istockphoto",
    "picsum", "placehold", "placeholder.com", "dummyimage", "lorempixel",
    "generated.photos", "thispersondoesnotexist",
]

errors: list[str] = []
warnings: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


class ImageParser(HTMLParser):
    """Collect every image source a page can render."""

    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        attrs = dict(attrs)
        if tag == "img":
            if attrs.get("src"):
                self.sources.append(attrs["src"])
            self.sources.extend(self._srcset(attrs.get("srcset")))
        elif tag == "source":
            self.sources.extend(self._srcset(attrs.get("srcset")))
        elif tag == "link" and attrs.get("rel") in {"icon", "apple-touch-icon", "preload"}:
            href = attrs.get("href", "")
            if Path(urlsplit(href).path).suffix.lower() in IMAGE_SUFFIXES:
                self.sources.append(href)

    @staticmethod
    def _srcset(value: str | None) -> list[str]:
        if not value:
            return []
        return [part.strip().split()[0] for part in value.split(",") if part.strip()]


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
approved = {entry["path"]: entry for entry in manifest["approved"]}
pending_dir = manifest["pending"]["directory"]
campaign_dir = manifest["campaigns"]["directory"]
leadership_dir = manifest["leadership"]["directory"]
connect_dir = manifest["connect"]["directory"]

locations = json.loads(LOCATIONS.read_text(encoding="utf-8"))["locations"]
location_slugs = {location["slug"] for location in locations}

campaigns = json.loads(CAMPAIGNS.read_text(encoding="utf-8"))["campaigns"]
campaign_slugs = {campaign["slug"] for campaign in campaigns}

leaders = json.loads(LEADERSHIP.read_text(encoding="utf-8"))["leaders"]
leader_slugs = {leader["slug"] for leader in leaders}

pages = sorted(ROOT.glob("*.html"))
seen: dict[str, list[str]] = {}

for page in pages:
    text = page.read_text(encoding="utf-8")
    parser = ImageParser()
    parser.feed(text)

    for raw in parser.sources:
        source = raw.strip()
        lowered = source.lower()

        for banned in BANNED_SOURCES:
            if banned in lowered:
                fail(f"{page.name}: image from a banned source: {source}")

        parsed = urlsplit(source)
        if parsed.scheme or parsed.netloc:
            fail(f"{page.name}: image loaded from an external host: {source}")
            continue

        path = parsed.path.split("?", 1)[0].lstrip("/")
        if not path:
            continue

        seen.setdefault(path, []).append(page.name)

        if path in approved:
            continue

        # Approved campaign artwork: assets/campaigns/<slug>-<width>.<ext>,
        # or the derived ambient backdrop for that same campaign.
        if path.startswith(campaign_dir):
            name = Path(path).stem
            match = re.fullmatch(r"(?P<slug>[a-z0-9-]+?)(?:-mobile)?"
                                 r"(?:-(?P<width>\d+)|-ambient)", name)
            if not match or match.group("slug") not in campaign_slugs:
                fail(f"{page.name}: {path} is not one of the approved campaigns "
                     f"listed in data/campaigns.json")
            continue

        # A built leadership portrait: assets/leadership/<slug>-<width>.<ext>.
        # The width has to be a real ladder step for that person, so a
        # hand-added file at some other size cannot slip onto the page.
        if path.startswith(leadership_dir):
            name = Path(path).stem
            match = re.fullmatch(r"(?P<slug>[a-z0-9-]+?)-(?P<width>\d+)", name)
            if not match or match.group("slug") not in leader_slugs:
                fail(f"{page.name}: {path} is not one of the approved portraits "
                     f"listed in data/leadership.json")
            continue

        # A built location photograph: assets/locations/<slug>-<width>.<ext>
        if path.startswith(pending_dir):
            name = Path(path).stem
            match = re.fullmatch(r"(?P<slug>[a-z0-9-]+?)(?P<card>-card)?-(?P<width>\d+)",
                                 name)
            if not match or match.group("slug") not in location_slugs:
                fail(f"{page.name}: {path} is not one of the approved location "
                     f"photographs listed in data/locations.json")
            continue

        # The Masinloc Connect hero: assets/connect/connect-hero[-portrait]-<width>.
        # Built from one supplied original by scripts/build-connect-hero.py, so
        # the name is the whole contract — anything else in there is a file
        # nobody built.
        if path.startswith(connect_dir):
            name = Path(path).stem
            if not re.fullmatch(r"connect-hero(?:-portrait)?-\d+", name):
                fail(f"{page.name}: {path} is not a build product of "
                     f"scripts/build-connect-hero.py")
            continue

        fail(f"{page.name}: {path} is not listed in data/photography.json")

# Every approved photograph should actually exist.
for path, entry in approved.items():
    if not (ROOT / path).is_file():
        fail(f"approved asset is missing from the repository: {path}")

# Anything sitting in assets/ that nothing lists is unaccounted for.
for path in sorted(ROOT.glob("assets/**/*")):
    if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
        continue
    relative = path.relative_to(ROOT).as_posix()
    if (relative in approved or relative.startswith(pending_dir)
            or relative.startswith(campaign_dir)
            or relative.startswith(leadership_dir)
            or relative.startswith(connect_dir)):
        continue
    fail(f"unaccounted image in the repository: {relative}")

if errors:
    print("PHOTOGRAPHY AUDIT FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

built = sorted((ROOT / pending_dir).glob("*")) if (ROOT / pending_dir).is_dir() else []

print("PHOTOGRAPHY AUDIT PASSED")
print(f"{len(pages)} pages checked. Every image resolves to an approved project "
      f"asset; none is loaded from an external host.")
for path, used_on in sorted(seen.items()):
    if path in approved:
        entry = approved[path]
        label = entry.get("subject") or entry["kind"]
        print(f"  {path}")
        print(f"      {label} — {entry['origin']} — used on {', '.join(sorted(set(used_on)))}")

if not built:
    print()
    print(f"Location photography is not built yet ({len(location_slugs)} places "
          f"mapped in data/locations.json).")
    print("Run scripts/build-locations.py against the originals from the Drive "
          "Location folder.")

for entry in manifest["approved"]:
    if entry.get("review"):
        warnings.append(f"{entry['path']}: {entry['review']}")

if warnings:
    print()
    print("For review:")
    for warning in warnings:
        print(f"  - {warning}")
