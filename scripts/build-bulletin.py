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
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "bulletin"
SITE = "https://www.masinloc-zambales.com"

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
               extra: str = "", og_type: str = "website",
               active: str = "Discover") -> str:
    """`active` names which of the five destinations owns this page.

    The articles and the sources directory are reading material, so Discover
    holds the current-page state for them. The Bulletin's own front page is the
    editorial publication and is not one of the five, so it passes active=""
    and highlights nothing rather than borrowing a highlight it has no claim to.
    """
    up = "../" if depth else ""
    disc_cur = ' class="active" aria-current="page"' if active == "Discover" else ""
    ogtype = f'<meta property="og:type" content="{og_type}">\n'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
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
<link rel="stylesheet" href="{up}tokens.css?v=20260823-1">
<link rel="stylesheet" href="{up}site.css?v=20260825-2">
<link rel="stylesheet" href="{up}site-polish.css?v=20260825-2">
<link rel="stylesheet" href="{up}site-stability.css?v=20260825-1">
<link rel="stylesheet" href="{up}bulletin.css?v=20260827-1">
</head>
<body class="about-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="{up}index.html" aria-label="Masinloc, Zambales home"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="{up}discover/index.html"{disc_cur}>Discover</a>
    <a href="{up}sambal-tina.html">Sambal Tina</a>
    <a href="{up}marketplace.html">Marketplace</a>
    <a href="{up}a-closer-look.html">About Masinloc</a>
    <a class="connect-link" href="{up}connect.html">Masinloc Connect</a>
  </nav>
</header>
"""


def shell_foot(depth: int, jsonld: str = "", scripts: str = "") -> str:
    up = "../" if depth else ""
    return f"""
<footer class="home-footer">
  <div class="footer-brand"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="{up}index.html">Home</a><a href="{up}discover/index.html">Discover</a><a href="{up}sambal-tina.html">Sambal Tina</a><a href="{up}marketplace.html">Marketplace</a><a href="{up}a-closer-look.html">About Masinloc</a><a href="{up}connect.html">Masinloc Connect</a><a href="{up}verified-history.html">Verified History</a><a href="{up}masinloc-bulletin.html">Masinloc Bulletin</a><a href="{up}sources.html">Sources &amp; References</a><a href="{up}contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
{jsonld}<script src="{up}site.js?v=20260825-1"></script>
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
        <a href="../discover/index.html">
          <span class="continue-label">Back to Discover</span>
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


# Which MABAYANI chapter each research article stands behind. The reader
# arrives here from a search or an old link; this is how they find the story it
# belongs to rather than reading a fragment and leaving.
MABAYANI_CHAPTER = {
    "was-masinloc-founded-in-1572": ("03", "1572: ang petsa na minana natin"),
    "1607-and-the-first-mission-church": ("05", "18 November 1607"),
    "before-the-written-record": ("02", "Bago isulat ang pangalan natin"),
    "the-first-church-was-not-todays-church": ("09", "Ang unang simbahan ay hindi bato"),
    "san-andres-church-across-the-centuries": ("17", "Ang simbahang paulit-ulit na inalagaan"),
    "1649-when-six-caracoas-came": ("13", "1649: anim na caracoa"),
    "what-binabayani-remembers": ("19", "Binabayani: alaala, pananampalataya, at pagwawasto"),
    "what-is-sambal-tina": ("20", "Sambal Tina: ang wikang maaaring mawala nang tahimik"),
    "why-older-sources-say-tina": ("20", "Sambal Tina: ang wikang maaaring mawala nang tahimik"),
    "why-mabayani-exists": ("30", "Continue the work"),
}


def chapter_note(slug: str) -> str:
    """The MABAYANI chapter this research supports, said at the top."""
    pick = MABAYANI_CHAPTER.get(slug)
    if not pick:
        return ""
    number, label = pick
    return (
        '      <aside class="research-of">\n'
        '        <p class="research-of-mark">Research behind MABAYANI</p>\n'
        f'        <p class="research-of-line"><a href="../mabayani/#s{number}">'
        f'{esc(label)}</a></p>\n'
        "      </aside>\n")


def article_page(article: dict, everything: list[dict]) -> str:
    slug = article["slug"]
    url = f"{SITE}/bulletin/{slug}.html"
    # These ten were the MABAYANI sequence. MABAYANI is now the reading at
    # /mabayani/, and they are the research behind its chapters. The page stays
    # and keeps its URL; what it gives up is the claim to be the canonical
    # MABAYANI, so there is one authoritative experience rather than two.
    canonical = f"{SITE}/mabayani/"
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
                    {"@type": "ListItem", "position": 2, "name": "Discover Masinloc", "item": f"{SITE}/discover/"},
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
                "url": f"{SITE}/mabayani/",
                "inLanguage": "en-PH",
                "publisher": {"@id": f"{SITE}/#publisher"},
            },
            *author_node,
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    head = shell_head(article["metaTitle"], article["description"], canonical, depth=1,
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
      <li><a href="../discover/index.html">Discover Masinloc</a></li>
      <li><span aria-current="page">{esc(category)}</span></li>
    </ol>
  </nav>

  <article class="article">
{chapter_note(slug)}    <header class="article-head">
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


def publication_page(articles: list[dict]) -> str:
    """The Bulletin, now that the research has moved to Discover.

    Every article this page used to index is reading material, and reading
    material has one home: Discover. What is left here is the thing the
    Bulletin was always better suited to be — the place where something new
    gets said. Announcements, notices, the practical things worth knowing.

    Nothing has been posted yet, and the page says so plainly rather than
    padding itself out. An empty shelf that admits it is empty is honest; one
    dressed up with placeholders is not.
    """
    url = f"{SITE}/masinloc-bulletin.html"

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Masinloc Bulletin", "item": url},
                ],
            },
            {
                "@type": "WebPage",
                "@id": f"{url}#page",
                "name": "Masinloc Bulletin",
                "description": "Announcements, notices and news from Masinloc, Zambales.",
                "url": url,
                "inLanguage": "en-PH",
                "isPartOf": {"@id": f"{SITE}/#website"},
                "publisher": {"@id": f"{SITE}/#publisher"},
            },
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    return shell_head(
        "Masinloc Bulletin | Announcements & News",
        "Announcements, notices and news from Masinloc, Zambales. The reading \u2014 history, heritage and language \u2014 lives in Discover.",
        url, depth=0, active="") + f"""
<main id="main">
  <section class="bulletin-hero">
    <p class="section-label">Masinloc Bulletin</p>
    <h1>What is happening in Masinloc.</h1>
    <p class="lead">This is where announcements, notices and the practical things worth
      knowing will be posted \u2014 the kind of news you would want before a weekend, a
      fiesta, or a trip home.</p>
  </section>

  <section class="bul-empty" aria-labelledby="emptyTitle">
    <h2 id="emptyTitle">Nothing posted yet</h2>
    <p>The Bulletin is new. There is nothing here today, which is exactly what the
      first day should look like. When there is something worth telling you \u2014 a
      notice, a schedule, an announcement from the town \u2014 it will appear here,
      dated and in plain words.</p>
    <p class="bul-invite">If you know something Masinloc ought to hear about,
      <a href="contact.html">tell us</a> and we will look into it.</p>
  </section>

  <section class="bul-next" aria-labelledby="nextTitle">
    <h2 id="nextTitle">Looking for the reading?</h2>
    <p>It is all in one place now. Discover holds the stories about Masinloc, the
      MABAYANI research sequence, the verified history and the founder of the town
      \u2014 along with the questions the evidence has not answered yet.</p>
    <p class="bul-next-go"><a href="discover/index.html">Open Discover Masinloc</a></p>
  </section>
</main>
""" + shell_foot(0, jsonld, "")


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
    """Hand the sitemap to the one script that owns it.

    This used to rewrite the bulletin/ slice in place and leave the rest of the
    file to be maintained by hand. Two writers is how a page goes missing, and
    the hand-maintained half had drifted: most URLs carried no <lastmod> and
    every one that did was stamped with a deployment date rather than the day
    anything was written.

    scripts/build-sitemap.py now derives the whole file from the pages that
    exist, their own canonical links, and the last commit that touched each
    one. Nothing about the Bulletin is special enough to need its own copy of
    that logic.
    """
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build-sitemap.py")],
        cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode:
        sys.stderr.write(result.stdout + result.stderr)
        sys.exit("sitemap build failed")
    listed = (ROOT / "sitemap.xml").read_text(encoding="utf-8").count("<loc>")
    return listed

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

    (ROOT / "masinloc-bulletin.html").write_text(publication_page(articles), encoding="utf-8")
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
    print(f"{len(open_questions(articles))} open research questions, listed on Discover")
    print(f"sitemap.xml rebuilt by scripts/build-sitemap.py: {listed} URLs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
