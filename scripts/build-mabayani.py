#!/usr/bin/env python3
"""Build /mabayani/ from data/mabayani.json.

MABAYANI is the immersive reading of Masinloc's history. Verified History is
the same history in inspectable form. This page is the first; it links to the
second rather than restating it.

WHAT THIS FILE OWNS, AND WHY THE RULES ARE HERE RATHER THAN IN A CHECKLIST

  - EVIDENCE STATE IS TEXT, NEVER COLOUR ALONE. Every badge prints the word
    DOCUMENTED, RECONSTRUCTED, REMEMBERED or STILL OPEN. A reader who cannot
    distinguish the tints still gets the claim.

  - THE RECORD OPENS WITHOUT JAVASCRIPT. Source drawers are <details>, so the
    evidence is reachable with scripting off, on a slow connection, and to a
    screen reader that ignores our CSS. The brief asks for a bottom sheet on
    small screens; that is styling on top of an element that already works.

  - NO INVENTED VISUAL STANDS IN FOR EVIDENCE. Where the brief asks for a scan
    or a photograph we do not hold, the section falls back to typography and
    space rather than stock imagery or a placeholder box. An empty frame
    captioned "portrait coming soon" would be a promise the archive has not
    made.

  - THREE NAMES STAY MISSING. Section 15 renders three empty name slots. They
    are not a design flourish; they are the point of the section, and nothing
    may fill them until the source chain is pinned.

Usage
-----
    python3 scripts/build-mabayani.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "mabayani"
DATA = json.loads((ROOT / "data" / "mabayani.json").read_text(encoding="utf-8"))
SITE = "https://www.masinloc-zambales.com"

SEO = DATA["seo"]

# The brief's meta description is 208 characters. Search results cut off near
# 160, so a third of it would only ever be written for a machine. This is the
# same claim inside the window; the full sentence is unchanged in the data and
# in the page's own opening.
META_DESCRIPTION = (
    "A documented human history of Masinloc, Zambales: the people before the "
    "written record, the 1607 mission, the 1649 defence, San Andres Church "
    "and Sambal Tina."
)
DRAWER = DATA["drawer"]

# Where each call to action goes. Written out rather than inferred from the
# copy, because a CTA pointing at the wrong page is invisible to every check
# that only counts links.
CTA_TARGETS = {
    ("00", "primary_cta"): "#s01",
    ("00", "secondary_cta"): "../verified-history.html",
    ("04", "cta"): "../contact.html",
    ("06", "cta"): "../founder-of-masinloc.html",
    ("15", "cta"): "../contact.html",
    ("19", "cta"): "../bulletin/what-binabayani-remembers.html",
    ("20", "cta"): "../sambal-tina.html",
    ("21", "cta"): "../contact.html",
    ("22", "cta"): "../contact.html",
    ("28", "cta"): "#s29",
    ("30", "primary_cta"): "../verified-history.html",
    ("30", "secondary_cta"): "../sources.html",
    ("30", "tertiary_cta"): "../contact.html",
}

# The research articles that stand behind a section. These are the ten pieces
# that used to be presented as "the MABAYANI sequence"; they keep their URLs
# and become what they always were underneath — the worked research a section
# rests on. Every one of the ten is reachable from here.
FURTHER_READING = {
    "02": [("before-the-written-record", "Before the written record: what we can and cannot say")],
    "03": [("was-masinloc-founded-in-1572", "1607 is Masinloc's documented founding year")],
    "05": [("1607-and-the-first-mission-church", "1607: the founding of Masinloc and its first church")],
    "09": [("the-first-church-was-not-todays-church", "The first church was not the church we see today")],
    "13": [("1649-when-six-caracoas-came", "1649: Masinloc fought back")],
    "17": [("san-andres-church-across-the-centuries",
            "A church built, damaged, and rebuilt: San Andres across the centuries")],
    "19": [("what-binabayani-remembers", "Binabayani: Kristiyano and Aeta")],
    "20": [("what-is-sambal-tina", "What is Sambal Tina?"),
           ("why-older-sources-say-tina", 'Why older sources call the language "Tina"')],
    "30": [("why-mabayani-exists", "Why MABAYANI exists")],
}

BADGES = ["DOCUMENTED", "RECONSTRUCTED", "REMEMBERED", "STILL OPEN"]


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def lines(block: str) -> str:
    """A paragraph, keeping the line breaks the copy was written with."""
    return "<br>".join(esc(x) for x in block.split("\n") if x.strip())


def prose(blocks: list[str], cls: str = "") -> str:
    attr = f' class="{cls}"' if cls else ""
    return "\n".join(f"      <p{attr}>{lines(b)}</p>" for b in blocks)


def badge(section: dict) -> str:
    """The evidence state, as a word. Never colour on its own."""
    record = section.get("record") or {}
    text = " ".join(record.get("evidence_status") or []) or " ".join(
        section.get("evidence_status") or [])
    if not text:
        return ""
    found = [b for b in BADGES if b in text.upper()]
    if not found:
        return ""
    chips = "".join(
        f'<span class="mb-badge mb-badge-{b.lower().replace(" ", "-")}">'
        f'<span class="mb-badge-dot" aria-hidden="true"></span>{b}</span>'
        for b in found)
    label = "Evidence state" if len(found) == 1 else "Evidence states"
    return f'      <p class="mb-badges"><span class="mb-badges-label">{label}</span>{chips}</p>'


def record_drawer(section: dict) -> str:
    """The evidence, reachable without leaving the narrative and without JS."""
    record = section.get("record")
    if not record:
        return ""
    tabs = [
        ("what_we_know", "What we know"),
        ("what_remains_uncertain", "What remains uncertain"),
        ("sources", "Sources"),
    ]
    parts = []
    for key, title in tabs:
        if not record.get(key):
            continue
        rows = "".join(
            f"<li>{lines(x)}</li>" for block in record[key] for x in [block])
        parts.append(
            f'<div class="mb-rec-tab"><h3>{esc(title)}</h3><ul>{rows}</ul></div>')
    if not parts:
        return ""
    return (
        '      <details class="mb-record">\n'
        f'        <summary><span>{esc(DRAWER["button"])}</span></summary>\n'
        f'        <div class="mb-rec-body">{"".join(parts)}\n'
        f'          <p class="mb-rec-foot">{esc(DRAWER["footer"])}</p>\n'
        "        </div>\n"
        "      </details>"
    )


def fact_block(section: dict) -> str:
    """Fact boxes, strips and chronologies: the same shape, collapsible."""
    out = []
    for key, title in (("fact_box", "The record, in short"),
                       ("fact_strip", "The record, in short"),
                       ("chronology_status", "Chronology, by evidence state"),
                       ("profile_facts", "Profile")):
        if not section.get(key):
            continue
        rows = []
        for block in section[key]:
            for row in block.split("\n"):
                row = row.strip()
                if not row:
                    continue
                rows.append(f"<li>{esc(row.lstrip('- ').strip())}</li>")
        out.append(
            f'      <details class="mb-facts" open>\n'
            f"        <summary><span>{esc(title)}</span></summary>\n"
            f'        <ul>{"".join(rows)}</ul>\n'
            "      </details>")
    return "\n".join(out)


def pledge_lines(section: dict) -> str:
    """The Panata, one stanza at a time, at the reader's own pace."""
    stanzas = "".join(
        f'<li>{lines(block)}</li>' for block in section.get("public_copy", []))
    return f'      <ol class="mb-panata">{stanzas}</ol>'


def further(section: dict) -> str:
    picks = FURTHER_READING.get(section["number"])
    if not picks:
        return ""
    rows = "".join(
        f'<li><a href="../bulletin/{esc(slug)}.html">{esc(title)}</a></li>'
        for slug, title in picks)
    return (
        '      <div class="mb-further">\n'
        "        <h3>The research behind this section</h3>\n"
        f"        <ul>{rows}</ul>\n"
        "      </div>")


def ctas(section: dict) -> str:
    out = []
    for key, cls in (("primary_cta", "mb-cta mb-cta-primary"),
                     ("secondary_cta", "mb-cta"),
                     ("tertiary_cta", "mb-cta"),
                     ("cta", "mb-cta")):
        label = section.get(key)
        if not label:
            continue
        href = CTA_TARGETS.get((section["number"], key))
        if not href:
            continue
        out.append(f'<a class="{cls}" href="{esc(href)}">{esc(label)}</a>')
    if not out:
        return ""
    return f'      <p class="mb-ctas">{"".join(out)}</p>'


def section_html(section: dict, index: int) -> str:
    number = section["number"]
    heading = "h1" if number == "00" else "h2"
    # Section 00 carries no TITLE field: its title is the first line of its own
    # copy, and the brief fixes the page's H1 as the bare word. Falling back to
    # the section label produced "ENTER MABAYANI", which is a navigation label,
    # not the name of the thing.
    title = SEO["h1"] if number == "00" else (section.get("title") or section["label"])
    head = []
    if section.get("eyebrow"):
        head.append(f'      <p class="mb-eyebrow">{esc(section["eyebrow"])}</p>')
    head.append(f'      <{heading} id="t{number}" class="mb-title">{lines(title)}</{heading}>')
    if section.get("subtitle"):
        head.append(f'      <p class="mb-sub">{lines(section["subtitle"])}</p>')

    body = []
    if number == "29":
        body.append(pledge_lines(section))
    else:
        for key, cls in (("public_copy", ""),
                         ("full_viewport_copy", "mb-large"),
                         ("second_reveal_after_pause_scroll", "mb-large mb-reveal")):
            blocks = section.get(key)
            if not blocks:
                continue
            if number == "00" and key == "public_copy":
                blocks = [b for b in blocks if b.strip() != SEO["h1"]]
            body.append(prose(blocks, cls))

    for key, title_text in (("ayon_sa_kuwentong_bayan", "Ayon sa kuwentong-bayan"),
                            ("ayon_sa_kasulatang_tala", "Ayon sa kasulatang tala")):
        if section.get(key):
            body.append(
                f'      <div class="mb-side"><h3>{esc(title_text)}</h3>'
                f'{prose(section[key])}</div>')

    for key, title_text in (("what_we_will_not_do", "What we will not do"),
                            ("what_we_will_do", "What we will do")):
        if section.get(key):
            rows = "".join(
                f"<li>{esc(row.strip())}</li>"
                for block in section[key] for row in block.split("\n") if row.strip())
            body.append(
                f'      <div class="mb-vow"><h3>{esc(title_text)}</h3><ul>{rows}</ul></div>')

    if section.get("reflection"):
        body.append(
            f'      <blockquote class="mb-reflect">{prose(section["reflection"])}</blockquote>')

    # Section 15 is three names nobody has recovered. The blanks are the copy.
    if number == "15":
        body.append(
            '      <ol class="mb-missing" aria-label="Three names not yet recovered">'
            + "".join('<li><span class="mb-missing-slot" aria-hidden="true"></span>'
                      "NAME NOT YET RECOVERED</li>" for _ in range(3))
            + "</ol>")

    tail = [badge(section), fact_block(section), record_drawer(section),
            further(section), ctas(section)]
    # The closing section carries the footnote that explains what this page is,
    # and the credit for the research direction. Both come from the brief.
    if section.get("final_footnote_copy"):
        tail.append(
            f'      <p class="mb-footnote">{prose(section["final_footnote_copy"])[13:]}')
    if section.get("author_credit"):
        # The field holds the credit line and then a note about where
        # acknowledgments belong. Only the first is a credit.
        credit = section["author_credit"].split("\n")[0].strip()
        tail.append(f'      <p class="mb-credit">{esc(credit)}</p>')
    if section.get("transition"):
        tail.append(f'      <p class="mb-transition">{prose(section["transition"])[13:]}')

    classes = ["mb-section"]
    if number in {"00", "28"}:
        classes.append("mb-full")
    if number == "29":
        classes.append("mb-panata-section")

    inner = "\n".join(x for x in head + body + tail if x)
    return (
        f'  <section id="s{number}" class="{" ".join(classes)}" '
        f'data-part="{number}" aria-labelledby="t{number}">\n'
        f"    <div class=\"mb-inner\">\n{inner}\n    </div>\n"
        "  </section>")


def story_map() -> str:
    rows = "".join(
        f'<li><a href="#s{esc(item["number"])}">'
        f'<span class="mb-map-n">{esc(item["number"])}</span>'
        f'<span>{esc(item["label"])}</span></a></li>'
        for item in DATA["storyMap"])
    return (
        '<details class="mb-map" id="storyMap">\n'
        '  <summary><span>Story Map</span></summary>\n'
        f'  <nav aria-label="Story map"><ol>{rows}</ol></nav>\n'
        "</details>")


def profiles_section() -> str:
    cards = []
    for entry in DATA["profiles"]:
        state = entry.get("evidence", "")
        chip = ""
        found = [b for b in BADGES if b in state.upper()]
        if found:
            chip = "".join(
                f'<span class="mb-badge mb-badge-{b.lower().replace(" ", "-")}">'
                f'<span class="mb-badge-dot" aria-hidden="true"></span>{b}</span>'
                for b in found)
        cards.append(
            f'<li class="mb-person mb-person-{entry["kind"]}">'
            f'<h3>{esc(entry["name"])}</h3>'
            f'<p class="mb-badges">{chip}</p>'
            + "".join(f"<p>{lines(b)}</p>" for b in entry["body"])
            + "</li>")
    return (
        '  <section id="people" class="mb-section mb-people" aria-labelledby="people-title">\n'
        '    <div class="mb-inner">\n'
        '      <h2 id="people-title" class="mb-title">The people named in the record</h2>\n'
        "      <p>Some names were preserved by an institution that had a reason to keep them. "
        "Most of the people beside them were not. Both facts belong to the history.</p>\n"
        f'      <ul class="mb-people-list">{"".join(cards)}</ul>\n'
        "    </div>\n"
        "  </section>")


def contribution_section() -> str:
    give = DATA["contribution"]
    items = "".join(f"<li>{esc(x)}</li>" for x in give.get("fields", []))
    body = "".join(f"<p>{lines(b)}</p>" for b in give.get("body", []))
    trust = "".join(f'<p class="mb-trust">{lines(b)}</p>' for b in give.get("trust", []))
    return (
        '  <section id="contribute" class="mb-section mb-give" aria-labelledby="give-title">\n'
        '    <div class="mb-inner">\n'
        f'      <h2 id="give-title" class="mb-title">{esc(give["entry"])}</h2>\n'
        f"      {body}\n{trust}\n"
        '      <details class="mb-facts"><summary><span>What a submission asks for</span></summary>'
        f"<ol>{items}</ol>"
        f'<p>{esc(give.get("consent", ""))}</p></details>\n'
        f'      <p class="mb-ctas"><a class="mb-cta mb-cta-primary" href="../contact.html">'
        f'{esc(give.get("submit", "Submit for historical review"))}</a></p>\n'
        f'      <p class="mb-note">{esc(give.get("confirmation", ""))}</p>\n'
        "    </div>\n"
        "  </section>")


def sources_section() -> str:
    rows = []
    for entry in DATA["sources"]:
        rows.append(
            f'<li id="{esc(entry["id"].lower())}">'
            f'<p class="mb-src-cite">{esc(entry["citation"])}</p>'
            + (f'<p class="mb-src-use">{esc(entry["use"])}</p>' if entry.get("use") else "")
            + (f'<p class="mb-src-status">{esc(entry["status"])}</p>' if entry.get("status") else "")
            + "</li>")
    return (
        '  <section id="sources" class="mb-section mb-sources" aria-labelledby="src-title">\n'
        '    <div class="mb-inner">\n'
        '      <h2 id="src-title" class="mb-title">Every source this page rests on</h2>\n'
        f'      <ol class="mb-src-list">{"".join(rows)}</ol>\n'
        '      <p class="mb-ctas"><a class="mb-cta" href="../sources.html">'
        "The full Sources &amp; References directory</a></p>\n"
        "    </div>\n"
        "  </section>")


def legend() -> str:
    rows = "".join(
        f'<div class="mb-legend-row">'
        f'<span class="mb-badge mb-badge-{name.lower().replace(" ", "-")}">'
        f'<span class="mb-badge-dot" aria-hidden="true"></span>{name}</span>'
        f"<p>{esc(text)}</p></div>"
        for name, text in DRAWER["badges"].items())
    return (
        '  <section id="legend" class="mb-section mb-legend" aria-labelledby="legend-title">\n'
        '    <div class="mb-inner">\n'
        '      <h2 id="legend-title" class="mb-title">How to read the evidence labels</h2>\n'
        f"      {rows}\n"
        "    </div>\n"
        "  </section>")


def research_index() -> str:
    """The ten worked research articles, with the progress bulletin.js keeps.

    data-slug and #mabPath are what bulletin.js reads to dim what this reader
    has already opened and count them up. The hooks are unchanged, so the
    feature moves with the articles instead of being lost when Discover stopped
    listing them as a sequence.
    """
    order = ["03", "05", "02", "09", "17", "13", "19", "20", "30"]
    seen, rows = set(), []
    for number in order:
        for slug, title in FURTHER_READING.get(number, []):
            if slug in seen:
                continue
            seen.add(slug)
            rows.append(
                f'<li class="mb-res-item" data-slug="{esc(slug)}">'
                f'<a href="../bulletin/{esc(slug)}.html">'
                f'<span class="mb-res-n">{len(seen):02d}</span>'
                f'<span class="mb-res-title">{esc(title)}</span></a></li>')
    return (
        '  <section id="research" class="mb-section mb-research" aria-labelledby="res-title">\n'
        '    <div class="mb-inner">\n'
        '      <h2 id="res-title" class="mb-title">The research behind the story</h2>\n'
        "      <p>Each of these works through one part of the record in detail — the "
        "sources, the disagreements between them, and what is still unresolved. They "
        "are where the claims on this page were argued out.</p>\n"
        '      <p class="mb-res-progress" id="mabProgress" hidden></p>\n'
        f'      <ol class="mb-res-list" id="mabPath">{"".join(rows)}</ol>\n'
        "    </div>\n"
        "  </section>")


def page() -> str:
    url = SEO["canonical"]
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales",
                     "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "About Masinloc",
                     "item": f"{SITE}/a-closer-look.html"},
                    {"@type": "ListItem", "position": 3, "name": "MABAYANI", "item": url},
                ],
            },
            {
                # WebPage only. The brief is explicit that unresolved dates must
                # not be encoded as settled historical entities in structured
                # data, and half this page exists to say which dates are not
                # settled.
                "@type": "WebPage",
                "@id": f"{url}#page",
                "name": SEO["title"],
                "description": SEO["description"],
                "url": url,
                "inLanguage": ["en-PH", "fil-PH"],
                "isPartOf": {"@id": f"{SITE}/#website"},
                "publisher": {"@id": f"{SITE}/#publisher"},
            },
        ],
    }
    jsonld = json.dumps(graph, indent=2, ensure_ascii=False)
    body = "\n\n".join(section_html(s, i) for i, s in enumerate(DATA["sections"]))
    total = len(DATA["sections"])

    return f"""<!doctype html>
<html lang="fil">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(SEO["title"])}</title>
<meta name="description" content="{esc(META_DESCRIPTION)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{esc(SEO["title"])}">
<meta property="og:description" content="{esc(META_DESCRIPTION)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<meta property="og:image:alt" content="Masinloc, Zambales from the air">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(SEO["title"])}">
<meta name="twitter:description" content="{esc(META_DESCRIPTION)}">
<meta name="twitter:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<link rel="stylesheet" href="../tokens.css?v=20260823-1">
<link rel="stylesheet" href="../site.css?v=20260825-2">
<link rel="stylesheet" href="../site-polish.css?v=20260825-2">
<link rel="stylesheet" href="../site-stability.css?v=20260825-1">
<link rel="stylesheet" href="../mabayani.css?v=20260827-1">
</head>
<body class="about-page mabayani-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="../index.html" aria-label="Masinloc, Zambales home"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="../discover/index.html">Discover</a>
    <a href="../sambal-tina.html">Sambal Tina</a>
    <a href="../marketplace.html">Marketplace</a>
    <a class="active" href="../a-closer-look.html" aria-current="page">About Masinloc</a>
    <a class="connect-link" href="../connect.html">Masinloc Connect</a>
  </nav>
</header>

<div class="mb-progress" id="mbProgress" role="status" aria-live="polite" hidden>
  <span class="mb-progress-bar" id="mbProgressBar"></span>
  <span class="mb-progress-text" id="mbProgressText"></span>
</div>

{story_map()}

<main id="main" data-parts="{total}">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="../index.html">Masinloc, Zambales</a></li>
      <li><a href="../a-closer-look.html">About Masinloc</a></li>
      <li><span aria-current="page">MABAYANI</span></li>
    </ol>
  </nav>

{body}

{legend()}

{research_index()}

{profiles_section()}

{contribution_section()}

{sources_section()}
</main>

<footer class="home-footer">
  <div class="footer-brand"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="../index.html">Home</a><a href="../discover/index.html">Discover</a><a href="../sambal-tina.html">Sambal Tina</a><a href="../marketplace.html">Marketplace</a><a href="../a-closer-look.html">About Masinloc</a><a href="../connect.html">Masinloc Connect</a><a href="../verified-history.html">Verified History</a><a href="../masinloc-bulletin.html">Masinloc Bulletin</a><a href="../sources.html">Sources &amp; References</a><a href="../contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Masinloc. All rights reserved.</span><span>Photography · Mabayani Project by FMB</span></div>
</footer>
<script src="../site.js?v=20260825-1"></script>
<script src="../bulletin.js?v=20260825-2"></script>
<script src="../mabayani.js?v=20260827-1"></script>
<script type="application/ld+json">
{jsonld}
</script>
</body>
</html>
"""


def main() -> int:
    OUT.mkdir(exist_ok=True)
    (OUT / "index.html").write_text(page(), encoding="utf-8")

    sections = DATA["sections"]
    print(f"mabayani/index.html: {len(sections)} sections, "
          f"{sum(1 for s in sections if 'record' in s)} source drawers, "
          f"{len(DATA['profiles'])} profiles, {len(DATA['sources'])} registry entries")
    linked = sum(len(v) for v in FURTHER_READING.values())
    print(f"{linked} research articles linked from the sections they stand behind")
    missing = [s["number"] for s in sections
               if s.get("cta") and ("cta" not in {k[1] for k in CTA_TARGETS if k[0] == s["number"]})]
    if missing:
        print(f"WARNING: sections with an unrouted CTA: {missing}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
