#!/usr/bin/env python3
"""Validate the published Sambal Tina data.

The dictionary is the one place on this site where a silent data regression
would be invisible in review and damaging in public: it documents a language
with few written sources. These checks assert the shape of the file and, above
all, that provenance survives the build. An entry without a confidence rating
or a page reference is an entry a reader cannot check.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "sambal-tina.json"
EXPECTED_COLUMNS = ["tina", "pos", "en", "fil", "pages", "status", "conf", "notes"]
MIN_ENTRIES = 5000
TINA, POS, EN, FIL, PAGES, STATUS, CONF, NOTES = range(8)

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


if not DATA.is_file():
    print("DICTIONARY CHECK FAILED")
    print(f"- missing {DATA.relative_to(ROOT)}")
    raise SystemExit(1)

payload = json.loads(DATA.read_text(encoding="utf-8"))

if payload.get("columns") != EXPECTED_COLUMNS:
    fail(f"column order changed: {payload.get('columns')}")

source = payload.get("source") or {}
for key in ("title", "year", "authority", "rule"):
    if not source.get(key):
        fail(f"source block is missing '{key}'; the published data must name its authority")

statuses = payload.get("statuses") or []
entries = payload.get("entries") or []

if len(entries) < MIN_ENTRIES:
    fail(f"only {len(entries)} entries; expected at least {MIN_ENTRIES}")

missing_confidence = 0
missing_pages = 0
bad_status = 0
empty_headword = 0

for entry in entries:
    if len(entry) != len(EXPECTED_COLUMNS):
        fail(f"entry has {len(entry)} fields, expected {len(EXPECTED_COLUMNS)}: {entry[:3]}")
        break
    if not str(entry[TINA]).strip():
        empty_headword += 1
    if not isinstance(entry[CONF], int) or not 1 <= entry[CONF] <= 5:
        missing_confidence += 1
    if not isinstance(entry[STATUS], int) or not 0 <= entry[STATUS] < len(statuses):
        bad_status += 1
    # A flagged entry is the one a reader most needs to verify, so it must say
    # which printed page to look at.
    if entry[CONF] <= 2 and not str(entry[PAGES]).strip():
        missing_pages += 1

if empty_headword:
    fail(f"{empty_headword} entries have no headword")
if missing_confidence:
    fail(f"{missing_confidence} entries have no usable confidence rating (1-5)")
if bad_status:
    fail(f"{bad_status} entries point at a status outside the status table")
if missing_pages:
    fail(f"{missing_pages} flagged entries have no page reference to check against")

phrasebook = payload.get("phrasebook") or []
if not phrasebook:
    fail("phrasebook is empty; the visitor vocabulary should not disappear silently")

by_headword = {entry[TINA]: entry for entry in entries}
for group in phrasebook:
    if not group.get("title") or not group.get("words"):
        fail(f"phrasebook group is incomplete: {group.get('title')!r}")
        continue
    for word in group["words"]:
        entry = by_headword.get(word.get("tina"))
        if entry is None:
            fail(f"phrasebook word {word.get('tina')!r} is not in the dictionary")
        elif entry[CONF] < 4:
            fail(f"phrasebook word {word['tina']!r} is only confidence {entry[CONF]}; "
                 f"the visitor list must stay at 4 or better")

# The page states these counts in prose. Prose drifts silently; assert it.
PAGE = ROOT / "sambal-tina.html"
if PAGE.is_file():
    page_text = PAGE.read_text(encoding="utf-8")
    counts = {
        "well supported": sum(1 for entry in entries if entry[CONF] >= 4),
        "readable": sum(1 for entry in entries if entry[CONF] == 3),
        "needing a source check": sum(1 for entry in entries if entry[CONF] <= 2),
        "total": len(entries),
    }
    for label, value in counts.items():
        if f"{value:,}" not in page_text:
            fail(f"sambal-tina.html does not state the {label} count ({value:,}); "
                 f"the page copy has drifted from the data")

if errors:
    print("DICTIONARY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

flagged = sum(1 for entry in entries if entry[CONF] <= 2)
words = sum(len(group["words"]) for group in phrasebook)
print("DICTIONARY CHECK PASSED")
print(f"{len(entries)} entries, every one carrying a confidence rating and source status.")
print(f"{flagged} entries flagged for a source check, each with a page reference.")
print(f"{words} phrasebook words across {len(phrasebook)} groups, all confidence 4 or better.")
