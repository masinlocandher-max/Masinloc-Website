#!/usr/bin/env python3
"""Build the Discover Masinloc section from data/discover.json.

Discover is where all the reading lives: the outward-facing editorial articles
written for somebody who does not live here, the MABAYANI research sequence,
the verified record, and the questions the evidence has not closed. One library
with one front door. The Masinloc Bulletin is no longer a second one — it is
the editorial publication, where announcements and news get posted.

Nothing is restated across pages. An article that competes with one of our own
for the same search is a page we maintain twice and a reader we split in half,
so each collection is listed here and read where it lives.

Everything the pages need is in the data file. This script owns the shell, the
metadata, the structured data and the layout, so that a correction to a fact is
a correction to one JSON value rather than to prose, metadata and schema in
three places that then drift apart.

Two rules are enforced here rather than trusted:

  - HEROES ARE NEVER CROPPED. The approved originals arrive with the branded
    treatment already applied — logo, geometric ribbons, location label and
    footer line are part of the artwork. Each image keeps its native aspect
    ratio, declared in data/discover-assets.json, and the page is built around
    whatever that is.

  - NO FAQ MARKUP. These articles came out of search-intent research and must
    not read, or be marked up, as an FAQ directory.

Usage
-----
    python3 scripts/build-discover.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "discover"
DATA = json.loads((ROOT / "data" / "discover.json").read_text(encoding="utf-8"))
ASSETS = {}
_assets_file = ROOT / "data" / "discover-assets.json"
if _assets_file.is_file():
    ASSETS = json.loads(_assets_file.read_text(encoding="utf-8"))
LOCATION_META = {
    location["slug"]: location
    for location in json.loads(
        (ROOT / "data" / "locations.json").read_text(encoding="utf-8")
    )["locations"]
}

SITE = "https://www.masinloc-zambales.com"
SECTION = DATA["section"]
THEMES = {t["id"]: t for t in DATA["themes"]}
ARTICLES = DATA["articles"]
BY_SLUG = {a["slug"]: a for a in ARTICLES}
FACTS = DATA["currentFacts"]

# The other two collections. Discover is the home of every article on this
# site, so the hub has to be able to list them — but it lists them, it does not
# absorb them.
#
# MABAYANI is a SEQUENCE, not a set. Every article carries `order` and `next`,
# and the tenth one is a reveal that only lands if you arrived through the nine
# before it. Flattening that into a filterable grid would not be tidying, it
# would be deleting the argument. So it keeps its own renderer, its own URLs
# and its own reading order, and appears here as what it is.
#
# Verified History is the settled record: the conclusions the sequence argues
# for. It keeps its own page for the same reason.
BULLETIN = json.loads((ROOT / "data" / "bulletin.json").read_text(encoding="utf-8"))
HISTORY = json.loads((ROOT / "data" / "history.json").read_text(encoding="utf-8"))

# Where each hero family lives, and the widths built for it.
FAMILY = {
    "discover": ("assets/discover", [640, 960, 1280, 1672]),
    "locations": ("assets/locations", [640, 960, 1280, 1600, 1920]),
    "stage1": ("assets/stage1", None),
}


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def available(family: str, name: str, ext: str) -> list[int]:
    directory, ladder = FAMILY[family]
    found = []
    for path in (ROOT / directory).glob(f"{name}-*.{ext}"):
        match = re.fullmatch(rf"{re.escape(name)}-(\d+)", path.stem)
        if match:
            found.append(int(match.group(1)))
    return sorted(found)


def picture(hero: dict, *, eager: bool, classes: str = "d-hero-img",
            sizes: str = "(min-width: 900px) 860px, 100vw") -> str:
    """A hero at its own native ratio. Never cropped, never letterboxed.

    `sizes` is a parameter because the hub no longer draws every image at one
    width. A card in a three-up row and a feature spanning the whole measure
    are an order of magnitude apart, and a single hint would either send a
    thumbnail-sized file to a full-width photograph or a full-width file to a
    thumbnail. The shapes below pass their own.
    """
    family, name = hero["family"], hero["name"]
    directory, _ = FAMILY[family]

    if family == "stage1":
        # The one shared editorial photograph, a single byte-locked AVIF.
        return (f'<img class="{classes}" src="../{directory}/{name}.avif" '
                f'width="1536" height="864" alt="{esc(hero["alt"])}" '
                + ('fetchpriority="high" decoding="async"' if eager
                   else 'loading="lazy" decoding="async"') + ">")

    jpgs = available(family, name, "jpg")
    if not jpgs:
        return ""

    def srcset(ext: str) -> str:
        widths = available(family, name, ext)
        return ", ".join(f"../{directory}/{name}-{w}.{ext} {w}w" for w in widths)

    dims = ""
    meta = ASSETS.get(name) or LOCATION_META.get(name)
    if meta:
        dims = f' width="{meta["native"]["width"]}" height="{meta["native"]["height"]}"'

    loading = ('fetchpriority="high" decoding="async"' if eager
               else 'loading="lazy" decoding="async"')
    avif = srcset("avif")
    webp = srcset("webp")
    return (
        "<picture>"
        + (f'<source type="image/avif" sizes="{sizes}" srcset="{avif}">' if avif else "")
        + (f'<source type="image/webp" sizes="{sizes}" srcset="{webp}">' if webp else "")
        + f'<img class="{classes}" src="../{directory}/{name}-{jpgs[-1]}.jpg" '
          f'sizes="{sizes}" srcset="{srcset("jpg")}"{dims} '
          f'alt="{esc(hero["alt"])}" {loading}>'
        + "</picture>"
    )


def nav(active: str) -> str:
    def item(href: str, label: str, cls: str = "") -> str:
        classes = [c for c in [cls, "active" if label == active else ""] if c]
        attrs = f' class="{" ".join(classes)}"' if classes else ""
        current = ' aria-current="page"' if label == active else ""
        return f'<a{attrs} href="{href}"{current}>{label}</a>'

    return f"""<header class="site-nav" id="siteNav">
  <a class="brand" href="../index.html" aria-label="Masinloc, Zambales home"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    {item("index.html", "Discover")}
    {item("../sambal-tina.html", "Sambal Tina")}
    {item("../marketplace.html", "Marketplace")}
    {item("../a-closer-look.html", "About Masinloc")}
    {item("../connect.html", "Masinloc Connect", "connect-link")}
  </nav>
</header>"""


FOOTER = """<footer class="home-footer">
  <div class="footer-brand"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="../index.html">Home</a><a href="index.html">Discover</a><a href="../sambal-tina.html">Sambal Tina</a><a href="../marketplace.html">Marketplace</a><a href="../a-closer-look.html">About Masinloc</a><a href="../connect.html">Masinloc Connect</a><a href="../verified-history.html">Verified History</a><a href="../masinloc-bulletin.html">Masinloc Bulletin</a><a href="../sources.html">Sources &amp; References</a><a href="../contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>"""


def head(*, title: str, description: str, url: str, image: str | None,
         extra: str = "") -> str:
    og_image = image or f"{SITE}/assets/stage1/masinloc-hero.avif"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{url}">
<meta property="og:type" content="{'article' if extra else 'website'}">
<meta property="og:site_name" content="Discover Masinloc">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{og_image}">
{extra}<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<link rel="stylesheet" href="../tokens.css?v=20260823-1">
<link rel="stylesheet" href="../site.css?v=20260825-2">
<link rel="stylesheet" href="../site-polish.css?v=20260825-2">
<link rel="stylesheet" href="../discover.css?v=20260827-2">
<link rel="stylesheet" href="../site-stability.css?v=20260825-1">
</head>
<!-- The shared navigation paints white links on a transparent bar, which works
     over the full-bleed photograph on Places and disappears completely on a
     white editorial page. .about-page is the existing light-page treatment used
     by Contact, Trust and Sources: a sticky white bar with dark links. Without
     it the navigation on every Discover page is invisible — measured at 1.00:1
     by the contrast suite, which is what caught this. -->
<body class="about-page">"""


def crumbs(trail: list[tuple[str, str | None]]) -> str:
    items = []
    for label, href in trail:
        if href:
            items.append(f'<li><a href="{href}">{esc(label)}</a></li>')
        else:
            items.append(f'<li><span aria-current="page">{esc(label)}</span></li>')
    return ('<nav class="crumbs" aria-label="Breadcrumb">\n    <ol>\n      '
            + "\n      ".join(items) + "\n    </ol>\n  </nav>")


def breadcrumb_ld(trail: list[tuple[str, str]]) -> dict:
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": item}
            for i, (name, item) in enumerate(trail)
        ],
    }


def hero_url(hero: dict | None) -> str | None:
    if not hero:
        return None
    family, name = hero["family"], hero["name"]
    directory, _ = FAMILY[family]
    if family == "stage1":
        return f"{SITE}/{directory}/{name}.avif"
    jpgs = available(family, name, "jpg")
    return f"{SITE}/{directory}/{name}-{jpgs[-1]}.jpg" if jpgs else None


def facts_table() -> str:
    rows = []
    for entry in FACTS.values():
        note = (f'<span class="fact-note">{esc(entry["note"])}</span>'
                if entry.get("note") else "")
        rows.append(
            f'    <div class="fact">'
            f'<dt>{esc(entry["label"])}</dt>'
            f'<dd><strong>{esc(entry["value"])}</strong>{note}'
            f'<span class="fact-src">{esc(entry["source"])} · checked '
            f'{esc(entry["verified"])}</span></dd></div>')
    return ('<dl class="facts">\n' + "\n".join(rows) + "\n  </dl>")


def render_body(article: dict) -> str:
    out = []
    for block in article["body"]:
        kind = block.get("type")
        if kind == "p":
            out.append(f"      <p>{esc(block['text'])}</p>")
        elif kind == "h2":
            out.append(f"      <h2>{esc(block['text'])}</h2>")
        elif kind == "pull":
            out.append(f"      <blockquote class=\"d-pull\"><p>{esc(block['text'])}</p></blockquote>")
        elif kind == "note":
            out.append(
                f'      <aside class="d-note"><p class="d-note-label">'
                f'{esc(block.get("label", "Note"))}</p><p>{esc(block["text"])}</p></aside>')
        elif kind == "image":
            img = picture(block, eager=False, classes="d-figure-img")
            out.append(f'      <figure class="d-figure">{img}'
                       f'<figcaption>{esc(block["caption"])}</figcaption></figure>')
        elif kind == "links":
            items = "".join(
                f'<li><a href="{esc(i["href"])}">{esc(i["label"])}</a></li>'
                for i in block["items"])
            out.append(f'      <ul class="d-inline-links">{items}</ul>')
        else:
            sys.exit(f"unknown block type in {article['slug']}: {kind}")

        if article.get("currentFacts") and kind == "h2" and "read the dates" in block["text"].lower():
            out.append("      " + facts_table())
    return "\n".join(out)


def sources_block(article: dict) -> str:
    if not article.get("sources"):
        return ""
    items = []
    for source in article["sources"]:
        label = esc(source["label"])
        publisher = esc(source["publisher"])
        if source.get("href"):
            items.append(f'<li><a href="{esc(source["href"])}" rel="noopener">{label}</a>'
                         f'<span>{publisher}</span></li>')
        else:
            items.append(f"<li>{label}<span>{publisher}</span></li>")
    return (f'    <section class="d-sources" aria-labelledby="sources-heading">\n'
            f'      <h2 id="sources-heading">Sources &amp; further reading</h2>\n'
            f'      <ul>{"".join(items)}</ul>\n    </section>\n')


# Where a Discover article and a MABAYANI chapter cover the same subject.
#
# They are not competing: a Discover article answers "what is this, and what
# will I see" — visiting, architecture, what is on the plate, where the beach
# is. The MABAYANI chapter answers "who did this, what does the evidence say,
# and what is still missing". Different questions, different search intent, and
# each says where the other one is so neither has to restate it.
MABAYANI_CHAPTER = {
    "the-church-masinloquenos-walk-past": (
        "17", "Read how generations built, damaged and rebuilt this church"),
    "every-november-masinloc-stages-a-battle": (
        "19", "Read what Binabayani remembers, and what is still unverified"),
    "the-sambal-words-we-refuse-to-lose": (
        "20", "Read how a language disappears quietly, and what holds it"),
    "san-salvador-has-a-better-story": (
        "13", "Read what happened here in 1649, and whose names are missing"),
    "masinloc-history-has-more-than-one-starting-date": (
        "05", "Read what 18 November 1607 does and does not prove"),
    "masinloc-masingloc-and-the-origin-story": (
        "03", "Read why 1572 is a date we inherited rather than one we can prove"),
    "the-giant-in-bani": (
        "24", "Read how Masinloc came to hold industry and a protected sea at once"),
    "how-masinloc-makes-a-living": (
        "23", "Read how the mountain became an industrial landscape"),
}


def mabayani_link(article: dict) -> str:
    """The chapter of MABAYANI that carries the same subject as people."""
    pick = MABAYANI_CHAPTER.get(article["slug"])
    if not pick:
        return ""
    number, label = pick
    return (
        '    <aside class="d-mab-cross">\n'
        '      <p class="d-mab-cross-mark">MABAYANI</p>\n'
        f'      <p class="d-mab-cross-line"><a href="../mabayani/#s{number}">'
        f'{esc(label)}</a></p>\n'
        "    </aside>\n")


def related_block(article: dict) -> str:
    related = [BY_SLUG[s] for s in article.get("related", []) if s in BY_SLUG]
    if not related:
        return ""
    cards = []
    for other in related:
        theme = THEMES[other["theme"]]["name"]
        cards.append(
            f'<li class="d-rel"><a href="{other["slug"]}.html">'
            f'<span class="d-rel-theme">{esc(theme)}</span>'
            f'<span class="d-rel-title">{esc(other["title"])}</span>'
            f'<span class="d-rel-deck">{esc(other["deck"][:110])}…</span></a></li>')
    return (f'    <section class="d-related" aria-labelledby="related-heading">\n'
            f'      <h2 id="related-heading">Keep reading</h2>\n'
            f'      <ul>{"".join(cards)}</ul>\n    </section>\n')


def article_page(article: dict) -> str:
    url = f"{SITE}/discover/{article['slug']}.html"
    image = hero_url(article.get("hero"))
    theme = THEMES[article["theme"]]
    meta_title = article.get("metaTitle", f"{article['title']} | Discover Masinloc")
    meta_description = article.get("metaDescription", article["deck"])

    graph = [
        breadcrumb_ld([
            ("Masinloc, Zambales", f"{SITE}/"),
            ("Discover Masinloc", f"{SITE}/discover/"),
            (article["title"], url),
        ]),
        {
            "@type": "BlogPosting",
            "@id": f"{url}#article",
            "headline": article["title"],
            "description": meta_description,
            "datePublished": article["published"],
            "dateModified": article["updated"],
            "inLanguage": "en-PH",
            "isPartOf": {"@id": f"{SITE}/discover/#blog"},
            "mainEntityOfPage": {"@type": "WebPage", "@id": url},
            "author": {"@type": "Organization", "name": "Discover Masinloc",
                       "url": f"{SITE}/"},
            "publisher": {"@type": "Organization", "name": "Discover Masinloc",
                          "url": f"{SITE}/"},
            "about": {"@type": "Place", "name": "Masinloc, Zambales, Philippines"},
            **({"image": image} if image else {}),
        },
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph},
                    indent=2, ensure_ascii=False)

    # An article may name a hero whose artwork has not been delivered yet. It
    # opens on type rather than on an empty frame, and picks the image up the
    # moment the asset is built — no edit to the article required.
    hero_markup = ""
    if article.get("hero"):
        img = picture(article["hero"], eager=True)
        if img:
            caption = article["hero"].get("caption")
            hero_markup = (f'  <figure class="d-hero">{img}'
                           + (f"<figcaption>{esc(caption)}</figcaption>" if caption else "")
                           + "</figure>\n")

    extra = (f'<meta property="article:published_time" content="{article["published"]}">\n'
             f'<meta property="article:modified_time" content="{article["updated"]}">\n')

    published = article["published"]
    updated = article["updated"]
    updated_line = ("" if published == updated
                    else f' · <span>Updated <time datetime="{updated}">{updated}</time></span>')

    return f"""{head(title=meta_title,
                     description=meta_description, url=url, image=image, extra=extra)}
{nav("Discover")}
<main class="d-article">
  {crumbs([("Masinloc, Zambales", "../index.html"),
           ("Discover", "index.html"),
           (article["title"], None)])}
  <header class="d-head">
    <p class="d-theme">{esc(theme["name"])}</p>
    <h1>{esc(article["title"])}</h1>
    <p class="d-deck">{esc(article["deck"])}</p>
    <p class="d-meta"><span>Published <time datetime="{published}">{published}</time></span>{updated_line}</p>
  </header>
{hero_markup}  <div class="d-body">
{render_body(article)}
  </div>
{sources_block(article)}{mabayani_link(article)}{related_block(article)}</main>
{FOOTER}
<script src="../site.js?v=20260825-1"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


# How each shape draws its promoted article, and the width hint that goes with
# it. The hub is 1180px at most: a feature takes a little over half of that
# beside its copy, a wide one takes the whole measure, and an ordinary card
# takes a third of it in the widest layout.
SHAPES = {
    "cluster": ("d-card-lead", "(min-width: 900px) 58vw, 100vw"),
    "feature": ("d-card-feature", "(min-width: 860px) 56vw, 100vw"),
    "wide": ("d-card-wide", "(min-width: 1220px) 1100px, 100vw"),
}
CARD_SIZES = "(min-width: 1000px) 33vw, (min-width: 620px) 48vw, 100vw"


def card(article: dict, *, promoted: str = "", sizes: str = CARD_SIZES) -> str:
    thumb = ""
    if article.get("hero"):
        built = picture(article["hero"], eager=False, classes="d-card-img",
                        sizes=sizes)
        if built:
            thumb = f'<span class="d-card-media">{built}</span>'
    classes = " ".join(c for c in ("d-card", promoted,
                                   "" if thumb else "d-card-text") if c)
    return (f'<li class="{classes}">'
            f'<a href="{article["slug"]}.html">{thumb}'
            f'<span class="d-card-body">'
            f'<span class="d-card-title">{esc(article["title"])}</span>'
            f'<span class="d-card-deck">{esc(article["deck"])}</span>'
            f'</span></a></li>')


def theme_section(theme: dict, members: list[dict]) -> str:
    """One theme, drawn in the shape it asks for.

    A theme may name a `shape` and the `feature` article that carries it. The
    shape is honoured only if that article is present in the theme and has a
    photograph actually built for it: every shape here is built around an
    image, so promoting a text card into one would produce a large empty frame
    rather than a feature. Falling back to the plain grid is silent on purpose
    — the hub stays correct while an asset is still being prepared, and picks
    the composition up the moment the file lands.
    """
    shape = theme.get("shape", "grid")
    promoted = None
    if shape in SHAPES:
        wanted = theme.get("feature")
        candidate = next((a for a in members if a["slug"] == wanted), None)
        if candidate and candidate.get("hero") \
                and picture(candidate["hero"], eager=False):
            promoted = candidate
        else:
            shape = "grid"

    if promoted is None:
        cards = [card(a) for a in members]
        grid_class = "d-grid"
    else:
        css_class, sizes = SHAPES[shape]
        rest = [a for a in members if a is not promoted]
        cards = [card(promoted, promoted=css_class, sizes=sizes)] \
            + [card(a) for a in rest]
        grid_class = f"d-grid d-grid--{shape}"

    return (f'  <section class="d-theme" aria-labelledby="theme-{theme["id"]}">\n'
            f'    <div class="d-theme-head">\n'
            f'      <h2 id="theme-{theme["id"]}">{esc(theme["name"])}</h2>\n'
            f'      <p>{esc(theme["blurb"])}</p>\n'
            f'    </div>\n'
            f'    <ul class="{grid_class}">{"".join(cards)}</ul>\n'
            f'  </section>')


def mabayani_feature() -> str:
    """The one door from Discover into MABAYANI.

    MABAYANI outgrew being a Discover article; it is the immersive reading of
    the town's history and its home is About Masinloc. Discover keeps the
    doorway, and keeps it as one of the strongest things on the page — this is
    a promotion, not a place to tuck it away. What Discover no longer holds is
    a copy of its contents.
    """
    return (
        '  <section class="d-mab" aria-labelledby="mab-title">\n'
        '    <div class="d-mab-inner">\n'
        '      <p class="d-mab-mark">MABAYANI</p>\n'
        '      <h2 id="mab-title" class="d-mab-line">They called them fierce.<br>'
        'We call them MABAYANI.</h2>\n'
        '      <p class="d-mab-what">The story of the people who built, defended, '
        'endured and carried Masinloc forward.</p>\n'
        '      <p class="d-mab-teaser">Long before Masinloc entered the written '
        'record, there were already people here. Centuries later, their courage '
        'survives in battles, buildings, language, faith and names we are still '
        'trying to recover.</p>\n'
        '      <p class="d-mab-go"><a href="../mabayani/">Enter the story</a></p>\n'
        '    </div>\n'
        '  </section>')


def questions_section() -> str:
    """The open questions, gathered from the articles that raised them.

    Each one is written once, inside the story that earned it. Collecting them
    here rather than restating them means the two can never drift apart, and it
    keeps the honest part of the research — what is still unsettled — in the
    library beside the stories rather than filed away on another page.
    """
    published = [a for a in BULLETIN["articles"] if a.get("status") == "published"]
    found = []
    for article in sorted(published, key=lambda a: a["order"]):
        for block in article.get("body", []):
            label = str(block.get("label", "")).lower()
            if block.get("type") == "note" and label.startswith("still open"):
                found.append((article, block["text"]))
    if not found:
        return ""

    pieces = []
    for article, text in found:
        pieces.append(
            f'<li class="d-open-item">'
            f'<p class="d-open-q">{esc(text)}</p>'
            f'<p class="d-open-src"><a href="../bulletin/{article["slug"]}.html">'
            f'{esc(article["title"])}</a></p></li>')

    return (
        '  <section class="d-open" aria-labelledby="open-title">\n'
        '    <div class="d-theme-head">\n'
        '      <h2 id="open-title">Still open</h2>\n'
        '      <p>The questions the evidence has not answered yet.</p>\n'
        '    </div>\n'
        f'    <ul class="d-open-list">{"".join(pieces)}</ul>\n'
        '    <p class="d-open-more"><a href="../sources.html">'
        'Every source these stories rest on &rarr;</a></p>\n'
        '  </section>')


def deck(text: str, limit: int = 260) -> str:
    """A card deck ends on a sentence, not in the middle of a clause.

    Cutting at a fixed character count left the Verified History card reading
    "...founded the mission town, a" — a sentence abandoned partway through a
    list. The unit here is one whole sentence, however long it runs. Only a
    sentence longer than the limit falls back to a word boundary, and that one
    says so with an ellipsis instead of just stopping.
    """
    text = " ".join(str(text).split())
    match = re.search(r"(?<=[.!?])\s", text)
    first = text[:match.start()] if match else text
    if len(first) <= limit:
        return first
    return f"{first[:limit].rsplit(' ', 1)[0]}…"


def record_section() -> str:
    """The settled record: what the research concluded."""
    founding = HISTORY.get("founding", {})
    founder = HISTORY.get("founder", {})
    timeline = HISTORY.get("timeline", []) or []
    cards = [
        ('../verified-history.html', 'Verified History',
         founding.get("summary") or founding.get("statement")
         or "The dates, names and events the evidence actually supports.",
         f'{len(timeline)} dated entries' if timeline else ""),
        ('../founder-of-masinloc.html',
         founder.get("name", "The founder of Masinloc"),
         founder.get("summary") or founder.get("role")
         or "The friar named in the founding record.",
         founder.get("years", "")),
    ]
    pieces = []
    for href, title, blurb, meta in cards:
        tail = f'<span class="d-rec-meta">{esc(meta)}</span>' if meta else ""
        pieces.append(
            f'<li class="d-card d-card-text"><a href="{href}">'
            f'<span class="d-card-body">'
            f'<span class="d-card-title">{esc(title)}</span>'
            f'<span class="d-card-deck">{esc(deck(blurb))}</span>'
            f'{tail}</span></a></li>')
    items = "".join(pieces)
    return (
        '  <section class="d-theme" aria-labelledby="record-title">\n'
        '    <div class="d-theme-head">\n'
        '      <h2 id="record-title">The verified record</h2>\n'
        '      <p>What the research settled, kept apart from the stories.</p>\n'
        '    </div>\n'
        f'    <ul class="d-grid">{items}</ul>\n'
        '  </section>')


def hub_page() -> str:
    url = f"{SITE}/discover/"
    lead = BY_SLUG[SECTION["lead"]]
    rest = [a for a in ARTICLES if a["slug"] != lead["slug"]]

    graph = [
        breadcrumb_ld([("Masinloc, Zambales", f"{SITE}/"),
                       ("Discover Masinloc", url)]),
        {
            "@type": "Blog",
            "@id": f"{url}#blog",
            "name": "Discover Masinloc",
            "description": SECTION["intro"],
            "url": url,
            "inLanguage": "en-PH",
            "publisher": {"@type": "Organization", "name": "Discover Masinloc",
                          "url": f"{SITE}/"},
            "blogPost": [
                {"@type": "BlogPosting",
                 "headline": a["title"],
                 "description": a["deck"],
                 "datePublished": a["published"],
                 "dateModified": a["updated"],
                 "url": f"{SITE}/discover/{a['slug']}.html"}
                for a in ARTICLES
            ],
        },
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph},
                    indent=2, ensure_ascii=False)

    lead_img = picture(lead["hero"], eager=True, classes="d-lead-img") if lead.get("hero") else ""

    sections = []
    for theme in DATA["themes"]:
        members = [a for a in rest if a["theme"] == theme["id"]]
        if not members:
            continue
        sections.append(theme_section(theme, members))

    return f"""{head(title=SECTION.get("metaTitle", "Discover Masinloc | Masinloc, Zambales"),
                     description=SECTION.get("metaDescription", SECTION["intro"]), url=url,
                     image=hero_url(lead.get("hero")))}
{nav("Discover")}
<main class="d-hub">
  {crumbs([("Masinloc, Zambales", "../index.html"), ("Discover", None)])}
  <header class="d-hub-head">
    <p class="d-hub-kicker">{esc(SECTION["tagline"])}</p>
    <h1>Discover Masinloc</h1>
    <p class="d-hub-intro">{esc(SECTION["intro"])}</p>
    <p class="d-hub-note">{esc(SECTION["note"])}</p>
  </header>

  <section class="d-lead" aria-labelledby="lead-title">
    <a class="d-lead-link" href="{lead["slug"]}.html">
      <span class="d-lead-media">{lead_img}</span>
      <span class="d-lead-copy">
        <span class="d-lead-theme">{esc(THEMES[lead["theme"]]["name"])}</span>
        <span class="d-lead-title" id="lead-title">{esc(lead["title"])}</span>
        <span class="d-lead-deck">{esc(lead["deck"])}</span>
        <span class="d-lead-go">Start here</span>
      </span>
    </a>
  </section>

{chr(10).join(sections)}

{mabayani_feature()}

{record_section()}

{questions_section()}
</main>
{FOOTER}
<script src="../site.js?v=20260825-1"></script>
<script src="../bulletin.js?v=20260825-2"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


def main() -> int:
    OUT.mkdir(exist_ok=True)

    # A shape names the article that carries it. A missing photograph is
    # handled gracefully at render time, but a misspelled slug, an article
    # filed under a different theme, or a feature that is also the section
    # lead — and therefore never appears in any theme — are all typos, and a
    # typo that silently downgrades the composition is a typo nobody finds.
    for theme in DATA["themes"]:
        shape = theme.get("shape", "grid")
        if shape == "grid":
            if theme.get("feature"):
                sys.exit(f"theme {theme['id']}: names a feature but no shape")
            continue
        if shape not in SHAPES:
            sys.exit(f"theme {theme['id']}: unknown shape {shape!r}")
        slug = theme.get("feature")
        if slug not in BY_SLUG:
            sys.exit(f"theme {theme['id']}: feature {slug!r} does not exist")
        if BY_SLUG[slug]["theme"] != theme["id"]:
            sys.exit(f"theme {theme['id']}: feature {slug!r} is filed under "
                     f"{BY_SLUG[slug]['theme']!r}")
        if slug == SECTION["lead"]:
            sys.exit(f"theme {theme['id']}: feature {slug!r} is the section "
                     f"lead, so it never appears in a theme")

    # A theme with no articles would render an empty heading.
    for article in ARTICLES:
        if article["theme"] not in THEMES:
            sys.exit(f"{article['slug']}: unknown theme {article['theme']}")
        for slug in article.get("related", []):
            if slug not in BY_SLUG:
                sys.exit(f"{article['slug']}: related article {slug} does not exist")

    (OUT / "index.html").write_text(hub_page(), encoding="utf-8")
    for article in ARTICLES:
        (OUT / f"{article['slug']}.html").write_text(article_page(article),
                                                     encoding="utf-8")

    print(f"built discover/index.html and {len(ARTICLES)} articles")
    for theme in DATA["themes"]:
        members = [a for a in ARTICLES if a["theme"] == theme["id"]]
        print(f"  {theme['name']}: {len(members)}")
    withhero = sum(1 for a in ARTICLES if a.get("hero"))
    print(f"{withhero} of {len(ARTICLES)} carry a hero image; "
          f"{len(ARTICLES) - withhero} use a text opening rather than a borrowed photograph")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
