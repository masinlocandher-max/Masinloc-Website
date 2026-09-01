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

# The artwork the project supplied for this page, declared in
# data/mabayani-assets.json and built by scripts/build-mabayani-assets.py.
# Keyed by slug so a page can ask for one by name and get its real widths,
# native size and alt text rather than repeating them in markup.
ARTWORK = {
    art["slug"]: art
    for art in json.loads(
        (ROOT / "data" / "mabayani-assets.json").read_text(encoding="utf-8"))["artwork"]
}
# Both designs are 1672x941. Stated once here so the <img> can carry real
# dimensions and the browser reserves the right box before the file arrives.
ARTWORK_SIZE = {"mabayani-history": (1672, 941), "mabayani-quote": (1672, 941)}

# WHERE MABAYANI CAME FROM, AND THE ONE LINE OF THE AUTHOR'S THIS PAGE QUOTES.
#
# Hand-authored, and deliberately not in data/mabayani.json — that file is
# regenerated wholesale from the brief by parse-mabayani-spec.py, so anything
# added to it by hand disappears on the next parse.
#
# EVERY QUOTED LINE SAYS WHERE IT CAME FROM.
#
# The author is quoted on this page, never written for. This started as a check
# that the epigraph was a verbatim passage of the closing quotation card, which
# was right while that card was the only thing of hers the project held. It is
# not any more: she has since supplied an author's message written for this
# page, and a rule that only recognises one source would have refused her own
# words.
#
# So the rule is now about provenance rather than about one source. A quoted
# line declares where it came from and the build stops without that
# declaration. "quotation-card" is machine-checkable and is checked. "supplied"
# is not — no script can confirm what a person sent — so the declaration is the
# record of who vouched for it, which is exactly how this page treats every
# other claim it makes.
PROVENANCE = json.loads(
    (ROOT / "data" / "mabayani-provenance.json").read_text(encoding="utf-8"))
EPIGRAPH_SOURCES = ("quotation-card", "supplied")
_source = PROVENANCE.get("epigraphSource")
if _source not in EPIGRAPH_SOURCES:
    sys.exit(
        f"REFUSING TO BUILD: data/mabayani-provenance.json quotes the author but "
        f"declares epigraphSource {_source!r}. It must be one of "
        f"{', '.join(EPIGRAPH_SOURCES)} — a line attributed to a real person "
        f"ships with a record of where it came from, or it does not ship.")
if (_source == "quotation-card"
        and PROVENANCE["epigraph"] not in " ".join(ARTWORK["mabayani-quote"]["text"])):
    sys.exit(
        "REFUSING TO BUILD: the epigraph in data/mabayani-provenance.json is "
        "declared as coming from the closing quotation card, and is not a "
        "verbatim passage of it. Quote it exactly, or declare the line as "
        "'supplied' if the project provided it directly.")

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

# The word beside each chapter number. Tagalog, unlike the rest of the page's
# furniture, because this label sits directly against the section titles and
# those are Tagalog — "Part 13 / 1649: Anim na Caracoa" changes language in the
# middle of a line, and "Bahagi" does not.
CHAPTER_LABEL = "Bahagi"



def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def lines(block: str) -> str:
    """A paragraph, keeping the line breaks the copy was written with."""
    return "<br>".join(esc(x) for x in block.split("\n") if x.strip())


def prose(blocks: list[str], cls: str = "") -> str:
    attr = f' class="{cls}"' if cls else ""
    return "\n".join(f"      <p{attr}>{lines(b)}</p>" for b in blocks)


def artwork(slug: str, eager: bool = False, full: bool = False) -> str:
    """One supplied MABAYANI design, at every width it was built in.

    Rendered as a <figure> rather than a bare <img> because these are drawings,
    not photographs of Masinloc, and the page's whole argument is that a reader
    can tell what kind of evidence they are looking at. The caption says so in
    words; the alt text describes what is drawn, so somebody who cannot see it
    is told the same thing rather than only that an image exists.
    """
    art = ARTWORK[slug]
    width, height = ARTWORK_SIZE[slug]
    widths = art["widths"]
    sizes = "100vw" if full else "(min-width: 900px) 860px, 100vw"

    def srcset(ext: str) -> str:
        return ", ".join(f"../assets/mabayani/{slug}-{w}.{ext} {w}w" for w in widths)

    loading = "" if eager else ' loading="lazy"'

    # A card whose content is a paragraph of type is unreadable once it is
    # scaled to a phone: 1672px of setting inside a 350px box. So the same
    # passage is also set in the page's own type, and a media query shows
    # exactly one of the two — the card where its lettering is legible, the
    # text where it is not. Both are in the HTML at every width; neither is
    # ever displayed at the same time as the other.
    alternative = ""
    if art.get("text"):
        paragraphs = "".join(f"<p>{lines(block)}</p>" for block in art["text"])
        alternative = (
            f'        <blockquote class="mb-art-text">{paragraphs}'
            f'<cite>{esc(art.get("attribution", ""))}</cite></blockquote>\n')

    return (
        f'      <figure class="mb-art{" mb-art-full" if full else ""}">\n'
        f'        <picture class="mb-art-image">\n'
        f'          <source type="image/avif" sizes="{sizes}" srcset="{srcset("avif")}">\n'
        f'          <source type="image/webp" sizes="{sizes}" srcset="{srcset("webp")}">\n'
        f'          <img src="../assets/mabayani/{slug}-{widths[-1]}.jpg" '
        f'sizes="{sizes}" srcset="{srcset("jpg")}" width="{width}" height="{height}" '
        f'alt="{esc(art["alt"])}"{loading} decoding="async">\n'
        f"        </picture>\n"
        f"{alternative}"
        f'        <figcaption>Artwork &middot; {esc(art["origin"].split("—")[0].strip())}</figcaption>\n'
        f"      </figure>")


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
    # The wordmark signs the vow. It is navy on transparency and this is the one
    # section on the page with a paper ground, so it is the only place on the
    # page where the mark can sit on the colour it was drawn for. Decorative:
    # the heading above it already reads PANATA NG MABAYANI, so an alt here
    # would make a screen reader say the name twice in three seconds.
    mark = ARTWORK["mabayani-wordmark"]
    widths = mark["widths"]
    sign = (
        '      <p class="mb-panata-mark" aria-hidden="true">'
        '<picture>'
        f'<source type="image/webp" srcset="'
        + ", ".join(f"../assets/mabayani/mabayani-wordmark-{w}.webp {w}w" for w in widths)
        + '">'
        f'<img src="../assets/mabayani/mabayani-wordmark-{widths[-1]}.png" srcset="'
        + ", ".join(f"../assets/mabayani/mabayani-wordmark-{w}.png {w}w" for w in widths)
        + '" sizes="196px" width="756" height="138" alt="" loading="lazy" decoding="async">'
        "</picture></p>")
    return f'      <ol class="mb-panata">{stanzas}</ol>\n{sign}'


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
    # The page opens on the title artwork. It is a finished design carrying the
    # wordmark and its own tagline, so it is shown whole rather than cropped to
    # a band, and it sits above the heading rather than behind it — laying the
    # H1 over a drawing that already says MABAYANI prints the word twice.
    if number == "00":
        head.append(artwork("mabayani-history", eager=True, full=True))
    # The chapter mark. The number is information rather than ornament — this
    # is a numbered sequence, the story map is built on these numbers, and the
    # bar overhead prints the one the reader is in. Section 00 is the title
    # screen and the five reference sections are not part of the count, so
    # neither gets one.
    if number != "00":
        head.append(
            f'      <p class="mb-chapter">'
            f'<span class="mb-chapter-n">{esc(number)}</span>'
            f"<span>{esc(CHAPTER_LABEL)}</span>"
            f'<span class="mb-chapter-rule" aria-hidden="true"></span></p>')
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
        tail.append(prose(section["final_footnote_copy"], "mb-footnote"))
    if section.get("author_credit"):
        # The field holds the credit line and then a note about where
        # acknowledgments belong. Only the first is a credit.
        credit = section["author_credit"].split("\n")[0].strip()
        tail.append(f'      <p class="mb-credit">{esc(credit)}</p>')
    if section.get("transition"):
        tail.append(prose(section["transition"], "mb-transition"))

    # The last word on the page is the project's own, set in the closing card:
    # after the credit, after the footnote, with nothing after it.
    if number == "30":
        tail.append(artwork("mabayani-quote"))

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


# What follows the thirty-one story parts. These are real destinations — the
# people, the evidence key, the worked research, the sources, and the form for
# adding to them — and until now the story map ended at part 30, so the only
# way to any of them was to scroll past the whole narrative. A reader who wants
# the sources wants them now, not after thirty-one sections.
REFERENCE_MAP = [
    ("legend", "How to read the evidence labels"),
    ("research", "The research behind the story"),
    ("people", "The people named in the record"),
    ("sources", "Every source this page rests on"),
    ("contribute", "Add what you know"),
]


def provenance() -> str:
    """Who wrote this, said at the top rather than only in the credits.

    It used to be a single line at the foot of thirty-six sections: "Historical
    narrative and research direction: Francine Marie Bautista." Anyone who did
    not read to the end never learned the page had an author at all, let alone
    that it is a book she donated. That is the first thing about it worth
    knowing, so it is now the first thing after the title.
    """
    body = "".join(f'        <p>{lines(block)}</p>\n' for block in PROVENANCE["body"])
    art = ARTWORK["mabayani-author"]
    widths = art["widths"]
    sizes = "(min-width: 820px) 260px, 168px"

    def srcset(ext: str) -> str:
        return ", ".join(f"../assets/mabayani/mabayani-author-{w}.{ext} {w}w" for w in widths)

    # A real photograph of a living person, carrying her name in its alt rather
    # than an empty one. A portrait beside a name is sometimes decorative; this
    # one is not. The page has spent thirty-six sections arguing that a claim
    # arrives with whoever stands behind it, and the person standing behind all
    # of it has a face and a name.
    portrait = (
        '      <figure class="mb-prov-portrait">\n'
        "        <picture>\n"
        f'          <source type="image/avif" sizes="{sizes}" srcset="{srcset("avif")}">\n'
        f'          <source type="image/webp" sizes="{sizes}" srcset="{srcset("webp")}">\n'
        f'          <img src="../assets/mabayani/mabayani-author-{widths[1]}.jpg" '
        f'sizes="{sizes}" srcset="{srcset("jpg")}" width="1122" height="1402" '
        f'alt="{esc(art["alt"])}" loading="lazy" decoding="async">\n'
        "        </picture>\n"
        "      </figure>")

    return (
        '  <aside class="mb-prov" aria-labelledby="prov-title">\n'
        '    <div class="mb-inner mb-prov-inner">\n'
        f"{portrait}\n"
        '      <div class="mb-prov-body">\n'
        f'        <p class="mb-prov-label">{esc(PROVENANCE["label"])}</p>\n'
        f'        <h2 id="prov-title" class="mb-prov-title">{esc(PROVENANCE["title"])}</h2>\n'
        f"{body}"
        '        <blockquote class="mb-prov-quote">\n'
        f'          <p>{lines(PROVENANCE["epigraph"])}</p>\n'
        f'          <cite>{esc(PROVENANCE["author"])}'
        f'<span>{esc(PROVENANCE["role"])}</span></cite>\n'
        "        </blockquote>\n"
        "      </div>\n"
        "    </div>\n"
        "  </aside>")


# Where a reader can send this. No "copy link" button: the project asked for
# sharing that does not run through the clipboard, and the same request is why
# the narrative itself is not selectable. Every one of these is an ordinary
# link, so they work with scripting off; the native share sheet on top of them
# is the enhancement, not the mechanism.
SHARE_TEXT = "MABAYANI — the documented history of Masinloc, Zambales."
SHARE_TARGETS = [
    ("Facebook", "https://www.facebook.com/sharer/sharer.php?u={url}"),
    ("X", "https://twitter.com/intent/tweet?url={url}&text={text}"),
    ("WhatsApp", "https://wa.me/?text={text}%20{url}"),
]
# No email target. A mailto: share link is a reasonable thing to want, but this
# site routes every contact through contact.html and check-seo.py enforces it
# across every page — carving an exception into that rule for a share button is
# a worse trade than doing without one.


def share() -> str:
    """Somewhere to send the page, at the point a reader has finished it."""
    from urllib.parse import quote
    url = quote(f"{SITE}/mabayani/", safe="")
    text = quote(SHARE_TEXT, safe="")
    links = "".join(
        f'<li><a class="mb-share-link" '
        f'href="{target.format(url=url, text=text)}" '
        f'target="_blank" rel="noopener noreferrer">'
        f'<span class="visually-hidden">Share MABAYANI on </span>{esc(name)}</a></li>'
        for name, target in SHARE_TARGETS)
    return (
        '  <section class="mb-share" aria-labelledby="share-title">\n'
        '    <div class="mb-inner">\n'
        '      <p class="mb-share-label">Pass it on</p>\n'
        '      <h2 id="share-title" class="mb-share-title">'
        "Somebody in Masinloc has not read this yet.</h2>\n"
        '      <p class="mb-share-note">Send them the page rather than a copy of it. '
        "The link opens the whole thing, with the sources and the evidence beside "
        "every claim &mdash; a pasted paragraph arrives without any of that.</p>\n"
        '      <button class="mb-share-native" id="mbShareNative" type="button" hidden>'
        "Share MABAYANI</button>\n"
        f'      <ul class="mb-share-list">{links}</ul>\n'
        '      <p class="mb-share-rights">The text of MABAYANI is the author&rsquo;s work and '
        "remains hers. Link to it freely; reproducing it elsewhere is her decision to give.</p>\n"
        "    </div>\n"
        "  </section>")


def story_map() -> str:
    rows = "".join(
        f'<li><a href="#s{esc(item["number"])}">'
        f'<span class="mb-map-n">{esc(item["number"])}</span>'
        f'<span>{esc(item["label"])}</span></a></li>'
        for item in DATA["storyMap"])
    reference = "".join(
        f'<li><a href="#{esc(anchor)}">'
        f'<span class="mb-map-n" aria-hidden="true">&middot;</span>'
        f"<span>{esc(label)}</span></a></li>"
        for anchor, label in REFERENCE_MAP)
    return (
        '<details class="mb-map" id="storyMap">\n'
        '  <summary><span class="mb-map-brand">MABAYANI</span>'
        '<span class="mb-map-label">Story map</span>'
        # Where the reader is, printed in the bar they can always see. Filled by
        # mabayani.js and aria-hidden, because the summary is a button: its
        # accessible name should not change under a screen-reader user as they
        # scroll. Position is announced by the progress region instead.
        '<span class="mb-here" id="mbHere" aria-hidden="true"></span></summary>\n'
        '  <nav aria-label="Story map">\n'
        f'    <p class="mb-map-group" id="mbMapStory">The story</p>\n'
        f'    <ol aria-labelledby="mbMapStory">{rows}</ol>\n'
        f'    <p class="mb-map-group" id="mbMapRef">Reference</p>\n'
        f'    <ul aria-labelledby="mbMapRef">{reference}</ul>\n'
        "  </nav>\n"
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
        # Prefixed. The sources are numbered S01..S25 in the brief and the
        # story parts are numbered 00..30, so lowercasing the source id gave
        # twenty-five elements sharing an id with a story section — "s13" was
        # both part 13 and source S13. A browser resolves a duplicate id to
        # whichever comes first in the document, which is always the story
        # section, so every source anchor pointed at the wrong place and the
        # page shipped invalid HTML. The visible label is unchanged.
        rows.append(
            f'<li id="src-{esc(entry["id"].lower())}">'
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
    # The provenance block sits directly after the title sequence: a reader
    # meets the artwork, then the name of the page, then who wrote it.
    rendered = [section_html(s, i) for i, s in enumerate(DATA["sections"])]
    rendered.insert(1, provenance())
    body = "\n\n".join(rendered)
    total = len(DATA["sections"])

    return f"""<!doctype html>
<html lang="fil">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(SEO["title"])}</title>
<meta name="description" content="{esc(META_DESCRIPTION)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{esc(SEO["title"])}">
<meta property="og:description" content="{esc(META_DESCRIPTION)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/mabayani/mabayani-history-1120.jpg">
<meta property="og:image:alt" content="MABAYANI — History. Expression. Remembrance.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(SEO["title"])}">
<meta name="twitter:description" content="{esc(META_DESCRIPTION)}">
<meta name="twitter:image" content="{SITE}/assets/mabayani/mabayani-history-1120.jpg">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<link rel="stylesheet" href="../tokens.css?v=20260823-1">
<link rel="stylesheet" href="../site.css?v=20260825-2">
<link rel="stylesheet" href="../site-polish.css?v=20260825-2">
<link rel="stylesheet" href="../site-stability.css?v=20260901-2">
<link rel="stylesheet" href="../mabayani.css?v=20260828-16">
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

{share()}

{legend()}

{research_index()}

{profiles_section()}

{contribution_section()}

{sources_section()}
</main>

<footer class="home-footer">
  <div class="footer-brand"><img src="../assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="../index.html">Home</a><a href="../discover/index.html">Discover</a><a href="../sambal-tina.html">Sambal Tina</a><a href="../marketplace.html">Marketplace</a><a href="../a-closer-look.html">About Masinloc</a><a href="../connect.html">Masinloc Connect</a><a href="../verified-history.html">Verified History</a><a href="../masinloc-bulletin.html">Masinloc Bulletin</a><a href="../sources.html">Sources &amp; References</a><a href="../contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
<script src="../site.js?v=20260825-1"></script>
<script src="../bulletin.js?v=20260825-2"></script>
<script src="../mabayani.js?v=20260828-5"></script>
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
