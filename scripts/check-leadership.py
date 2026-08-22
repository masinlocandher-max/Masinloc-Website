#!/usr/bin/env python3
"""Guard the leadership record's promise: nobody is treated better than anybody.

This section is about people who hold or held public office in a real town.
A design that quietly favours one of them is not a styling bug, so the things
that could express favouritism are checked rather than trusted:

  - Every portrait exists at the same widths, in the same formats, at the same
    aspect ratio. A leader with an extra size, a missing size, or a different
    shape is a failure.
  - No portrait is disproportionately larger in bytes than the others at the
    same width, which is how a per-person quality bump would show up.
  - Every profile carries a name and an office and nothing else. The forbidden
    content list is explicit: terms, dates, party, achievements, relationships.
  - The names on the page match the approved spelling exactly, including
    initials and honorifics, and appear in the supplied order.
  - The one factual claim about women in leadership appears as approved, and
    is not upgraded into a national record claim.
  - Alt text describes each portrait in the same form, so no one gets a
    flattering description and no one gets a bare filename.

Usage
-----
    python3 scripts/check-leadership.py
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "leadership.html"
ASSETS = ROOT / "assets" / "leadership"
DATA = json.loads((ROOT / "data" / "leadership.json").read_text(encoding="utf-8"))

LEADERS = DATA["leaders"]
WOMEN = DATA["womenInLeadership"]

FORMATS = ("avif", "webp", "jpg")

# Wording that would turn a record into a campaign page. Checked against the
# page's visible text, not the data, so it catches hand-edits too.
PROMOTIONAL = [
    "visionary", "transformative", "dynamic leader", "exceptional",
    "beloved", "historic leader", "distinguished", "trailblaz",
    "tireless", "unwavering", "champion of", "under her leadership",
    "under his leadership", "legacy of",
]

# Claims the approved sentence must never be inflated into.
OVERCLAIM = [
    "record", "longest", "first woman", "first female", "only municipality",
    "in the philippines", "unprecedented", "history-making",
]



class Portraits(HTMLParser):
    """Collect every <img> in the leadership cards, with its alt and sizing."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[dict] = []
        self.text: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img" and "assets/leadership/" in (attrs.get("src") or ""):
            self.images.append(attrs)
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.text.append(data)


def main() -> int:
    problems: list[str] = []

    if not PAGE.is_file():
        print("MABAYANI LEADERSHIP GUARD FAILED")
        print("- leadership.html has not been built")
        return 1

    raw = PAGE.read_text(encoding="utf-8")
    parsed = Portraits()
    parsed.feed(raw)
    visible = re.sub(r"\s+", " ", " ".join(parsed.text)).strip()
    low = visible.lower()

    # --- portraits: identical ladder, identical shape ------------------------
    ladders: dict[str, list[int]] = {}
    for leader in LEADERS:
        slug = leader["slug"]
        widths = sorted(
            int(m.group(1))
            for m in (re.fullmatch(rf"{re.escape(slug)}-(\d+)\.jpg", f.name)
                      for f in ASSETS.glob(f"{slug}-*.jpg"))
            if m
        )
        ladders[slug] = widths
        if not widths:
            problems.append(f"{slug}: no portrait derivatives were built")
            continue
        for width in widths:
            for ext in FORMATS:
                path = ASSETS / f"{slug}-{width}.{ext}"
                if ext == "avif" and not path.is_file():
                    # AVIF is optional: Pillow may lack the encoder. It is only
                    # a failure if SOME leaders got it and others did not.
                    continue
                if not path.is_file():
                    problems.append(f"{slug}: missing {width}px {ext}")

    reference = None
    for slug, widths in ladders.items():
        if reference is None:
            reference = widths
        elif widths != reference:
            problems.append(
                f"{slug} has portrait widths {widths} while others have "
                f"{reference}: one leader is being served at a different size")

    with_avif = {slug for slug in ladders
                 if any((ASSETS / f"{slug}-{w}.avif").is_file() for w in ladders[slug])}
    if with_avif and len(with_avif) != len(ladders):
        problems.append(f"only {sorted(with_avif)} got AVIF; the rest are served a "
                        f"heavier format for the same portrait")

    # Aspect ratio, measured from the files rather than assumed.
    try:
        from PIL import Image
        shapes = {}
        for slug, widths in ladders.items():
            if not widths:
                continue
            with Image.open(ASSETS / f"{slug}-{widths[-1]}.jpg") as img:
                shapes[slug] = round(img.width / img.height, 4)
        if len(set(shapes.values())) > 1:
            problems.append(f"portraits are not all the same shape: {shapes}")
    except ImportError:
        print("note: Pillow unavailable, portrait aspect ratio not measured")

    # Byte weight at the largest shared width. Painted portraits differ in
    # detail so exact parity is not expected; a large outlier is the signal.
    if reference:
        largest = reference[-1]
        sizes = {slug: (ASSETS / f"{slug}-{largest}.jpg").stat().st_size
                 for slug in ladders if (ASSETS / f"{slug}-{largest}.jpg").is_file()}
        if len(sizes) > 1:
            smallest = min(sizes.values())
            for slug, size in sizes.items():
                if size > smallest * 1.6:
                    problems.append(
                        f"{slug} is {size / smallest:.1f}x the smallest portrait at "
                        f"{largest}px, which suggests a per-person quality setting")

    # --- the page: names, offices, and nothing else --------------------------
    if len(parsed.images) != len(LEADERS):
        problems.append(f"the page shows {len(parsed.images)} portraits for "
                        f"{len(LEADERS)} leaders")

    order = [m for m in re.findall(r'class="leader-name">([^<]+)<', raw)]
    expected = [l["name"] for l in LEADERS]
    if order != expected:
        problems.append(f"names or their order differ from the approved list:\n"
                        f"    page: {order}\n    data: {expected}")

    for leader in LEADERS:
        if leader["name"] not in visible:
            problems.append(f"{leader['slug']}: approved spelling '{leader['name']}' "
                            f"is not on the page")
        if leader["office"] not in visible:
            problems.append(f"{leader['slug']}: office '{leader['office']}' is missing")

    current = [l for l in LEADERS if l["status"] == "current"]
    if len(current) != 1:
        problems.append(f"{len(current)} leaders are marked current; exactly one holds "
                        f"the office")
    elif order and order[0] != current[0]["name"]:
        problems.append(f"the incumbent is not listed first (first is {order[0]})")

    badge_count = raw.count('class="leader-now"')
    if badge_count != 1:
        problems.append(f"{badge_count} current-office indicators on the page; "
                        f"expected exactly 1")

    # --- alt text: same form for everyone ------------------------------------
    for image, leader in zip(parsed.images, LEADERS):
        alt = image.get("alt", "")
        if alt != leader["alt"]:
            problems.append(f"{leader['slug']}: alt text does not match the data")
        if not alt.startswith("Portrait of "):
            problems.append(f"{leader['slug']}: alt text is not in the shared form "
                            f"'Portrait of NAME, OFFICE of Masinloc'")
        if leader["name"] not in alt:
            problems.append(f"{leader['slug']}: alt text does not name the person")

    # --- copy rules -----------------------------------------------------------
    for phrase in PROMOTIONAL:
        if phrase in low:
            problems.append(f"promotional language on the page: '{phrase}'")

    # "Name and office only" is checked positively rather than by blacklist: a
    # caption must read as exactly the approved name, the approved office, and
    # — for the incumbent alone — the current-office word. Anything else in
    # there is by definition something we said we would not publish. (A
    # blacklist would also trip over the lead paragraph, which has to be able
    # to say the page carries no terms and no dates.)
    captions = re.findall(r"<figcaption>(.*?)</figcaption>", raw, re.S)
    if len(captions) != len(LEADERS):
        problems.append(f"{len(captions)} captions for {len(LEADERS)} leaders")
    for caption, leader in zip(captions, LEADERS):
        words = re.sub(r"<[^>]+>", " ", caption)
        words = re.sub(r"\s+", " ", words).strip()
        allowed = f"{leader['name']} {leader['office']}"
        if leader["status"] == "current":
            allowed += f" {DATA['currentBadge']}"
        if words != allowed:
            problems.append(f"{leader['slug']}: the caption reads \"{words}\" but only "
                            f"\"{allowed}\" is approved")

    fact = WOMEN["fact"]
    if fact not in visible:
        problems.append("the approved women-in-leadership sentence is not on the page")
    for name in WOMEN["recognises"]:
        if name not in visible:
            problems.append(f"women in leadership does not recognise {name}")

    # The overclaim check is scoped to the women-in-leadership block: "record"
    # and "first" are ordinary words elsewhere on a site about history.
    block = re.search(r'<section class="women-lead".*?</section>', raw, re.S)
    if not block:
        problems.append("the women-in-leadership section is missing")
    else:
        block_text = re.sub(r"<[^>]+>", " ", block.group(0)).lower()
        for phrase in OVERCLAIM:
            if phrase in block_text:
                problems.append(f"women in leadership makes an unsourced claim: "
                                f"'{phrase}'. Only the approved sentence is allowed.")

    if problems:
        print("LEADERSHIP GUARD FAILED")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("LEADERSHIP GUARD PASSED")
    print(f"{len(LEADERS)} leaders, all at the same widths {reference}, the same "
          f"aspect ratio and comparable file weight.")
    print("The incumbent is first and carries one restrained current-office marker; "
          "every profile shows a name and an office and nothing else.")
    print(f"Approved wording only: \"{fact}\" recognising "
          f"{', '.join(WOMEN['recognises'])}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
