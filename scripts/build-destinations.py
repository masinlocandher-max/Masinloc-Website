#!/usr/bin/env python3
"""Render destinations.html from data/locations.json.

The page is generated rather than hand-maintained so the mapping of
photograph to place lives in exactly one file. Every location section is
static HTML: the photographs, names, localities and rhymes are all present
without JavaScript, which only adds the viewer and the scroll behaviour.

Usage
-----
    python3 scripts/build-destinations.py
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "locations.json"
PAGE = ROOT / "destinations.html"

WIDTHS = [480, 768, 1120, 1536, 2048]
CARD_WIDTHS = [600, 1200]
SIZES = "100vw"

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#03112F">
<title>Places in Masinloc, Zambales | Rivers, Coast &amp; Heritage</title>
<meta name="description" content="Eight places in Masinloc, Zambales: Hamat River, San Salvador Island, Coto Kidz Pool, San Andres Church, Bunga Cave, Bacala Sandbar, Sitio Buri and the Baywalk.">
<link rel="canonical" href="https://masinloc-zambales.com/destinations.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="Places in Masinloc, Zambales | Rivers, Coast &amp; Heritage">
<meta property="og:description" content="Eight documented places in Masinloc, Zambales: the river, the island, the cave, the church, the sandbar and the baywalk.">
<meta property="og:url" content="https://masinloc-zambales.com/destinations.html">
<meta property="og:image" content="https://masinloc-zambales.com/assets/stage1/masinloc-hero.avif">
<meta property="og:image:alt" content="Masinloc, Zambales from the air">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Places in Masinloc, Zambales | Rivers, Coast &amp; Heritage">
<meta name="twitter:description" content="Eight documented places in Masinloc, Zambales: the river, the island, the cave, the church, the sandbar and the baywalk.">
<meta name="twitter:image" content="https://masinloc-zambales.com/assets/stage1/masinloc-hero.avif">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="tokens.css?v=20260823-1">
<link rel="stylesheet" href="site.css?v=20260821-1">
<link rel="stylesheet" href="site-polish.css?v=20260820-1">
<link rel="stylesheet" href="destinations.css?v=20260823-1">
<link rel="stylesheet" href="site-stability.css?v=20260823-1">
</head>
<body class="about-page places-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="index.html">Home</a><a href="discover/index.html">Discover</a>
    <a class="active" href="a-closer-look.html" aria-current="page">A Closer Look</a>
    <a href="verified-history.html">Verified History</a>
    <a href="masinloc-bulletin.html">Masinloc Bulletin</a>
    <a class="connect-link" href="connect.html">Masinloc Connect</a>
    <a href="contact.html">Contact</a>
  </nav>
</header>

<main id="main">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="index.html">Masinloc, Zambales</a></li>
      <li><a href="a-closer-look.html">A Closer Look</a></li>
      <li><span aria-current="page">Places</span></li>
    </ol>
  </nav>

  <section class="places-hero">
    <p class="section-label">A Closer Look · Places</p>
    <h1>The places we<br>grew up in.</h1>
    <p class="lead">{count_word} places in Masinloc, Zambales, each photographed where it actually is and written down with the barangay it belongs to. Most of us grew up in them; nobody had put them in one place before.</p>
    <a class="places-scroll" href="#{first}">Start at {first_name}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v13M7 13l5 5 5-5"/></svg></a>
  </section>

  <nav class="places-index" aria-label="Places">
    <ol>
{index}
    </ol>
  </nav>

"""

FOOT = """</main>

<div class="viewer" id="viewer" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="viewerName">
  <button class="viewer-close" id="viewerClose" type="button" aria-label="Close">&times;</button>
  <figure class="viewer-figure">
    <img id="viewerImage" src="" alt="">
    <figcaption>
      <p class="viewer-name" id="viewerName"></p>
      <p class="viewer-locality"></p>
    </figcaption>
  </figure>
  <button class="viewer-nav viewer-prev" id="viewerPrev" type="button" aria-label="Previous place">&#8249;</button>
  <button class="viewer-nav viewer-next" id="viewerNext" type="button" aria-label="Next place">&#8250;</button>
</div>

<footer class="home-footer">
  <div class="footer-brand"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="marketplace.html">Marketplace</a><a href="a-closer-look.html">A Closer Look</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="connect.html">Masinloc Connect</a><a href="contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Masinloc. All rights reserved.</span><span>Photography · Mabayani Project by FMB</span></div>
</footer>
{jsonld}
<script src="site.js?v=20260820-2"></script>
<script src="destinations.js?v=20260821-4"></script>
</body>
</html>
"""


ASSETS = ROOT / "assets" / "locations"


def available(slug: str, extension: str, widths: list[int], suffix: str = "") -> list[int]:
    """Widths that were actually produced. Originals differ in resolution and
    are never upscaled, so a shared list would advertise files that do not
    exist."""
    found = [width for width in widths
             if (ASSETS / f"{slug}{suffix}-{width}.{extension}").is_file()]
    return found or widths[:1]


def srcset(slug: str, extension: str, suffix: str = "",
           widths: list[int] | None = None) -> str:
    widths = widths or WIDTHS
    return ", ".join(
        f"assets/locations/{slug}{suffix}-{width}.{extension} {width}w"
        for width in available(slug, extension, widths, suffix)
    )


def largest(slug: str, extension: str, suffix: str = "",
            widths: list[int] | None = None) -> int:
    return available(slug, extension, widths or WIDTHS, suffix)[-1]


def section(location: dict, position: int, total: int) -> str:
    slug = location["slug"]
    esc = {key: html.escape(str(value)) for key, value in location.items()
           if isinstance(value, str)}
    todo = "".join(f"<li>{html.escape(item)}</li>" for item in location["todo"])
    # Where the Bulletin has actually researched this place, say so here rather
    # than in a block of links at the foot of the page. It reads as part of the
    # entry because it is: somebody looking at the church is exactly the person
    # who wants its history. Places without research get nothing — an empty
    # "related reading" heading is worse than none.
    reads = ""
    if location.get("reads"):
        link = location["reads"]
        reads = (f'      <p class="place-reads">'
                 f'<a href="{html.escape(link["href"])}">'
                 f'{html.escape(link["label"])}</a></p>\n')
    tags = "".join(f"<li>{html.escape(tag)}</li>" for tag in location["tags"])
    # The first photograph is the page's largest paint; it loads eagerly and at
    # high priority. The rest wait until they are near the viewport.
    first = position == 1
    loading = 'fetchpriority="high" decoding="async"' if first \
        else 'loading="lazy" decoding="async"'

    return f"""  <section class="place" id="{slug}" data-place="{slug}" data-index="{position}" aria-labelledby="{slug}-name" style="--place-focus:{esc.get('focus', '50% 50%')}">
    <figure class="place-media">
      <picture>
        <source type="image/avif" srcset="{srcset(slug, 'avif')}" sizes="{SIZES}">
        <source type="image/webp" srcset="{srcset(slug, 'webp')}" sizes="{SIZES}">
        <img src="assets/locations/{slug}-{largest(slug, 'jpg')}.jpg" srcset="{srcset(slug, 'jpg')}" sizes="{SIZES}"
             alt="{esc['alt']}" {loading}>
      </picture>
      <span class="place-scrim" aria-hidden="true"></span>
    </figure>
    <div class="place-copy">
      <p class="place-index" aria-hidden="true">{position:02d}<span>/{total:02d}</span></p>
      <h2 class="place-name" id="{slug}-name">{esc['name']}</h2>
      <p class="place-locality">{esc['locality']}</p>
      <p class="place-rhyme">{esc['rhyme']}</p>
      <p class="place-caption">{esc['caption']}</p>
{reads}
      <div class="place-detail">
        <div class="place-todo">
          <h3>Things to do</h3>
          <ul>{todo}</ul>
        </div>
        <ul class="place-tags">{tags}</ul>
      </div>
      <div class="place-actions">
        <button class="place-open" type="button" data-open="{slug}">See it bigger</button>
        <a class="place-card" href="assets/locations/{slug}-card-{largest(slug, 'jpg', '-card', CARD_WIDTHS)}.jpg" download>Save the card</a>
      </div>
    </div>
  </section>

"""



def structured_data(locations: list[dict]) -> str:
    """BreadcrumbList plus a Place for each documented location."""
    site = "https://masinloc-zambales.com"
    places = []
    for loc in locations:
        slug = loc["slug"]
        places.append({
            "@type": "Place",
            "@id": f"{site}/destinations.html#{slug}",
            "name": loc["name"],
            "description": loc["caption"],
            "image": f"{site}/assets/locations/{slug}-{largest(slug, 'jpg')}.jpg",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": "Masinloc",
                "addressRegion": "Zambales",
                "addressCountry": "PH",
            },
            "containedInPlace": {"@id": f"{site}/#place"},
        })
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales",
                     "item": f"{site}/"},
                    {"@type": "ListItem", "position": 2, "name": "A Closer Look",
                     "item": f"{site}/a-closer-look.html"},
                    {"@type": "ListItem", "position": 3, "name": "Places",
                     "item": f"{site}/destinations.html"},
                ],
            },
            {
                "@type": "CollectionPage",
                "@id": f"{site}/destinations.html#webpage",
                "url": f"{site}/destinations.html",
                "name": "Places in Masinloc, Zambales",
                "isPartOf": {"@id": f"{site}/#website"},
                "inLanguage": "en-PH",
                "hasPart": [{"@id": place["@id"]} for place in places],
            },
            *places,
        ],
    }
    return ('<script type="application/ld+json">\n'
            + json.dumps(graph, indent=2, ensure_ascii=False)
            + "\n</script>")


COUNT_WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
               6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten"}


def main() -> int:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    locations = payload["locations"]
    total = len(locations)
    if not total:
        sys.exit("data/locations.json lists no locations")

    index = "\n".join(
        f'      <li><a href="#{loc["slug"]}"><span>{position:02d}</span>'
        f'{html.escape(loc["name"])}</a></li>'
        for position, loc in enumerate(locations, start=1)
    )

    body = "".join(
        section(loc, position, total)
        for position, loc in enumerate(locations, start=1)
    )

    page = HEAD.format(
        count=total,
        count_word=COUNT_WORDS.get(total, str(total)),
        first=locations[0]["slug"],
        first_name=html.escape(locations[0]["name"]),
        index=index,
    ) + body + FOOT.format(jsonld=structured_data(locations))

    PAGE.write_text(page, encoding="utf-8")
    print(f"wrote {PAGE.relative_to(ROOT)} — {total} places")
    return 0


if __name__ == "__main__":
    sys.exit(main())
