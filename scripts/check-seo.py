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
import posixpath
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://www.masinloc-zambales.com"
CANONICAL_HOST = "www.masinloc-zambales.com"

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
        self.meta_values: dict[str, list[str]] = {}
        self.canonical = ""
        self.canonicals: list[str] = []
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
                value = a.get("content", "")
                self.meta[key] = value
                self.meta_values.setdefault(key, []).append(value)
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href", "")
            self.canonicals.append(self.canonical)
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


pages = (sorted(p for p in ROOT.glob("*.html"))
         + sorted(ROOT.glob("bulletin/*.html"))
         + sorted(ROOT.glob("discover/*.html"))
         + sorted(ROOT.glob("marketplace/*.html"))
         + sorted(ROOT.glob("mabayani/*.html")))
titles: dict[str, str] = {}
descriptions: dict[str, str] = {}
inbound: dict[str, set[str]] = {p.relative_to(ROOT).as_posix(): set() for p in pages}


# Pages that deliberately name another page as their canonical.
#
# The ten MABAYANI research articles are the case. They keep their URLs and
# their content — nothing here deletes them, and they stay crawlable through
# the links from /mabayani/ and from each other — but MABAYANI is the
# authoritative reading of that history and they say so rather than competing
# with it for the same searches.
#
# Listed explicitly so that a page canonicalizing elsewhere is always a
# decision somebody made, never a build accident. A cross-page canonical is
# advisory: search engines weigh it against the content and may keep indexing
# a page that differs substantially from its target. If these need to leave
# the index for certain, robots noindex is the reliable lever, not this.
CANONICAL_ELSEWHERE = {
    f"bulletin/{slug}.html": f"{SITE}/mabayani/"
    for slug in (
        "was-masinloc-founded-in-1572", "1607-and-the-first-mission-church",
        "before-the-written-record", "the-first-church-was-not-todays-church",
        "san-andres-church-across-the-centuries", "1649-when-six-caracoas-came",
        "what-binabayani-remembers", "what-is-sambal-tina",
        "why-older-sources-say-tina", "why-mabayani-exists",
    )
}


def expected_canonical(name: str) -> str:
    """The one public URL that corresponds to a built file.

    Section indexes publish at their directory URL. Everything else keeps its
    explicit .html path; silently treating those as interchangeable would let
    a page canonicalize to a duplicate route that does not exist in the build.
    """
    if name in CANONICAL_ELSEWHERE:
        return CANONICAL_ELSEWHERE[name]
    if name == "index.html":
        return f"{SITE}/"
    if name.endswith("/index.html"):
        return f"{SITE}/{name[:-len('index.html')]}"
    return f"{SITE}/{name}"


def site_urls(node) -> list[str]:
    """Return every absolute URL owned by this site in a JSON-LD graph."""
    found: list[str] = []
    if isinstance(node, dict):
        for value in node.values():
            found += site_urls(value)
    elif isinstance(node, list):
        for value in node:
            found += site_urls(value)
    elif isinstance(node, str):
        parsed = urlsplit(node)
        if parsed.hostname in {"masinloc-zambales.com", CANONICAL_HOST}:
            found.append(node)
    return found


def page_entities(graph) -> list[dict]:
    """Return page-level entities, without mistaking listed items for the page.

    A Discover hub legitimately embeds nineteen BlogPosting summaries. Those
    URLs identify the listed articles, not the hub, so recursively treating
    every typed node as the current page would reject truthful Blog markup.
    Page entities live at the JSON-LD root or directly in @graph.
    """
    if not isinstance(graph, dict):
        return []
    candidates = graph.get("@graph")
    if not isinstance(candidates, list):
        candidates = [graph]
    page_kinds = {
        "WebPage", "CollectionPage", "Article", "NewsArticle",
        "BlogPosting", "LocalBusiness", "CafeOrCoffeeShop",
        "FoodEstablishment",
    }
    found = []
    for node in candidates:
        if not isinstance(node, dict):
            continue
        kinds = node.get("@type", [])
        if isinstance(kinds, str):
            kinds = [kinds]
        if any(kind in page_kinds for kind in kinds):
            found.append(node)
    return found


sitemap_raw = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
sitemap_urls = re.findall(r"<loc>([^<]+)</loc>", sitemap_raw)
sitemap_set = set(sitemap_urls)
if len(sitemap_urls) != len(sitemap_set):
    fail("sitemap.xml: a canonical URL is listed more than once")
for url in sitemap_urls:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != CANONICAL_HOST:
        fail(f"sitemap.xml: URL is not on the canonical HTTPS host: {url}")

for page in pages:
    name = page.relative_to(ROOT).as_posix()
    markup = page.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(markup)
    text = visible_text(markup)

    noindex = "noindex" in parser.meta.get("robots", "").lower()

    if name in PRIVATE:
        if "noindex" not in parser.meta.get("robots", "").lower():
            fail(f"{name}: a private surface must carry meta robots noindex")
        if parser.canonical and parser.canonical in sitemap_set:
            fail(f"{name}: a private surface is listed in sitemap.xml")
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
    if len(parser.canonicals) != 1:
        fail(f"{name}: expected exactly one canonical link, found "
             f"{len(parser.canonicals)}")
    elif parser.canonical != expected_canonical(name):
        fail(f"{name}: canonical is {parser.canonical}; expected "
             f"{expected_canonical(name)}")
    else:
        parsed = urlsplit(parser.canonical)
        if parsed.scheme != "https" or parsed.netloc != CANONICAL_HOST:
            fail(f"{name}: canonical is not on the canonical HTTPS host: "
                 f"{parser.canonical}")
    if noindex:
        if parser.canonical in sitemap_set:
            fail(f"{name}: noindex page is listed in sitemap.xml")
    elif parser.canonical not in sitemap_set:
        fail(f"{name}: canonical is missing from sitemap.xml")

    # --- one H1, in order ------------------------------------------------
    # A MINIMAL page is one whose entire content is a single supplied artwork
    # carrying its own message. 404.html is the only one: it is noindex, it has
    # no prose to head, and a heading there would either duplicate what the
    # artwork already says or contradict it. The landmark and alt-text rules
    # below still apply, because those are about whether the page is navigable
    # and readable rather than about how it ranks.
    h1s = [text for level, text in parser.headings if level == 1]
    if name not in MINIMAL and len(h1s) != 1:
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
    # A MINIMAL page still needs <main> and <header> — the first so assistive
    # technology can reach the content, the second because it carries the only
    # link out. It does not need a <footer>, having no secondary navigation to
    # put in one.
    required_landmarks = ("main", "header") if name in MINIMAL else ("main", "header", "footer")
    for landmark in required_landmarks:
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
    og_urls = parser.meta_values.get("og:url", [])
    if len(og_urls) != 1:
        fail(f"{name}: expected exactly one og:url, found {len(og_urls)}")
    elif og_urls[0] != parser.canonical:
        fail(f"{name}: og:url disagrees with canonical ({og_urls[0]} vs "
             f"{parser.canonical})")

    # --- internal linking -------------------------------------------------
    # A section index is linked at its directory URL, not at index.html —
    # "../mabayani/" is how every link to it is written. Counting only hrefs
    # ending in .html made those links invisible, so a page reached solely that
    # way was reported as orphaned when it was linked from two places.
    internal = [href for href in parser.links
                if not href.startswith(("http", "//", "mailto:", "tel:", "#"))
                and (href.endswith(".html") or href.endswith("/"))]
    here = Path(name).parent
    for href in internal:
        target = href.split("#")[0].split("?")[0]
        if target.endswith("/"):
            target += "index.html"
        resolved = posixpath.normpath((here / target).as_posix()).lstrip("/")
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
    # can work from. Contact is a reviewed form. The exceptions are the pages
    # where a published address of record is the point: the trust page, and the
    # privacy notice, which must name a contact for data-rights requests.
    if name not in {"trust.html", "privacy.html"}:
        for href in parser.links:
            if href.lower().startswith("mailto:"):
                fail(f"{name}: Contact must route through contact.html, not a "
                     f"mailto link ({href})")

    # --- structured data --------------------------------------------------
    for block in parser.jsonld:
        try:
            graph = json.loads(block)
        except json.JSONDecodeError as error:
            fail(f"{name}: structured data is not valid JSON: {error}")
            continue

        for url in site_urls(graph):
            parsed = urlsplit(url)
            if parsed.scheme != "https" or parsed.netloc != CANONICAL_HOST:
                fail(f"{name}: structured data uses a non-canonical site URL: "
                     f"{url}")

        # Structured data identifies the page it is on. On a page that
        # canonicalizes elsewhere those are different URLs, and the schema must
        # keep describing this page rather than adopting the other one's
        # identity — two documents claiming one @id is worse than a page whose
        # canonical and @id differ on purpose.
        _self = (f"{SITE}/" if name == "index.html"
                 else f"{SITE}/{name[:-len('index.html')]}" if name.endswith("/index.html")
                 else f"{SITE}/{name}")

        for entity in page_entities(graph):
            entity_url = entity.get("url")
            if isinstance(entity_url, str) and entity_url != _self:
                fail(f"{name}: {entity.get('@type')} schema URL disagrees with "
                     f"the page's own URL ({entity_url} vs {_self})")

            entity_id = entity.get("@id")
            if (isinstance(entity_id, str)
                    and urlsplit(entity_id).hostname in {
                        "masinloc-zambales.com", CANONICAL_HOST}
                    and not (entity_id == _self
                             or entity_id.startswith(_self + "#"))):
                fail(f"{name}: {entity.get('@type')} schema @id disagrees with "
                     f"canonical ({entity_id} vs {parser.canonical})")

            main = entity.get("mainEntityOfPage")
            if isinstance(main, dict):
                main = main.get("@id")
            if isinstance(main, str) and not (main == _self
                                              or main.startswith(_self + "#")):
                fail(f"{name}: mainEntityOfPage disagrees with the page's own URL "
                     f"({main} vs {_self})")

# Every public page should be reachable from somewhere else on the site.
for name, sources in inbound.items():
    if name in PRIVATE or name in {"index.html", "404.html"}:
        continue
    if not sources:
        notes.append(f"{name} is not linked from any other page")

# FAQ markup has to be backed by text a reader can see. Declaring questions and
# answers that appear nowhere on the page is hidden crawler content: it asks
# search engines and answer engines to quote something no visitor is shown, and
# it is against Google's own structured-data rules for FAQPage.
#
# Found live: trust.html declared "How does Masinloc Connect protect personal
# information?", which the page never asked. The page said the same thing under
# a statement heading, so the markup was corrected to the four questions the
# page really does ask rather than by adding text to justify the markup.
for page in pages:
    raw = page.read_text(encoding="utf-8")
    if '"FAQPage"' not in raw:
        continue
    visible = re.sub(r"<script.*?</script>", " ", raw, flags=re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    visible = re.sub(r"\s+", " ", visible).lower()
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                            raw, re.S):
        try:
            graph = json.loads(block)
        except json.JSONDecodeError:
            continue

        def questions(node):
            found = []
            if isinstance(node, dict):
                if node.get("@type") == "Question":
                    found.append(node)
                for value in node.values():
                    found += questions(value)
            elif isinstance(node, list):
                for value in node:
                    found += questions(value)
            return found

        for question in questions(graph):
            name = str(question.get("name", "")).strip().rstrip("?")
            answer = str(question.get("acceptedAnswer", {}).get("text", "")).strip()
            if name and name.lower() not in visible:
                errors.append(f"{page.name}: FAQ markup asks \"{name}?\" but the "
                              f"page never does — hidden crawler content")
            if answer and answer[:70].lower() not in visible:
                errors.append(f"{page.name}: the FAQ answer to \"{name}?\" is not "
                              f"visible on the page")

if errors:
    print("SEO CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

public = [p.relative_to(ROOT).as_posix() for p in pages
          if p.relative_to(ROOT).as_posix() not in PRIVATE]
public_noindex = [name for name in public
                  if re.search(r'<meta\s+name="robots"[^>]*content="[^"]*noindex',
                               (ROOT / name).read_text(encoding="utf-8"), re.I)]
print("SEO CHECK PASSED")
print(f"{len(public) - len(public_noindex)} indexable pages plus "
      f"{len(public_noindex)} public noindex error surface: unique "
      f"titles and descriptions, one H1 each, "
      f"exact www canonicals, sitemap agreement, Open Graph and Twitter card, "
      f"valid site-owned schema URLs, described alt text, and internal links "
      f"with meaningful anchors.")
if notes:
    print()
    print("For review:")
    for note in notes:
        print(f"  - {note}")
