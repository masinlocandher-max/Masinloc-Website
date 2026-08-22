#!/usr/bin/env python3
"""Build the Masinloc Bulletin from data/bulletin.json and data/sources.json.

Adding an article means adding an object to data/bulletin.json and running this
script. Nothing is hand-maintained: the archive page, every article page, the
category counts and the sources directory are all rendered from the data, so a
headline or a date exists in exactly one place.

Two rules are enforced here rather than left to discipline:

  - An article's evidence must resolve to a real entry in data/sources.json.
    A dangling source id fails the build.
  - The internal research manuscript is never a public citation. Articles cite
    the underlying study, record or archive; the manuscript only identified
    what to look for.

Usage
-----
    python3 scripts/build-bulletin.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "bulletin"
SITE = "https://masinloc-zambales.com"

BULLETIN = json.loads((ROOT / "data" / "bulletin.json").read_text(encoding="utf-8"))
SOURCES = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))

AUTHOR = BULLETIN["author"]
CATEGORIES = {c["id"]: c["label"] for c in BULLETIN["categories"]}

# Naming the internal manuscript on a public page would create a citation loop:
# the site citing its own working document as proof of its own article.
FORBIDDEN_PUBLIC = [
    "adviser review manuscript", "mabayani manuscript", "manuscript v0",
    "claim register", "according to the mabayani", "mabayani research says",
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
    live = [a for a in BULLETIN["articles"] if a.get("status") == "published"]
    return sorted(live, key=lambda a: (a["published"], a["slug"]), reverse=True)


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
<link rel="stylesheet" href="{up}bulletin.css?v=20260822-1">
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


def shell_foot(depth: int, jsonld: str = "") -> str:
    up = "../" if depth else ""
    return f"""
<footer class="home-footer">
  <div class="footer-brand"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="{up}index.html">Home</a><a href="{up}a-closer-look.html">A Closer Look</a><a href="{up}verified-history.html">Verified History</a><a href="{up}masinloc-bulletin.html">Masinloc Bulletin</a><a href="{up}sources.html">Sources &amp; References</a><a href="{up}connect.html">Masinloc Connect</a><a href="{up}contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>masinloc-zambales.com</span></div>
</footer>
{jsonld}<script src="{up}site.js?v=20260820-2"></script>
</body>
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


def article_page(article: dict, everything: list[dict]) -> str:
    slug = article["slug"]
    url = f"{SITE}/bulletin/{slug}.html"
    category = CATEGORIES[article["category"]]

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

    related = ""
    by_slug = {a["slug"]: a for a in everything}
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
                "author": {"@id": AUTHOR["id"]},
                "publisher": {"@id": f"{SITE}/#publisher"},
                "isPartOf": {"@id": f"{SITE}/#website"},
                "mainEntityOfPage": url,
            },
            {
                "@type": "Person",
                "@id": AUTHOR["id"],
                "name": AUTHOR["name"],
            },
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    head = shell_head(article["metaTitle"], article["description"], url, depth=1,
                      og_type="article",
                      extra=f'<meta property="article:published_time" content="{article["published"]}">\n'
                            f'<meta property="article:modified_time" content="{article["modified"]}">\n'
                            f'<meta property="article:author" content="{esc(AUTHOR["name"])}">\n'
                            f'<meta property="article:section" content="{esc(category)}">\n')

    return head + f"""
<main id="main">
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
        <span>By {esc(AUTHOR['name'])}</span>
        <span><time datetime="{article['published']}">{human_date(article['published'])}</time></span>
        <span>{article['readingMinutes']} min read</span>
      </p>
    </header>

    <div class="article-body">
{body}
{elsewhere}
    </div>

{evidence}
{related}
  </article>
</main>
""" + shell_foot(1, jsonld)


# --- archive ------------------------------------------------------------------

def archive_page(articles: list[dict]) -> str:
    url = f"{SITE}/masinloc-bulletin.html"
    lead = next((a for a in articles if a.get("featured")), articles[0])
    rest = [a for a in articles if a["slug"] != lead["slug"]]

    used = [c for c in BULLETIN["categories"]
            if any(a["category"] == c["id"] for a in articles)]
    chips = "".join(
        f'<button type="button" class="chip" data-filter="{esc(c["id"])}">'
        f'{esc(c["label"])} <span>{sum(1 for a in articles if a["category"] == c["id"])}</span>'
        "</button>" for c in used)

    def card(a: dict) -> str:
        return f"""        <li class="story" data-category="{esc(a['category'])}">
          <a href="bulletin/{esc(a['slug'])}.html">
            <p class="story-cat">{esc(CATEGORIES[a['category']])}</p>
            <h3 class="story-title">{esc(a['title'])}</h3>
            <p class="story-stand">{esc(a['standfirst'])}</p>
            <p class="story-meta"><time datetime="{a['published']}">{human_date(a['published'])}</time> &middot; {a['readingMinutes']} min read</p>
          </a>
        </li>"""

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
                "@type": "ItemList",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1,
                     "url": f"{SITE}/bulletin/{a['slug']}.html", "name": a["title"]}
                    for i, a in enumerate(articles)
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
<main id="main">
  <section class="bulletin-hero">
    <p class="section-label">Masinloc Bulletin</p>
    <h1>What we know about Masinloc, and how we know it.</h1>
    <p class="lead">Historical, heritage and language reporting for Masinloc, Zambales. Every article names the evidence it rests on, and says plainly where the evidence stops. Sources are collected in our <a href="sources.html">Sources &amp; References</a> directory.</p>
  </section>

  <section class="bulletin-lead" aria-labelledby="leadTitle">
    <a class="lead-card" href="bulletin/{esc(lead['slug'])}.html">
      <p class="story-cat">{esc(CATEGORIES[lead['category']])}</p>
      <h2 id="leadTitle">{esc(lead['title'])}</h2>
      <p class="story-stand">{esc(lead['standfirst'])}</p>
      <p class="story-meta">By {esc(AUTHOR['name'])} &middot; <time datetime="{lead['published']}">{human_date(lead['published'])}</time> &middot; {lead['readingMinutes']} min read</p>
    </a>
  </section>

  <section class="bulletin-archive" aria-labelledby="archiveTitle">
    <div class="archive-head">
      <h2 id="archiveTitle">All stories</h2>
      <div class="archive-filters" role="group" aria-label="Filter by category">
        <button type="button" class="chip is-active" data-filter="all">All <span>{len(articles)}</span></button>
        {chips}
      </div>
    </div>
    <ol class="story-list" id="storyList">
{chr(10).join(card(a) for a in rest)}
    </ol>
    <p class="archive-empty" id="archiveEmpty" hidden>No stories in this category yet.</p>
  </section>
</main>
""" + shell_foot(0, jsonld).replace('<script src="site.js?v=20260820-2"></script>',
                                    '<script src="site.js?v=20260820-2"></script>\n'
                                    '<script src="bulletin.js?v=20260822-1"></script>')


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
        text = " ".join(b.get("text", "") for b in a["body"]).lower()
        for phrase in FORBIDDEN_PUBLIC:
            if phrase in text:
                problems.append(f"{a['slug']}: cites the internal manuscript publicly "
                                f"('{phrase}')")
    if problems:
        print("BULLETIN BUILD FAILED")
        for p in problems:
            print(f"- {p}")
        sys.exit(1)


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

    words = sum(len(" ".join(b.get("text", "") for b in a["body"]).split())
                for a in articles)
    print(f"built {len(articles)} articles ({words:,} words), the archive and "
          f"the sources directory")
    for a in articles:
        print(f"  bulletin/{a['slug']}.html  [{CATEGORIES[a['category']]}]")
    linked = sum(1 for e in SOURCE_BY_ID.values() if e.get("link"))
    print(f"{len(SOURCE_BY_ID)} sources; {linked} with a verified public link, "
          f"{len(SOURCE_BY_ID) - linked} awaiting one")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
