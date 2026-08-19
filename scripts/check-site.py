#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "index.html",
    "a-closer-look.html",
    "connect.html",
    "admin.html",
    "home.css",
    "styles.css",
    "app.js",
    "app-base.js",
    "security.js",
    "assets/stage1/masinloc-hero.avif",
]
FORBIDDEN_FILES = [
    "hero-loader.js",
    "assets/stage1/masinloc-hero-visible.avif",
]
FORBIDDEN_GLOBS = ["assets/stage1/hero-b64-*.txt"]
FORBIDDEN_PUBLIC_REFERENCES = ["hero-loader", "hero-b64-", "masinloc-hero-visible"]

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


class ReferenceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ("src", "href"):
            value = attrs.get(key)
            if value:
                self.refs.append(value.strip())


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
    if path.startswith("/"):
        target = ROOT / path.lstrip("/")
    else:
        target = source.parent / path
    if path.endswith("/"):
        target = target / "index.html"
    return target.resolve()


for html in ROOT.glob("*.html"):
    text = html.read_text(encoding="utf-8")
    parser = ReferenceParser()
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

for path in list(ROOT.glob("*.html")) + list(ROOT.glob("*.css")) + list(ROOT.glob("*.js")):
    text = path.read_text(encoding="utf-8", errors="replace")
    for forbidden in FORBIDDEN_PUBLIC_REFERENCES:
        if forbidden in text:
            fail(f"obsolete hero mechanism referenced in {path.name}: {forbidden}")

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
print("Stage 1 pages and local references are present.")
print("Hero asset is a direct 1536x864 AVIF and obsolete reconstruction files are absent.")
