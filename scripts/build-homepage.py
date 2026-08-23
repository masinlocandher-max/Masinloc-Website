#!/usr/bin/env python3
"""Render index.html from the project's own data.

The homepage names eight places and seven Sambal Tina words. Hand-typing them
is how a gloss drifts from the dictionary or a locality drifts from the
mapping, so the copy that is factual is rendered from the same files the rest
of the site is built from:

    data/locations.json        places, localities, rhymes, focal points
    data/sambal-tina-living.json  user-confirmed living vocabulary
    data/campaigns.json        approved campaign artwork

The authored copy — headlines, the narrative connective tissue — lives here,
because it is writing rather than data.

Usage
-----
    python3 scripts/build-homepage.py
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "index.html"

LOCATIONS = json.loads((ROOT / "data" / "locations.json").read_text(encoding="utf-8"))
LIVING = json.loads((ROOT / "data" / "sambal-tina-living.json").read_text(encoding="utf-8"))
CAMPAIGNS = json.loads((ROOT / "data" / "campaigns.json").read_text(encoding="utf-8"))
DICT = json.loads((ROOT / "data" / "sambal-tina.json").read_text(encoding="utf-8"))
BULLETIN = json.loads((ROOT / "data" / "bulletin.json").read_text(encoding="utf-8"))
LEADERSHIP = json.loads((ROOT / "data" / "leadership.json").read_text(encoding="utf-8"))

CAMPAIGN_WIDTHS = [480, 768, 1120, 1440, 1672]
PLACE_WIDTHS = [480, 768, 1120, 1536, 2048]

# The words the approved campaign artwork puts on screen, in the order the
# homepage stages them. Every one is resolved against the living-usage data
# below; anything missing there is dropped rather than guessed.
FEATURED = ["lanom", "ayama", "talacaca", "masitas", "cabatwan", "oybon"]

# Where each entry card sits around the phone. Depth is carried by scale,
# blur and opacity together, so a card further back also reads softer.
PLACEMENT = [
    {"side": "left",  "css": "top:2%;left:4%",    "depth": 1.00, "soften": 0,   "fade": 1,   "drift": 0,  "delay": 60},
    {"side": "left",  "css": "top:38%;left:0%",   "depth": 0.94, "soften": .3,  "fade": .96, "drift": 4,  "delay": 170},
    {"side": "left",  "css": "top:74%;left:9%",   "depth": 0.88, "soften": .7,  "fade": .9,  "drift": 8,  "delay": 280},
    {"side": "right", "css": "top:5%;right:2%",   "depth": 0.96, "soften": .2,  "fade": .97, "drift": 3,  "delay": 120},
    {"side": "right", "css": "top:42%;right:8%",  "depth": 1.00, "soften": 0,   "fade": 1,   "drift": 0,  "delay": 230},
    {"side": "right", "css": "top:78%;right:0%",  "depth": 0.90, "soften": .6,  "fade": .92, "drift": 7,  "delay": 340},
]


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def available(slug: str, extension: str, widths: list[int], folder: str,
              suffix: str = "") -> list[int]:
    """Widths actually on disk. Originals differ, and nothing is upscaled, so a
    shared list would advertise files that do not exist."""
    return [w for w in widths
            if (ROOT / "assets" / folder / f"{slug}{suffix}-{w}.{extension}").is_file()]


def srcset(slug: str, extension: str, widths: list[int], folder: str,
           suffix: str = "") -> str:
    have = available(slug, extension, widths, folder, suffix)
    return ", ".join(f"assets/{folder}/{slug}{suffix}-{w}.{extension} {w}w" for w in have)


def largest(slug: str, extension: str, widths: list[int], folder: str,
            suffix: str = "") -> str:
    have = available(slug, extension, widths, folder, suffix)
    return f"assets/{folder}/{slug}{suffix}-{have[-1]}.{extension}" if have else ""


# --- 02 campaign stage --------------------------------------------------------

def campaign_slides() -> str:
    out = []
    for i, campaign in enumerate(CAMPAIGNS["campaigns"]):
        slug = campaign["slug"]
        # A portrait source is used only when the project supplies one. None is
        # invented: cropping a designed campaign would cut the copy it exists
        # to show.
        mobile = campaign.get("mobileSource")
        sources = []
        for extension in ("avif", "webp"):
            if mobile:
                small = srcset(slug, extension, CAMPAIGN_WIDTHS, "campaigns", "-mobile")
                if small:
                    sources.append(f'<source media="(max-width:640px)" type="image/{extension}" '
                                   f'srcset="{small}">')
            wide = srcset(slug, extension, CAMPAIGN_WIDTHS, "campaigns")
            if wide:
                sources.append(f'<source type="image/{extension}" srcset="{wide}" '
                               f'sizes="(min-width:1100px) 84vw, 100vw">')
        fallback = largest(slug, "jpg", CAMPAIGN_WIDTHS, "campaigns")
        ambient = f"assets/campaigns/{slug}-ambient.jpg"
        loading = "" if i == 0 else ' loading="lazy"'
        out.append(f"""        <li class="slide" role="group" aria-roledescription="slide" aria-label="{esc(campaign['headline'])}">
          <a class="slide-link" href="{esc(campaign['href'])}">
            <span class="slide-ambient" aria-hidden="true"><img src="{ambient}" alt="" width="64" height="36" loading="lazy" decoding="async"></span>
            <picture>
              {chr(10).join('              ' + s for s in sources).strip()}
              <img class="slide-art" src="{fallback}" alt="{esc(campaign['alt'])}" width="1672" height="941"{loading} decoding="async" fetchpriority="{'high' if i == 0 else 'auto'}">
            </picture>
            <span class="slide-cta">{esc(campaign['cta'])}<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h13M13 7l5 5-5 5"/></svg></span>
          </a>
        </li>""")
    return "\n".join(out)


# --- 03 discover --------------------------------------------------------------

def discover_shots() -> str:
    out = []
    for location in LOCATIONS["locations"]:
        slug = location["slug"]
        out.append(f"""          <div class="discover-shot" style="--focus:{esc(location['focus'])}">
            <picture>
              <source type="image/avif" srcset="{srcset(slug, 'avif', PLACE_WIDTHS, 'locations')}" sizes="52vw">
              <source type="image/webp" srcset="{srcset(slug, 'webp', PLACE_WIDTHS, 'locations')}" sizes="52vw">
              <img src="{largest(slug, 'jpg', PLACE_WIDTHS, 'locations')}" alt="{esc(location['alt'])}" loading="lazy" decoding="async">
            </picture>
          </div>""")
    return "\n".join(out)


def discover_rows() -> str:
    out = []
    for i, location in enumerate(LOCATIONS["locations"], start=1):
        slug = location["slug"]
        out.append(f"""          <li class="place-row rise" data-where="{esc(location['locality'])}" style="--delay:{(i - 1) * 40}ms">
            <a href="destinations.html#{esc(slug)}">
              <span class="place-shot" aria-hidden="true" style="--focus:{esc(location['focus'])}">
                <picture>
                  <source type="image/avif" srcset="{srcset(slug, 'avif', PLACE_WIDTHS, 'locations')}" sizes="100vw">
                  <source type="image/webp" srcset="{srcset(slug, 'webp', PLACE_WIDTHS, 'locations')}" sizes="100vw">
                  <img src="{largest(slug, 'jpg', PLACE_WIDTHS, 'locations')}" alt="" loading="lazy" decoding="async">
                </picture>
              </span>
              <span class="place-index">{i:02d}</span>
              <h3 class="place-name">{esc(location['name'])}</h3>
              <p class="place-where">{esc(location['locality'])}</p>
              <p class="place-what">{esc(location['caption'])}</p>
            </a>
          </li>""")
    return "\n".join(out)


# --- 04 language --------------------------------------------------------------

def living_index() -> dict:
    return {entry["tina"].lower(): entry for entry in LIVING["entries"]}


def entry_cards() -> tuple[str, str]:
    """Cards for the left and right of the phone, resolved against the data."""
    known = living_index()
    left, right = [], []
    for word, place in zip(FEATURED, PLACEMENT):
        entry = known.get(word)
        if entry is None:
            # Never render a word the verified data does not carry.
            continue
        card = f"""            <article class="entry" style="{place['css']};--depth:{place['depth']};--soften:{place['soften']}px;--fade:{place['fade']};--drift:{place['drift']}px;--delay:{place['delay']}ms">
              <h3>{esc(entry['tina'].title())}</h3>
              <p class="pos">{esc(entry.get('pos', ''))}</p>
              <p class="mean">{esc(entry.get('en', ''))}</p>
              <p class="fil">{esc(entry.get('fil', ''))}</p>
              <span class="tag">Sambal Tina</span>
            </article>"""
        (left if place["side"] == "left" else right).append(card)
    return "\n".join(left), "\n".join(right)


def phone_list() -> str:
    known = living_index()
    rows = []
    for word in FEATURED[:5]:
        entry = known.get(word)
        if entry:
            rows.append(f"""            <li><b>{esc(entry['tina'].title())}</b><span>{esc(entry.get('en', ''))}</span></li>""")
    return "\n".join(rows)


# Real entries from the archive, chosen to show the whole confidence ladder
# including a damaged reading. Nothing here is written by hand: the gloss, the
# page reference and the status are all looked up in data/sambal-tina.json, so
# a specimen cannot drift from the record it is quoting.
SPECIMENS = [
    ("lanoman",   "Resolved against a second source."),
    ("abagat",    "Cross-checked between the main body and the printed index."),
    ("aapo-apon", "Readable in the main body, not yet confirmed elsewhere."),
    ("ab6h",      "A damaged glyph. The reading stays open rather than tidied."),
]


def specimens() -> list[dict]:
    cols = DICT["columns"]
    T, P, E, PG, S, CF = (cols.index(k) for k in ("tina", "pos", "en", "pages", "status", "conf"))
    statuses = DICT["statuses"]
    found = {}
    for entry in DICT["entries"]:
        key = str(entry[T]).lower()
        if key not in found:
            found[key] = entry
    out = []
    for word, why in SPECIMENS:
        entry = found.get(word)
        if entry is None:
            # Never print a specimen the archive does not actually carry.
            continue
        conf = entry[CF]
        out.append({
            "tina": entry[T],
            "pos": entry[P] or "",
            "en": str(entry[E] or "").split(";")[0].split(",")[0].strip(),
            "pages": entry[PG] or "",
            "status": statuses[entry[S]] if entry[S] is not None else "",
            "band": ("strong" if conf >= 4 else "ok" if conf == 3 else "check"),
            "label": ("Well supported" if conf >= 4 else "Readable" if conf == 3
                      else "Needs another look"),
            "why": why,
        })
    return out


def specimen_slips() -> str:
    rows = []
    for i, s in enumerate(specimens()):
        rows.append(f"""          <li class="slip rise slip-{s['band']}" style="--delay:{i * 80}ms">
            <p class="slip-page">Archive p.&nbsp;{esc(s['pages'])}</p>
            <p class="slip-word">{esc(s['tina'])}</p>
            <p class="slip-pos">{esc(s['pos'])}</p>
            <p class="slip-gloss">{esc(s['en'])}</p>
            <p class="slip-why">{esc(s['why'])}</p>
            <p class="slip-band"><span class="dot"></span>{esc(s['label'])}</p>
            <p class="slip-status">{esc(s['status'])}</p>
          </li>""")
    return "\n".join(rows)


def counts() -> dict:
    entries = DICT["entries"]
    conf = DICT["columns"].index("conf")
    return {
        "total": len(entries),
        "strong": sum(1 for e in entries if e[conf] >= 4),
        "check": sum(1 for e in entries if e[conf] <= 2),
        "living": len(LIVING["entries"]),
    }


# --- page ---------------------------------------------------------------------

def entry_story() -> dict:
    """The story MABAYANI opens with, named from the data rather than pinned here."""
    slug = BULLETIN["entryStory"]
    return next(a for a in BULLETIN["articles"] if a["slug"] == slug)


def render() -> str:
    entry = entry_story()
    story_count = sum(1 for a in BULLETIN["articles"] if a.get("status") == "published")

    n = counts()
    known = living_index()
    feature = known.get("lanom") or LIVING["entries"][0]
    left_cards, right_cards = entry_cards()
    hero = "assets/stage1/masinloc-hero.avif"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#03112F">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<title>Masinloc, Zambales | History, Sambal Tina &amp; Places</title>
<meta name="description" content="Masinloc, Zambales through its places, the Sambal Tina language recorded in {n['total']:,} dictionary entries, and the archive behind both.">
<link rel="canonical" href="https://masinloc-zambales.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="Masinloc, Zambales | History, Sambal Tina &amp; Places">
<meta property="og:description" content="Eight places in Masinloc, the Sambal Tina language recorded in {n['total']:,} entries, and the archive behind both.">
<meta property="og:url" content="https://masinloc-zambales.com/">
<meta property="og:image" content="https://masinloc-zambales.com/assets/campaigns/masinloc-connect-1120.jpg">
<meta property="og:image:alt" content="The Masinloc Connect app shown on a phone">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Masinloc, Zambales | History, Sambal Tina &amp; Places">
<meta name="twitter:description" content="Eight places in Masinloc, the Sambal Tina language recorded in {n['total']:,} entries, and the archive behind both.">
<meta name="twitter:image" content="https://masinloc-zambales.com/assets/campaigns/masinloc-connect-1120.jpg">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="preload" as="image" href="{hero}" type="image/avif" fetchpriority="high">
<link rel="stylesheet" href="tokens.css?v=20260822-1">
<link rel="stylesheet" href="site.css?v=20260820-1">
<link rel="stylesheet" href="site-polish.css?v=20260820-1">
<link rel="stylesheet" href="site-stability.css?v=20260821-1">
<link rel="stylesheet" href="homepage.css?v=20260822-1">
</head>
<body class="home">
<a class="skip-link" href="#main">Skip to content</a>

<header class="home-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="nav-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Menu"><span></span><span></span></button>
  <nav class="home-links" id="primaryNav" aria-label="Primary">
    <a href="index.html" aria-current="page">Home</a>
    <a href="a-closer-look.html">A Closer Look</a>
    <a href="verified-history.html">Verified History</a>
    <a href="masinloc-bulletin.html">Masinloc Bulletin</a>
    <a href="connect.html">Masinloc Connect</a>
    <a href="contact.html">Contact</a>
  </nav>
</header>

<main id="main">

  <!-- 01 ................................................................. -->
  <section class="hero" aria-labelledby="heroTitle">
    <div class="hero-media">
      <img src="{hero}" alt="Masinloc, Zambales from the air, with San Andres Church and the town around it" width="1600" height="900" fetchpriority="high" decoding="async">
    </div>
    <div class="hero-inner">
      <img class="hero-mark" src="assets/masinloc-logo.webp" width="320" height="78" alt="" aria-hidden="true">
      <h1 id="heroTitle"><span class="mask"><span>The world</span></span> <span class="mask"><span><em>finds us here.</em></span></span></h1>
      <p class="hero-note rise" style="--delay:520ms">Discover Masinloc through its people, culture, places, businesses, and ideas.</p>
      <div class="hero-cta rise" style="--delay:640ms">
        <a class="cta-primary" href="a-closer-look.html">Discover Masinloc</a>
        <a class="cta-secondary" href="connect.html">Explore Masinloc Connect</a>
      </div>
    </div>
    <p class="hero-cue"><i></i>Scroll</p>
  </section>

  <!-- 02 ................................................................. -->
  <section class="entries" aria-labelledby="entriesTitle">
    <div class="entries-inner">
      <h2 id="entriesTitle" class="stage-label">Start here</h2>
      <ul class="door-grid">
        <li class="door rise"><a href="destinations.html">
          <span class="e-num">01</span>
          <span class="e-name">Places</span>
          <span class="e-what">Eight places on this coast, photographed where they actually are.</span>
        </a></li>
        <li class="door rise" style="--delay:80ms"><a href="sambal-tina.html">
          <span class="e-num">02</span>
          <span class="e-name">Culture &amp; Sambal&nbsp;Tina</span>
          <span class="e-what">{n['total']:,} dictionary entries, and the language Masinloc still speaks.</span>
        </a></li>
        <li class="door rise" style="--delay:160ms"><a href="connect.html">
          <span class="e-num">03</span>
          <span class="e-name">Local Businesses</span>
          <span class="e-what">Masinloqueño trade, added to the record by the people who run it.</span>
        </a></li>
        <li class="door rise" style="--delay:240ms"><a href="connect.html">
          <span class="e-num">04</span>
          <span class="e-name">Masinloc Connect</span>
          <span class="e-what">Opportunities, services and community updates in one platform.</span>
        </a></li>
      </ul>
    </div>
  </section>

  <!-- 03 ................................................................. -->
  <section class="campaign" aria-labelledby="campaignTitle">
    <div class="campaign-head">
      <h2 class="stage-label" id="campaignTitle">{esc(CAMPAIGNS['label'])}</h2>
      <p>What we are building for Masinloc.</p>
    </div>
    <div class="rail" data-rail>
      <div class="rail-window">
        <ul class="rail-track" role="tablist" aria-label="Featured campaigns">
{campaign_slides()}
        </ul>
      </div>
      <button class="rail-arrow" data-dir="prev" type="button" aria-label="Previous campaign"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="rail-arrow" data-dir="next" type="button" aria-label="Next campaign"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="dots" role="tablist" aria-label="Choose a campaign"></div>
    </div>
  </section>

  <!-- 03 ................................................................. -->
  <section class="discover stage" aria-labelledby="discoverTitle">
    <div class="discover-inner">
      <div>
        <p class="stage-label">Place</p>
        <h2 id="discoverTitle" class="discover-title">Eight places we grew up in.</h2>
        <p class="stage-lead">Each one photographed where it actually is, and named with the barangay it belongs to.</p>
        <ul class="place-list">
{discover_rows()}
        </ul>
      </div>
      <div class="discover-stage" aria-hidden="true">
{discover_shots()}
        <p class="discover-caption"></p>
      </div>
    </div>
  </section>

  <!-- 04 ................................................................. -->
  <section class="language" aria-labelledby="languageTitle">
    <div class="language-inner">
      <p class="language-open">
        <span class="language-word rise">{esc(feature['tina'].title())}</span>
        <span class="language-gloss rise" style="--delay:120ms">{esc(feature.get('en', ''))} &middot; {esc(feature.get('fil', ''))}</span>
      </p>
      <p class="stage-label" style="color:rgba(255,255,255,.5)">Language</p>
      <h2 id="languageTitle" class="language-claim rise">A language lives when people use it.</h2>

      <div class="language-scene">
        <div class="card-field">
{left_cards}
        </div>

        <div class="phone" aria-hidden="true">
          <div class="phone-bar"><b>SAMBAL TINA</b><span>DICTIONARY</span></div>
          <div class="phone-search">Search a word&hellip;</div>
          <div class="phone-feature">
            <p class="phone-kicker">FEATURED WORD</p>
            <p class="phone-word">{esc(feature['tina'].title())}</p>
            <p class="phone-say">{esc(feature.get('pos', ''))}</p>
            <p class="phone-mean">{esc(feature.get('en', ''))}</p>
          </div>
          <ul class="phone-list">
{phone_list()}
          </ul>
        </div>

        <div class="card-field">
{right_cards}
          <p class="aside-note" style="top:-4%;right:4%">Tanda mo doman?</p>
        </div>
      </div>

      <p class="stage-lead rise" style="color:rgba(255,255,255,.72);margin-top:clamp(36px,6vh,72px)">The archive holds {n['total']:,} entries, every one carrying the page it was copied from. Alongside it sits the living usage {n['living']} words confirmed by the people who still speak them, kept separate so neither pretends to be the other.</p>
      <p class="language-actions">
        <a class="btn btn-solid" href="sambal-tina.html">Open the dictionary</a>
        <a class="btn btn-ghost" href="sambal-tina.html#contribute">Add a word you know</a>
      </p>
    </div>
  </section>

  <!-- 05 ................................................................. -->
  <section class="archive" aria-labelledby="archiveTitle">
    <div class="archive-inner">
      <div class="archive-head rise">
        <p class="stage-label">The record</p>
        <h2 id="archiveTitle">We would rather show you the page.</h2>
        <p class="stage-lead">Masinloc&rsquo;s written history is mostly a language, and that language is mostly one damaged archive. Here is what we hold, and exactly how sure we are of it.</p>
      </div>

      <ol class="layers">
        <li class="layer rise"><span class="layer-no">Layer 01</span><h3>The main body</h3><p>Read straight through, entry by entry, and transcribed as it stands. Nothing corrected on the way past.</p></li>
        <li class="layer rise" style="--delay:80ms"><span class="layer-no">Layer 02</span><h3>The printed index</h3><p>Read separately, then matched against the body. Where the two agree, the reading is firm.</p></li>
        <li class="layer rise" style="--delay:160ms"><span class="layer-no">Layer 03</span><h3>The doubtful letters</h3><p>Every unclear glyph revisited on its own and rated. Where it stays unclear, it is published unclear.</p></li>
      </ol>

      <p class="archive-kicker rise">Four entries, as they actually sit in the record</p>
      <ul class="slips">
{specimen_slips()}
      </ul>

      <div class="archive-close rise">
        <p class="archive-count"><strong>{n['check']}</strong> entries still read like the last one. Every one is left in the open, because a tidy invention would outlive us in a language with very little written down.</p>
        <p class="archive-note">Event history &mdash; dates, names, what happened when &mdash; is not here yet. Verified History stays deliberately empty until there is something with a source behind it, and oral accounts will always be marked as what they are. <a href="verified-history.html">See how we are gathering it</a>.</p>
      </div>
    </div>
  </section>

  <!-- 06 ................................................................. -->
  <section class="community" aria-labelledby="communityTitle">
    <div class="community-inner">
      <div class="rise">
        <p class="stage-label" style="color:rgba(255,255,255,.5)">Community</p>
        <h2 id="communityTitle">The dictionary grows because people send words.</h2>
        <p>If Sambal Tina is the language you grew up with, you can settle an entry faster than any amount of squinting at a damaged page. Here is exactly what happens when you send one.</p>
      </div>
      <div class="thread rise" style="--delay:90ms">
        <div class="thread-step"><div class="thread-rail"><span class="thread-dot"></span><span class="thread-line"></span></div><div><h3>You send a word</h3><p>The word, what it means, and how you want to be credited.</p></div></div>
        <div class="thread-step"><div class="thread-rail"><span class="thread-dot"></span><span class="thread-line"></span></div><div><h3>We check it against the archive</h3><p>Nothing is published automatically. It is compared with what we already hold.</p></div></div>
        <div class="thread-step"><div class="thread-rail"><span class="thread-dot"></span><span class="thread-line"></span></div><div><h3>A person approves it</h3><p>An editor confirms the reading and records what was checked.</p></div></div>
        <div class="thread-step"><div class="thread-rail"><span class="thread-dot"></span></div><div><h3>Your name goes in the contributors</h3><p>If you asked to be credited, it is listed on the dictionary page. That is the only way a name gets there.</p></div></div>
      </div>
    </div>
  </section>

  <!-- 07 ................................................................. -->
  <section class="close" aria-labelledby="closeTitle">
    <div class="close-inner">
      <h2 id="closeTitle" class="rise">If you only read one thing.</h2>

      <a class="close-lead rise" href="bulletin/{entry['slug']}.html">
        <span class="cl-kicker">{esc(BULLETIN['publication']['kicker'])} &middot; {esc(BULLETIN['publication']['name'])}</span>
        <span class="cl-title">{esc(entry['title'])}</span>
        <span class="cl-stand">{esc(entry['standfirst'])}</span>
        <span class="cl-go">Start the first story <i aria-hidden="true">&rarr;</i></span>
      </a>

      <ul class="routes">
        <li class="rise"><a href="destinations.html"><span class="r-name">Places</span><span class="r-what">Eight destinations, photographed where they actually are.</span></a></li>
        <li class="rise" style="--delay:60ms"><a href="sambal-tina.html"><span class="r-name">Sambal Tina</span><span class="r-what">{n['total']:,} entries, free to search, with the page reference on every one.</span></a></li>
        <li class="rise" style="--delay:120ms"><a href="leadership.html"><span class="r-name">Municipal Leadership</span><span class="r-what">The mayor serving now, and the four who served before her.</span></a></li>
        <li class="rise" style="--delay:180ms"><a href="verified-history.html"><span class="r-name">Verified History</span><span class="r-what">Our past, with the records to back it up.</span></a></li>
        <li class="rise" style="--delay:240ms"><a href="masinloc-bulletin.html"><span class="r-name">Masinloc Bulletin</span><span class="r-what">All {story_count} stories, and the questions still open.</span></a></li>
        <li class="rise" style="--delay:300ms"><a href="sources.html"><span class="r-name">Sources &amp; References</span><span class="r-what">Every study, record and archive the history here rests on.</span></a></li>
        <li class="rise" style="--delay:360ms"><a href="connect.html"><span class="r-name">Masinloc Connect</span><span class="r-what">Your business, your story, your trade. Add it to the record.</span></a></li>
      </ul>
    </div>
  </section>

</main>

<footer class="home-foot">
  <div class="foot-inner">
    <p class="foot-say">Our words. Our stories. Our Masinloc.</p>
    <div class="foot-cols">
      <img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales">
      <nav class="foot-nav" aria-label="Footer">
        <a href="destinations.html">Places</a>
        <a href="sambal-tina.html">Sambal Tina</a>
        <a href="a-closer-look.html">A Closer Look</a>
        <a href="leadership.html">Municipal Leadership</a>
        <a href="verified-history.html">Verified History</a>
        <a href="masinloc-bulletin.html">Masinloc Bulletin</a>
        <a href="connect.html">Masinloc Connect</a>
        <a href="trust.html">Trust &amp; privacy</a>
        <a href="contact.html">Contact</a>
      </nav>
    </div>
    <div class="foot-base">
      <span>&copy; 2026 Mabayani Project by FMB. All rights reserved.</span>
      <span>masinloc-zambales.com</span>
    </div>
  </div>
</footer>

<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "WebSite",
      "@id": "https://masinloc-zambales.com/#website",
      "url": "https://masinloc-zambales.com/",
      "name": "Discover Masinloc",
      "alternateName": "Masinloc, Zambales",
      "description": "An independent community record of Masinloc, Zambales: its places, the Sambal Tina language, and local history.",
      "inLanguage": "en-PH",
      "publisher": {{ "@id": "https://masinloc-zambales.com/#publisher" }}
    }},
    {{
      "@type": "Organization",
      "@id": "https://masinloc-zambales.com/#publisher",
      "name": "Mabayani Project by FMB",
      "url": "https://masinloc-zambales.com/",
      "logo": "https://masinloc-zambales.com/assets/masinloc-logo.webp",
      "email": "hello@masinloc-zambales.com"
    }},
    {{
      "@type": "WebPage",
      "@id": "https://masinloc-zambales.com/#webpage",
      "url": "https://masinloc-zambales.com/",
      "name": "Masinloc, Zambales | History, Sambal Tina & Places",
      "isPartOf": {{ "@id": "https://masinloc-zambales.com/#website" }},
      "inLanguage": "en-PH",
      "about": [
        {{ "@id": "https://masinloc-zambales.com/#place" }},
        {{ "@type": "Thing", "name": "Sambal Tina language and culture" }},
        {{ "@type": "Thing", "name": "Masinloc local history" }}
      ],
      "subjectOf": {{
        "@type": "AboutPage",
        "@id": "https://masinloc-zambales.com/trust.html#webpage",
        "url": "https://masinloc-zambales.com/trust.html",
        "name": "Discover Masinloc and Masinloc Connect Platform Trust Information"
      }},
      "primaryImageOfPage": "https://masinloc-zambales.com/{hero}"
    }},
    {{
      "@type": "Place",
      "@id": "https://masinloc-zambales.com/#place",
      "name": "Masinloc",
      "address": {{
        "@type": "PostalAddress",
        "addressLocality": "Masinloc",
        "addressRegion": "Zambales",
        "addressCountry": "PH"
      }}
    }}
  ]
}}
</script>
<script src="site.js?v=20260820-2"></script>
<script src="homepage.js?v=20260822-1" defer></script>
</body>
</html>
"""


def main() -> int:
    OUT.write_text(render(), encoding="utf-8")
    n = counts()
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(LOCATIONS['locations'])} places, "
          f"{len(CAMPAIGNS['campaigns'])} campaigns, "
          f"{len([w for w in FEATURED if w in living_index()])} of {len(FEATURED)} "
          f"featured words resolved against the living data")
    print(f"  dictionary counts rendered from data: {n['total']:,} entries, "
          f"{n['strong']:,} well supported, {n['check']} still checking")
    missing = [w for w in FEATURED if w not in living_index()]
    if missing:
        print(f"  not rendered (absent from the living data): {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
