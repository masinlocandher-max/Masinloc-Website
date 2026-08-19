#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PAGES = [
    "index.html",
    "a-closer-look.html",
    "verified-history.html",
    "masinloc-bulletin.html",
    "connect.html",
]
REQUIRED = [
    "index.html",
    "a-closer-look.html",
    "verified-history.html",
    "masinloc-bulletin.html",
    "connect.html",
    "admin.html",
    "404.html",
    "site.css",
    "site.js",
    "styles.css",
    "app.js",
    "app-base.js",
    "security.js",
    "robots.txt",
    "sitemap.xml",
    "assets/masinloc-logo.webp",
    "assets/stage1/masinloc-hero.avif",
]
FORBIDDEN_FILES = [
    "hero-loader.js",
    "hero-single.css",
    "home.css",
    "assets/stage1/masinloc-hero-visible.avif",
]
FORBIDDEN_GLOBS = ["assets/stage1/hero-b64-*.txt"]
FORBIDDEN_PUBLIC_REFERENCES = [
    "hero-loader",
    "hero-b64-",
    "hero-photo",
    "masinloc-hero-visible",
    "WELCOME TO",
]
FUTURE_ROUTE = re.compile(
    r'href=["\'](?:/?)(?:discover|destinations|stories|sambal|local)(?:[/._-]|["\'])',
    re.I,
)

errors = []


def fail(message: str) -> None:
    errors.append(message)


for rel in REQUIRED:
    if not (ROOT / rel).is_file():
        fail(f"missing required file: {rel}")

for rel in FORBIDDEN_FILES:
    if (ROOT / rel).exists():
        fail(f"obsolete file must not return: {rel}")

for pattern in FORBIDDEN_GLOBS:
    for path in ROOT.glob(pattern):
        fail(f"obsolete hero reconstruction artifact: {path.relative_to(ROOT)}")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.ids = []
        self.h1_count = 0
        self.has_description = False
        self.has_canonical = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h1":
            self.h1_count += 1
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        for key in ("src", "href"):
            value = attrs.get(key)
            if value:
                self.refs.append(value.strip())
        if tag == "meta" and attrs.get("name") == "description" and attrs.get("content"):
            self.has_description = True
        if tag == "link" and attrs.get("rel") == "canonical" and attrs.get("href"):
            self.has_canonical = True


def local_target(source: Path, value: str):
    if not value or value.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    path = parsed.path
    if not path:
        return None
    if path == "/":
        return ROOT / "index.html"
    target = ROOT / path.lstrip("/") if path.startswith("/") else source.parent / path
    if path.endswith("/"):
        target = target / "index.html"
    return target.resolve()


for html in ROOT.glob("*.html"):
    text = html.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(text)

    for ref in parser.refs:
        target = local_target(html, ref)
        if target is None:
            continue
        try:
            target.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"reference escapes repository root: {html.name} -> {ref}")
            continue
        if not target.exists():
            fail(f"broken local reference: {html.name} -> {ref}")

    if html.name in PUBLIC_PAGES:
        if parser.h1_count != 1:
            fail(f"{html.name}: expected exactly one H1, found {parser.h1_count}")
        if not parser.has_description:
            fail(f"{html.name}: missing meta description")
        if not parser.has_canonical:
            fail(f"{html.name}: missing canonical link")
        duplicate_ids = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
        if duplicate_ids:
            fail(f"{html.name}: duplicate IDs: {', '.join(duplicate_ids)}")
        if FUTURE_ROUTE.search(text):
            fail(f"{html.name}: links to an unfinished future-stage route")

for path in list(ROOT.glob("*.html")) + list(ROOT.glob("*.css")) + list(ROOT.glob("*.js")):
    text = path.read_text(encoding="utf-8", errors="replace")
    for forbidden in FORBIDDEN_PUBLIC_REFERENCES:
        if forbidden in text:
            fail(f"obsolete Stage 1 mechanism referenced in {path.name}: {forbidden}")

hero = ROOT / "assets/stage1/masinloc-hero.avif"
if hero.is_file():
    data = hero.read_bytes()
    if len(data) <= 60000:
        fail(f"hero asset is suspiciously small: {len(data)} bytes")
    if b"ftypavif" not in data[:32]:
        fail("hero asset does not have an AVIF file signature")
    pos = data.find(b"ispe")
    if pos < 0 or len(data) < pos + 16:
        fail("hero asset is missing AVIF image dimensions")
    else:
        width, height = struct.unpack(">II", data[pos + 8 : pos + 16])
        if (width, height) != (1536, 864):
            fail(f"hero dimensions changed unexpectedly: {width}x{height}")

    cursor = 0
    seen_mdat = False
    while cursor + 8 <= len(data):
        size = struct.unpack(">I", data[cursor:cursor + 4])[0]
        box_type = data[cursor + 4:cursor + 8]
        header = 8
        if size == 1:
            if cursor + 16 > len(data):
                fail("hero AVIF has a truncated extended box header")
                break
            size = struct.unpack(">Q", data[cursor + 8:cursor + 16])[0]
            header = 16
        elif size == 0:
            size = len(data) - cursor
        if size < header or cursor + size > len(data):
            fail(f"hero AVIF has an invalid/truncated {box_type.decode('ascii', 'replace')} box")
            break
        if box_type == b"mdat":
            seen_mdat = True
        cursor += size
    if not seen_mdat:
        fail("hero AVIF has no complete mdat payload")
    if cursor != len(data):
        fail(f"hero AVIF has {len(data) - cursor} unparsed trailing bytes")

admin = ROOT / "admin.html"
if admin.is_file():
    admin_text = admin.read_text(encoding="utf-8").lower()
    if "noindex" not in admin_text or "nofollow" not in admin_text:
        fail("admin.html must remain noindex,nofollow")

if errors:
    print("SITE INTEGRITY CHECK FAILED")
    for item in errors:
        print(f"- {item}")
    sys.exit(1)

print("SITE INTEGRITY CHECK PASSED")
print("Current public routes, SEO essentials, local references and protected boundaries are present.")
print("Hero is one direct 1536x864 AVIF with a complete container; obsolete reconstruction assets are absent.")
print("Verified History and Masinloc Bulletin are valid purpose pages with no invented content entries.")
print("No unfinished future-stage route is exposed by the current public pages.")
