#!/usr/bin/env python3
from __future__ import annotations

import re
import struct
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_HTML = [ROOT / "index.html", ROOT / "a-closer-look.html", ROOT / "connect.html"]
REQUIRED = [
    ROOT / "index.html",
    ROOT / "a-closer-look.html",
    ROOT / "connect.html",
    ROOT / "site.css",
    ROOT / "site.js",
    ROOT / "styles.css",
    ROOT / "app.js",
    ROOT / "app-base.js",
    ROOT / "security.js",
    ROOT / "assets" / "masinloc-logo.webp",
    ROOT / "assets" / "stage1" / "masinloc-hero-visible.avif",
]
BANNED_PUBLIC_TOKENS = (
    "hero-loader.js",
    "hero-b64-",
    "hero-photo",
    "WELCOME TO",
)

class Scanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refs: list[tuple[str, str]] = []
        self.ids: list[str] = []
        self.h1_count = 0
        self.has_description = False
        self.has_canonical = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "h1":
            self.h1_count += 1
        if data.get("id"):
            self.ids.append(data["id"] or "")
        if tag in {"img", "script"} and data.get("src"):
            self.refs.append(("src", data["src"] or ""))
        if tag == "link" and data.get("href"):
            self.refs.append(("href", data["href"] or ""))
            if data.get("rel") == "canonical":
                self.has_canonical = True
        if tag == "a" and data.get("href"):
            self.refs.append(("href", data["href"] or ""))
        if tag == "meta" and data.get("name") == "description" and data.get("content"):
            self.has_description = True


def local_path(ref: str) -> Path | None:
    ref = ref.strip()
    if not ref or ref.startswith(("#", "mailto:", "tel:", "data:")):
        return None
    parsed = urlsplit(ref)
    if parsed.scheme or parsed.netloc:
        return None
    clean = parsed.path.lstrip("/")
    return ROOT / clean if clean else None


def verify_avif(path: Path) -> list[str]:
    errors: list[str] = []
    data = path.read_bytes()
    if len(data) < 32:
        return [f"Hero AVIF is implausibly small: {len(data)} bytes"]
    if b"ftypavif" not in data[:64]:
        errors.append("Hero asset is not an AVIF container (missing ftypavif).")

    pos = 0
    seen_mdat = False
    while pos + 8 <= len(data):
        size = struct.unpack(">I", data[pos:pos+4])[0]
        box_type = data[pos+4:pos+8]
        header = 8
        if size == 1:
            if pos + 16 > len(data):
                errors.append("Hero AVIF has a truncated extended box header.")
                break
            size = struct.unpack(">Q", data[pos+8:pos+16])[0]
            header = 16
        elif size == 0:
            size = len(data) - pos
        if size < header:
            errors.append(f"Hero AVIF contains invalid box size at byte {pos}.")
            break
        end = pos + size
        if end > len(data):
            errors.append(f"Hero AVIF is truncated: box {box_type.decode('ascii','replace')} extends past EOF.")
            break
        if box_type == b"mdat":
            seen_mdat = True
        pos = end
    if not seen_mdat:
        errors.append("Hero AVIF has no complete mdat payload.")
    if pos != len(data):
        errors.append(f"Hero AVIF has {len(data)-pos} unparsed trailing bytes.")
    return errors


def main() -> int:
    errors: list[str] = []

    for path in REQUIRED:
        if not path.exists():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")

    for html in PUBLIC_HTML:
        if not html.exists():
            continue
        text = html.read_text(encoding="utf-8")
        scanner = Scanner()
        scanner.feed(text)

        if scanner.h1_count != 1:
            errors.append(f"{html.name}: expected exactly one H1, found {scanner.h1_count}")
        if not scanner.has_description:
            errors.append(f"{html.name}: missing meta description")
        if not scanner.has_canonical:
            errors.append(f"{html.name}: missing canonical link")

        duplicates = sorted({value for value in scanner.ids if scanner.ids.count(value) > 1})
        if duplicates:
            errors.append(f"{html.name}: duplicate IDs: {', '.join(duplicates)}")

        for token in BANNED_PUBLIC_TOKENS:
            if token in text:
                errors.append(f"{html.name}: obsolete Stage 1 token still present: {token}")

        for kind, ref in scanner.refs:
            target = local_path(ref)
            if target and not target.exists():
                errors.append(f"{html.name}: broken local {kind} reference: {ref}")

    hero = ROOT / "assets" / "stage1" / "masinloc-hero-visible.avif"
    if hero.exists():
        errors.extend(verify_avif(hero))

    # Public Stage 1 pages must not expose future placeholder routes.
    future_route = re.compile(r'href=["\'](?:discover|stories|sambal|local|destinations)[^"\']*["\']', re.I)
    for html in PUBLIC_HTML:
        if html.exists() and future_route.search(html.read_text(encoding="utf-8")):
            errors.append(f"{html.name}: links to an unfinished future-stage route")

    if errors:
        print("SITE VERIFICATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("SITE VERIFICATION PASSED")
    print("Stage 1 public pages, local assets, SEO essentials, hero container, and route guardrails are valid.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
