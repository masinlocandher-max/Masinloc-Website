#!/usr/bin/env python3
"""Build the Masinloc Bulletin from data/bulletin.json and data/sources.json.

Adding an article means adding an object to data/bulletin.json and running this
script. Nothing is hand-maintained: the archive page, every article page, the
pathway sequence, the category groups and the sources directory are all
rendered from the data, so a headline or a date exists in exactly one place.

Three rules are enforced here rather than left to discipline:

  - An article's evidence must resolve to a real entry in data/sources.json.
    A dangling source id fails the build.
  - The internal research manuscript is never a public citation. Articles cite
    the underlying study, record or archive; the manuscript only identified
    what to look for.
  - The person who wrote MABAYANI is not named anywhere until the closing
    reflection. Exactly one article may carry "revealsCreator": true, and it
    is the only page that gets a byline, an author name in metadata, or a
    Person node in structured data. Everywhere else the work is attributed to
    the project. scripts/check-mabayani-anonymity.py checks the built HTML.

Usage
-----
    python3 scripts/build-bulletin.py
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "bulletin"
SITE = "https://masinloc-zambales.com"

BULLETIN = json.loads((ROOT / "data" / "bulletin.json").read_text(encoding="utf-8"))
SOURCES = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))

PUBLICATION = BULLETIN["publication"]
CATEGORIES = {c["id"]: c["label"] for c in BULLETIN["categories"]}
PATHWAYS = {p["id"]: p["label"] for p in BULLETIN["pathways"]}
ENTRY_STORY = BULLETIN["entryStory"]

# The archive groups categories under plain reader-facing headings. A category
# missing from here would silently vanish from the page, so verify() checks it.
GROUPS = [
    ("History & Heritage", "The documented town: dates, churches, the record and its holes.",
     ["myth-vs-record", "history", "heritage"]),
    ("Language & Memory", "What Masinloc kept without writing it down.",
     ["language", "oral-history"]),
    ("From the record", "Method, limits, and why any of this is done the way it is done.",
     ["research-note", "reflection"]),
]

# Naming the internal manuscript on a public page would create a citation loop:
# the site citing its own working document as proof of its own article.
FORBIDDEN_PUBLIC = [
    "adviser review manuscript", "mabayani manuscript", "manuscript v0",
    "claim register", "according to the mabayani", "mabayani research says",
]

# Serialised storytelling borrowed from streaming platforms is the one register
# this must not adopt. The sequence is a reading path, not a season.
#
# Only unambiguous streaming phrases are banned in prose: "episode" has an
# ordinary historical sense ("the strongest documented episode of the raid")
# and banning the bare word here would push honest writing around a UI rule.
# The interface is the place that must never borrow the register, and it is
# checked as built HTML by scripts/check-mabayani-anonymity.py.
BANNED_REGISTER = [
    "series premiere", "season finale", "binge", "next episode",
    "now streaming", "watch now", "play now", "new episode",
]


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def source_index() -> dict:
    found = {}
    for section in SOURCES["sections"]:
        for entry in section["entries"]:
            found[entry["id"]] = {**entry, "section": section["id"]}
    return found


SOURCE_BY_ID = source_index()


def published() -> list[dict]:
    """Only published articles are built. Drafts never reach the site."""
    return [a for a in BULLETIN["articles"] if a.get("status") == "published"]


def in_order(articles: list[dict]) -> list[dict]:
    """The reading sequence: the order a first-time reader is walked through."""
    return sorted(articles, key=lambda a: (a["order"], a["slug"]))


def by_date(articles: list[dict]) -> list[dict]:
    return sorted(articles, key=lambda a: (a["published"], a["slug"]), reverse=True)


# --- shared shell -------------------------------------------------------------

def shell_head(title: str, description: str, canonical: str, *, depth: int,
               extra: str = "", og_type: str = "website") -> str:
    up = "../" if depth else ""
    ogtype = f'<meta property="og:type" content="{og_type}">\n'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#061A46">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{canonical}">
{ogtype}<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<meta property="og:image:alt" content="Masinloc, Zambales from the air">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
{extra}<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{up}assets/apple-touch-icon.png">
<link rel="stylesheet" href="{up}tokens.css?v=20260822-1">
<link rel="stylesheet" href="{up}site.css?v=20260820-1">
<link rel="stylesheet" href="{up}site-polish.css?v=20260820-1">
<link rel="stylesheet" href="{up}site-stability.css?v=20260821-1">
<link rel="stylesheet" href="{up}bulletin.css?v=20260822-2">
</head>
<body class="about-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="{up}index.html" aria-label="Masinloc, Zambales home"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="{up}index.html">Home</a>
    <a href="{up}a-closer-look.html">A Closer Look</a>
    <a href="{up}verified-history.html">Verified History</a>
    <a class="active" href="{up}masinloc-bulletin.html" aria-current="page">Masinloc Bulletin</a>
    <a class="connect-link" href="{up}connect.html">Masinloc Connect</a>
    <a href="{up}contact.html">Contact</a>
  </nav>
</header>
"""


def shell_foot(depth: int, jsonld: str = "", scripts: str = "") -> str:
    up = "../" if depth else ""
    return f"""
<footer class="home-footer">
  <div class="footer-brand"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="{up}index.html">Home</a><a href="{up}a-closer-look.html">A Closer Look</a><a href="{up}verified-history.html">Verified History</a><a href="{up}masinloc-bulletin.html">Masinloc Bulletin</a><a href="{up}sources.html">Sources &amp; References</a><a href="{up}connect.html">Masinloc Connect</a><a href="{up}contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>masinloc-zambales.com</span></div>
</footer>
{jsonld}<script src="{up}site.js?v=20260820-2"></script>
{scripts}</body>
</html>
"""


# --- article ------------------------------------------------------------------

def render_block(block: dict) -> str:
    kind = block["type"]
    if kind == "p":
        return f"      <p>{esc(block['text'])}</p>"
    if kind == "h2":
        return f"      <h2>{esc(block['text'])}</h2>"
    if kind == "pull":
        return f"      <blockquote class=\"pull\"><p>{esc(block['text'])}</p></blockquote>"
    if kind == "note":
        return ('      <aside class="evidence">'
                f'<p class="evidence-label">{esc(block["label"])}</p>'
                f'<p>{esc(block["text"])}</p></aside>')
    if kind == "list":
        items = "".join(f"<li>{esc(i)}</li>" for i in block["items"])
        return f"      <ul class=\"article-list\">{items}</ul>"
    sys.exit(f"unknown block type: {kind}")


def human_date(value: str) -> str:
    from datetime import date
    y, m, d = (int(x) for x in value.split("-"))
    return date(y, m, d).strftime("%d %B %Y").lstrip("0")


def continue_block(article: dict, by_slug: dict, total: int) -> str:
    """The pull to the next story. A question first, then the door.

    This is the whole of the serialisation: a reader who wants one article gets
    one article, and a reader who wants the sequence is always shown where it
    goes next. No countdowns, no autoplay, nothing that behaves like a queue.
    """
    nxt = article.get("next")
    if not nxt or nxt not in by_slug:
        return ("""      <nav class="continue continue-end" aria-label="Where to go next">
        <p class="continue-q">That is the end of the sequence.</p>
        <a href="../masinloc-bulletin.html">
          <span class="continue-label">Back to the Bulletin</span>
          <span class="continue-title">Every story, and the questions still open</span>
        </a>
      </nav>""")
    target = by_slug[nxt]
    return f"""      <nav class="continue" aria-label="Continue the story">
        <p class="continue-q">{esc(article['nextQuestion'])}</p>
        <a href="{esc(target['slug'])}.html" data-continue>
          <span class="continue-label">Continue the story</span>
          <span class="continue-title">{esc(target['title'])}</span>
          <span class="continue-meta">{esc(PATHWAYS[target['pathway']])} &middot; {target['readingMinutes']} min read</span>
        </a>
      </nav>"""


def article_page(article: dict, everything: list[dict]) -> str:
    slug = article["slug"]
    url = f"{SITE}/bulletin/{slug}.html"
    category = CATEGORIES[article["category"]]
    reveals = bool(article.get("revealsCreator"))
    creator = PUBLICATION["creator"]
    total = len(everything)
    position = article["order"] + 1

    body = "\n".join(render_block(b) for b in article["body"])

    # Evidence: a pointer into the sources directory, not a bibliography.
    cited = []
    for sid in article["sources"]:
        entry = SOURCE_BY_ID[sid]
        who = entry.get("author") or entry.get("publication") or ""
        cited.append(
            f'<li><a href="../sources.html#{esc(sid)}">{esc(entry["title"])}</a>'
            + (f' <span>{esc(who)}</span>' if who else "") + "</li>")
    evidence = (
        '      <section class="article-sources" aria-labelledby="basisTitle">\n'
        '        <h2 id="basisTitle">Research basis</h2>\n'
        '        <p>This article is based on the following, listed in full in our '
        '<a href="../sources.html">Sources &amp; References</a> directory.</p>\n'
        f'        <ul>{"".join(cited)}</ul>\n'
        '      </section>')

    by_slug = {a["slug"]: a for a in everything}
    related = ""
    picks = [by_slug[s] for s in article.get("related", []) if s in by_slug]
    if picks:
        cards = "".join(
            f'<li><a href="{esc(a["slug"])}.html">'
            f'<span class="rel-cat">{esc(CATEGORIES[a["category"]])}</span>'
            f'<span class="rel-title">{esc(a["title"])}</span></a></li>'
            for a in picks)
        related = ('      <section class="article-related" aria-labelledby="relTitle">\n'
                   '        <h2 id="relTitle">Related stories</h2>\n'
                   f'        <ul>{cards}</ul>\n      </section>')

    elsewhere = ""
    if article.get("internalLinks"):
        links = " ".join(
            f'<a href="{esc(l["href"])}">{esc(l["text"])}</a>'
            for l in article["internalLinks"])
        elsewhere = f'      <p class="article-elsewhere">See also: {links}.</p>'

    # Authorship. Until the closing reflection the work belongs to the project,
    # not to a person — in the visible byline, in the metadata and in the graph.
    if reveals:
        author_ref = {"@id": f"{url}#creator"}
        author_node = [{
            "@type": "Person",
            "@id": f"{url}#creator",
            "name": creator["name"],
            "affiliation": {"@id": f"{SITE}/#publisher"},
        }]
        author_meta = (f'<meta property="article:author" '
                       f'content="{esc(creator["name"])}">\n')
        byline = f'<span>By {esc(creator["name"])}</span>'
    else:
        author_ref = {"@id": f"{SITE}/#publisher"}
        author_node = []
        author_meta = ""
        byline = f'<span>{esc(PUBLICATION["name"])}</span>'

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Masinloc Bulletin", "item": f"{SITE}/masinloc-bulletin.html"},
                    {"@type": "ListItem", "position": 3, "name": article["title"], "item": url},
                ],
            },
            {
                # BlogPosting rather than NewsArticle: these are evergreen
                # historical explainers, not breaking news.
                "@type": "BlogPosting",
                "@id": f"{url}#article",
                "headline": article["title"],
                "description": article["description"],
                "datePublished": article["published"],
                "dateModified": article["modified"],
                "inLanguage": "en-PH",
                "articleSection": category,
                "author": author_ref,
                "publisher": {"@id": f"{SITE}/#publisher"},
                "isPartOf": {"@id": PUBLICATION["id"]},
                "mainEntityOfPage": url,
            },
            {
                "@type": "Blog",
                "@id": PUBLICATION["id"],
                "name": PUBLICATION["name"],
                "url": f"{SITE}/masinloc-bulletin.html",
                "inLanguage": "en-PH",
                "publisher": {"@id": f"{SITE}/#publisher"},
            },
            *author_node,
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    head = shell_head(article["metaTitle"], article["description"], url, depth=1,
                      og_type="article",
                      extra=f'<meta property="article:published_time" content="{article["published"]}">\n'
                            f'<meta property="article:modified_time" content="{article["modified"]}">\n'
                            + author_meta +
                            f'<meta property="article:section" content="{esc(category)}">\n')

    return head + f"""
<main id="main" data-story="{esc(slug)}" data-story-total="{total}">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="../index.html">Masinloc, Zambales</a></li>
      <li><a href="../masinloc-bulletin.html">Masinloc Bulletin</a></li>
      <li><span aria-current="page">{esc(category)}</span></li>
    </ol>
  </nav>

  <article class="article">
    <header class="article-head">
      <p class="article-cat">{esc(category)}</p>
      <h1>{esc(article['title'])}</h1>
      <p class="article-stand">{esc(article['standfirst'])}</p>
      <p class="article-meta">
        {byline}
        <span><time datetime="{article['published']}">{human_date(article['published'])}</time></span>
        <span>{article['readingMinutes']} min read</span>
        <span class="article-place">{esc(PATHWAYS[article['pathway']])} &middot; part {position} of {total}</span>
      </p>
    </header>

    <div class="article-body">
{body}
{elsewhere}
    </div>

{continue_block(article, by_slug, total)}
{evidence}
{related}
  </article>
</main>
""" + shell_foot(1, jsonld,
                 '<script src="../bulletin.js?v=20260822-2"></script>\n')


# --- archive ------------------------------------------------------------------

def open_questions(articles: list[dict]) -> list[tuple[dict, str]]:
    """Every 'Still open' note in the library, gathered in one place.

    These are written once, inside the article that earned them. Repeating them
    by hand at the bottom of the archive would let the two drift apart.
    """
    found = []
    for a in in_order(articles):
        for block in a["body"]:
            if block["type"] == "note" and block["label"].lower().startswith("still open"):
                found.append((a, block["text"]))
    return found


def archive_page(articles: list[dict]) -> str:
    url = f"{SITE}/masinloc-bulletin.html"
    sequence = in_order(articles)
    by_slug = {a["slug"]: a for a in articles}
    entry = by_slug[ENTRY_STORY]
    total = len(articles)

    def card(a: dict) -> str:
        return f"""          <li class="story" data-category="{esc(a['category'])}" data-slug="{esc(a['slug'])}">
            <a href="bulletin/{esc(a['slug'])}.html">
              <p class="story-cat">{esc(CATEGORIES[a['category']])}</p>
              <h4 class="story-title">{esc(a['title'])}</h4>
              <p class="story-stand">{esc(a['standfirst'])}</p>
              <p class="story-meta"><time datetime="{a['published']}">{human_date(a['published'])}</time> &middot; {a['readingMinutes']} min read</p>
            </a>
          </li>"""

    # The pathway rail: the whole sequence, in order, in one glance.
    rail = "".join(
        f'<li class="path-step" data-slug="{esc(a["slug"])}">'
        f'<a href="bulletin/{esc(a["slug"])}.html">'
        f'<span class="path-n">{a["order"] + 1}</span>'
        f'<span class="path-way">{esc(PATHWAYS[a["pathway"]])}</span>'
        f'<span class="path-title">{esc(a["title"])}</span>'
        f'</a></li>'
        for a in sequence)

    recent = by_date(articles)[:3]
    recent_cards = "\n".join(card(a) for a in recent)

    groups = []
    for heading, blurb, cats in GROUPS:
        members = [a for a in sequence if a["category"] in cats]
        if not members:
            continue
        anchor = heading.lower().replace(" & ", "-").replace(" ", "-")
        groups.append(f"""    <section class="archive-group" id="{esc(anchor)}" aria-labelledby="{esc(anchor)}-title">
      <div class="group-head">
        <h3 id="{esc(anchor)}-title">{esc(heading)}</h3>
        <p>{esc(blurb)}</p>
      </div>
      <ol class="story-list">
{chr(10).join(card(a) for a in members)}
      </ol>
    </section>""")

    questions = "".join(
        f'<li><p class="q-text">{esc(text)}</p>'
        f'<a href="bulletin/{esc(a["slug"])}.html">{esc(a["title"])}</a></li>'
        for a, text in open_questions(articles))

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": f"{url}#webpage",
                "url": url,
                "name": "Masinloc Bulletin",
                "description": "Historical, heritage and language reporting about Masinloc, Zambales.",
                "isPartOf": {"@id": f"{SITE}/#website"},
                "inLanguage": "en-PH",
            },
            {
                "@type": "Blog",
                "@id": PUBLICATION["id"],
                "name": PUBLICATION["name"],
                "url": url,
                "description": PUBLICATION["blurb"],
                "inLanguage": "en-PH",
                "publisher": {"@id": f"{SITE}/#publisher"},
            },
            {
                "@type": "ItemList",
                "name": "MABAYANI, in reading order",
                "itemListOrder": "https://schema.org/ItemListOrderAscending",
                "itemListElement": [
                    {"@type": "ListItem", "position": a["order"] + 1,
                     "url": f"{SITE}/bulletin/{a['slug']}.html", "name": a["title"]}
                    for a in sequence
                ],
            },
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    return shell_head(
        "Masinloc Bulletin | History, Heritage & Language",
        "Researched reporting on Masinloc, Zambales: its documented history, its heritage church, the Sambal Tina language, and the questions still open.",
        url, depth=0) + f"""
<main id="main" data-story-total="{total}">
  <section class="bulletin-hero">
    <p class="section-label">Masinloc Bulletin</p>
    <h1>What we know about Masinloc, and how we know it.</h1>
    <p class="lead">Historical, heritage and language reporting for Masinloc, Zambales. Every article names the evidence it rests on, and says plainly where the evidence stops. Sources are collected in our <a href="sources.html">Sources &amp; References</a> directory.</p>
  </section>

  <section class="mabayani" aria-labelledby="mabTitle">
    <div class="mab-mark">
      <p class="mab-kicker">{esc(PUBLICATION['kicker'])}</p>
      <h2 id="mabTitle">{esc(PUBLICATION['name'])}</h2>
      <p class="mab-lead">{esc(PUBLICATION['blurb'])}</p>
    </div>

    <a class="mab-entry" href="bulletin/{esc(entry['slug'])}.html">
      <p class="mab-entry-label">Start here</p>
      <h3>{esc(entry['title'])}</h3>
      <p class="mab-entry-stand">{esc(entry['standfirst'])}</p>
      <p class="mab-entry-go"><span>Read the first story</span> <span aria-hidden="true">→</span></p>
    </a>

    <div class="mab-path-wrap">
      <div class="mab-path-head">
        <h3 class="mab-path-title">Continue the story</h3>
        <p class="mab-progress" id="mabProgress" hidden></p>
      </div>
      <ol class="mab-path" id="mabPath">
{rail}
      </ol>
      <p class="mab-path-note">Each story stands on its own. Read in order and they build one argument about how Masinloc's history has been told.</p>
    </div>
  </section>

  <section class="bulletin-archive" aria-labelledby="archiveTitle">
    <div class="archive-head">
      <h2 id="archiveTitle">All stories</h2>
      <div class="archive-filters" role="group" aria-label="Filter by category">
        <button type="button" class="chip is-active" data-filter="all">All <span>{total}</span></button>
        {"".join(
            f'<button type="button" class="chip" data-filter="{esc(c["id"])}">'
            f'{esc(c["label"])} <span>{sum(1 for a in articles if a["category"] == c["id"])}</span>'
            "</button>"
            for c in BULLETIN["categories"]
            if any(a["category"] == c["id"] for a in articles))}
      </div>
    </div>

    <section class="archive-group" id="recent" aria-labelledby="recent-title">
      <div class="group-head">
        <h3 id="recent-title">Recently added</h3>
        <p>The newest work in the library.</p>
      </div>
      <ol class="story-list">
{recent_cards}
      </ol>
    </section>

{chr(10).join(groups)}
    <p class="archive-empty" id="archiveEmpty" hidden>No stories in this category yet.</p>
  </section>

  <section class="open-questions" aria-labelledby="openTitle">
    <h2 id="openTitle">Questions still open</h2>
    <p class="open-lead">Research that has not been finished. Each one is stated in the article it belongs to, and each one is an invitation: if you can close one, <a href="contact.html">tell us</a>.</p>
    <ul class="q-list">{questions}</ul>
  </section>
</main>
""" + shell_foot(0, jsonld, '<script src="bulletin.js?v=20260822-2"></script>\n')


# --- sources ------------------------------------------------------------------

def sources_page() -> str:
    url = f"{SITE}/sources.html"
    intro = "".join(f"<p>{esc(p)}</p>" for p in SOURCES["intro"]["body"])

    sections = []
    for section in SOURCES["sections"]:
        rows = []
        for entry in section["entries"]:
            tags = "".join(f'<li>{esc(t)}</li>' for t in entry.get("tags", []))
            if entry.get("link"):
                link = (f'<p class="source-link"><a href="{esc(entry["link"])}" '
                        f'rel="noopener">View source</a></p>')
            else:
                # No invented URLs. Where no verified public copy has been
                # located the entry says so and stays citable.
                link = (f'<p class="source-pending">{esc(entry["linkStatus"])}</p>')
            rows.append(f"""        <li class="source" id="{esc(entry['id'])}">
          <p class="source-type">{esc(entry['type'])}</p>
          <h3>{esc(entry['title'])}</h3>
          <p class="source-who">{esc(entry.get('author', ''))}</p>
          <p class="source-pub">{esc(entry.get('publication', ''))}</p>
          <p class="source-note">{esc(entry['note'])}</p>
          {f'<ul class="source-tags">{tags}</ul>' if tags else ''}
          {link}
        </li>""")
        sections.append(f"""    <section class="source-section" id="{esc(section['id'])}" aria-labelledby="{esc(section['id'])}-title">
      <h2 id="{esc(section['id'])}-title">{esc(section['title'])}</h2>
      <p class="source-blurb">{esc(section['blurb'])}</p>
      <ol class="source-list">
{chr(10).join(rows)}
      </ol>
    </section>""")

    graph = {
        "@context": "https://schema.org",
        "@graph": [{
            "@type": "WebPage",
            "@id": f"{url}#webpage",
            "url": url,
            "name": "Sources & References",
            "description": "The evidence directory behind Masinloc historical, heritage and language articles.",
            "isPartOf": {"@id": f"{SITE}/#website"},
            "inLanguage": "en-PH",
        }],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    return shell_head(
        "Sources & References | Masinloc, Zambales",
        "The studies, archives, heritage records and linguistic scholarship behind what Discover Masinloc publishes about Masinloc history and language.",
        url, depth=0) + f"""
<main id="main">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="index.html">Masinloc, Zambales</a></li>
      <li><span aria-current="page">Sources &amp; References</span></li>
    </ol>
  </nav>

  <section class="sources-hero">
    <p class="section-label">Evidence</p>
    <h1>{esc(SOURCES['intro']['title'])}</h1>
    <div class="lead">{intro}</div>
  </section>

{chr(10).join(sections)}
</main>
""" + shell_foot(0, jsonld)


# --- checks -------------------------------------------------------------------

def verify(articles: list[dict]) -> None:
    problems = []
    slugs = {a["slug"] for a in articles}
    grouped = {c for _, _, cats in GROUPS for c in cats}
    creator = PUBLICATION["creator"]["name"].lower()
    surname = creator.split()[-1]
    reveals = [a for a in articles if a.get("revealsCreator")]

    if len(reveals) != 1:
        problems.append(f"exactly one article may reveal the creator; {len(reveals)} do")
    elif reveals[0]["order"] != max(a["order"] for a in articles):
        problems.append(f"the reveal ({reveals[0]['slug']}) is not the last story in the sequence")

    orders = sorted(a["order"] for a in articles)
    if orders != list(range(len(articles))):
        problems.append(f"reading order is not a complete run from 0: {orders}")

    for a in articles:
        for sid in a["sources"]:
            if sid not in SOURCE_BY_ID:
                problems.append(f"{a['slug']}: cites unknown source id '{sid}'")
        if not a["sources"]:
            problems.append(f"{a['slug']}: names no evidence")
        for rel in a.get("related", []):
            if rel not in slugs:
                problems.append(f"{a['slug']}: related article '{rel}' is not published")
        if a["category"] not in CATEGORIES:
            problems.append(f"{a['slug']}: unknown category '{a['category']}'")
        if a["category"] not in grouped:
            problems.append(f"{a['slug']}: category '{a['category']}' is in no archive group, "
                            f"so the story would not appear on the Bulletin")
        if a["pathway"] not in PATHWAYS:
            problems.append(f"{a['slug']}: unknown pathway '{a['pathway']}'")
        if a.get("next"):
            if a["next"] not in slugs:
                problems.append(f"{a['slug']}: continues to '{a['next']}', which is not published")
            if not a.get("nextQuestion"):
                problems.append(f"{a['slug']}: has a next story but no question to carry the reader there")

        text = " ".join(b.get("text", "") for b in a["body"]).lower()
        haystack = f"{a['title']} {a['standfirst']} {a['description']} {text}".lower()
        for phrase in FORBIDDEN_PUBLIC:
            if phrase in text:
                problems.append(f"{a['slug']}: cites the internal manuscript publicly "
                                f"('{phrase}')")
        for word in BANNED_REGISTER:
            if word in haystack:
                problems.append(f"{a['slug']}: uses streaming-serial language ('{word}')")
        # The anonymity rule, checked at the source as well as in the built HTML.
        if not a.get("revealsCreator") and (creator in haystack or surname in haystack):
            problems.append(f"{a['slug']}: names the creator before the closing reflection")

    if problems:
        print("BULLETIN BUILD FAILED")
        for p in problems:
            print(f"- {p}")
        sys.exit(1)


def sync_sitemap(articles: list[dict]) -> int:
    """Rewrite the Bulletin's slice of sitemap.xml from the article data.

    The rest of the sitemap is hand-maintained and left untouched; only the
    bulletin/ entries are owned here. Publishing a story and forgetting to
    list it is otherwise silent — the page is live and nothing says it is
    missing from the index.
    """
    path = ROOT / "sitemap.xml"
    text = path.read_text(encoding="utf-8")

    kept, block, dropping = [], [], False
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped == "<url>":
            block, dropping = [line], False
        elif block:
            block.append(line)
            if "/bulletin/" in stripped:
                dropping = True
            if stripped == "</url>":
                if not dropping:
                    kept.extend(block)
                block = []
        else:
            kept.append(line)

    entries = []
    for a in in_order(articles):
        entries += [
            "  <url>",
            f"    <loc>{SITE}/bulletin/{a['slug']}.html</loc>",
            f"    <lastmod>{a['modified']}</lastmod>",
            "  </url>",
        ]

    close = kept.index("</urlset>")
    kept[close:close] = entries
    path.write_text("\n".join(kept), encoding="utf-8")
    return len(articles)


def main() -> int:
    articles = published()
    if not articles:
        sys.exit("no published articles in data/bulletin.json")
    verify(articles)

    OUT.mkdir(exist_ok=True)
    # Remove pages for articles that are no longer published, so unpublishing
    # actually takes something off the site.
    live = {f"{a['slug']}.html" for a in articles}
    for stale in OUT.glob("*.html"):
        if stale.name not in live:
            stale.unlink()
            print(f"removed {stale.relative_to(ROOT)}")

    for a in articles:
        (OUT / f"{a['slug']}.html").write_text(article_page(a, articles), encoding="utf-8")

    (ROOT / "masinloc-bulletin.html").write_text(archive_page(articles), encoding="utf-8")
    (ROOT / "sources.html").write_text(sources_page(), encoding="utf-8")
    listed = sync_sitemap(articles)

    words = sum(len(" ".join(b.get("text", "") for b in a["body"]).split())
                for a in articles)
    print(f"built {len(articles)} stories ({words:,} words), the Bulletin and "
          f"the sources directory")
    for a in in_order(articles):
        mark = "  reveal" if a.get("revealsCreator") else ""
        print(f"  {a['order'] + 1:>2}. bulletin/{a['slug']}.html  "
              f"[{PATHWAYS[a['pathway']]}]{mark}")
    linked = sum(1 for e in SOURCE_BY_ID.values() if e.get("link"))
    print(f"{len(SOURCE_BY_ID)} sources; {linked} with a verified public link, "
          f"{len(SOURCE_BY_ID) - linked} awaiting one")
    print(f"{len(open_questions(articles))} open research questions listed")
    print(f"sitemap.xml carries all {listed} story URLs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
