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
    # Script and style bodies are not copy. JSON-LD in particular is machine
    # metadata and is validated by scripts/check-seo.py instead; leaving it in
    # here would judge structured data by rules written for prose.
    readable = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", page_text)
    rendered = " ".join(re.sub(r"<[^>]+>", " ", readable).split())
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

# NO UNCONFIRMED READING IS PUBLISHED.
#
# Some entries came off the printed page with glyphs the transcription could
# not resolve — `ab6h`, `aspil6`, `alagaw6n` — carrying confidence 2 and the
# status "NEEDS VISUAL SOURCE CHECK". They are held out of the published
# collection until somebody confirms them against the archive page, because a
# dictionary is quoted: a damaged reading left in public long enough starts
# being cited back as the real spelling.
#
# This is checked on the DATA FILE rather than on the page, because
# data/sambal-tina.json is fetched by the browser and vercel.json gives /data/
# its own Cache-Control header — it is a public URL that anybody can open.
# Filtering these out in JavaScript would leave them one view-source away,
# which is not hiding anything.
UNCERTAIN_AT_OR_BELOW = 2
uncertain = [entry for entry in entries if entry[CONF] <= UNCERTAIN_AT_OR_BELOW]
for entry in uncertain[:5]:
    fail(f"unconfirmed reading {entry[0]!r} is in the published dictionary "
         f"({entry[NOTES] or 'no note'}); data/sambal-tina.json is a public URL. "
         f"Run: python3 scripts/withhold-uncertain.py")
if len(uncertain) > 5:
    fail(f"…and {len(uncertain) - 5} more unconfirmed readings are published")

# The withheld set is kept, not deleted: it seeds the editors' review queue.
withheld_file = ROOT / "supabase" / "seed" / "sambal-tina-uncertain.json"
withheld_count = 0
if withheld_file.is_file():
    withheld_count = len(json.loads(withheld_file.read_text(encoding="utf-8"))["entries"])
    ignore = ROOT / ".vercelignore"
    ignored = ignore.read_text(encoding="utf-8") if ignore.is_file() else ""
    if "supabase/" not in ignored:
        fail("supabase/seed/sambal-tina-uncertain.json holds the withheld readings "
             "but .vercelignore does not exclude supabase/ — taking them out of "
             "data/ and then serving them from another path achieves nothing")

# EVERY COUNT ON THE SITE IS THE DATASET'S COUNT.
#
# Two totals are true at once and they are easy to confuse. The transcription
# off the printed pages produced 5,222 readings; 97 of those are unresolved and
# withheld above, so the collection the site actually serves is 5,125. A page
# may say the archive holds the larger number — it does — but no page may
# claim the site publishes, exposes or offers it, and the figure printed on
# the dictionary's own stat row is the dataset's length or it is wrong.
PUBLISHED = f"{len(entries):,}"
MASTER = f"{len(entries) + withheld_count:,}"

if PAGE.is_file():
    stat = re.search(r"<dt>Entries</dt><dd>([^<]+)</dd>", PAGE.read_text(encoding="utf-8"))
    if not stat:
        fail("sambal-tina.html no longer prints an entry count in its stat row")
    elif stat.group(1) != PUBLISHED:
        fail(f"sambal-tina.html states {stat.group(1)} entries; "
             f"data/sambal-tina.json holds {PUBLISHED}")

# A count is a claim about what a reader can open, so the verb decides whether
# it is honest. "holds" describes the archive; the rest describe this website.
PUBLISHING_VERB = re.compile(
    rf"\b(publishes|published|exposes|offers|serves|carries|contains|keeps|has|with)\b"
    rf"[^.<]{{0,40}}{re.escape(MASTER)}")
if withheld_count:
    for page in sorted(ROOT.glob("*.html")) + sorted(ROOT.glob("discover/*.html")) \
            + sorted(ROOT.glob("bulletin/*.html")) + sorted(ROOT.glob("mabayani/*.html")):
        hit = PUBLISHING_VERB.search(page.read_text(encoding="utf-8"))
        if hit:
            fail(f"{page.relative_to(ROOT)} says the site {hit.group(0)!r}, but "
                 f"{MASTER} is the transcription total and only {PUBLISHED} are "
                 f"published — {withheld_count} readings are withheld for review")

# The public page must not offer a filter for entries it no longer carries.
if PAGE.is_file() and 'data-filter="check"' in PAGE.read_text(encoding="utf-8"):
    fail('sambal-tina.html still offers the "Review in progress" filter, but no '
         'entry below confidence 3 is published for it to show')

if errors:
    print("DICTIONARY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

words = sum(len(group["words"]) for group in phrasebook)
print("DICTIONARY CHECK PASSED")
print(f"{len(entries)} published entries retain their confidence and provenance metadata.")
print(f"No unconfirmed reading is published: nothing below confidence "
      f"{UNCERTAIN_AT_OR_BELOW + 1} is in data/sambal-tina.json, which is a public URL.")
print(f"{withheld_count} withheld reading(s) wait in the editors' review queue, "
      f"outside the deployment.")
print(f"{words} phrasebook words across {len(phrasebook)} groups remain publication-safe.")
