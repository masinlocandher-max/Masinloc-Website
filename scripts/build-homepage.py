#!/usr/bin/env python3
"""Validate the canonical homepage without rewriting it.

Why this file no longer generates ``index.html``
-----------------------------------------------
The homepage was redesigned directly in ``index.html`` during the mobile-first
work. The older generator was not updated with that redesign, so running it
could silently replace the production homepage with obsolete markup.

``index.html`` is now the canonical homepage source. This script intentionally
keeps the historical command name so old notes, shell history, or automation
cannot accidentally destroy the current design. Running it is safe: it performs
read-only checks and never writes files.

Usage
-----
    python3 scripts/build-homepage.py
    python3 scripts/build-homepage.py --check

Both commands are equivalent and read-only. There is deliberately no write
mode. If the homepage is ever generated again, build a new generator from the
current mobile-first page and add a reproduction test before enabling writes.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
LOCATIONS = ROOT / "data" / "locations.json"


class HomepageValidationError(RuntimeError):
    pass


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate() -> list[str]:
    errors: list[str] = []

    require(INDEX.is_file(), "index.html is missing", errors)
    if errors:
        return errors

    page = INDEX.read_text(encoding="utf-8")

    # These are the non-negotiable fingerprints of the current mobile-first
    # homepage. They specifically guard against the old generated page being
    # restored by accident.
    required_fragments = {
        'viewport-fit=cover': "mobile safe-area viewport support is missing",
        'homepage-v2.css': "the current homepage-v2 stylesheet is not linked",
        '<body class="home">': "the canonical homepage body hook is missing",
        'Masinloc, connected.': "the current hero headline is missing",
        'To the world.': "the current hero continuation is missing",
        'Explore Masinloc Connect': "the primary Masinloc Connect CTA is missing",
        'Open Help Desk': "the Help Desk CTA is missing",
        'One community platform': "the current platform-intro section is missing",
        'The website tells you. The app helps you do.': "the website/app positioning block is missing",
        'https://www.masinloc-zambales.com/': "the canonical production domain is missing",
    }
    for fragment, message in required_fragments.items():
        require(fragment in page, message, errors)

    required_routes = (
        'href="discover/index.html"',
        'href="sambal-tina.html"',
        'href="marketplace.html"',
        'href="jobs.html"',
        'href="verified-history.html"',
        'href="leadership.html"',
        'href="connect.html"',
        'href="emergency/"',
    )
    for route in required_routes:
        require(route in page, f"required homepage route missing: {route}", errors)

    # The current homepage deliberately features real Masinloc photography.
    # Validate the slugs against the same location dataset used elsewhere so a
    # typo cannot create a dead destination while keeping this script read-only.
    try:
        location_data = json.loads(LOCATIONS.read_text(encoding="utf-8"))
        known_slugs = {item["slug"] for item in location_data.get("locations", [])}
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        errors.append(f"could not read location data: {exc}")
        known_slugs = set()

    featured_slugs = (
        "san-salvador-island",
        "masinloc-baywalk",
        "coto-kidz-pool",
    )
    for slug in featured_slugs:
        require(slug in known_slugs, f"featured homepage location is absent from data/locations.json: {slug}", errors)
        require(f"destinations.html#{slug}" in page, f"featured homepage destination link is missing: {slug}", errors)

    # Prevent a future edit from quietly turning this command back into a
    # destructive writer without deliberately replacing this validator.
    require("OUT.write_text" not in page, "unexpected generator marker found in index.html", errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only validation for the canonical Masinloc homepage."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Explicitly request validation. This is also the default behavior.",
    )
    args = parser.parse_args()
    _ = args  # The flag documents intent; validation is always read-only.

    errors = validate()
    if errors:
        print("Homepage validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Homepage validation passed. index.html is canonical; no files were written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
