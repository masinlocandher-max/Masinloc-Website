#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PAGES = [
    "index.html",
    "a-closer-look.html",
    "verified-history.html",
    "masinloc-bulletin.html",
    "connect.html",
]
EXPECTED_NAV = [
    ("index.html", "Home"),
    ("a-closer-look.html", "A Closer Look"),
    ("verified-history.html", "Verified History"),
    ("masinloc-bulletin.html", "Masinloc Bulletin"),
    ("connect.html", "Masinloc Connect"),
    ("mailto:hello@masinloc-zambales.com", "Contact"),
]
EXPECTED_LOGO = "assets/masinloc-logo.webp"
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
    expected_current = "index.html" if page_name == "index.html" else page_name
    if len(current) != 1 or current[0]["href"] != expected_current:
        fail(f"{page_name}: expected exactly one aria-current=page link for {expected_current}")

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
if EXPECTED_LOGO not in admin:
    fail("admin.html: missing shared Masinloc logo asset")

not_found = (ROOT / "404.html").read_text(encoding="utf-8")
if EXPECTED_LOGO not in not_found:
    fail("404.html: missing shared Masinloc logo asset")

for css in ("site.css", "site-polish.css", "connect-polish.css", "connect-shell.css", "admin-polish.css"):
    if not (ROOT / css).is_file():
        fail(f"missing design-system surface: {css}")

if errors:
    print("DESIGN CONSISTENCY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("DESIGN CONSISTENCY CHECK PASSED")
print("Public navigation, logo usage, active states and design layers are aligned across Masinloc surfaces.")
