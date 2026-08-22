#!/usr/bin/env python3
"""Validate the user-confirmed living Sambal Tina data layer.

The public dictionary intentionally keeps source mechanics out of the reader UI,
but internal validation still protects the separate living-usage layer, known
archive variants, meanings, and the rule against invented archive citations.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVING = ROOT / "data" / "sambal-tina-living.json"
ARCHIVE = ROOT / "data" / "sambal-tina.json"
PAGE = ROOT / "sambal-tina.html"

EXPECTED = {
    "lanom": ("water", "tubig"),
    "ayama": ("crab / crabs", "alimasag / alimango"),
    "talacaca": ("sibling", "kapatid"),
    "nakabayo": ("young man", "binata"),
    "masitas": ("plant / plants", "halaman / mga halaman"),
    "cabatwan": ("river", "ilog"),
    "oybon": ("egg", "itlog"),
    "damolag": ("carabao", "kalabaw"),
    "matibya": ("red", "pula"),
    "labay-labay": ("like very much / love very much", "gustong-gusto"),
    "macicwa": ("to ask for", "manghingi"),
    "igwa": ("to put / place", "ilagay"),
    "awlo": ("day / sun", "araw"),
    "ambay": ("sea", "dagat"),
    "mabanglo": ("fragrant", "mabango"),
    "mabata": ("smelly", "mabaho"),
    "mahiban": ("big / large", "malaki"),
    "macalog": ("small", "maliit"),
}

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


if not LIVING.is_file():
    fail("missing data/sambal-tina-living.json")
else:
    payload = json.loads(LIVING.read_text(encoding="utf-8"))
    if payload.get("source_layer") != "User-confirmed living usage":
        fail("living data must identify its internal source layer")
    rule = str(payload.get("editorial_rule") or "")
    if "separate from archival transcription" not in rule:
        fail("living data is missing the archive/living separation rule")

    entries = payload.get("entries") or []
    by_word = {str(item.get("tina") or "").strip(): item for item in entries}
    if len(entries) != len(by_word):
        fail("living data contains duplicate headwords")
    if set(by_word) != set(EXPECTED):
        missing = sorted(set(EXPECTED) - set(by_word))
        extra = sorted(set(by_word) - set(EXPECTED))
        if missing:
            fail(f"missing living headwords: {', '.join(missing)}")
        if extra:
            fail(f"unexpected living headwords: {', '.join(extra)}")

    for word, (english, filipino) in EXPECTED.items():
        item = by_word.get(word)
        if not item:
            continue
        if item.get("en") != english:
            fail(f"{word}: English meaning changed: {item.get('en')!r}")
        if item.get("fil") != filipino:
            fail(f"{word}: Filipino meaning changed: {item.get('fil')!r}")
        if "User-confirmed" not in str(item.get("verification") or ""):
            fail(f"{word}: missing internal user-confirmed verification")
        if not str(item.get("archive_relation") or "").strip():
            fail(f"{word}: missing internal archive relationship/provenance note")
        if "pages" in item and str(item.get("pages") or "").strip():
            fail(f"{word}: living usage must not invent an archive page citation")

    if "ayamd" not in str(by_word.get("ayama", {}).get("archive_relation", "")):
        fail("ayama must preserve its internal relationship to archival ayamd")
    if "kabatwan" not in str(by_word.get("cabatwan", {}).get("archive_relation", "")):
        fail("cabatwan must preserve its internal relationship to archival kabatwan")

if ARCHIVE.is_file():
    archive = json.loads(ARCHIVE.read_text(encoding="utf-8"))
    archive_words = {str(entry[0]).strip() for entry in archive.get("entries", []) if entry}
    for word in ("lanom", "damolag", "awlo", "ambay"):
        if word not in archive_words:
            fail(f"expected archive-backed living form missing from archive: {word}")
    for variant in ("ayamd", "kabatwan"):
        if variant not in archive_words:
            fail(f"archival variant must remain intact: {variant}")
else:
    fail("missing data/sambal-tina.json")

if PAGE.is_file():
    page = PAGE.read_text(encoding="utf-8")
    for required in (
        "sambal-tina-living.css",
        "sambal-tina-living.js",
        "Community-confirmed",
        "matibya",
    ):
        if required not in page:
            fail(f"sambal-tina.html is missing the community living-layer hook: {required}")
    forbidden_public = ("archive p.", "printed index", "source page reference")
    lowered = page.lower()
    for phrase in forbidden_public:
        if phrase in lowered:
            fail(f"public page exposes internal source mechanics: {phrase}")
else:
    fail("missing sambal-tina.html")

if errors:
    print("LIVING SAMBAL CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("LIVING SAMBAL CHECK PASSED")
print(f"{len(EXPECTED)} user-confirmed living forms remain protected internally.")
print("Archive variants and provenance are retained in data while the public UI stays clean.")
