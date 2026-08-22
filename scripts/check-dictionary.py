#!/usr/bin/env python3
"""Validate the Sambal Tina dictionary data and public presentation.

Internal provenance remains strict even though the public page intentionally
uses a cleaner community-facing vocabulary. Data QA must never be weakened just
because source mechanics are no longer shown to visitors.
"""
from __future__ import annotations

import json
import re
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
for key in ("title", "authority", "rule"):
    if not source.get(key):
        fail(f"internal source block is missing '{key}'")

compilation = payload.get("compilation") or {}
for key in ("title", "compiler", "work", "rights"):
    if not compilation.get(key):
        fail(f"compilation block is missing '{key}'")

PAGE_CREDIT = compilation.get("compiler", "")
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
    if entry[CONF] <= 2 and not str(entry[PAGES]).strip():
        missing_pages += 1

if empty_headword:
    fail(f"{empty_headword} entries have no headword")
if missing_confidence:
    fail(f"{missing_confidence} entries have no usable confidence rating (1-5)")
if bad_status:
    fail(f"{bad_status} entries point at a status outside the status table")
if missing_pages:
    fail(f"{missing_pages} internally flagged entries have no provenance page")

phrasebook = payload.get("phrasebook") or []
if not phrasebook:
    fail("phrasebook is empty")

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
            fail(f"phrasebook word {word['tina']!r} is only confidence {entry[CONF]}")

PAGE = ROOT / "sambal-tina.html"
if PAGE.is_file():
    page_text = PAGE.read_text(encoding="utf-8")
    rendered = " ".join(re.sub(r"<[^>]+>", " ", page_text).split())
    rendered_lower = rendered.lower()

    if f"{len(entries):,}" not in rendered:
        fail(f"sambal-tina.html does not state the core entry count ({len(entries):,})")
    if PAGE_CREDIT and PAGE_CREDIT.removeprefix("The ") not in rendered:
        fail(f"sambal-tina.html does not credit the compiler ({PAGE_CREDIT})")

    public_source_footprints = (
        "archive page",
        "archival layer",
        "printed index",
        "source status",
        "page reference",
        "transcribed entries",
        "download archive",
    )
    for phrase in public_source_footprints:
        if phrase in rendered_lower:
            fail(f"public dictionary copy exposes internal source mechanics: {phrase!r}")

    for required_phrase in (
        "we gather it",
        "we verify it",
        "we improve it together",
        "contributors",
        "send a correction",
    ):
        if required_phrase not in rendered_lower:
            fail(f"public dictionary copy is missing required community language: {required_phrase!r}")
else:
    fail("missing sambal-tina.html")

if errors:
    print("DICTIONARY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

flagged = sum(1 for entry in entries if entry[CONF] <= 2)
words = sum(len(group["words"]) for group in phrasebook)
print("DICTIONARY CHECK PASSED")
print(f"{len(entries)} core entries retain internal confidence and provenance metadata.")
print(f"{flagged} internally flagged entries retain the data needed for verification.")
print(f"{words} phrasebook words across {len(phrasebook)} groups remain publication-safe.")
