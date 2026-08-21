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

WIDTHS = [640, 1024, 1600, 2400]
SIZES = "100vw"

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#03112F">
<title>The places we grew up in</title>
<meta name="description" content="Eight places in Masinloc, Zambales — Hamat River, San Salvador Island, Coto Kidz Pool, San Andres Church, Bunga Cave, Bacala Sandbar, Sitio Buri and the Baywalk — photographed and written down by Masinloqueños.">
<link rel="canonical" href="https://masinloc-zambales.com/destinations.html">
<meta property="og:type" content="website">
<meta property="og:title" content="The places we grew up in">
<meta property="og:description" content="The river, the island, the cave, the church, the sandbar and the baywalk. Masinloc, Zambales, as we know it.">
<meta property="og:url" content="https://masinloc-zambales.com/destinations.html">
<meta property="og:image" content="https://masinloc-zambales.com/assets/stage1/masinloc-hero.avif">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="tokens.css?v=20260821-4">
<link rel="stylesheet" href="site.css?v=20260820-1">
<link rel="stylesheet" href="site-polish.css?v=20260820-1">
<link rel="stylesheet" href="destinations.css?v=20260821-4">
<link rel="stylesheet" href="site-stability.css?v=20260821-1">
</head>
<body class="about-page places-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="index.html">Home</a>
    <a class="active" href="a-closer-look.html" aria-current="page">A Closer Look</a>
    <a href="verified-history.html">Verified History</a>
    <a href="masinloc-bulletin.html">Masinloc Bulletin</a>
    <a class="connect-link" href="connect.html">Masinloc Connect</a>
    <a href="mailto:hello@masinloc-zambales.com">Contact</a>
  </nav>
</header>

<main id="main">
  <section class="places-hero">
    <p class="section-label">A Closer Look · Places</p>
    <h1>The places we<br>grew up in.</h1>
    <p class="lead">You know these {count} already. Some you swam in every summer, some you pass on the way to work, one you were probably baptised in. Nobody had ever photographed them properly and put them in one place. So we did.</p>
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
  <div class="footer-nav"><a href="index.html">Home</a><a href="a-closer-look.html">A Closer Look</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="connect.html">Masinloc Connect</a><a href="mailto:hello@masinloc-zambales.com">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Masinloc. All rights reserved.</span><span>Photography · Mabayani Project by FMB</span></div>
</footer>
<script src="site.js?v=20260820-2"></script>
<script src="destinations.js?v=20260821-4"></script>
</body>
</html>
"""


def srcset(slug: str, extension: str) -> str:
    return ", ".join(
        f"assets/locations/{slug}-{width}.{extension} {width}w" for width in WIDTHS
    )


def section(location: dict, position: int, total: int) -> str:
    slug = location["slug"]
    esc = {key: html.escape(str(value)) for key, value in location.items()}
    # The first photograph is the page's largest paint; it loads eagerly and at
    # high priority. The rest wait until they are near the viewport.
    first = position == 1
    loading = 'fetchpriority="high" decoding="async"' if first \
        else 'loading="lazy" decoding="async"'

    return f"""  <section class="place" id="{slug}" data-place="{slug}" data-index="{position}" aria-labelledby="{slug}-name">
    <figure class="place-media">
      <picture>
        <source type="image/avif" srcset="{srcset(slug, 'avif')}" sizes="{SIZES}">
        <source type="image/webp" srcset="{srcset(slug, 'webp')}" sizes="{SIZES}">
        <img src="assets/locations/{slug}-1600.jpg" srcset="{srcset(slug, 'jpg')}" sizes="{SIZES}"
             alt="{esc['alt']}" {loading}>
      </picture>
      <span class="place-scrim" aria-hidden="true"></span>
    </figure>
    <div class="place-copy">
      <p class="place-index" aria-hidden="true">{position:02d}<span>/{total:02d}</span></p>
      <h2 class="place-name" id="{slug}-name">{esc['name']}</h2>
      <p class="place-locality">{esc['locality']}</p>
      <p class="place-rhyme">{esc['rhyme']}</p>
      <button class="place-open" type="button" data-open="{slug}">See it bigger</button>
    </div>
  </section>

"""


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
        first=locations[0]["slug"],
        first_name=html.escape(locations[0]["name"]),
        index=index,
    ) + body + FOOT

    PAGE.write_text(page, encoding="utf-8")
    print(f"wrote {PAGE.relative_to(ROOT)} — {total} places")
    return 0


if __name__ == "__main__":
    sys.exit(main())
