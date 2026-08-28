#!/usr/bin/env python3
"""Guard the MABAYANI anonymity rule and its register, against built HTML.

Two promises are checked here rather than trusted:

1. ANONYMITY. The person who created MABAYANI is not named anywhere on the
   site until the closing reflection. That is a promise about the shipped
   pages, not about the generator, so this reads the HTML that actually gets
   deployed: visible text, meta tags, structured data, HTML comments, image
   captions and alt text, link titles — everything a reader, a crawler or a
   "view source" can reach. Exactly one page may carry the name.

   scripts/build-bulletin.py enforces the same rule over the source data. This
   script is the one that would catch a name reaching a page some other way:
   hand-edited HTML, a copied template, a stray comment.

2. REGISTER. The sequence is a reading path, not a streaming season. The
   interface must never borrow that vocabulary, so the chrome — labels,
   headings, buttons, link text — is checked for it. Article prose is left
   alone: "episode" has an ordinary historical sense and a UI rule should not
   push honest writing around.

Usage
-----
    python3 scripts/check-mabayani-anonymity.py
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BULLETIN = json.loads((ROOT / "data" / "bulletin.json").read_text(encoding="utf-8"))

CREATOR = BULLETIN["publication"]["creator"]["name"]
# The one page permitted to name her, taken from the data rather than hardcoded
# so that moving the reveal moves the exemption with it.
REVEAL = next(a["slug"] for a in BULLETIN["articles"] if a.get("revealsCreator"))
REVEAL_PAGE = f"bulletin/{REVEAL}.html"
# MABAYANI names her in two places: a provenance block under the title, saying
# the page is a book she wrote and donated to the project, and the research
# credit in its closing section, which the page's brief asks for. Naming the
# page here means the exemption is a decision on the record rather than a
# directory this guard happens not to look at.
CREDIT_PAGE = "mabayani/index.html"
# The provenance block states she wrote the book and donated it, signs her
# quotation, and carries her portrait — whose alt text names her, because a
# photograph of a person is not decoration and a reader who cannot see it
# should still be told whose face it is. The closing section carries the
# research credit. Four mentions.
CREDIT_PAGE_MENTIONS = 4

# Names to look for. The surname alone is included because "Bautista" on a page
# is a reveal even without the first name.
NEEDLES = [CREATOR.lower(), CREATOR.split()[-1].lower()]

# "FMB" is deliberately not a needle. The initials have been in the site-wide
# copyright line since before MABAYANI existed ("Mabayani Project by FMB") and
# are the registered project name, not an author byline.

CHROME_CLASSES = {
    "mab-kicker", "mab-lead", "mab-entry-label", "mab-entry-go", "mab-path-title",
    "mab-progress", "mab-path-note", "path-way", "path-n",
    "continue-label", "continue-q", "continue-meta", "article-place",
    "section-label", "story-cat", "article-cat", "rel-cat", "chip",
}

BANNED_CHROME = [
    "episode", "season", "watch now", "play now", "streaming", "binge",
    "premiere", "series finale", "up next", "autoplay",
]

# Streaming-platform red. The site's own red is reserved for the Masinloc mark
# and for genuine alerts; a serialised story surface must not adopt it.
STREAMING_RED = re.compile(r"#(E50914|E61E25)", re.I)


class Chrome(HTMLParser):
    """Collect the text of interface elements, ignoring article prose."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.found: list[str] = []
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        classes = set((dict(attrs).get("class") or "").split())
        if self.depth or classes & CHROME_CLASSES:
            self.depth += 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if self.depth == 0:
                self.found.append(" ".join(self._buf))
                self._buf = []

    def handle_data(self, data):
        if self.depth:
            self._buf.append(data.strip())


def walk(node) -> list[dict]:
    """Every dict anywhere in a JSON-LD document, at any nesting depth."""
    found = []
    if isinstance(node, dict):
        found.append(node)
        for value in node.values():
            found += walk(value)
    elif isinstance(node, list):
        for value in node:
            found += walk(value)
    return found


def pages() -> list[Path]:
    """Every built HTML page on the site, not only the Bulletin's."""
    found = sorted(ROOT.glob("*.html"))
    found += sorted((ROOT / "bulletin").glob("*.html"))
    found += sorted((ROOT / "mabayani").glob("*.html"))
    return found


def main() -> int:
    problems: list[str] = []
    named: list[str] = []

    for page in pages():
        rel = page.relative_to(ROOT).as_posix()
        raw = page.read_text(encoding="utf-8")
        low = raw.lower()

        if rel == CREDIT_PAGE:
            # TWO PLACES, BOTH DECLARED, AND NOWHERE ELSE ON THE PAGE.
            #
            # This used to be "once, in the closing credit". That was right
            # while the credit was all the page said about its author: one line
            # at the foot of thirty-six sections. It now also says, directly
            # under the title, that MABAYANI is a book she wrote and donated —
            # which anyone who does not read to the end would otherwise never
            # learn, and which is the first thing about the page worth knowing.
            #
            # So the allowance is the provenance block plus the closing credit.
            # It stays a count rather than becoming "anywhere on this page",
            # because the thing being protected has not changed: the name must
            # not spread into the narrative itself. The block names her in its
            # sentence and again under her quotation, so the ceiling is three.
            shown = low.count(CREATOR.lower())
            if shown == 0:
                problems.append(f"{rel}: the closing section must credit the "
                                f"research direction, and does not")
            elif shown > CREDIT_PAGE_MENTIONS:
                problems.append(
                    f"{rel}: names the creator {shown} times; the page allows "
                    f"{CREDIT_PAGE_MENTIONS} — the provenance block under the "
                    f"title, its portrait's alt text, and the closing credit. "
                    f"More than that means the name has spread into the "
                    f"narrative.")

        hits = [n for n in NEEDLES if n in low]
        if hits and rel not in (REVEAL_PAGE, CREDIT_PAGE):
            # Report where, so a real leak is fixable without a manual hunt.
            where = []
            for needle in hits:
                for m in re.finditer(re.escape(needle), low):
                    where.append(raw[max(0, m.start() - 60):m.end() + 40]
                                 .replace("\n", " ").strip())
            problems.append(f"{rel}: names the creator before the reveal — "
                            f"...{where[0]}...")
        elif hits:
            named.append(rel)

        if rel != REVEAL_PAGE and 'property="article:author"' in raw:
            problems.append(f"{rel}: carries an article:author tag")

        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                                raw, re.S):
            try:
                graph = json.loads(block)
            except json.JSONDecodeError as err:
                problems.append(f"{rel}: structured data does not parse ({err})")
                continue
            # Walk the whole graph, not just its top level: a Person can sit
            # nested inside an ItemList item and still be published.
            #
            # A Person node is only a problem in two cases. On a Bulletin page
            # it means the stories have acquired a named author, which is the
            # thing this guard exists to prevent. Anywhere on the site, a
            # Person carrying the creator's name is the reveal happening early.
            # Elsewhere Person is legitimate — the leadership record names
            # public office holders, and that is the point of it.
            for node in walk(graph):
                if node.get("@type") != "Person" or rel == REVEAL_PAGE:
                    continue
                person = str(node.get("name", "")).lower()
                if rel.startswith("bulletin/"):
                    problems.append(f"{rel}: a Bulletin story carries a Person node "
                                    f"({node.get('name')})")
                elif any(n in person for n in NEEDLES):
                    problems.append(f"{rel}: structured data names the creator in a "
                                    f"Person node")

        if rel.startswith("bulletin/") or rel == "masinloc-bulletin.html":
            chrome = Chrome()
            chrome.feed(raw)
            text = " ".join(chrome.found).lower()
            for word in BANNED_CHROME:
                if word in text:
                    problems.append(f"{rel}: interface uses streaming language "
                                    f"('{word}')")

    if not named:
        problems.append(f"the reveal page {REVEAL_PAGE} does not name the creator — "
                        f"the closing story is supposed to be where it happens")
    elif sorted(named) != sorted({REVEAL_PAGE, CREDIT_PAGE}):
        # Exactly two pages may carry the name: the closing story, where the
        # reveal happens, and MABAYANI's credit line. A third is a leak.
        extra = [p for p in named if p not in (REVEAL_PAGE, CREDIT_PAGE)]
        if extra:
            problems.append(f"pages naming the creator that should not: {extra}")
        else:
            problems.append(f"the creator should be named on both {REVEAL_PAGE} and "
                            f"{CREDIT_PAGE}; found only {named}")

    css = (ROOT / "bulletin.css").read_text(encoding="utf-8")
    if STREAMING_RED.search(css):
        problems.append("bulletin.css uses a hardcoded streaming red; the flagship "
                        "surface takes its colour from tokens.css")
    for cue in ("▶", "&#9654;", "play-button", "btn-play"):
        if cue in css:
            problems.append(f"bulletin.css builds a play affordance ('{cue}')")

    if problems:
        print("MABAYANI GUARD FAILED")
        for p in problems:
            print(f"- {p}")
        return 1

    print("MABAYANI GUARD PASSED")
    print(f"{len(pages())} pages checked; the creator is named on "
          f"{REVEAL_PAGE}, and on {CREDIT_PAGE} as the author of the book and "
          f"in its closing research credit, with her portrait beside it.")
    print("No streaming-platform language in the Bulletin interface.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
