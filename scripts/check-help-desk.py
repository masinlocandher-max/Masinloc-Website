#!/usr/bin/env python3
"""Guard the one page on this site that is allowed to publish phone numbers.

scripts/check-marketplace-privacy.py states the site-wide rule plainly: the
Marketplace publishes no phone number of any kind, because a business owner's
mobile is private data. The Help Desk is the deliberate exception — an
emergency number exists in order to be dialled — and an exception is only safe
while it stays narrow. That is what this file enforces:

  1. Every number rendered on help-desk.html is declared in data/help-desk.json.
     A digit that appears on the page and not in the data file means somebody
     hand-edited generated HTML, which is exactly how a wrong emergency number
     gets published.

  2. Every declared number actually reaches the page. A number silently dropped
     by a template change is a number a resident cannot call.

  3. Every tel: href matches the number printed beside it. A link that dials
     something other than what it displays is the worst failure this page has,
     because it fails silently and only under pressure.

  4. tel: links and Philippine mobile numbers appear on help-desk.html and
     nowhere else in the site's root pages. The exception does not spread.

  5. The page states that this site is not the municipal government and that
     nothing sent through it reaches these offices. Somebody who believes a
     message here summons help would wait for a response that is not coming.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "help-desk.json"
PAGE = ROOT / "help-desk.html"

problems: list[str] = []

# Philippine mobile numbers in the forms this site could plausibly render:
# 0917-123-4567, 0917 123 4567, 09171234567, +639171234567.
#
# Separators are allowed only at the real group boundaries. An earlier version
# permitted one between every digit, which made "0 0 0 6 0 3 3 0 0 0 6" inside
# an SVG path read as a phone number and failed the build on connect.html.
# Every PH mobile is 09xx / +639xx, so anchoring on the 9 costs nothing and
# removes the whole class of false positive.
PHONE = re.compile(r"(?:\+63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}")
TEL = re.compile(r'href="tel:([^"]+)"')


def digits(value: str) -> str:
    """Comparable form: last ten significant digits, however it was written."""
    bare = re.sub(r"\D", "", value)
    if bare.startswith("63"):
        bare = bare[2:]
    return bare.lstrip("0")


if not DATA.is_file():
    sys.exit("data/help-desk.json is missing — the Help Desk has no source of truth")
if not PAGE.is_file():
    sys.exit("help-desk.html has not been built — run scripts/build-help-desk.py")

spec = json.loads(DATA.read_text(encoding="utf-8"))
page = PAGE.read_text(encoding="utf-8")

declared: dict[str, str] = {}
for entry in spec["municipal"]:
    for number in entry["numbers"]:
        declared[digits(number)] = f"{entry['name']} ({number})"
for entry in spec["barangay"]:
    for number in entry["numbers"]:
        declared[digits(number)] = f"{entry['barangay']} ({number})"

if not declared:
    problems.append("data/help-desk.json declares no numbers at all")

# 1. Nothing on the page that the data file does not declare.
on_page = {digits(m) for m in PHONE.findall(page)}
for found in sorted(on_page - set(declared)):
    problems.append(
        f"help-desk.html renders the number 0{found}, which data/help-desk.json "
        f"does not declare. Numbers are edited in the data file and the page is "
        f"rebuilt — never the other way round.")

# 2. Nothing declared that the page drops.
for missing in sorted(set(declared) - on_page):
    problems.append(
        f"data/help-desk.json declares {declared[missing]} but it does not appear "
        f"on help-desk.html — a declared emergency number that never reaches the "
        f"page cannot be called.")

# 3. Every tel: dials exactly what it prints.
for href in TEL.findall(page):
    if digits(href) not in declared:
        problems.append(
            f"help-desk.html has a tel: link to {href}, which is not a declared number")
    if not href.startswith("+63"):
        problems.append(
            f"help-desk.html tel: link {href} is not in +63 form, so it will not "
            f"dial correctly from a phone roaming abroad")

# The printed number and its own link must agree. Checked pairwise in document
# order rather than as two sets, because two numbers on one card that were
# swapped between each other would pass a set comparison and still dial the
# wrong office.
pairs = re.findall(r'href="tel:([^"]+)"[^>]*>.*?<span class="hd-call-number">([^<]+)</span>',
                   page, re.S)
if len(pairs) != len(TEL.findall(page)):
    problems.append("help-desk.html: a tel: link is not paired with a printed number")
for href, printed in pairs:
    if digits(href) != digits(printed):
        problems.append(
            f"help-desk.html displays {printed} but the link dials {href} — a call "
            f"button must dial the number it shows")

# 4. The exception does not spread beyond this page.
for other in sorted(ROOT.glob("*.html")):
    if other.name == "help-desk.html":
        continue
    raw = other.read_text(encoding="utf-8")
    if "tel:" in raw.lower():
        problems.append(
            f"{other.name}: contains a tel: link. Only help-desk.html publishes "
            f"phone numbers on this site.")
    for number in set(PHONE.findall(raw)):
        problems.append(
            f"{other.name}: contains the phone number {number}. Only help-desk.html "
            f"publishes phone numbers on this site.")

# 5. The boundary statement is on the page. Compared against whitespace-
# normalised text, because these sentences wrap across source lines and an
# exact-substring test would pass or fail on indentation rather than on
# whether the sentence is actually there.
flat = " ".join(page.split())
for required, why in (
    ("not the municipal government",
     "readers must not mistake this for an official government service"),
    ("nothing you send through this website reaches",
     "readers must not believe a message here summons help"),
):
    if required not in flat:
        problems.append(
            f"help-desk.html no longer states {required!r} — {why}")

if problems:
    print("HELP DESK CHECK FAILED")
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1)

print(f"Help Desk: {len(declared)} declared numbers, all rendered, all dialling what they "
      f"print. No phone number or tel: link anywhere else on the site.")
