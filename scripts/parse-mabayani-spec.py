#!/usr/bin/env python3
"""Turn scripts/mabayani-spec.txt into data/mabayani.json.

WHY A PARSER RATHER THAN A HAND-TYPED DATA FILE

The spec is 2,441 lines and most of it is public copy in Filipino and English,
including quoted Spanish from 1788 and 1879. Retyping that by hand would put a
transcription error somewhere in it, and a transcription error in a historical
quotation is a factual error. Parsing means the copy on the page is the copy in
the spec, byte for byte, and that re-running this proves it still is.

WHAT DOES NOT CROSS INTO data/

Everything under data/ is a public URL on this deployment — vercel.json serves
/data/(.*) and .vercelignore keeps only supabase/ and scripts/ out. The spec
contains three kinds of text that must not become public:

  - VISUAL and IMPLEMENTATION notes, which are directions to whoever builds
    the page, not things a reader should be shown.
  - CAUTION, RESEARCH NOTE and IMPLEMENTATION RULE inside source drawers,
    which are warnings to the writer about how a claim may be misused.
  - The whole of the purpose, asset-plan, mobile-rules, claim-master and
    editorial-lock sections, which are the brief itself.

INTERNAL_FIELDS below is the list that gets dropped, and check-mabayani.py
re-checks the built page and the published JSON for any of it. The spec stays
in scripts/, which is not deployed, so its provenance is kept without being
served.

Usage
-----
    python3 scripts/parse-mabayani-spec.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "scripts" / "mabayani-spec.txt"
OUT = ROOT / "data" / "mabayani.json"

# Field labels that carry copy a reader is meant to see.
PUBLIC_FIELDS = {
    "EYEBROW", "TITLE", "SUBTITLE", "PUBLIC COPY", "FULL-VIEWPORT COPY",
    "SECOND REVEAL AFTER PAUSE/SCROLL", "TRANSITION", "REFLECTION",
    "FACT BOX", "FACT STRIP", "CHRONOLOGY STATUS", "PROFILE FACTS",
    "EVIDENCE STATUS", "CTA", "PRIMARY CTA", "SECONDARY CTA", "TERTIARY CTA",
    "AYON SA KUWENTONG-BAYAN", "AYON SA KASULATANG TALA",
    "WHAT WE WILL NOT DO", "WHAT WE WILL DO",
    "FINAL FOOTNOTE COPY", "AUTHOR CREDIT", "SOURCE DRAWER",
    "ENTRY CTA COPY", "BODY COPY", "KEY TRUST COPY", "FORM FIELDS",
    "ORAL HISTORY CONSENT COPY", "SUBMIT BUTTON", "CONFIRMATION COPY",
}

# Field labels that are instructions to the builder. These are read so the
# build can honour them, and then dropped before anything is written.
INTERNAL_FIELDS = {
    "VISUAL", "IMPLEMENTATION NOTE", "IMPLEMENTATION RULE", "IMPLEMENTATION",
    "PRIVACY RULE",
}

# Inside a source drawer, the tabs a reader gets (§35) versus the notes to the
# writer. The second set never leaves this script.
DRAWER_PUBLIC = {"WHAT WE KNOW", "EVIDENCE STATUS", "WHAT REMAINS UNCERTAIN", "SOURCES"}
DRAWER_INTERNAL = {"CAUTION", "RESEARCH NOTE", "IMPLEMENTATION RULE"}

# Sentences inside otherwise-public prose that address the builder rather than
# the reader. They are dropped and reported, so removing one is a visible act
# rather than a silent edit to the copy.
DIRECTIVE_SENTENCE = re.compile(
    r"(?:^|(?<=[.!?]\s))("
    r"Do not [^.]*\."
    r"|Display absence[^.]*\."
    r"|Use him to explain[^.]*\."
    r"|Use this profile to show[^.]*\."
    r")"
)

LABEL = re.compile(r"^([A-Z][A-Z0-9 /&'\-]{1,40})$")
DRAWER_LABEL = re.compile(r"^([A-Z][A-Z ]+):\s*(.*)$")
BLOCK = re.compile(r"^=+$")
HEADING = re.compile(r"^(\d+)\.\s+(.*)$")
SECTION_HEADING = re.compile(r"^(\d+)\.\s+SECTION\s+(\d+)\s*\|\s*(.*)$")


def blocks(text: str) -> list[tuple[str, list[str]]]:
    """Split the spec on its ==== rules into (heading, body-lines) pairs."""
    lines = text.split("\n")
    out, heading, body = [], None, []
    i = 0
    while i < len(lines):
        if BLOCK.match(lines[i].strip()) and i + 2 < len(lines) and BLOCK.match(lines[i + 2].strip()):
            if heading is not None:
                out.append((heading, body))
            heading, body = lines[i + 1].strip(), []
            i += 3
            continue
        if heading is not None:
            body.append(lines[i])
        i += 1
    if heading is not None:
        out.append((heading, body))
    return out


def fields(body: list[str]) -> dict:
    """Read a section body into {label: text}, keeping paragraph breaks."""
    found: dict[str, list[str]] = {}
    current = None
    for raw in body:
        line = raw.rstrip()
        match = LABEL.match(line.strip())
        if match and match.group(1) in PUBLIC_FIELDS | INTERNAL_FIELDS:
            current = match.group(1)
            found.setdefault(current, [])
            continue
        if current is not None:
            found[current].append(line)
    return {k: "\n".join(v).strip("\n") for k, v in found.items()}


# Whole lines addressed to the builder. These sit inside reader-facing fields —
# two of them are bullets in the Binabayani fact box, one is the pacing note on
# the closing transition — so they cannot be excluded by field name alone.
DIRECTIVE_LINE = re.compile(
    r"^\s*-?\s*(?:Do not |Never |Allow one quiet scroll|Display absence|"
    r"Use a date card|Prefer \u201c)",
)


def strip_directives(text: str, where: str, log: list[str]) -> str:
    """Drop builder-directive lines, recording each one that goes."""
    kept = []
    for line in text.split("\n"):
        if line.strip() and DIRECTIVE_LINE.match(line):
            log.append(f"{where}: {line.strip()}")
            continue
        kept.append(line)
    return "\n".join(kept).strip("\n")


def paragraphs(text: str) -> list[str]:
    """Blank-line separated blocks, each with its own line breaks preserved.

    Line breaks matter here: the copy uses single-line stanzas deliberately
    ("Dagat sa kanluran. / Kabundukan sa silangan.") and collapsing them into
    running prose would change how the page reads.
    """
    return [p.strip("\n") for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]


def drawer(text: str) -> dict:
    """A source drawer, split into the tabs §35 defines. Notes are dropped."""
    out: dict[str, list[str]] = {}
    current = None
    known = DRAWER_PUBLIC | DRAWER_INTERNAL
    for line in text.split("\n"):
        stripped = line.strip()
        # Labels appear as "SOURCES:" and, in one section, as a bare "CAUTION"
        # on its own line. Recognising only the colon form let a caution note
        # run on into the public sources tab.
        match = DRAWER_LABEL.match(stripped)
        if not match and stripped in known:
            current = stripped
            out.setdefault(current, [])
            continue
        if match and match.group(1) in known:
            current = match.group(1)
            out.setdefault(current, [])
            if match.group(2):
                out[current].append(match.group(2))
            continue
        if current is not None:
            out[current].append(line)
    tabs = {}
    for key in DRAWER_PUBLIC:
        if key in out:
            value = "\n".join(out[key]).strip()
            if value:
                tabs[key.lower().replace(" ", "_")] = paragraphs(value)
    return tabs


def main() -> int:
    text = SPEC.read_text(encoding="utf-8")
    parsed = blocks(text)

    sections, profiles, registry = [], [], []
    dropped: list[str] = []
    story_map, contribution, drawer_ux, seo = [], {}, {}, {}

    for heading, body in parsed:
        joined = "\n".join(body)
        section = SECTION_HEADING.match(heading)

        if section:
            data = fields(body)
            entry = {
                "number": section.group(2),
                "slug": re.sub(r"[^a-z0-9]+", "-", section.group(3).lower()).strip("-"),
                "label": section.group(3).strip(),
            }
            for label in sorted(PUBLIC_FIELDS):
                if label not in data:
                    continue
                key = label.lower().replace(" ", "_").replace("/", "_").replace("-", "_")
                if label == "SOURCE DRAWER":
                    tabs = drawer(data[label])
                    if tabs:
                        entry["record"] = tabs
                elif label in {"TITLE", "SUBTITLE", "EYEBROW", "CTA", "PRIMARY CTA",
                               "SECONDARY CTA", "TERTIARY CTA", "AUTHOR CREDIT"}:
                    entry[key] = data[label].strip()
                else:
                    where = f"section {entry['number']} {label}"
                    cleaned = strip_directives(data[label], where, dropped)
                    if cleaned.strip():
                        entry[key] = paragraphs(cleaned)
            sections.append(entry)
            continue

        number = HEADING.match(heading)
        index = int(number.group(1)) if number else -1

        if index == 1:  # story map / navigation labels
            for line in body:
                item = re.match(r"^(\d{2})\s+(.*)$", line.strip())
                if item:
                    story_map.append({"number": item.group(1), "label": item.group(2).strip()})

        elif index == 33:  # historical people profiles
            current = None
            for line in body:
                stripped = line.strip()
                if re.fullmatch(r"PROFILE \d+", stripped) or stripped == "UNNAMED PROFILE GROUP":
                    current = {"kind": "group" if "UNNAMED" in stripped else "person",
                               "name": "", "evidence": "", "body": []}
                    profiles.append(current)
                elif current is not None:
                    if not current["name"] and stripped:
                        current["name"] = stripped
                    elif stripped.startswith("Evidence:"):
                        current["evidence"] = stripped.split(":", 1)[1].strip().rstrip(".")
                    elif stripped and stripped != "Public profile:":
                        current["body"].append(stripped)
            for entry in profiles:
                joined_body = "\n".join(entry["body"])
                for directive in DIRECTIVE_SENTENCE.findall(joined_body):
                    dropped.append(f"{entry['name']}: {directive.strip()}")
                joined_body = DIRECTIVE_SENTENCE.sub("", joined_body)
                entry["body"] = paragraphs(re.sub(r"[ \t]{2,}", " ", joined_body))

        elif index == 34:  # contribution flow
            data = fields(body)
            contribution = {
                "entry": data.get("ENTRY CTA COPY", "").strip(),
                "body": paragraphs(data.get("BODY COPY", "")),
                "trust": paragraphs(data.get("KEY TRUST COPY", "")),
                "fields": [re.sub(r"^\d+\.\s*", "", x.strip())
                           for x in data.get("FORM FIELDS", "").split("\n") if x.strip()],
                "consent": data.get("ORAL HISTORY CONSENT COPY", "").strip(),
                "submit": data.get("SUBMIT BUTTON", "").strip(),
                "confirmation": data.get("CONFIRMATION COPY", "").strip(),
            }

        elif index == 35:  # evidence drawer UX copy
            tabs = re.search(r"DRAWER TABS\n(.*?)\n\n", joined, re.S)
            button = re.search(r"BUTTON LABEL\n(.*?)\n", joined)
            footer = re.search(r"DRAWER FOOTER\n(.*?)\n", joined)
            badges = {}
            for name in ("DOCUMENTED", "RECONSTRUCTED", "REMEMBERED", "STILL OPEN"):
                match = re.search(rf"^{name}\n(.+)$", joined, re.M)
                if match:
                    badges[name] = match.group(1).strip()
            drawer_ux = {
                "button": button.group(1).strip() if button else "View the record",
                "tabs": [x.strip() for x in tabs.group(1).split("\n") if x.strip()] if tabs else [],
                "badges": badges,
                "footer": footer.group(1).strip() if footer else "",
            }

        elif index == 38:  # SEO and internal link ownership
            for key, pattern in (("canonical", r"CANONICAL ROUTE\n(.*?)\n"),
                                 ("title", r"SEO TITLE\n(.*?)\n"),
                                 ("description", r"META DESCRIPTION\n(.*?)\n"),
                                 ("h1", r"H1\n(.*?)\n"),
                                 ("breadcrumb", r"BREADCRUMB\n(.*?)\n")):
                match = re.search(pattern, joined)
                if match:
                    seo[key] = match.group(1).strip()

        elif index == 40:  # source registry
            for chunk in re.split(r"\n(?=S\d{2} )", joined):
                rows = chunk.strip().split("\n")
                head = re.match(r"^(S\d{2})\s+(.*)$", rows[0])
                if not head:
                    continue
                rest = rows[1:]
                citation, use, status = [], "", ""
                for line in rest:
                    if line.startswith("Use:"):
                        use = line.split(":", 1)[1].strip()
                    elif line.startswith("Status:"):
                        status = line.split(":", 1)[1].strip()
                    elif line.startswith("Caution:"):
                        continue
                    elif line.strip():
                        citation.append(line.strip())
                registry.append({"id": head.group(1), "shortName": head.group(2).strip(),
                                 "citation": " ".join(citation), "use": use, "status": status})

    document = {
        "_comment": (
            "Generated by scripts/parse-mabayani-spec.py from scripts/mabayani-spec.txt. "
            "Public copy only: the spec's VISUAL, IMPLEMENTATION and editorial-lock text "
            "is deliberately absent because everything under /data/ is a public URL. "
            "Edit the spec and re-run the parser; do not hand-edit this file."
        ),
        "seo": seo,
        "storyMap": story_map,
        "drawer": drawer_ux,
        "sections": sections,
        "profiles": profiles,
        "contribution": contribution,
        "sources": registry,
    }
    OUT.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"data/mabayani.json: {len(sections)} sections, {len(profiles)} profiles, "
          f"{len(registry)} registry entries, {len(story_map)} story-map labels")
    with_record = sum(1 for s in sections if "record" in s)
    print(f"{with_record} sections carry a source drawer")
    if dropped:
        print(f"{len(dropped)} builder directive(s) removed from public profile copy:")
        for line in dropped:
            print(f"  - {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
