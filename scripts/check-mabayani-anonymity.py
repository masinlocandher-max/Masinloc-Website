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


def pages() -> list[Path]:
    """Every built HTML page on the site, not only the Bulletin's."""
    found = sorted(ROOT.glob("*.html"))
    found += sorted((ROOT / "bulletin").glob("*.html"))
    return found


def main() -> int:
    problems: list[str] = []
    named: list[str] = []

    for page in pages():
        rel = page.relative_to(ROOT).as_posix()
        raw = page.read_text(encoding="utf-8")
        low = raw.lower()

        hits = [n for n in NEEDLES if n in low]
        if hits and rel != REVEAL_PAGE:
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
            nodes = graph.get("@graph", [graph]) if isinstance(graph, dict) else []
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                if node.get("@type") == "Person" and rel != REVEAL_PAGE:
                    problems.append(f"{rel}: structured data carries a Person node "
                                    f"({node.get('name')})")

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
    elif named != [REVEAL_PAGE]:
        problems.append(f"more than one page names the creator: {named}")

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
          f"{REVEAL_PAGE} and nowhere else.")
    print("No streaming-platform language in the Bulletin interface.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
