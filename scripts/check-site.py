#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import hashlib
import json
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PAGES = [
    "index.html",
    "a-closer-look.html",
    "sambal-tina.html",
    "destinations.html",
    "leadership.html",
    "verified-history.html",
    "founder-of-masinloc.html",
    "masinloc-bulletin.html",
    "connect.html",
]
EDITORIAL_PAGES = [
    "index.html",
    "a-closer-look.html",
    "sambal-tina.html",
    "destinations.html",
    "leadership.html",
    "verified-history.html",
    "founder-of-masinloc.html",
    "masinloc-bulletin.html",
]
REQUIRED = [
    "index.html",
    "a-closer-look.html",
    "verified-history.html",
    "founder-of-masinloc.html",
    "history.css",
    "data/history.json",
    "scripts/build-history.py",
    "masinloc-bulletin.html",
    "connect.html",
    "admin.html",
    "404.html",
    "tokens.css",
    "site.css",
    "site-polish.css",
    "site.js",
    "sambal-tina.html",
    "sambal-tina.css",
    "sambal-tina.js",
    "data/sambal-tina.json",
    "assets/favicon.svg",
    "assets/apple-touch-icon.png",
    "assets/vendor/supabase.js",
    "destinations.html",
    "destinations.css",
    "destinations.js",
    "data/locations.json",
    "scripts/build-locations.py",
    "scripts/build-destinations.py",
    "scripts/check-locations.py",
    "scripts/check-photography.py",
    "data/photography.json",
    "scripts/destinations-qa.mjs",
    "leadership.html",
    "leadership.css",
    "leadership.js",
    "data/leadership.json",
    "scripts/build-leadership.py",
    "scripts/check-leadership.py",
    "scripts/leadership-qa.mjs",
    "scripts/contrast-qa.mjs",
    "scripts/responsive-qa.mjs",
    "styles.css",
    "connect-polish.css",
    "connect-shell.css",
    "connect-shell.js",
    "app.js",
    "app-base.js",
    "security.js",
    "robots.txt",
    "sitemap.xml",
    "vercel.json",
    "BUILD-NOTES.md",
    "scripts/browser-qa.mjs",
    "scripts/dictionary-qa.mjs",
    "scripts/check-dictionary.py",
    "scripts/build-dictionary.py",
    ".github/workflows/browser-qa.yml",
    "assets/masinloc-logo.webp",
    "assets/stage1/masinloc-hero.avif",
]
# Reachability, expressed as the navigation actually is.
#
# The articles on this site used to live in three places a visitor had to know
# about separately: Discover, the MABAYANI Bulletin, and Verified History. They
# are one library now, and Discover is its home — so the page every visitor
# must be able to reach from anywhere is Discover, and Discover is what has to
# carry the links onward.
#
# ARTICLE_HOME_CARRIES below is the other half. Requiring a link on every page
# is how you keep a section reachable; requiring the home to link to its
# children is how you keep the children from being orphaned when the bar is
# trimmed. Both are needed: without the second, removing an item from the
# navigation would silently strand everything under it.
MENU_LINKS = ["a-closer-look.html", "discover/index.html"]
ARTICLE_HOME = "discover/index.html"
# The Bulletin is deliberately not in this list any more. It is no longer a
# collection of reading material — it is the editorial publication, where new
# announcements get posted — so Discover linking to it would be Discover
# linking sideways rather than down to something it houses. What Discover must
# reach are the things it is the home of: the sequence's articles, the verified
# record, and the sources those rest on.
ARTICLE_HOME_CARRIES = [
    "verified-history.html",
    "founder-of-masinloc.html",
    "sources.html",
    "../mabayani/",
]

# The ten research articles are no longer listed on Discover; they are the
# worked research behind MABAYANI and are gathered there, beside the sections
# they support. That makes /mabayani/ the page that must not lose them, so it
# is checked directly rather than trusting the link that replaced the list.
RESEARCH_HOME = "mabayani/index.html"
FORBIDDEN_FILES = [
    "hero-loader.js",
    "hero-single.css",
    "home.css",
    ".github/workflows/fix-hero-once.yml",
    "assets/stage1/masinloc-hero-visible.avif",
    "assets/masinloc-sign.jpg",
    "assets/masinloc-secondary.jpg",
    "foo2.txt",
    "BUILD-MODE.md",
]
FORBIDDEN_GLOBS = [
    "assets/stage1/hero-b64-*.txt",
    ".repair/*",
    "*.tmp",
    "*.bak",
    "*~",
]
FORBIDDEN_PUBLIC_REFERENCES = [
    "hero-loader",
    "hero-b64-",
    "hero-photo",
    "masinloc-hero-visible",
    "masinloc-sign.jpg",
    "masinloc-secondary.jpg",
    "WELCOME TO",
]
PLACEHOLDER_MARKERS = [
    "lorem ipsum",
    "sample article",
    "example headline",
    "dummy content",
    "placeholder article",
]
# Routes that belong to a later stage. A link to one of these is only a
# problem while the page does not exist: once a stage genuinely ships, the
# page is on disk and the link is legitimate. Checking the filesystem means a
# finished stage never has to loosen this guard to get merged.
FUTURE_ROUTE = re.compile(
    r'href=["\'](?:/?)((?:discover|destinations|stories|sambal|local)[\w./-]*)["\']',
    re.I,
)
EXPECTED_HERO_BYTES = 76913
EXPECTED_HERO_SHA256 = "e7cc6d5057009c0967c770af2db0c1a5e6f72e794def8ea203079ec00abf22a5"

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
        if tag == "h1":
            self.h1_count += 1
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "img":
            self.images.append(attrs)
        for key in ("src", "href"):
            value = attrs.get(key)
            if value is not None:
                value = value.strip()
                if key == "href" and not value:
                    self.empty_hrefs += 1
                if value:
                    self.refs.append(value)
        if tag == "meta" and attrs.get("name") == "description" and attrs.get("content"):
            self.has_description = True
        if tag == "meta" and attrs.get("name") == "viewport" and attrs.get("content"):
            self.has_viewport = True
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
    lower = text.lower()
    parser = PageParser()
    parser.feed(text)

    for ref in parser.refs:
        target = local_target(html, ref)
        if target is None:
            continue
        # Location photography is a build output of scripts/build-locations.py.
        # scripts/check-locations.py owns its state and gives a far better
        # message than eight identical broken-reference lines.
        if ref.lstrip("/").startswith("assets/locations/"):
            continue
        try:
            target.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"reference escapes repository root: {html.name} -> {ref}")
            continue
        if not target.exists():
            fail(f"broken local reference: {html.name} -> {ref}")

    if parser.empty_hrefs:
        fail(f"{html.name}: contains empty href values")

    for image in parser.images:
        if "alt" not in image:
            fail(f"{html.name}: image missing alt attribute: {image.get('src', '[inline image]')}")

    if html.name in PUBLIC_PAGES:
        if parser.h1_count != 1:
            fail(f"{html.name}: expected exactly one H1, found {parser.h1_count}")
        if not parser.has_description:
            fail(f"{html.name}: missing meta description")
        if not parser.has_canonical:
            fail(f"{html.name}: missing canonical link")
        if not parser.has_viewport:
            fail(f"{html.name}: missing viewport meta")
        duplicate_ids = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
        if duplicate_ids:
            fail(f"{html.name}: duplicate IDs: {', '.join(duplicate_ids)}")
        for match in FUTURE_ROUTE.finditer(text):
            target = urlsplit(match.group(1)).path
            if target and not (ROOT / target.lstrip("/")).is_file():
                fail(f"{html.name}: links to an unfinished future-stage route: {target}")
        for menu_link in MENU_LINKS:
            if menu_link not in parser.refs:
                fail(f"{html.name}: missing required public menu link to {menu_link}")
        # (the article home is checked once, below, rather than per page)
        if "admin.html" in {urlsplit(ref).path for ref in parser.refs}:
            fail(f"{html.name}: public navigation must not expose admin.html")
        for marker in PLACEHOLDER_MARKERS:
            if marker in lower:
                fail(f"{html.name}: placeholder content detected: {marker}")

        local_ref_paths = {urlsplit(ref).path for ref in parser.refs}
        expected_polish = "connect-polish.css" if html.name == "connect.html" else "site-polish.css"
        if expected_polish not in local_ref_paths:
            fail(f"{html.name}: missing modern polish stylesheet {expected_polish}")

    if html.name in EDITORIAL_PAGES:
        local_ref_paths = {urlsplit(ref).path for ref in parser.refs}
        if "site.js" not in local_ref_paths:
            fail(f"{html.name}: missing shared public interaction script site.js")

for path in list(ROOT.glob("*.html")) + list(ROOT.glob("*.css")) + list(ROOT.glob("*.js")):
    text = path.read_text(encoding="utf-8", errors="replace")
    for forbidden in FORBIDDEN_PUBLIC_REFERENCES:
        if forbidden in text:
            fail(f"obsolete Stage 1 mechanism referenced in {path.name}: {forbidden}")

# Verified History and the founder profile are built from one reviewed claim
# register. This catches a hand edit, a drift back to 1572, an altered
# Binabayani framing, or an unattributed founder image before release.
_history_check = subprocess.run(
    [sys.executable, str(ROOT / "scripts" / "build-history.py"), "--check"],
    cwd=ROOT, capture_output=True, text=True, check=False)
if _history_check.returncode:
    fail("Verified History is out of date or violates its claim contract\n"
         + "    " + _history_check.stdout.strip().replace("\n", "\n    "))

# Masinloc Connect has its own supplied hero — the Masinloc mark on a navy
# field, circled by an orbit — and a dedicated responsive shell.
#
# This rule used to require the shared place photograph twice over, "for both
# landing and chooser photography". Neither half of that holds any more: the
# chooser screen is gone, and Connect no longer borrows the editorial hero. The
# photograph itself is unchanged and still byte-locked below for the nine pages
# that do use it.
#
# What is worth guarding here is that Connect's hero is served in every format
# and at every width the build produces, since a missing tier degrades silently
# to a heavier file or a broken image rather than to an error.
connect = ROOT / "connect.html"
if connect.is_file():
    connect_text = connect.read_text(encoding="utf-8")
    connect_hero = ROOT / "assets" / "connect"
    for width in (640, 960, 1280, 1672):
        for ext in ("avif", "webp", "jpg"):
            if not (connect_hero / f"connect-hero-{width}.{ext}").is_file():
                fail(f"Masinloc Connect hero missing {width}px {ext}")
    for width in (390, 560, 753):
        for ext in ("avif", "webp", "jpg"):
            if not (connect_hero / f"connect-hero-portrait-{width}.{ext}").is_file():
                fail(f"Masinloc Connect phone hero missing {width}px {ext}")
    if "connect-hero-portrait-390" not in connect_text:
        fail("connect.html must serve the phone crop of its hero: a 16:9 graphic "
             "cropped by a portrait viewport loses the mark")
    if "assets/stage1/masinloc-hero" in connect_text:
        fail("connect.html should use its own hero, not the shared photograph")
    for required_ref in ("connect-polish.css", "connect-shell.css", "connect-shell.js"):
        if required_ref not in connect_text:
            fail(f"connect.html missing required shell asset: {required_ref}")
    if "connect-menu-toggle" not in connect_text:
        fail("connect.html missing responsive navigation toggles")

hero = ROOT / "assets/stage1/masinloc-hero.avif"
if hero.is_file():
    data = hero.read_bytes()
    if len(data) != EXPECTED_HERO_BYTES:
        fail(f"hero asset bytes changed unexpectedly: {len(data)} != {EXPECTED_HERO_BYTES}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_HERO_SHA256:
        fail(f"hero asset hash changed unexpectedly: {digest}")
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

# robots.txt: search discovery and model training are separate permissions and
# have to stay that way. This is checked rather than trusted because the failure
# is silent in both directions — a wildcard edit can quietly withdraw ChatGPT
# Search, and a tidy-up can quietly reopen training.
# IndexNow: the key file is what proves to the endpoint that this repository
# owns the domain. It must exist, be named for its own contents, and be exactly
# one file — a stale second key silently invalidates submissions, and the
# failure is invisible from the site itself.
_keys = [p for p in ROOT.glob("*.txt") if re.fullmatch(r"[0-9a-f]{8,128}", p.stem)]
if len(_keys) > 1:
    fail(f"more than one IndexNow key file at the root: "
         f"{sorted(k.name for k in _keys)}; the endpoint cannot tell which is current")
elif len(_keys) == 1:
    _key = _keys[0]
    if _key.read_text(encoding="utf-8").strip() != _key.stem:
        fail(f"{_key.name}: an IndexNow key file must contain exactly its own name")
    if not (ROOT / ".github/workflows/indexnow.yml").is_file():
        fail("an IndexNow key is published but nothing submits to IndexNow")

robots = ROOT / "robots.txt"
if not robots.is_file():
    fail("robots.txt is missing")
else:
    robots_text = robots.read_text(encoding="utf-8")
    groups = {}
    current = None
    for line in robots_text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            current = value
            groups.setdefault(current, [])
        elif current is not None and key in ("allow", "disallow"):
            groups[current].append((key, value))

    if "OAI-SearchBot" not in groups:
        fail("robots.txt: OAI-SearchBot needs its own group so public pages stay "
             "discoverable for ChatGPT Search independently of the wildcard rule")
    else:
        rules = groups["OAI-SearchBot"]
        if ("disallow", "/") in rules:
            fail("robots.txt: OAI-SearchBot is blocked from the whole site; search "
                 "discovery is not training access and should stay open")
        if ("allow", "/") not in rules:
            fail("robots.txt: OAI-SearchBot has no Allow: / rule")
        if ("disallow", "/admin.html") not in rules:
            fail("robots.txt: OAI-SearchBot may reach /admin.html")

    if groups.get("GPTBot") != [("disallow", "/")]:
        fail("robots.txt: GPTBot should be disallowed from the whole site. "
             "Training access is a separate permission from search discovery, "
             "and blocking it here does not affect OAI-SearchBot.")

    for agent, rules in groups.items():
        if agent == "*" and ("disallow", "/") in rules:
            fail("robots.txt: the wildcard group disallows the whole site")
    if "Sitemap: https://www.masinloc-zambales.com/sitemap.xml" not in robots_text:
        fail("robots.txt does not point at the sitemap")

# The sitemap is generated. If it is stale, the deploy would publish dates and
# URLs that do not match the pages actually being shipped.
_sitemap_check = subprocess.run(
    [sys.executable, str(ROOT / "scripts" / "build-sitemap.py"), "--check"],
    cwd=ROOT, capture_output=True, text=True, check=False)
if _sitemap_check.returncode:
    fail("sitemap.xml is out of date — run python3 scripts/build-sitemap.py\n"
         + "    " + _sitemap_check.stdout.strip().replace("\n", "\n    "))

sitemap = ROOT / "sitemap.xml"
if sitemap.is_file():
    sitemap_text = sitemap.read_text(encoding="utf-8").lower()
    for forbidden in ("admin.html", "404.html"):
        if forbidden in sitemap_text:
            fail(f"sitemap.xml must not publish {forbidden}")
    for rel in ("a-closer-look.html", "verified-history.html", "founder-of-masinloc.html", "masinloc-bulletin.html", "connect.html"):
        if rel not in sitemap_text:
            fail(f"sitemap.xml missing current public route: {rel}")
    # Every built Bulletin story must be listed. scripts/build-bulletin.py keeps
    # this block in sync; the check is here so a story published some other way
    # cannot go live unindexed and unnoticed.
    for story in sorted((ROOT / "bulletin").glob("*.html")):
        if f"/bulletin/{story.name}" not in sitemap_text:
            fail(f"sitemap.xml missing published story: bulletin/{story.name}")

vercel = ROOT / "vercel.json"
if vercel.is_file():
    try:
        config = json.loads(vercel.read_text(encoding="utf-8"))
        deployment_enabled = config.get("git", {}).get("deploymentEnabled", {})
        if not isinstance(deployment_enabled, dict) or deployment_enabled.get("agent/*") is not False:
            fail("vercel.json must keep agent/* preview deployments disabled during staged development")
    except json.JSONDecodeError as exc:
        fail(f"vercel.json is invalid JSON: {exc}")

# The home carries its children.
#
# Discover is now the only article destination in the navigation, so every
# other collection is reached through it. If one of these links goes, that
# collection is reachable from nothing but a footer — which is exactly the kind
# of quiet orphaning that trimming a navigation causes, and exactly what
# nothing else here would catch.
_home = ROOT / ARTICLE_HOME
if not _home.is_file():
    fail(f"the article home {ARTICLE_HOME} does not exist")
else:
    _home_text = _home.read_text(encoding="utf-8")
    for child in ARTICLE_HOME_CARRIES:
        if child not in _home_text:
            fail(f"{ARTICLE_HOME}: does not link to {child}. Discover is the home of "
                 f"every article on this site, so a collection it does not link to is "
                 f"reachable from nothing but the footer.")

_research = ROOT / RESEARCH_HOME
if not _research.is_file():
    fail(f"{RESEARCH_HOME} does not exist")
else:
    _research_text = _research.read_text(encoding="utf-8")
    _stories = sorted(p.name for p in (ROOT / "bulletin").glob("*.html"))
    for story in _stories:
        if f"../bulletin/{story}" not in _research_text:
            fail(f"{RESEARCH_HOME}: does not link to bulletin/{story}. The research "
                 f"articles are reached from here now that Discover links to the "
                 f"story rather than listing them, so one missing here is orphaned.")

if errors:
    print("SITE INTEGRITY CHECK FAILED")
    for item in errors:
        print(f"- {item}")
    sys.exit(1)

print("SITE INTEGRITY CHECK PASSED")
print("Current public routes, SEO essentials, local references and protected boundaries are present.")
print("The exact approved hero remains byte-locked and intact across the public shell and Masinloc Connect.")
print("Modern public-site and Masinloc Connect polish/navigation layers are present on every public surface.")
print("Verified History and the founder profile match the reviewed history claim register.")
print("Staged agent branches remain protected from automatic Vercel preview deployment.")
