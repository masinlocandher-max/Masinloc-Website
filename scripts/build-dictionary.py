#!/usr/bin/env python3
"""Build data/sambal-tina.json from the Sambal Tina working master.

Source of truth
---------------
"Sambal Tina Strong Collection" (Google Drive, Masinloc Website Asset), a
source-coverage working master reconstructed from the 1988 English-Tina
Sambal-Pilipino Dictionary. The original printed dictionary is the authority.

This script carries the workbook's own provenance columns through to the
published data: PDF page reference, source status, confidence (1-5) and QA
note. Nothing is silently corrected. Entries whose historical glyphs are
still uncertain stay in the file, flagged, so a reader can check them against
the printed page instead of trusting a guess.

Usage
-----
    python3 scripts/build-dictionary.py <workbook-export.txt> [-o data/sambal-tina.json]

The export is the flattened text representation of the workbook.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

COLUMNS = ["tina", "pos", "en", "fil", "pages", "status", "conf", "notes"]

# A provenance tail is ",pages,status,confidence,note". Anything beyond this
# belongs to the next row or the next worksheet.
TAIL_LIMIT = 300

# The Tina-first inventory ends where the next worksheet begins.
NEXT_SHEET = "English-First Source"
HEAVY_DAMAGE = re.compile(r"[~_!\]·]")


def csv_field(value: object) -> str:
    """Encode a value the way the workbook export quotes it."""
    text = str(value)
    if "," in text or '"' in text:
        return '"' + text.replace('"', '""') + '"'
    return text


def read_export(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    if raw.lstrip().startswith("{"):
        return json.loads(raw)["fileContent"]
    return raw


def parse_tail(tail: str) -> tuple[str, str, int | None, str]:
    """Split the trailing provenance columns of one row.

    Only the four provenance fields are consumed. Anything after them belongs
    to a later row or a later worksheet and must not leak into this entry.
    """
    tail = tail.strip()
    if tail.startswith(","):
        tail = tail[1:]
    tail = tail[:TAIL_LIMIT]
    try:
        parts = next(csv.reader(io.StringIO(tail)))
    except Exception:
        parts = tail.split(",")
    parts = [part.strip() for part in parts]
    pages = parts[0] if parts else ""
    status = parts[1] if len(parts) > 1 else ""
    confidence = parts[2] if len(parts) > 2 else ""
    notes = parts[3] if len(parts) > 3 else ""
    match = re.match(r"^(\d)\b", confidence)
    return pages, status, (int(match.group(1)) if match else None), notes


def locate(text: str, row: list, cursor: int) -> tuple[int, int]:
    """Find where a row's known first four fields start, and their length."""
    prefix = ",".join(csv_field(value) for value in row[:4])
    index = text.find(prefix, cursor)
    if index >= 0:
        return index, len(prefix)

    # Damaged headwords break exact matching; fall back to headword + part of speech.
    short = csv_field(row[0]) + "," + csv_field(row[1]) + ","
    index = text.find(short, cursor)

    if index < 0:
        # The export escapes broken glyphs with a backslash the skeleton does
        # not carry ("d\_islpolo" against "d_islpolo"). Damage lands in the
        # part-of-speech column too ("\_ n."), so allow one anywhere in both.
        def loose(value: object) -> str:
            return r"\\?" + r"\\?".join(re.escape(character) for character in str(value))

        match = re.compile(loose(row[0]) + "," + loose(row[1]) + ",").search(text, cursor)
        if match is None:
            return -1, 0
        index = match.start()

    try:
        fields = next(csv.reader(io.StringIO(text[index:index + 1200])))
    except Exception:
        return index, len(short)
    return index, len(",".join(csv_field(value) for value in fields[:4]))


# A short visitor vocabulary, grouped the way someone actually needs it.
# Each group lists English glosses to look for; a word only appears if the
# source genuinely supports it at confidence 4 or better and carries no open
# QA note. Nothing here is invented, and empty groups are dropped.
PHRASEBOOK = [
    ("Meeting people", ["good", "welcome", "friend", "thank", "name",
                        "companion", "guest", "visitor", "kind", "happy"]),
    ("The sea and the table", ["rice", "water", "sea", "fish", "crab", "shrimp",
                               "fruit", "cook", "sweet", "hungry", "thirsty"]),
    ("Finding your way", ["road", "town", "river", "island", "near", "far",
                          "where", "field", "house", "mountain", "boat"]),
    ("Family", ["father", "mother", "child", "woman", "man", "brother",
                "sister", "grandchild", "friend"]),
]


# Transcription noise: digits standing in for accented vowels, broken glyphs,
# mid-word capitals, and the f/i substitution. A headword carrying any of this
# is not put in front of a visitor as if it were settled.
SUSPECT_GLOSS = re.compile(r"[0-9~_!\]·]|[a-z][A-Z]|\w[fF]\w")


def build_phrasebook(entries: list[list]) -> list[dict]:
    """Pick well-supported everyday words for visitors, grouped by situation.

    English is paired with Sambal Tina only. The Pilipino column of the source
    still carries transcription noise in places, and a visitor-facing list is
    the wrong place to show a gloss that cannot be vouched for; the full
    dictionary shows it alongside its provenance instead.
    """
    groups = []
    used: set[str] = set()

    for title, glosses in PHRASEBOOK:
        words = []
        for gloss in glosses:
            pattern = re.compile(r"(^|[;,]\s*)" + re.escape(gloss) + r"\s*($|[;,])",
                                 re.IGNORECASE)
            for entry in entries:
                tina, _pos, english, pilipino, pages, _status, confidence, notes = entry
                if confidence < 4 or notes or tina in used:
                    continue
                if not pattern.search(english) or SUSPECT_GLOSS.search(tina):
                    continue
                words.append({"en": gloss, "tina": tina, "pages": pages})
                used.add(tina)
                break
        if len(words) >= 4:
            groups.append({"title": title, "words": words})
    return groups


def read_skeleton(skeleton_path: Path, output_path: Path) -> list[list]:
    """Ordered tina/pos/en/fil rows used to align the provenance join.

    The workbook export flattens to a single line and its quoting is lossy, so
    the join needs a row order to walk. The published file already carries one,
    so a rebuild needs no extra input; an explicit skeleton is only for the
    first build or for re-deriving from a different source.
    """
    if skeleton_path is not None and skeleton_path.is_file():
        return json.loads(skeleton_path.read_text(encoding="utf-8"))

    if not output_path.is_file():
        raise SystemExit(
            f"no skeleton at {skeleton_path} and no existing {output_path} to "
            f"derive one from; pass --skeleton for the first build"
        )
    previous = json.loads(output_path.read_text(encoding="utf-8"))
    return [entry[:4] for entry in previous["entries"]]


def build(export_path: Path, skeleton_path: Path, output_path: Path) -> dict:
    text = read_export(export_path)
    rows = read_skeleton(skeleton_path, output_path)

    header = text.index("Tina-First Dictionary Tina Sambal")
    cursor = text.index("QA / Notes", header) + len("QA / Notes")

    start_of_sheet = cursor
    starts: list[tuple[int, int]] = []
    for row in rows:
        index, length = locate(text, row, cursor)
        starts.append((index, length))
        if index >= 0:
            cursor = index + length

    # The workbook's row order is not exactly the skeleton's, so a forward-only
    # scan can walk past a row it has not matched yet. Give anything still
    # unplaced a second look across the whole sheet.
    for position, (index, _length) in enumerate(starts):
        if index < 0:
            starts[position] = locate(text, rows[position], start_of_sheet)

    entries = []
    statuses: list[str] = []
    status_index: dict[str, int] = {}

    for position, (index, length) in enumerate(starts):
        tina, pos, english, pilipino = rows[position][:4]

        if index < 0:
            pages, status, confidence, notes = "", "", None, ""
        else:
            following = min(index + length + TAIL_LIMIT, len(text))
            for later in range(position + 1, len(starts)):
                if starts[later][0] >= 0:
                    following = min(following, starts[later][0])
                    break
            tail = text[index + length:following]
            sheet_break = tail.find(NEXT_SHEET)
            if sheet_break >= 0:
                tail = tail[:sheet_break]
            pages, status, confidence, notes = parse_tail(tail)

        # Rows the join could not place are exactly the glyph-damaged ones.
        if confidence is None:
            confidence = 1
            status = "NEEDS VISUAL SOURCE CHECK"
            if not notes and HEAVY_DAMAGE.search(str(tina)):
                notes = "heavy glyph damage in source transcription"

        if status not in status_index:
            status_index[status] = len(statuses)
            statuses.append(status)

        entries.append([tina, pos, english, pilipino, pages,
                        status_index[status], confidence, notes])

    return {
        "phrasebook": build_phrasebook(entries),
        "source": {
            "title": "English-Tina Sambal-Pilipino Dictionary",
            "year": 1988,
            "authority": "the original printed dictionary",
            "master": "Sambal Tina Strong Collection working master",
            "rule": ("Use the source-supported form. Never silently guess "
                     "uncertain historical glyphs."),
        },
        "columns": COLUMNS,
        "statuses": statuses,
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path, help="flattened workbook export")
    parser.add_argument("--skeleton", type=Path, default=None,
                        help="ordered tina/pos/en/fil rows used to align the join; "
                             "defaults to the row order of the existing output")
    parser.add_argument("-o", "--output", type=Path,
                        default=Path("data/sambal-tina.json"))
    args = parser.parse_args()

    payload = build(args.export, args.skeleton, args.output)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    entries = payload["entries"]
    flagged = sum(1 for entry in entries if entry[6] <= 2)
    print(f"wrote {args.output} — {len(entries)} entries, {flagged} flagged for source check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
