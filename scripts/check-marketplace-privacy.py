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
   no public field in the schema holds one.

   Phone numbers are simpler than they used to be: there is no allowlist. The
   Marketplace publishes no number of any kind — the public contact method is
   Facebook — so any Philippine mobile number appearing anywhere in a page is a
   leak by definition, whether it is in the markup, a data attribute, a script
   object, a meta tag or a JSON-LD block. A tel: link fails on sight, since the
   only thing it can carry is a number.

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
    # The Marketplace publishes no phone number of any kind, so the field names
    # that would carry one are private here too.
    "contact_number", "contactNumber", "contactDigits", "telephone",
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


def main() -> int:
    problems: list[str] = []

    if not DATA.is_file():
        print("no data/marketplace.json — nothing to check")
        return 0

    spec = json.loads(DATA.read_text(encoding="utf-8"))
    businesses = spec["businesses"]

    approved = {b["name"] for b in businesses}
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

        # No phone number of any kind, from any source. There is no allowlist
        # to fall through: the Marketplace's public contact method is Facebook,
        # so any Philippine mobile number appearing anywhere in a page — in the
        # markup, a data attribute, a script, a meta tag or a JSON-LD block —
        # is a leak by definition.
        for number in set(PHONE.findall(raw)):
            problems.append(
                f"{rel}: publishes the phone number {number}. The Marketplace "
                f"publishes no phone numbers — the public contact method is Facebook.")

        if "tel:" in lowered:
            problems.append(f"{rel}: contains a tel: link, which can only carry a phone number")

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

    # data/marketplace.json is not only build input. vercel.json gives /data/
    # its own Cache-Control header, so the file is served at a public URL and
    # anybody can read it — which makes it exactly the "client-side JSON" a
    # leak test should cover. Values are checked rather than the whole file,
    # because the leading _comment documents the private column names on
    # purpose and naming a column is not disclosing it.
    for business in businesses:
        label = business.get("name", business.get("slug", "?"))
        for key, value in business.items():
            if key.startswith("_"):
                continue
            if key.lower() in {n.lower() for n in PRIVATE_NAMES}:
                problems.append(f"data/marketplace.json: {label} carries the private key {key!r}")
            if not isinstance(value, str):
                continue
            if PHONE.search(value):
                problems.append(
                    f"data/marketplace.json: {label}.{key} contains a phone number, "
                    f"and this file is publicly served")
            for address in EMAIL.findall(value):
                if address.lower() not in allowed_emails:
                    problems.append(
                        f"data/marketplace.json: {label}.{key} contains the email {address}")

    # Every file under data/ is served publicly, so a number can reach the site
    # through prose in a manifest as easily as through a page. That is not
    # theoretical either: the note recording that Adaler's logo had been cleaned
    # up originally quoted the very numbers it was describing the removal of.
    for public_json in sorted((ROOT / "data").glob("marketplace*.json")):
        text = public_json.read_text(encoding="utf-8")
        for number in set(PHONE.findall(text)):
            problems.append(
                f"data/{public_json.name}: contains the phone number {number}. "
                f"Everything under data/ is served publicly — describe a number's "
                f"removal without writing it down.")

    # A logo is an image of text as far as everything above is concerned. None
    # of those checks can read pixels, so a phone number printed inside a mark
    # would sail past all of them and still be perfectly readable to a visitor
    # — and to image search. That is not hypothetical: Adaler's Grazing
    # Delights first supplied a logo with two mobile numbers set into it, one
    # of which was the number this site had been told to stop publishing. They
    # are not written out here, for the same reason they are not on the page.
    #
    # So a published logo has to carry a recorded human review saying somebody
    # looked at the artwork and found no contact details in it. The check
    # cannot read the image; it can insist that a person did.
    logos_file = ROOT / "data" / "marketplace-logos.json"
    logos = json.loads(logos_file.read_text(encoding="utf-8")) if logos_file.is_file() else {}
    for slug, entry in logos.items():
        if not entry.get("widths"):
            continue
        review = entry.get("artworkReviewed")
        if not review:
            problems.append(
                f"{slug}: a logo is published with no artworkReviewed record. Read the "
                f"artwork at full size and record whether contact details are set into it.")
        elif review.get("contactDetailsInArtwork"):
            problems.append(
                f"{slug}: the logo is published although its artwork is recorded as "
                f"carrying contact details. This site publishes no phone numbers.")

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
    print("No phone number of any kind, and no tel: link — the public contact "
          "method is Facebook.")
    print("No invented ratings, reviews, badges or follower counts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
