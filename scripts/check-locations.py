#!/usr/bin/env python3
"""Validate the Masinloc locations experience.

The photograph-to-place mapping is fixed by the project. The failure this
guards against is a photograph drifting onto the wrong place, or a location
quietly appearing that nobody approved. It checks that data/locations.json,
destinations.html and the built photography all agree.

Photography is a build output. Until scripts/build-locations.py has run
against the original files, the page is reported as pending rather than
failed — but a partial build is a hard failure, because half a gallery is
worse than none.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "locations.json"
PAGE = ROOT / "destinations.html"
ASSETS = ROOT / "assets" / "locations"

WIDTHS = [640, 1024, 1600, 2400]
REQUIRED_FORMATS = ["webp", "jpg"]      # AVIF is an enhancement, not a floor.

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


if not DATA.is_file():
    sys.exit(f"missing {DATA.relative_to(ROOT)}")

payload = json.loads(DATA.read_text(encoding="utf-8"))
locations = payload.get("locations") or []

if not locations:
    fail("data/locations.json lists no locations")

slugs = [location["slug"] for location in locations]
if len(set(slugs)) != len(slugs):
    fail("duplicate slugs in data/locations.json")

for location in locations:
    for key in ("slug", "name", "locality", "rhyme", "alt", "source"):
        if not str(location.get(key, "")).strip():
            fail(f"{location.get('slug', '?')}: missing '{key}'")

# Every photograph belongs to exactly one place.
sources = [location["source"] for location in locations]
if len(set(sources)) != len(sources):
    fail("the same photograph is mapped to more than one location")

# --- the page agrees with the mapping ---------------------------------------
if not PAGE.is_file():
    fail("destinations.html has not been generated; run scripts/build-destinations.py")
else:
    page_text = PAGE.read_text(encoding="utf-8")
    rendered = " ".join(re.sub(r"<[^>]+>", " ", page_text).split())

    for location in locations:
        slug = location["slug"]
        if f'id="{slug}"' not in page_text:
            fail(f"destinations.html has no section for {location['name']} ({slug})")
        if location["name"] not in rendered:
            fail(f"destinations.html does not name {location['name']}")
        if location["locality"] not in rendered:
            fail(f"{location['name']}: locality '{location['locality']}' is not on the page")
        if location["alt"] not in page_text:
            fail(f"{location['name']}: the approved alt text is not on the page")
        # The alt text names the place, so a photograph swapped onto the wrong
        # section shows up here rather than in front of a reader.
        section = page_text.split(f'id="{slug}"', 1)[1].split("</section>", 1)[0]
        if f"{slug}-1600.jpg" not in section:
            fail(f"{location['name']}: section does not use its own photograph")

    stray = re.findall(r'assets/locations/([a-z0-9-]+)-\d+\.(?:avif|webp|jpg)', page_text)
    unknown = sorted({name for name in stray if name not in slugs})
    if unknown:
        fail(f"destinations.html references photography for unlisted locations: "
             f"{', '.join(unknown)}")

# --- built photography -------------------------------------------------------
expected = {
    f"{location['slug']}-{width}.{fmt}"
    for location in locations
    for width in WIDTHS
    for fmt in REQUIRED_FORMATS
}
present = {path.name for path in ASSETS.glob("*")} if ASSETS.is_dir() else set()
built = expected & present

if errors:
    print("LOCATIONS CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

if not built:
    print("LOCATIONS CHECK PENDING")
    print(f"{len(locations)} locations are mapped and destinations.html is generated,")
    print("but the photography has not been built yet.")
    print()
    print("  python3 scripts/build-locations.py <folder-with-originals>")
    print()
    print("The folder needs the original files named in data/locations.json.")
    print("The page stays unlinked from the site until they are in place.")
    sys.exit(0)

missing = sorted(expected - present)
if missing:
    print("LOCATIONS CHECK FAILED")
    print(f"- photography is only partly built: {len(missing)} of {len(expected)} "
          f"files are missing, starting with {missing[0]}")
    print("  Re-run scripts/build-locations.py against the full set of originals.")
    sys.exit(1)

print("LOCATIONS CHECK PASSED")
print(f"{len(locations)} locations; every one carries its approved photograph, "
      f"locality and alt text.")
print(f"{len(present)} image files built across {len(WIDTHS)} widths.")
