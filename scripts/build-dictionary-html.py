#!/usr/bin/env python3
"""Put real Sambal Tina words into sambal-tina.html.

The dictionary page arrived with every entry loaded by fetch, so the markup
described a dictionary without containing one. A search engine that does not
run JavaScript — and most agents that read pages on behalf of a person do not
— saw a page about Sambal Tina with no Sambal Tina on it.

This renders the curated vocabulary into the page at build time, between
markers, using exactly the markup sambal-tina.js produces. The script then
replaces it with the same content on load, so nothing differs between what a
crawler is served and what a visitor sees. That is the whole point: this is
not a crawler-only block, it is the page finally containing its own content.

Only the curated layers go in — the everyday phrasebook and the
speaker-confirmed living usage. The full 5,222-entry archive stays a fetch,
because inlining it would make the page several hundred kilobytes for no
reader benefit.

Usage
-----
    python3 scripts/build-dictionary-html.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "sambal-tina.html"
DICT = json.loads((ROOT / "data" / "sambal-tina.json").read_text(encoding="utf-8"))
LIVING = json.loads((ROOT / "data" / "sambal-tina-living.json").read_text(encoding="utf-8"))

START = "<!-- phrasebook:start -->"
END = "<!-- phrasebook:end -->"
LIVING_START = "<!-- living:start -->"
LIVING_END = "<!-- living:end -->"


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def phrasebook_markup() -> str:
    """Mirrors renderPhrasebook() in sambal-tina.js, element for element."""
    groups = DICT.get("phrasebook") or []
    if not groups:
        sys.exit("data/sambal-tina.json carries no phrasebook")
    out = []
    for group in groups:
        items = "".join(
            "<li>"
            "<span>"
            f'<span class="phrase-tina">{esc(word["tina"])}</span><br>'
            f'<span class="phrase-en">{esc(word["en"])}</span>'
            "</span>"
            + (f'<span class="phrase-page">p.&nbsp;{esc(word["pages"])}</span>'
               if word.get("pages") else "")
            + "</li>"
            for word in group["words"]
        )
        out.append(
            '<div class="phrase-group">'
            f'<h3>{esc(group["title"])}</h3>'
            f"<ul>{items}</ul>"
            "</div>"
        )
    return "".join(out)


def living_markup() -> str:
    """The speaker-confirmed layer, kept visibly separate from the archive."""
    rows = "".join(
        "<li>"
        "<span>"
        f'<span class="phrase-tina">{esc(entry["tina"])}</span><br>'
        f'<span class="phrase-en">{esc(entry.get("en", ""))}'
        + (f' &middot; {esc(entry.get("fil", ""))}' if entry.get("fil") else "")
        + "</span>"
        "</span>"
        "</li>"
        for entry in LIVING["entries"]
    )
    return (
        '<div class="phrase-group">'
        f'<h3>{esc(LIVING["title"])}</h3>'
        f"<ul>{rows}</ul>"
        "</div>"
    )


def main() -> int:
    markup = PAGE.read_text(encoding="utf-8")

    # The phrasebook goes inside the container sambal-tina.js owns, because
    # the script rewrites that element with identical markup on load.
    block = phrasebook_markup()

    if START in markup and END in markup:
        markup = re.sub(
            re.escape(START) + r".*?" + re.escape(END),
            START + block + END,
            markup,
            flags=re.S,
        )
    else:
        target = '<div class="phrasebook-groups" id="phrasebookGroups" data-empty="Loading&hellip;"></div>'
        if target not in markup:
            sys.exit("could not find the phrasebook container in sambal-tina.html")
        markup = markup.replace(
            target,
            '<div class="phrasebook-groups" id="phrasebookGroups" data-empty="Loading&hellip;">'
            + START + block + END + "</div>",
        )

    # The speaker-confirmed layer goes in its own section, outside anything
    # the script rewrites. Putting it inside the phrasebook container would
    # mean a crawler saw 68 words and a visitor saw 50 — the page serving two
    # different things, which is the one thing this must never do.
    living = (
        '<section class="phrasebook living-static" aria-labelledby="livingTitle">'
        '<div class="phrasebook-head">'
        f'<h2 id="livingTitle">{esc(LIVING["title"]).title()}</h2>'
        '<p>Words confirmed by people who still speak them, kept separate from the '
        'archive transcription so neither is mistaken for the other.</p>'
        '</div>'
        '<div class="phrasebook-groups">' + living_markup() + '</div>'
        '</section>'
    )
    if LIVING_START in markup and LIVING_END in markup:
        markup = re.sub(
            re.escape(LIVING_START) + r".*?" + re.escape(LIVING_END),
            LIVING_START + living + LIVING_END,
            markup, flags=re.S,
        )
    else:
        anchor = '  <section class="dict" aria-labelledby="dictTitle">'
        if anchor not in markup:
            sys.exit("could not find the search section in sambal-tina.html")
        markup = markup.replace(
            anchor, LIVING_START + living + LIVING_END + "\n\n" + anchor, 1)

    PAGE.write_text(markup, encoding="utf-8")

    groups = len(DICT.get("phrasebook") or [])
    words = sum(len(g["words"]) for g in DICT.get("phrasebook") or [])
    print(f"wrote {PAGE.name}")
    print(f"  {words} everyday words across {groups} groups, plus "
          f"{len(LIVING['entries'])} speaker-confirmed entries, now in the HTML")
    print(f"  page is {len(markup) / 1024:.0f} KB; the full "
          f"{len(DICT['entries']):,}-entry archive stays a fetch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
