#!/usr/bin/env python3
"""Tell IndexNow which URLs actually changed in a push.

IndexNow is a single HTTP POST, so it needs no infrastructure beyond a key file
served from the site root — which a static host does without being asked. The
logic lives here rather than inside the workflow YAML so that it can be read,
reasoned about, and run by hand with --dry-run before it is ever pointed at the
live endpoint.

What it will and will not submit
--------------------------------
Only pages whose FILE changed between two commits. A deployment that rebuilt
identical output produces no diff and therefore submits nothing, which is the
whole point: telling a search engine that twenty-two pages changed when none of
them did is how a site teaches crawlers to stop believing it.

Added and modified pages are submitted so they are recrawled. Deleted pages are
submitted too — that is how IndexNow is meant to handle removal: the crawler
comes back, finds the page gone, and drops it. A page that has quietly started
saying noindex is treated the same way.

Never fatal
-----------
Submission is a courtesy to search engines, not part of publishing. Every
failure path here exits 0 with an explanation. A deploy must never fail because
an external endpoint was slow.

Usage
-----
    python3 scripts/indexnow-submit.py --base <sha> --head <sha> [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "www.masinloc-zambales.com"
SITE = f"https://{HOST}"
ENDPOINT = "https://api.indexnow.org/IndexNow"
TIMEOUT = 20

NOINDEX = re.compile(r'<meta\s+name="robots"[^>]*content="[^"]*noindex', re.I)
CANONICAL = re.compile(r'<link\s+rel="canonical"\s+href="([^"]+)"', re.I)


def key_file() -> tuple[str, str] | None:
    """The IndexNow key, read from the file the site publishes at its root."""
    candidates = [p for p in ROOT.glob("*.txt")
                  if re.fullmatch(r"[0-9a-f]{8,128}", p.stem)]
    if len(candidates) != 1:
        return None
    path = candidates[0]
    key = path.read_text(encoding="utf-8").strip()
    if key != path.stem:
        return None
    return key, f"{SITE}/{path.name}"


def changed(base: str, head: str) -> list[tuple[str, str]]:
    out = subprocess.run(
        ["git", "diff", "--name-status", base, head],
        cwd=ROOT, capture_output=True, text=True, check=False)
    if out.returncode:
        return []
    rows = []
    for line in out.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0][:1], parts[-1]
        if path.endswith(".html"):
            rows.append((status, path))
    return rows


def url_for(rel: str) -> str | None:
    """A page's public URL, taken from the page itself where it still exists."""
    path = ROOT / rel
    if path.is_file():
        raw = path.read_text(encoding="utf-8")
        if NOINDEX.search(raw):
            return None
        match = CANONICAL.search(raw)
        if match and match.group(1).startswith(SITE):
            return match.group(1)
        return None
    # Deleted: it has no canonical left to read, so derive the address it had.
    if rel == "index.html":
        return f"{SITE}/"
    return f"{SITE}/{rel}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    credentials = key_file()
    if not credentials:
        print("indexnow: no valid key file at the repository root; nothing submitted")
        return 0
    key, key_location = credentials

    urls, skipped = [], []
    for status, rel in changed(args.base, args.head):
        url = url_for(rel)
        if url:
            urls.append(url)
        else:
            skipped.append(rel)

    urls = sorted(set(urls))
    for rel in skipped:
        print(f"indexnow: skipping {rel} (not indexable)")

    if not urls:
        print("indexnow: no page content changed in this push; nothing to submit")
        return 0

    payload = {"host": HOST, "key": key, "keyLocation": key_location, "urlList": urls}
    print(f"indexnow: {len(urls)} changed URL(s)")
    for url in urls:
        print(f"  {url}")

    if args.dry_run:
        print("indexnow: dry run, not submitting")
        return 0

    request = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            print(f"indexnow: endpoint returned {response.status}")
    except urllib.error.HTTPError as err:
        # 422 normally means the key file could not be fetched or the host does
        # not match. Worth reading, never worth failing a deploy over.
        print(f"indexnow: endpoint returned {err.code} ({err.reason}); not fatal")
    except (urllib.error.URLError, OSError, ValueError) as err:
        print(f"indexnow: could not reach the endpoint ({err}); not fatal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
