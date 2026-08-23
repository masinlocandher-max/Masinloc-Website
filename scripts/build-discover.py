#!/usr/bin/env python3
"""Build the Discover Masinloc section from data/discover.json.

Discover is the outward-facing editorial layer: written for somebody who does
not live here and has no particular question yet. It is deliberately a
different thing from the Masinloc Bulletin, which is the MABAYANI research
record. Where the two touch the same subject, Discover links to the Bulletin
rather than restating it — an article that competes with one of our own pages
for the same search is a page we have to maintain twice and a reader we have
split in half.

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

SITE = "https://masinloc-zambales.com"
SECTION = DATA["section"]
THEMES = {t["id"]: t for t in DATA["themes"]}
ARTICLES = DATA["articles"]
BY_SLUG = {a["slug"]: a for a in ARTICLES}
FACTS = DATA["currentFacts"]

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


def picture(hero: dict, *, eager: bool, classes: str = "d-hero-img") -> str:
    """A hero at its own native ratio. Never cropped, never letterboxed."""
    family, name = hero["family"], hero["name"]
    directory, _ = FAMILY[family]

    if family == "stage1":
        # The one shared editorial photograph, a single byte-locked AVIF.
        return (f'<img class="{classes}" src="../{directory}/{name}.avif" '
                f'alt="{esc(hero["alt"])}" '
                + ('fetchpriority="high" decoding="async"' if eager
                   else 'loading="lazy" decoding="async"') + ">")

    jpgs = available(family, name, "jpg")
    if not jpgs:
        return ""
    sizes = "(min-width: 900px) 860px, 100vw"

    def srcset(ext: str) -> str:
        widths = available(family, name, ext)
        return ", ".join(f"../{directory}/{name}-{w}.{ext} {w}w" for w in widths)

    dims = ""
    meta = ASSETS.get(name)
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
    {item("../index.html", "Home")}
    {item("index.html", "Discover")}
    {item("../a-closer-look.html", "A Closer Look")}
    {item("../verified-history.html", "Verified History")}
    {item("../masinloc-bulletin.html", "Masinloc Bulletin")}
    {item("../connect.html", "Masinloc Connect", "connect-link")}
    {item("../contact.html", "Contact")}
  </nav>
</header>"""


FOOTER = """<footer class="home-footer">
  <div class="footer-brand"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="../index.html">Home</a><a href="index.html">Discover</a><a href="../a-closer-look.html">A Closer Look</a><a href="../verified-history.html">Verified History</a><a href="../masinloc-bulletin.html">Masinloc Bulletin</a><a href="../connect.html">Masinloc Connect</a><a href="../contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Masinloc. All rights reserved.</span><span>Photography · Mabayani Project by FMB</span></div>
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
<meta name="robots" content="index,follow,max-image-preview:large">
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
<link rel="stylesheet" href="../tokens.css?v=20260822-1">
<link rel="stylesheet" href="../site.css?v=20260820-1">
<link rel="stylesheet" href="../site-polish.css?v=20260820-1">
<link rel="stylesheet" href="../discover.css?v=20260823-1">
<link rel="stylesheet" href="../site-stability.css?v=20260821-1">
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
            "description": article["deck"],
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

    return f"""{head(title=f"{article['title']} | Discover Masinloc",
                     description=article["deck"], url=url, image=image, extra=extra)}
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
{sources_block(article)}{related_block(article)}</main>
{FOOTER}
<script src="../site.js?v=20260820-2"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


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
        cards = []
        for article in members:
            thumb = ""
            if article.get("hero"):
                built = picture(article["hero"], eager=False, classes="d-card-img")
                if built:
                    thumb = f'<span class="d-card-media">{built}</span>'
            cards.append(
                f'<li class="d-card{" d-card-text" if not thumb else ""}">'
                f'<a href="{article["slug"]}.html">{thumb}'
                f'<span class="d-card-body">'
                f'<span class="d-card-title">{esc(article["title"])}</span>'
                f'<span class="d-card-deck">{esc(article["deck"])}</span>'
                f'</span></a></li>')
        sections.append(
            f'  <section class="d-theme" aria-labelledby="theme-{theme["id"]}">\n'
            f'    <div class="d-theme-head">\n'
            f'      <h2 id="theme-{theme["id"]}">{esc(theme["name"])}</h2>\n'
            f'      <p>{esc(theme["blurb"])}</p>\n'
            f'    </div>\n'
            f'    <ul class="d-grid">{"".join(cards)}</ul>\n'
            f'  </section>')

    return f"""{head(title="Discover Masinloc | Masinloc, Zambales",
                     description=SECTION["intro"], url=url,
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
</main>
{FOOTER}
<script src="../site.js?v=20260820-2"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


def main() -> int:
    OUT.mkdir(exist_ok=True)

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
