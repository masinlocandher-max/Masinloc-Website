#!/usr/bin/env python3
"""Check that every page's markup and its stylesheets actually agree.

Three failures had gone out unnoticed before this guard existed, and each one
is invisible to the checks already in place. The contrast suite measures text
that is painted; the responsive suite measures layout that overflows. Neither
notices markup that was never styled at all, because unstyled text is usually
still legible and still fits.

What this asserts:

1. NO ORPHANED STYLESHEET. A .css file that no page links is dead weight, and
   worse, it is a trap: sambal-tina-community.css sat in the repository holding
   the only rules for the "Sambal Tina 101" primer, so the section shipped with
   browser defaults — three articles stacked full width instead of a grid, and
   the three core vowels running together as "AIO". Nobody noticed, because
   nothing was broken enough to fail a test.

2. NO UNSTYLED MARKUP. Every class in a page's HTML must be defined by a
   stylesheet that page loads, or by its own inline <style>. A class that is
   styled only in a sheet the page does not link is the same bug as above,
   caught one step earlier.

   Some classes are deliberately unstyled — hooks for scripts, or wrappers kept
   for structure. Those are listed in UNSTYLED_BY_DESIGN below, so that adding
   one is a decision somebody made on purpose rather than an accident.

3. CACHE STAMPS TELL THE TRUTH. Each `?v=` is meant to be the date the
   stylesheet's content last changed. Six of them had fallen behind the file
   they were stamping — homepage.css was serving as `?v=20260822-1` while the
   file had changed today — which is exactly the case where a returning visitor
   can be handed yesterday's layout. The stamps are hand-maintained in six
   places at once (the HTML plus five generators), so they drift; this is what
   notices.

Usage: python3 scripts/check-stylesheets.py
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Classes that are in the markup on purpose without any CSS behind them:
# script hooks and structural wrappers whose children carry the styling.
UNSTYLED_BY_DESIGN = {
    "site":         "connect.html — the outer shell div; the layout lives on its children",
    "is-single":    "leadership.html — state hook for a one-item grid",
    "d-card-body":  "discover — wrapper span; d-card-title and d-card-deck are block-level",
    "d-lead-copy":  "discover — wrapper span inside the lead card",
}

COMMENTS = re.compile(r"/\*.*?\*/", re.S)
CLASS_IN_CSS = re.compile(r"\.([A-Za-z][A-Za-z0-9_-]*)")
STYLESHEET = re.compile(r'<link rel="stylesheet" href="([^"]+)"')
INLINE_STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S)
CLASS_ATTR = re.compile(r'class="([^"]+)"')
STAMPED = re.compile(r"([A-Za-z0-9-]+\.css)\?v=(\d{8})-\d+")


def shallow_repository() -> bool:
    """A shallow clone reports the tip commit's date for every file.

    The same trap build-sitemap.py guards against: git does not fail and does
    not return nothing, it returns today for everything, so every stamp would
    look stale and this check would fail for a reason unrelated to the stamps.
    """
    try:
        out = subprocess.run(["git", "rev-parse", "--is-shallow-repository"],
                             cwd=ROOT, capture_output=True, text=True,
                             timeout=20, check=False)
        return out.stdout.strip() == "true"
    except (OSError, subprocess.SubprocessError):
        return False


def last_change(name: str) -> str:
    """YYYYMMDD of the last commit to touch this stylesheet."""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", name],
                             cwd=ROOT, capture_output=True, text=True,
                             timeout=20, check=False)
        return out.stdout.strip().replace("-", "")
    except (OSError, subprocess.SubprocessError):
        return ""


def classes_in(css: str) -> set[str]:
    return set(CLASS_IN_CSS.findall(COMMENTS.sub("", css)))


def pages() -> list[Path]:
    found: list[Path] = []
    for pattern in ("*.html", "bulletin/*.html", "discover/*.html",
                    "marketplace/*.html", "mabayani/*.html"):
        found.extend(sorted(ROOT.glob(pattern)))
    return found


def main() -> int:
    problems: list[str] = []
    sheets = {p.name: p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("*.css"))}
    defined = {name: classes_in(css) for name, css in sheets.items()}

    linked: set[str] = set()
    stamps: dict[str, set[str]] = {}

    for page in pages():
        text = page.read_text(encoding="utf-8", errors="replace")
        rel = page.relative_to(ROOT)

        names = [href.split("?")[0].split("/")[-1]
                 for href in STYLESHEET.findall(text)]
        linked.update(names)

        available: set[str] = set()
        for name in names:
            if name not in sheets:
                problems.append(f"{rel}: links {name}, which does not exist")
                continue
            available |= defined[name]
        for block in INLINE_STYLE.findall(text):
            available |= classes_in(block)

        used: set[str] = set()
        for attr in CLASS_ATTR.findall(text):
            used |= set(attr.split())

        for cls in sorted(used - available - set(UNSTYLED_BY_DESIGN)):
            elsewhere = sorted(n for n, d in defined.items() if cls in d)
            if elsewhere:
                problems.append(
                    f"{rel}: .{cls} is used here but styled only in "
                    f"{', '.join(elsewhere)}, which this page does not load")
            else:
                problems.append(
                    f"{rel}: .{cls} is used here and styled nowhere on the site")

        for name, stamp in STAMPED.findall(text):
            stamps.setdefault(name, set()).add(stamp)

    for name in sorted(set(sheets) - linked):
        problems.append(
            f"{name} is linked by no page. Either link it or delete it — a "
            f"stylesheet nobody loads is where unstyled markup comes from.")

    shallow = shallow_repository()
    if not shallow:
        for name, seen in sorted(stamps.items()):
            changed = last_change(name)
            if not changed:
                continue
            for stamp in sorted(seen):
                if stamp < changed:
                    problems.append(
                        f"{name} is served as ?v={stamp} but its content last "
                        f"changed {changed}. A visitor holding the cached copy "
                        f"never sees the change.")

    for name in sorted(set(sheets) - set(stamps)):
        if name in linked:
            problems.append(f"{name} is linked with no ?v= stamp")

    if problems:
        print("STYLESHEET CHECK FAILED")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("STYLESHEET CHECK PASSED")
    print(f"{len(sheets)} stylesheets, all linked; every class on "
          f"{len(pages())} pages is styled by a sheet that page loads.")
    if shallow:
        print("Shallow checkout: cache stamps were not checked against history. "
              "Use fetch-depth: 0 to check those too.")
    else:
        print("Every ?v= stamp is at least as new as the file it stamps.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
