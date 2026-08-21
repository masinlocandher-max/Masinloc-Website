#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import base64
import gzip
import hashlib
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PAGES = [
    "index.html",
    "a-closer-look.html",
    "verified-history.html",
    "history-timeline.html",
    "sambal-tina.html",
    "masinloc-bulletin.html",
    "bulletin-cleopatra-barrera.html",
    "connect.html",
]
EDITORIAL_PAGES = [page for page in PUBLIC_PAGES if page != "connect.html"]
REQUIRED = [
    *PUBLIC_PAGES,
    "admin.html", "404.html",
    "site.css", "site-polish.css", "site-stability.css", "stage2.css", "dictionary-fmb.css", "site.js",
    "styles.css", "connect-polish.css", "connect-shell.css", "connect-shell.js",
    "app.js", "app-base.js", "security.js",
    "sambal-tina.js", "data/sambal-tina-community.js",
    "data/sambal-tina-v2-01.js", "data/sambal-tina-v2-02.js", "data/sambal-tina-v2-03.js",
    "data/sambal-tina-v2-04.js", "data/sambal-tina-v2-05.js",
    "robots.txt", "sitemap.xml", "vercel.json", "BUILD-NOTES.md",
    "scripts/browser-qa.mjs", ".github/workflows/browser-qa.yml",
    "assets/masinloc-logo.webp", "assets/stage1/masinloc-hero.avif",
]
MENU_LINKS = ["verified-history.html", "masinloc-bulletin.html"]
FORBIDDEN_FILES = [
    "hero-loader.js", "hero-single.css", "home.css", ".github/workflows/fix-hero-once.yml",
    "assets/stage1/masinloc-hero-visible.avif", "assets/masinloc-sign.jpg", "assets/masinloc-secondary.jpg",
    "foo2.txt", "BUILD-MODE.md",
    "data/sambal-tina-01.js", "data/sambal-tina-02.js", "data/sambal-tina-03.js",
    "data/sambal-tina-04.js", "data/sambal-tina-05.js",
]
FORBIDDEN_GLOBS = ["assets/stage1/hero-b64-*.txt", ".repair/*", "*.tmp", "*.bak", "*~"]
FORBIDDEN_PUBLIC_REFERENCES = ["hero-loader", "hero-b64-", "hero-photo", "masinloc-hero-visible", "masinloc-sign.jpg", "masinloc-secondary.jpg", "WELCOME TO"]
PLACEHOLDER_MARKERS = ["lorem ipsum", "sample article", "example headline", "dummy content", "placeholder article"]
FUTURE_ROUTE = re.compile(r'href=["\'](?:/?)(?:discover|destinations|stories|local)(?:[/._-]|["\'])', re.I)
EXPECTED_HERO_BYTES = 76913
EXPECTED_HERO_SHA256 = "e7cc6d5057009c0967c770af2db0c1a5e6f72e794def8ea203079ec00abf22a5"
EXPECTED_DICTIONARY_ENTRIES = 5222
EXPECTED_DICTIONARY_REVIEW = 97
errors = []


def fail(message: str) -> None:
    errors.append(message)


for rel in REQUIRED:
    if not (ROOT / rel).is_file():
        fail(f"missing required file: {rel}")

for rel in FORBIDDEN_FILES:
    if (ROOT / rel).exists():
        fail(f"obsolete/scratch file must not return: {rel}")

for pattern in FORBIDDEN_GLOBS:
    for path in ROOT.glob(pattern):
        fail(f"temporary or reconstruction artifact: {path.relative_to(ROOT)}")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.ids = []
        self.h1_count = 0
        self.has_description = False
        self.has_canonical = False
        self.has_viewport = False
        self.images = []
        self.empty_hrefs = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h1": self.h1_count += 1
        if attrs.get("id"): self.ids.append(attrs["id"])
        if tag == "img": self.images.append(attrs)
        for key in ("src", "href"):
            value = attrs.get(key)
            if value is not None:
                value = value.strip()
                if key == "href" and not value: self.empty_hrefs += 1
                if value: self.refs.append(value)
        if tag == "meta" and attrs.get("name") == "description" and attrs.get("content"): self.has_description = True
        if tag == "meta" and attrs.get("name") == "viewport" and attrs.get("content"): self.has_viewport = True
        if tag == "link" and attrs.get("rel") == "canonical" and attrs.get("href"): self.has_canonical = True


def local_target(source: Path, value: str):
    if not value or value.startswith(("#", "mailto:", "tel:", "javascript:", "data:")): return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc: return None
    path = parsed.path
    if not path: return None
    if path == "/": return ROOT / "index.html"
    target = ROOT / path.lstrip("/") if path.startswith("/") else source.parent / path
    if path.endswith("/"): target = target / "index.html"
    return target.resolve()


for html in ROOT.glob("*.html"):
    text = html.read_text(encoding="utf-8")
    lower = text.lower()
    parser = PageParser(); parser.feed(text)
    for ref in parser.refs:
        target = local_target(html, ref)
        if target is None: continue
        try: target.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"reference escapes repository root: {html.name} -> {ref}"); continue
        if not target.exists(): fail(f"broken local reference: {html.name} -> {ref}")
    if parser.empty_hrefs: fail(f"{html.name}: contains empty href values")
    for image in parser.images:
        if "alt" not in image: fail(f"{html.name}: image missing alt attribute: {image.get('src', '[inline image]')}")
    if html.name in PUBLIC_PAGES:
        if parser.h1_count != 1: fail(f"{html.name}: expected exactly one H1, found {parser.h1_count}")
        if not parser.has_description: fail(f"{html.name}: missing meta description")
        if not parser.has_canonical: fail(f"{html.name}: missing canonical link")
        if not parser.has_viewport: fail(f"{html.name}: missing viewport meta")
        duplicate_ids = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
        if duplicate_ids: fail(f"{html.name}: duplicate IDs: {', '.join(duplicate_ids)}")
        if FUTURE_ROUTE.search(text): fail(f"{html.name}: links to an unfinished future-stage route")
        for menu_link in MENU_LINKS:
            if menu_link not in parser.refs: fail(f"{html.name}: missing required public menu link to {menu_link}")
        if "admin.html" in {urlsplit(ref).path for ref in parser.refs}: fail(f"{html.name}: public navigation must not expose admin.html")
        for marker in PLACEHOLDER_MARKERS:
            if marker in lower: fail(f"{html.name}: placeholder content detected: {marker}")
        local_ref_paths = {urlsplit(ref).path for ref in parser.refs}
        expected_polish = "connect-polish.css" if html.name == "connect.html" else "site-polish.css"
        if expected_polish not in local_ref_paths: fail(f"{html.name}: missing modern polish stylesheet {expected_polish}")
        if html.name != "connect.html" and "stage2.css" not in local_ref_paths: fail(f"{html.name}: missing Stage 2 stylesheet")
    if html.name in EDITORIAL_PAGES:
        if "site.js" not in {urlsplit(ref).path for ref in parser.refs}: fail(f"{html.name}: missing shared public interaction script site.js")

for path in list(ROOT.glob("*.html")) + list(ROOT.glob("*.css")) + list(ROOT.glob("*.js")):
    text = path.read_text(encoding="utf-8", errors="replace")
    for forbidden in FORBIDDEN_PUBLIC_REFERENCES:
        if forbidden in text: fail(f"obsolete Stage 1 mechanism referenced in {path.name}: {forbidden}")

# Stage 2 publication contracts.
history = ROOT / "history-timeline.html"
if history.is_file():
    text = history.read_text(encoding="utf-8")
    for required in ("Documented", "Local chronicle", "Historical context", "1572", "1942", "2012", "2016"):
        if required not in text: fail(f"history-timeline.html missing expected source-status/timeline marker: {required}")

bulletin = ROOT / "bulletin-cleopatra-barrera.html"
if bulletin.is_file():
    text = bulletin.read_text(encoding="utf-8")
    for required in ("Masinloc knew her first", "Founder of Discover Masinloc", "Reina Photogenic", "first runner-up", "Good to know", "pep.ph/videos/vertical"):
        if required not in text: fail(f"Cleopatra Bulletin missing required editorial marker: {required}")
    if "unverified transcription" not in text:
        fail("Cleopatra Bulletin must keep the Q&A transcript-verification disclosure")

# Dictionary chunks must decode into exactly the locked resolved-master counts.
parts = []
for idx in range(1, 6):
    path = ROOT / f"data/sambal-tina-v2-{idx:02d}.js"
    if not path.is_file(): continue
    text = path.read_text(encoding="utf-8")
    match = re.search(r'\+"([A-Za-z0-9+/=]+)";', text)
    if not match:
        fail(f"dictionary data chunk {idx} has an invalid wrapper")
    else:
        parts.append(match.group(1))

if len(parts) == 5:
    payload = None
    decode_errors = []
    candidates = []

    try:
        candidates.append(b"".join(base64.b64decode(part) for part in parts))
    except Exception as exc:
        decode_errors.append(f"per-chunk base64: {exc}")

    try:
        candidates.append(base64.b64decode("".join(parts)))
    except Exception as exc:
        decode_errors.append(f"joined base64: {exc}")

    for candidate in candidates:
        try:
            payload = json.loads(gzip.decompress(candidate).decode("utf-8"))
            break
        except Exception as exc:
            decode_errors.append(f"gzip/json: {exc}")

    if payload is None:
        fail("dictionary dataset could not be decoded: " + " | ".join(decode_errors))
    else:
        if len(payload) != EXPECTED_DICTIONARY_ENTRIES:
            fail(f"dictionary entry count changed: {len(payload)} != {EXPECTED_DICTIONARY_ENTRIES}")
        review_count = sum(1 for row in payload if len(row) >= 5 and row[4] == 1)
        if review_count != EXPECTED_DICTIONARY_REVIEW:
            fail(f"dictionary source-review count changed: {review_count} != {EXPECTED_DICTIONARY_REVIEW}")
        if any(len(row) != 5 for row in payload): fail("dictionary compact rows must keep five fields")

community_data = ROOT / "data/sambal-tina-community.js"
if community_data.is_file():
    text = community_data.read_text(encoding="utf-8")
    for required in ("lanom", "ayama", "talacaca", "masitas", "cabatwan", "oybon", "awlo", "matibya", "labay-labay", "macicwa", "igwa", "balaybay mi", "mabanglo", "mabata", "Inaro ni Cha Baby yay masitas na."):
        if required not in text: fail(f"community Sambal Tina layer missing confirmed form: {required}")

dictionary_page = ROOT / "sambal-tina.html"
if dictionary_page.is_file():
    text = dictionary_page.read_text(encoding="utf-8")
    for required in ("5,222", "Word of the Day", "Living Tina Sambal", "do not invent it", "dictionary-fmb.css", "sambal-tina-community.js", "sambal-tina.js"):
        if required not in text: fail(f"sambal-tina.html missing dictionary contract marker: {required}")

# Masinloc Connect uses the byte-locked place photograph and dedicated responsive shell.
connect = ROOT / "connect.html"
if connect.is_file():
    connect_text = connect.read_text(encoding="utf-8")
    if connect_text.count("assets/stage1/masinloc-hero.avif") < 2: fail("connect.html must use the verified hero for landing and chooser photography")
    for required_ref in ("connect-polish.css", "connect-shell.css", "connect-shell.js"):
        if required_ref not in connect_text: fail(f"connect.html missing required shell asset: {required_ref}")
    if "connect-menu-toggle" not in connect_text: fail("connect.html missing responsive navigation toggles")

hero = ROOT / "assets/stage1/masinloc-hero.avif"
if hero.is_file():
    data = hero.read_bytes()
    if len(data) != EXPECTED_HERO_BYTES: fail(f"hero asset bytes changed unexpectedly: {len(data)} != {EXPECTED_HERO_BYTES}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_HERO_SHA256: fail(f"hero asset hash changed unexpectedly: {digest}")
    if b"ftypavif" not in data[:32]: fail("hero asset does not have an AVIF file signature")
    pos = data.find(b"ispe")
    if pos < 0 or len(data) < pos + 16: fail("hero asset is missing AVIF image dimensions")
    else:
        width, height = struct.unpack(">II", data[pos + 8:pos + 16])
        if (width, height) != (1536, 864): fail(f"hero dimensions changed unexpectedly: {width}x{height}")

admin = ROOT / "admin.html"
if admin.is_file():
    admin_text = admin.read_text(encoding="utf-8").lower()
    if "noindex" not in admin_text or "nofollow" not in admin_text: fail("admin.html must remain noindex,nofollow")

sitemap = ROOT / "sitemap.xml"
if sitemap.is_file():
    sitemap_text = sitemap.read_text(encoding="utf-8").lower()
    for forbidden in ("admin.html", "404.html"):
        if forbidden in sitemap_text: fail(f"sitemap.xml must not publish {forbidden}")
    for rel in PUBLIC_PAGES[1:]:
        if rel not in sitemap_text: fail(f"sitemap.xml missing current public route: {rel}")

vercel = ROOT / "vercel.json"
if vercel.is_file():
    try:
        config = json.loads(vercel.read_text(encoding="utf-8"))
        deployment_enabled = config.get("git", {}).get("deploymentEnabled", {})
        if not isinstance(deployment_enabled, dict) or deployment_enabled.get("agent/*") is not False:
            fail("vercel.json must keep agent/* preview deployments disabled during staged development")
    except json.JSONDecodeError as exc:
        fail(f"vercel.json is invalid JSON: {exc}")

if errors:
    print("SITE INTEGRITY CHECK FAILED")
    for item in errors: print(f"- {item}")
    sys.exit(1)

print("SITE INTEGRITY CHECK PASSED")
print("Stage 2 public routes, SEO essentials, local references and protected boundaries are present.")
print("The 5,222-entry Sambal Tina dataset and 97 source-review flags decode exactly from the resolved master.")
print("The community-confirmed Sambal Tina layer remains separate from documentary source data.")
print("History source-status labels and the Cleopatra Bulletin editorial safeguards are enforced.")
print("The approved hero remains byte-locked and staged agent branches remain protected from automatic Vercel preview deployment.")
