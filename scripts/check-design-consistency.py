#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PAGES = [
    "index.html",
    "a-closer-look.html",
    "sambal-tina.html",
    "destinations.html",
    "leadership.html",
    "verified-history.html",
    "masinloc-bulletin.html",
    "connect.html",
]
# Pages that sit under a primary destination rather than being one. They carry
# the same shared shell, but the current-page state belongs to their parent, so
# the locked six-item navigation does not grow every time a section gains a
# detail page.
SUBPAGES = {
    "sambal-tina.html": "a-closer-look.html",
    "destinations.html": "a-closer-look.html",
    "leadership.html": "a-closer-look.html",
}
# Pages that carry the shared shell but are not themselves a nav destination
# with their own current-page state beyond the one they already mark.

EXPECTED_NAV = [
    ("index.html", "Home"),
    ("a-closer-look.html", "A Closer Look"),
    ("verified-history.html", "Verified History"),
    ("masinloc-bulletin.html", "Masinloc Bulletin"),
    ("connect.html", "Masinloc Connect"),
    ("contact.html", "Contact"),
]
EXPECTED_LOGO = "assets/masinloc-logo.webp"
STABILITY_CSS = "site-stability.css"
TOKENS_CSS = "tokens.css"
FAVICON = "assets/favicon.svg"

# The locked identity colours, plus the superseded palette they replaced.
# Both belong in tokens.css and nowhere else: a second definition anywhere is
# how the surfaces drifted apart in the first place.
LOCKED_COLOURS = [
    "#0D3B9E", "#1E63E9", "#E61E25", "#FFC700", "#061A46", "#03112F",
    "#0a34b7", "#e20718", "#ffb90a", "#09236d", "#071d58", "#e3a400",
]
errors = []


def fail(message):
    errors.append(message)


class ShellParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.header_depth = 0
        self.in_header_nav = False
        self.first_nav_done = False
        self.current_anchor = None
        self.nav_items = []
        self.header_logos = []
        self.stylesheets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "header":
            self.header_depth += 1
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.stylesheets.append(attrs["href"].split("?", 1)[0])
        if self.header_depth and tag == "img" and attrs.get("src"):
            self.header_logos.append(attrs["src"].split("?", 1)[0])
        if self.header_depth and tag == "nav" and not self.first_nav_done:
            self.in_header_nav = True
        if self.in_header_nav and tag == "a":
            self.current_anchor = {
                "href": attrs.get("href", ""),
                "text": "",
                "current": attrs.get("aria-current") == "page",
            }

    def handle_data(self, data):
        if self.current_anchor is not None:
            self.current_anchor["text"] += data

    def handle_endtag(self, tag):
        if self.current_anchor is not None and tag == "a":
            self.current_anchor["text"] = " ".join(self.current_anchor["text"].split())
            self.nav_items.append(self.current_anchor)
            self.current_anchor = None
        if self.in_header_nav and tag == "nav":
            self.in_header_nav = False
            self.first_nav_done = True
        if tag == "header" and self.header_depth:
            self.header_depth -= 1


for page_name in PUBLIC_PAGES:
    path = ROOT / page_name
    text = path.read_text(encoding="utf-8")
    parser = ShellParser()
    parser.feed(text)

    actual = [(item["href"], item["text"]) for item in parser.nav_items]
    if actual != EXPECTED_NAV:
        fail(f"{page_name}: primary navigation differs from the shared Masinloc order/labels: {actual}")

    if not parser.header_logos or parser.header_logos[0] != EXPECTED_LOGO:
        fail(f"{page_name}: header must use the shared Masinloc logo asset")

    current = [item for item in parser.nav_items if item["current"]]
    expected_current = SUBPAGES.get(page_name, page_name)
    if len(current) != 1 or current[0]["href"] != expected_current:
        fail(f"{page_name}: expected exactly one aria-current=page link for {expected_current}")

    if STABILITY_CSS not in parser.stylesheets:
        fail(f"{page_name}: missing shared mobile stability stylesheet {STABILITY_CSS}")

    if TOKENS_CSS not in parser.stylesheets:
        fail(f"{page_name}: missing shared design tokens {TOKENS_CSS}")
    elif parser.stylesheets[0] != TOKENS_CSS:
        fail(f"{page_name}: {TOKENS_CSS} must be the first stylesheet so later "
             f"layers can build on it")

    if FAVICON not in text:
        fail(f"{page_name}: missing shared favicon {FAVICON}")

    if page_name == "connect.html":
        for required in ("styles.css", "connect-polish.css", "connect-shell.css"):
            if required not in parser.stylesheets:
                fail(f"connect.html: missing required functional/design stylesheet {required}")
    else:
        for required in ("site.css", "site-polish.css"):
            if required not in parser.stylesheets:
                fail(f"{page_name}: missing shared editorial stylesheet {required}")

admin = (ROOT / "admin.html").read_text(encoding="utf-8")
if "admin-polish.css" not in admin:
    fail("admin.html: missing Masinloc admin polish layer")
if STABILITY_CSS not in admin:
    fail("admin.html: missing shared mobile stability layer")
if EXPECTED_LOGO not in admin:
    fail("admin.html: missing shared Masinloc logo asset")

not_found = (ROOT / "404.html").read_text(encoding="utf-8")
if EXPECTED_LOGO not in not_found:
    fail("404.html: missing shared Masinloc logo asset")
if STABILITY_CSS not in not_found:
    fail("404.html: missing shared mobile stability layer")

for css in ("tokens.css", "site.css", "site-polish.css", "site-stability.css",
            "connect-polish.css", "connect-shell.css", "admin-polish.css",
            "sambal-tina.css", "destinations.css"):
    if not (ROOT / css).is_file():
        fail(f"missing design-system surface: {css}")

# The palette is defined once, in tokens.css.
for stylesheet in sorted(ROOT.glob("*.css")):
    if stylesheet.name == TOKENS_CSS:
        continue
    body = stylesheet.read_text(encoding="utf-8")
    for colour in LOCKED_COLOURS:
        if colour.lower() in body.lower():
            fail(f"{stylesheet.name}: defines the identity colour {colour} directly; "
                 f"reference the token from {TOKENS_CSS} instead")

for script in ("app-base.js", "app.js", "admin.js", "site.js", "sambal-tina.js",
               "destinations.js"):
    path = ROOT / script
    if not path.is_file():
        continue
    body = path.read_text(encoding="utf-8")
    for colour in LOCKED_COLOURS:
        if colour.lower() in body.lower():
            fail(f"{script}: hardcodes the identity colour {colour}; inline styles "
                 f"beat every stylesheet, so use a token instead")

# Every page wearing the shared shell needs the palette that shell is written
# against, and this is discovered from the filesystem rather than from a list.
# The lists above are curated, and trust.html was never added to one: it shipped
# carrying site.css without tokens.css, so every var(--blue) resolved to nothing
# and its navigation rendered black with the Masinloc Connect button flattened.
# A page either wears the shell or it does not, and the page itself says which.
SHELL_MARKER = 'class="site-nav"'
for path in sorted(ROOT.glob("*.html")) + sorted(ROOT.glob("bulletin/*.html")):
    text = path.read_text(encoding="utf-8")
    if SHELL_MARKER not in text:
        continue
    rel = path.relative_to(ROOT).as_posix()
    sheets = re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"?]+)', text)
    sheets = [Path(href).name for href in sheets]
    if TOKENS_CSS not in sheets:
        fail(f"{rel}: wears the shared shell but never loads {TOKENS_CSS}, so every "
             f"colour token on the page resolves to nothing")
    elif sheets[0] != TOKENS_CSS:
        fail(f"{rel}: {TOKENS_CSS} must be the first stylesheet")
    if f'rel="icon"' not in text:
        fail(f"{rel}: wears the shared shell but declares no favicon")

if errors:
    print("DESIGN CONSISTENCY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("DESIGN CONSISTENCY CHECK PASSED")
print("Public navigation, logo usage, active states, mobile stability and design layers are aligned across Masinloc surfaces.")
