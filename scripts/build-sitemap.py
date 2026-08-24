#!/usr/bin/env python3
"""Build sitemap.xml from the pages that actually exist.

Why this script exists
----------------------
The sitemap used to be written in two places: build-bulletin.py owned the
story URLs and everything else was maintained by hand. That is the arrangement
that loses a page. It had also drifted — most URLs carried no <lastmod> at all,
and every one that did said the same date, which was the day of a deployment
rather than the day anything was written.

A deployment is not a modification. A sitemap that says otherwise is asking
search engines to recrawl unchanged pages and teaching them to ignore the
signal.

How it decides
--------------
- WHICH PAGES. Every built HTML page, minus any that asks not to be indexed.
  admin.html and 404.html carry <meta name="robots" content="noindex">, so they
  exclude themselves and no list here has to be kept in step with them.

- WHICH URL. The page's own <link rel="canonical">, not a path built from the
  filename. If a page disagrees with itself about where it lives, that is a
  fault worth failing on rather than papering over.

- WHICH DATE. The last commit that touched the file. This works precisely
  because every generator here produces byte-identical output from unchanged
  data: rebuilding a story whose prose has not changed produces no diff, so no
  commit, so no new date. The date moves when the content moves. An uncommitted
  file falls back to its modification time, which is the honest answer for
  something that is not in the history yet.

Usage
-----
    python3 scripts/build-sitemap.py           # write sitemap.xml
    python3 scripts/build-sitemap.py --check   # verify it is up to date
"""
from __future__ import annotations

import re
import subprocess
import sys
from datetime import date, timezone, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITEMAP = ROOT / "sitemap.xml"
SITE = "https://masinloc-zambales.com"

CANONICAL = re.compile(r'<link\s+rel="canonical"\s+href="([^"]+)"', re.I)
NOINDEX = re.compile(r'<meta\s+name="robots"[^>]*content="[^"]*noindex', re.I)


# Every directory that publishes pages. A section added to the site and not
# added here would build, deploy and never be listed — silently.
PAGE_DIRS = ["*.html", "bulletin/*.html", "discover/*.html"]


def pages() -> list[Path]:
    found: list[Path] = []
    for pattern in PAGE_DIRS:
        found += sorted(ROOT.glob(pattern))
    return found


def shallow_repository() -> bool:
    """True when the checkout has no real history to read dates from.

    This matters more than it looks. In a shallow clone — which is what
    actions/checkout does by default — `git log -1 --format=%cs -- <file>`
    does not fail and does not come back empty. It returns the tip commit's
    date for EVERY file, because that is the only commit present. Generating
    from that produces a sitemap claiming every page on the site changed today,
    which is precisely the deployment-date stamping this script exists to
    prevent, and it would do it silently.

    So a shallow checkout is treated as "dates unknowable" rather than as
    "dates are today".
    """
    try:
        out = subprocess.run(["git", "rev-parse", "--is-shallow-repository"],
                             cwd=ROOT, capture_output=True, text=True,
                             timeout=20, check=False)
        return out.stdout.strip() == "true"
    except (OSError, subprocess.SubprocessError):
        return False


def last_content_change(path: Path) -> str:
    """The date this page's content last changed, from the history."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(path.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, timeout=20, check=False)
        stamp = out.stdout.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp):
            return stamp
    except (OSError, subprocess.SubprocessError):
        pass
    # Not committed yet, or no git available. Its mtime is what we honestly know.
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).date().isoformat()


def collect() -> tuple[list[tuple[str, str]], list[str]]:
    entries: list[tuple[str, str]] = []
    problems: list[str] = []
    seen: dict[str, str] = {}

    for path in pages():
        rel = path.relative_to(ROOT).as_posix()
        raw = path.read_text(encoding="utf-8")

        if NOINDEX.search(raw):
            continue

        match = CANONICAL.search(raw)
        if not match:
            problems.append(f"{rel}: no canonical link, so it cannot be listed")
            continue

        url = match.group(1).strip()
        if not url.startswith(SITE):
            problems.append(f"{rel}: canonical points off-site ({url})")
            continue
        if url in seen:
            problems.append(f"{rel}: shares a canonical URL with {seen[url]} ({url}) "
                            f"— two pages competing for one address")
            continue
        seen[url] = rel

        entries.append((url, last_content_change(path)))

    # Deterministic and stable: the homepage, then everything else by URL.
    entries.sort(key=lambda e: ("" if e[0].rstrip("/") == SITE else e[0]))
    return entries, problems


def render(entries: list[tuple[str, str]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, lastmod in entries:
        lines += ["  <url>", f"    <loc>{url}</loc>",
                  f"    <lastmod>{lastmod}</lastmod>", "  </url>"]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main() -> int:
    shallow = shallow_repository()
    entries, problems = collect()
    if problems:
        print("SITEMAP BUILD FAILED")
        for problem in problems:
            print(f"- {problem}")
        return 1

    rendered = render(entries)
    check = "--check" in sys.argv

    if check:
        current = SITEMAP.read_text(encoding="utf-8") if SITEMAP.is_file() else ""
        if shallow:
            # Dates cannot be verified here, so only the URL set is checked.
            # Comparing dates against a shallow checkout would fail every run
            # for a reason that has nothing to do with the sitemap.
            listed = set(re.findall(r"<loc>([^<]+)</loc>", current))
            expected = {url for url, _ in entries}
            if listed != expected:
                print("SITEMAP IS OUT OF DATE")
                for url in sorted(expected - listed):
                    print(f"  missing: {url}")
                for url in sorted(listed - expected):
                    print(f"  stale:   {url}")
                print("Run: python3 scripts/build-sitemap.py")
                return 1
            print(f"SITEMAP UP TO DATE — {len(entries)} URLs.")
            print("Shallow checkout: the URL set was verified, the dates were not. "
                  "Use fetch-depth: 0 to check those too.")
            return 0
        if current != rendered:
            print("SITEMAP IS OUT OF DATE")
            print("Run: python3 scripts/build-sitemap.py")
            return 1
        print(f"SITEMAP UP TO DATE — {len(entries)} URLs, "
              f"each dated by its own last content change.")
        return 0

    if shallow:
        print("REFUSING TO WRITE sitemap.xml")
        print("This is a shallow checkout, where git reports the tip commit's date "
              "for every file. Writing now would stamp every page with today and "
              "call it a content change.")
        print("Run: git fetch --unshallow")
        return 1

    SITEMAP.write_text(rendered, encoding="utf-8")
    newest = max(e[1] for e in entries)
    print(f"sitemap.xml: {len(entries)} URLs")
    print(f"most recent content change: {newest}")
    print(f"today: {date.today().isoformat()} "
          f"(only a page that actually changed carries today's date)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
