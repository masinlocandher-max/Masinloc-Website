#!/usr/bin/env python3
"""Check that the Marketplace publishes business details and nothing else.

WHY THIS IS SEPARATE FROM THE BUILD

build-marketplace.py already refuses to build if data/marketplace.json carries
a private key. That protects the path everyone expects. This checks the built
pages themselves, which catches the paths nobody expects: a field added to the
generator's templates, a value pasted into a page by hand, a future live feed
wired straight into the HTML. The data file being clean and the pages being
clean are two different claims, and only the second one is what a visitor gets.

WHAT IT LOOKS FOR

1. The submission form's private columns, by name and by shape. owner_name,
   owner_email and owner_phone exist on every business_submissions row and none
   of them may appear. So must no reference code, submission id, moderation
   status or dashboard-interest flag.

2. Anything that looks like a private contact regardless of what it is called.
   An email address on a marketplace page is almost certainly an owner's, since
   no public field in the schema holds one. A phone number is checked against
   the numbers the data file actually publishes, so a second, unpublished
   number appearing in a page is caught even though phone numbers in general
   are expected there.

3. Invented trust signals. Ratings, review counts, "verified" badges and
   follower counts are not in the data and cannot be, so if one appears
   somebody has written a claim the businesses never made.

4. Only approved businesses. Every business rendered into a page must be one
   the data file declares. A page for a business that is not in the file is
   either stale or came from somewhere it should not have.

Usage: python3 scripts/check-marketplace-privacy.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "marketplace.json"
HUB = ROOT / "marketplace.html"
PAGES_DIR = ROOT / "marketplace"

# Column and field names that only ever hold private data.
PRIVATE_NAMES = [
    "owner_name", "ownerName", "owner_email", "ownerEmail",
    "owner_phone", "ownerPhone", "reference_code", "referenceCode",
    "dashboard_interest", "dashboardInterest", "internal_notes", "internalNotes",
    "brand_logo_path", "submission_id", "submissionId",
    "moderation", "reviewer", "admin_note",
]

# Marketing furniture that would have to be invented to appear.
INVENTED = [
    "rating", "ratings", "review", "reviews", "stars", "verified badge",
    "followers", "sold", "bestseller", "best seller", "top rated", "popular",
    "trending", "testimonial",
]

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Philippine mobile numbers in any of the forms a submission might carry.
PHONE = re.compile(r"(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}")
TAG = re.compile(r"<[^>]+>")


def digits(value: str) -> str:
    d = re.sub(r"\D", "", value)
    return "63" + d[1:] if d.startswith("0") else d


def main() -> int:
    problems: list[str] = []

    if not DATA.is_file():
        print("no data/marketplace.json — nothing to check")
        return 0

    spec = json.loads(DATA.read_text(encoding="utf-8"))
    businesses = spec["businesses"]

    approved = {b["name"] for b in businesses}
    published_numbers = {
        digits(b[key]) for b in businesses
        for key in ("contact", "contactDigits") if b.get(key)
    }
    # The site's own address is published on purpose, everywhere.
    allowed_emails = {"hello@masinloc-zambales.com"}

    pages = ([HUB] if HUB.is_file() else []) + sorted(PAGES_DIR.glob("*.html"))
    if not pages:
        print("no marketplace pages built — nothing to check")
        return 0

    for page in pages:
        rel = page.relative_to(ROOT)
        raw = page.read_text(encoding="utf-8")
        # Structured data and attributes count: a leak inside JSON-LD is still
        # a leak, and it is the easiest place to put one by accident.
        lowered = raw.lower()

        for name in PRIVATE_NAMES:
            if name.lower() in lowered:
                problems.append(f"{rel}: contains {name!r}, which is private submission data")

        for word in INVENTED:
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                problems.append(
                    f"{rel}: mentions {word!r} — the Marketplace has no such data, "
                    f"so this would be a claim no business made")

        for address in set(EMAIL.findall(raw)):
            if address.lower() not in allowed_emails:
                problems.append(f"{rel}: publishes the email address {address}")

        for number in set(PHONE.findall(raw)):
            if digits(number) not in published_numbers:
                problems.append(
                    f"{rel}: publishes the phone number {number}, which is not the "
                    f"business contact number in data/marketplace.json — an owner's "
                    f"private line reaches a page exactly like this")

        # Every business named on a detail page must be an approved one.
        if page.parent == PAGES_DIR:
            heading = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S)
            if not heading:
                problems.append(f"{rel}: no H1, so the business it describes cannot be identified")
            else:
                name = TAG.sub("", heading.group(1)).strip()
                # The page carries the escaped form; compare on the same footing.
                if name and name not in {b.replace("'", "&#x27;") for b in approved} | approved:
                    problems.append(
                        f"{rel}: describes {name!r}, which is not in data/marketplace.json "
                        f"— only approved businesses may be published")

    # Every approved business should actually have a page, or the directory is
    # quietly dropping somebody who was told they were listed.
    built = {p.stem for p in PAGES_DIR.glob("*.html")}
    for business in businesses:
        if business["slug"] not in built:
            problems.append(f"{business['name']}: approved but has no page — run build-marketplace.py")

    if problems:
        print("MARKETPLACE PRIVACY CHECK FAILED")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("MARKETPLACE PRIVACY CHECK PASSED")
    print(f"{len(pages)} page(s), {len(businesses)} approved business(es): no owner name, "
          f"email or private number, no reference codes or moderation fields.")
    print("No invented ratings, reviews, badges or follower counts. "
          "Every published phone number is the one the business asked to publish.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
