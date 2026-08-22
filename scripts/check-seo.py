#!/usr/bin/env python3
"""Check what a search engine, a crawler and a language model actually see.

The aim is not keyword density. It is that every public page answers three
questions immediately — what this page is about, why it matters, and where to
go next — and that the answer is in the HTML rather than assembled later by a
script.

So this checks the machine-readable surface (title, description, canonical,
Open Graph, Twitter card, one H1, heading order, alt text, internal links,
structured data) and it also refuses a set of stock travel-writing phrases
that make a page read as generated rather than written.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://masinloc-zambales.com"

# Private surfaces are not part of the public index and are checked only for
# staying out of it.
PRIVATE = {"admin.html"}
# A recovery screen needs no description or social card.
MINIMAL = {"404.html"}

# Stock phrasing. Any of these on a public page is a rewrite, not a warning:
# they are the tells that copy was generated rather than written by someone
# who knows the place.
BANNED_PHRASES = [
    "hidden gem", "breathtaking", "nestled in", "rich tapestry",
    "vibrant community", "embark on a journey", "where tradition meets",
    "discover the magic", "captivating destination", "testament to",
    "explore the wonders", "must-visit", "bucket list", "unspoiled paradise",
    "stunning beauty", "awe-inspiring", "treasure trove", "paradise on earth",
    "like no other", "step back in time",
]

TITLE_MAX = 65
DESC_MIN, DESC_MAX = 70, 165

errors: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.canonical = ""
        self.robots = ""
        self.headings: list[tuple[int, str]] = []
        self._heading = 0
        self.images: list[dict] = []
        self.links: list[str] = []
        self.jsonld: list[str] = []
        self._in_jsonld = False
        self.landmarks: set[str] = set()
        # A decorative image is often wrapped in an aria-hidden container
        # rather than carrying the attribute itself, so hiding is inherited.
        self._hidden_depth = 0
        self._open: list[tuple[str, bool]] = []

    VOID = {"img", "br", "hr", "meta", "link", "input", "source", "path"}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        hides = a.get("aria-hidden") == "true"
        if tag not in self.VOID:
            self._open.append((tag, hides))
            if hides:
                self._hidden_depth += 1
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href", "")
        elif tag in {"h1", "h2", "h3", "h4"}:
            self._heading = int(tag[1])
            self.headings.append((self._heading, ""))
        elif tag == "img":
            self.images.append({
                "src": a.get("src", ""), "alt": a.get("alt"),
                "hidden": hides or self._hidden_depth > 0,
            })
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._in_jsonld = True
        elif tag in {"main", "header", "footer", "nav", "article", "section"}:
            self.landmarks.add(tag)

    def handle_endtag(self, tag):
        for i in range(len(self._open) - 1, -1, -1):
            if self._open[i][0] == tag:
                if self._open[i][1]:
                    self._hidden_depth -= 1
                del self._open[i:]
                break
        if tag == "title":
            self._in_title = False
        elif tag in {"h1", "h2", "h3", "h4"}:
            self._heading = 0
        elif tag == "script":
            self._in_jsonld = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
        elif self._heading and self.headings:
            level, text = self.headings[-1]
            self.headings[-1] = (level, (text + " " + data.strip()).strip())
        elif self._in_jsonld:
            self.jsonld.append(data)


def visible_text(markup: str) -> str:
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", markup)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))


pages = sorted(p for p in ROOT.glob("*.html")) + sorted(ROOT.glob("bulletin/*.html"))
titles: dict[str, str] = {}
descriptions: dict[str, str] = {}
inbound: dict[str, set[str]] = {p.relative_to(ROOT).as_posix(): set() for p in pages}

for page in pages:
    name = page.relative_to(ROOT).as_posix()
    markup = page.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(markup)
    text = visible_text(markup)

    if name in PRIVATE:
        if "noindex" not in parser.meta.get("robots", "").lower():
            fail(f"{name}: a private surface must carry meta robots noindex")
        continue

    # --- stock phrasing --------------------------------------------------
    lowered = text.lower()
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            fail(f'{name}: stock travel phrasing on the page: "{phrase}"')

    # --- title -----------------------------------------------------------
    if not parser.title:
        fail(f"{name}: missing <title>")
    else:
        titles.setdefault(parser.title, name)
        if titles[parser.title] != name:
            fail(f"{name}: shares its title with {titles[parser.title]}")
        if len(parser.title) > TITLE_MAX:
            fail(f"{name}: title is {len(parser.title)} characters "
                 f"(keep it under {TITLE_MAX})")
        if "masinloc" not in parser.title.lower():
            fail(f"{name}: the title does not name Masinloc")

    # --- canonical -------------------------------------------------------
    if not parser.canonical:
        fail(f"{name}: missing canonical link")
    elif not parser.canonical.startswith(SITE):
        fail(f"{name}: canonical does not point at {SITE}: {parser.canonical}")

    # --- one H1, in order ------------------------------------------------
    h1s = [text for level, text in parser.headings if level == 1]
    if len(h1s) != 1:
        fail(f"{name}: expected exactly one H1, found {len(h1s)}")

    levels = [level for level, _ in parser.headings]
    for before, after in zip(levels, levels[1:]):
        if after > before + 1:
            fail(f"{name}: heading order jumps from H{before} to H{after}")
            break

    for level, heading in parser.headings:
        if not heading.strip():
            fail(f"{name}: an H{level} is empty")
            break

    # --- semantics -------------------------------------------------------
    for landmark in ("main", "header", "footer"):
        if landmark not in parser.landmarks:
            fail(f"{name}: no <{landmark}> landmark")

    # --- alt text --------------------------------------------------------
    for image in parser.images:
        alt = image["alt"]
        if alt is None:
            fail(f"{name}: <img {image['src']}> has no alt attribute")
            continue
        if alt == "" and not image["hidden"]:
            # Empty alt is correct only for an image the page has already
            # marked decorative.
            fail(f"{name}: <img {image['src']}> has empty alt but is not "
                 f"marked decorative")
        if alt and len(alt) > 160:
            fail(f"{name}: alt text is {len(alt)} characters, which reads as "
                 f"keyword stuffing: {alt[:60]}...")
        if alt and alt.lower().count("masinloc") > 2:
            fail(f"{name}: alt text repeats Masinloc {alt.lower().count('masinloc')} "
                 f"times: {alt[:60]}...")

    if name in MINIMAL:
        continue

    # --- description and social card -------------------------------------
    description = parser.meta.get("description", "")
    if not description:
        fail(f"{name}: missing meta description")
    else:
        descriptions.setdefault(description, name)
        if descriptions[description] != name:
            fail(f"{name}: shares its meta description with {descriptions[description]}")
        if not (DESC_MIN <= len(description) <= DESC_MAX):
            fail(f"{name}: meta description is {len(description)} characters "
                 f"(aim for {DESC_MIN}-{DESC_MAX})")

    for required in ("og:title", "og:description", "og:image", "og:url", "og:type"):
        if not parser.meta.get(required):
            fail(f"{name}: missing {required}")
    if not parser.meta.get("twitter:card"):
        fail(f"{name}: missing twitter:card")

    og_image = parser.meta.get("og:image", "")
    if og_image and not og_image.startswith("http"):
        fail(f"{name}: og:image must be an absolute URL: {og_image}")

    # --- internal linking -------------------------------------------------
    internal = [href for href in parser.links
                if href.endswith(".html") and not href.startswith("http")]
    here = Path(name).parent
    for href in internal:
        target = href.split("#")[0].split("?")[0]
        resolved = (here / target).as_posix().replace("./", "")
        while resolved.startswith("../"):
            resolved = resolved[3:]
        if resolved in inbound:
            inbound[resolved].add(name)
    if len(set(internal)) < 3:
        fail(f"{name}: only {len(set(internal))} internal links; a page should "
             f"say where to go next")

    # Anchor text has to describe the destination.
    for lazy in ("click here", "read more", "learn more", "here", "this link"):
        if re.search(rf">\s*{re.escape(lazy)}\s*<", markup, re.I):
            fail(f'{name}: uninformative anchor text: "{lazy}"')


    # --- contact routes through the form ---------------------------------
    # A mailto exposes the address to scrapers and leaves no record an admin
    # can work from. Contact is a reviewed form; trust.html is the one place a
    # published address of record belongs.
    if name != "trust.html":
        for href in parser.links:
            if href.lower().startswith("mailto:"):
                fail(f"{name}: Contact must route through contact.html, not a "
                     f"mailto link ({href})")

    # --- structured data --------------------------------------------------
    for block in parser.jsonld:
        try:
            json.loads(block)
        except json.JSONDecodeError as error:
            fail(f"{name}: structured data is not valid JSON: {error}")

# Every public page should be reachable from somewhere else on the site.
for name, sources in inbound.items():
    if name in PRIVATE or name in {"index.html", "404.html"}:
        continue
    if not sources:
        notes.append(f"{name} is not linked from any other page")

if errors:
    print("SEO CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

public = [p.name for p in pages if p.name not in PRIVATE]
print("SEO CHECK PASSED")
print(f"{len(public)} public pages: unique titles and descriptions, one H1 each, "
      f"canonical, Open Graph and Twitter card, described alt text, and internal "
      f"links with meaningful anchors.")
if notes:
    print()
    print("For review:")
    for note in notes:
        print(f"  - {note}")
