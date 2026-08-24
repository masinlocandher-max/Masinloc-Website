#!/usr/bin/env python3
"""Build the Masinloc Connect Marketplace from data/marketplace.json.

WHAT THIS IS

A public directory of approved Masinloc businesses. Somebody arrives wanting a
coffee or a caterer, finds the business, and calls it. That is the whole
product. There is no cart, no checkout, no ratings, no seller dashboard and no
inventory, because none of those help with that.

WHAT IT REFUSES TO PRINT

The submission form collects two phone numbers, and the difference is the
privacy model in one line: contact_number is the number a business wants
customers to ring, owner_phone is the owner's own. Only the first appears here.
Neither owner_name nor owner_email is carried in the data file at all, so there
is no path by which they could reach a page — the safest way to not leak a
field is to not have it. Reference codes, submission ids, moderation status and
dashboard-interest flags are the same.

That is enforced rather than trusted: PUBLIC_FIELDS below is the whole list of
keys a business may carry, and an unexpected key fails the build. If somebody
later pastes a raw submission row into the data file, this stops it.

ABSENT FIELDS ARE ABSENT

A business with no verified Facebook page gets no Facebook row — not an empty
one, not "N/A", not a dead link. Same for every optional field. A directory
that prints placeholders teaches people the entries are unreliable.

Usage
-----
    python3 scripts/build-marketplace.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "marketplace.json"
OUT_DIR = ROOT / "marketplace"
HUB = ROOT / "marketplace.html"
SITE = "https://masinloc-zambales.com"

# The only keys a business may carry. Anything else is either private data that
# has no business being in a public file, or a typo that would silently not
# render. Both should stop the build.
PUBLIC_FIELDS = {
    "slug", "name", "category", "location", "barangay", "description",
    "contact", "contactDigits", "image", "facebook",
}
# Keys that would mean a raw submission row had been pasted in.
FORBIDDEN = {
    "owner_name", "owner_email", "owner_phone", "ownerName", "ownerEmail",
    "ownerPhone", "reference_code", "referenceCode", "id", "status",
    "dashboard_interest", "dashboard_interest_at", "internal_notes", "notes",
    "brand_logo_path",
}

spec = json.loads(DATA.read_text(encoding="utf-8"))
CATEGORIES = spec["categories"]
BUSINESSES = spec["businesses"]
LABEL = {c["id"]: c["label"] for c in CATEGORIES}


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def validate() -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()
    for business in BUSINESSES:
        name = business.get("name", "(unnamed)")
        keys = {k for k in business if not k.startswith("_")}

        for key in sorted(keys & FORBIDDEN):
            problems.append(f"{name}: carries {key}, which is private and must never be published")
        for key in sorted(keys - PUBLIC_FIELDS):
            problems.append(f"{name}: unknown field {key} — add it to PUBLIC_FIELDS or remove it")
        for key in ("slug", "name", "category", "location", "description"):
            if not business.get(key):
                problems.append(f"{name}: missing required field {key}")

        slug = business.get("slug", "")
        if slug in seen:
            problems.append(f"duplicate slug {slug}")
        seen.add(slug)
        if slug and not re.fullmatch(r"[a-z0-9-]+", slug):
            problems.append(f"{name}: slug {slug!r} is not url-safe")
        if business.get("category") not in LABEL:
            problems.append(f"{name}: category {business.get('category')!r} is not a declared category")

        # A published link has to be a real https Facebook URL or not exist.
        facebook = business.get("facebook")
        if facebook is not None:
            if not re.match(r"^https://(www\.|m\.)?(facebook\.com|fb\.com)/.+", facebook):
                problems.append(f"{name}: facebook {facebook!r} is not a resolvable https Facebook URL")
    return problems


def nav(depth: int) -> str:
    """The shared masthead, byte-for-byte the one every other page uses.

    Copied rather than reinvented on purpose. The first version of this
    function invented `site-header` and `nav-toggle`, which are styled nowhere
    — check-stylesheets.py caught it, which is precisely the failure that guard
    was written for after the Sambal Tina primer shipped unstyled.

    depth 0 is the site root, 1 is /marketplace/.
    """
    up = "../" if depth else ""

    def item(href: str, label: str, cls: str = "") -> str:
        attrs = f' class="{cls}"' if cls else ""
        return f'<a{attrs} href="{href}">{label}</a>'

    return f"""<header class="site-nav" id="siteNav">
  <a class="brand" href="{up}index.html" aria-label="Masinloc, Zambales home"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    {item(f"{up}index.html", "Home")}
    {item(f"{up}discover/index.html", "Discover")}
    {item(f"{up}a-closer-look.html", "A Closer Look")}
    {item(f"{up}verified-history.html", "Verified History")}
    {item(f"{up}masinloc-bulletin.html", "Masinloc Bulletin")}
    {item(f"{up}connect.html", "Masinloc Connect", "connect-link")}
    {item(f"{up}contact.html", "Contact")}
  </nav>
</header>"""


def footer(depth: int) -> str:
    up = "../" if depth else ""
    return f"""<footer class="home-footer">
  <div class="footer-brand"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="{up}index.html">Home</a><a href="{up}discover/index.html">Discover</a><a href="{up}marketplace.html">Marketplace</a><a href="{up}a-closer-look.html">A Closer Look</a><a href="{up}verified-history.html">Verified History</a><a href="{up}masinloc-bulletin.html">Masinloc Bulletin</a><a href="{up}connect.html">Masinloc Connect</a><a href="{up}contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Masinloc. All rights reserved.</span><span>Photography · Mabayani Project by FMB</span></div>
</footer>"""


def head(*, title: str, description: str, url: str, depth: int, ld: str) -> str:
    up = "../" if depth else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Discover Masinloc">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{up}assets/apple-touch-icon.png">
<link rel="stylesheet" href="{up}tokens.css?v=20260823-1">
<link rel="stylesheet" href="{up}site.css?v=20260821-1">
<link rel="stylesheet" href="{up}site-polish.css?v=20260820-1">
<link rel="stylesheet" href="{up}marketplace.css?v=20260824-1">
<link rel="stylesheet" href="{up}site-stability.css?v=20260823-1">
</head>
<!-- .about-page is the light shell used by Contact, Trust, Sources and every
     Discover page. Without it the shared navigation paints white links on a
     white editorial page and disappears. -->
<body class="about-page">"""


def crumbs(trail: list[tuple[str, str | None]]) -> str:
    items = []
    for label, href in trail:
        items.append(f'<li><a href="{href}">{esc(label)}</a></li>' if href
                     else f'<li><span aria-current="page">{esc(label)}</span></li>')
    return ('<nav class="crumbs" aria-label="Breadcrumb">\n    <ol>\n      '
            + "\n      ".join(items) + "\n    </ol>\n  </nav>")


def breadcrumb_ld(trail: list[tuple[str, str]]) -> dict:
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u}
        for i, (n, u) in enumerate(trail)]}


def local_business_ld(business: dict) -> dict:
    """Only fields the business actually supplied.

    Nothing is inferred: no opening hours, no price range, no geo coordinates,
    no aggregate rating. A directory that decorates its structured data with
    guesses is publishing claims the business never made.
    """
    node = {
        "@type": "LocalBusiness",
        "@id": f"{SITE}/marketplace/{business['slug']}.html#business",
        "name": business["name"],
        "description": business["description"],
        "address": {"@type": "PostalAddress",
                    "streetAddress": business["location"],
                    "addressLocality": "Masinloc",
                    "addressRegion": "Zambales",
                    "addressCountry": "PH"},
        "url": f"{SITE}/marketplace/{business['slug']}.html",
    }
    if business.get("contactDigits"):
        node["telephone"] = business["contactDigits"]
    if business.get("facebook"):
        node["sameAs"] = [business["facebook"]]
    return node


def card(business: dict) -> str:
    """One business, as it appears in the directory.

    No image is not a broken image. A business whose logo the site cannot serve
    gets a text-led card carrying its initial, which is the same treatment
    Discover gives an article with no artwork.
    """
    href = f"marketplace/{business['slug']}.html"
    label = LABEL[business["category"]]
    if business.get("image"):
        media = (f'<span class="mk-card-media">'
                 f'<img src="{esc(business["image"])}" alt="{esc(business["name"])} logo" '
                 f'loading="lazy" decoding="async"></span>')
        variant = ""
    else:
        media = f'<span class="mk-card-mark" aria-hidden="true">{esc(business["name"][:1])}</span>'
        variant = " mk-card-text"

    return (
        f'<li class="mk-card{variant}" data-category="{esc(business["category"])}" '
        f'data-search="{esc(" ".join([business["name"], label, business["location"], business.get("barangay", ""), business["description"]]).lower())}">'
        f'<a href="{href}">'
        f'{media}'
        f'<span class="mk-card-body">'
        f'<span class="mk-card-cat">{esc(label)}</span>'
        f'<span class="mk-card-name">{esc(business["name"])}</span>'
        f'<span class="mk-card-loc">{esc(business["location"])}</span>'
        f'<span class="mk-card-desc">{esc(business["description"])}</span>'
        f'<span class="mk-card-cta">View business</span>'
        f'</span></a></li>')


def hub_page() -> str:
    url = f"{SITE}/marketplace.html"
    used = [c for c in CATEGORIES if any(b["category"] == c["id"] for b in BUSINESSES)]

    title = "Marketplace | Local businesses in Masinloc, Zambales"
    description = ("A directory of businesses in Masinloc, Zambales — food, services and "
                   "local enterprises, with the details you need to contact them directly.")

    graph = [
        breadcrumb_ld([("Masinloc, Zambales", f"{SITE}/"), ("Marketplace", url)]),
        {"@type": "CollectionPage", "@id": f"{url}#directory", "name": "Masinloc Connect Marketplace",
         "description": description, "url": url, "inLanguage": "en-PH",
         "about": {"@type": "Place", "name": "Masinloc, Zambales, Philippines"},
         "mainEntity": {"@type": "ItemList", "numberOfItems": len(BUSINESSES),
                        "itemListElement": [
                            {"@type": "ListItem", "position": i + 1,
                             "url": f"{SITE}/marketplace/{b['slug']}.html", "name": b["name"]}
                            for i, b in enumerate(BUSINESSES)]}},
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)

    filters = "".join(
        f'<button type="button" class="mk-chip" data-filter="{esc(c["id"])}">{esc(c["label"])}</button>'
        for c in used)

    cards = "\n      ".join(card(b) for b in BUSINESSES)
    count = len(BUSINESSES)
    noun = "business" if count == 1 else "businesses"

    # A three-column grid holding two cards reads as a column that failed to
    # load rather than as a directory with two entries in it. While the
    # directory is small the grid narrows to match, so the row is full and the
    # cards keep a sensible width. The class disappears on its own at three.
    few = " mk-grid-few" if count < 3 else ""

    return f"""{head(title=title, description=description, url=url, depth=0, ld=ld)}
{nav(0)}
<main id="main">
  {crumbs([("Masinloc, Zambales", "index.html"), ("Marketplace", None)])}

  <section class="mk-hero">
    <p class="section-label">Masinloc Connect</p>
    <h1>Local businesses. Easy to find.</h1>
    <p class="mk-lead">Businesses, food, services and local enterprises across Masinloc —
      listed by the people who run them, with the details you need to get in touch.</p>

    <div class="mk-search">
      <label class="visually-hidden" for="mkSearch">Search businesses</label>
      <input id="mkSearch" type="search" autocomplete="off"
             placeholder="Search by name, category or barangay">
    </div>

    <div class="mk-filters" role="group" aria-label="Filter by category">
      <button type="button" class="mk-chip is-on" data-filter="all">All</button>
      {filters}
    </div>
  </section>

  <section class="mk-results" aria-labelledby="mkResultsTitle">
    <h2 id="mkResultsTitle" class="visually-hidden">Businesses</h2>
    <p class="mk-count" id="mkCount" role="status">{count} {noun}</p>
    <ul class="mk-grid{few}" id="mkGrid">
      {cards}
    </ul>
    <p class="mk-empty" id="mkEmpty" hidden>No businesses found. Try another name, category, or location.</p>
  </section>

  <section class="mk-submit">
    <h2>Own a business in Masinloc?</h2>
    <p>Add your business to Masinloc Connect. Listings are reviewed before they appear here,
      and only the details you choose to publish are shown.</p>
    <a class="mk-submit-cta" href="connect.html">Submit your business</a>
  </section>
</main>
{footer(0)}
<script src="site.js?v=20260820-2"></script>
<script src="marketplace.js?v=20260824-1"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


def detail_page(business: dict) -> str:
    slug = business["slug"]
    url = f"{SITE}/marketplace/{slug}.html"
    label = LABEL[business["category"]]

    title = f"{business['name']} | Masinloc Marketplace"
    description = business["description"][:300]

    graph = [
        breadcrumb_ld([("Masinloc, Zambales", f"{SITE}/"),
                       ("Marketplace", f"{SITE}/marketplace.html"),
                       (business["name"], url)]),
        local_business_ld(business),
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)

    if business.get("image"):
        media = (f'<figure class="mk-detail-media"><img src="../{esc(business["image"])}" '
                 f'alt="{esc(business["name"])} logo" decoding="async"></figure>')
    else:
        media = f'<p class="mk-detail-mark" aria-hidden="true">{esc(business["name"][:1])}</p>'

    # Every row here is conditional. An absent field produces no row at all —
    # never an empty one and never a placeholder.
    rows = [f'<div class="mk-fact"><dt>Category</dt><dd>{esc(label)}</dd></div>',
            f'<div class="mk-fact"><dt>Location</dt><dd>{esc(business["location"])}</dd></div>']
    if business.get("contact"):
        tel = business.get("contactDigits") or re.sub(r"\D", "", business["contact"])
        rows.append(f'<div class="mk-fact"><dt>Contact</dt>'
                    f'<dd><a href="tel:{esc(tel)}">{esc(business["contact"])}</a></dd></div>')
    if business.get("facebook"):
        rows.append(f'<div class="mk-fact"><dt>Facebook</dt>'
                    f'<dd><a href="{esc(business["facebook"])}" rel="noopener nofollow" '
                    f'target="_blank">{esc(business["name"])} on Facebook</a></dd></div>')

    cta = ""
    if business.get("contact"):
        tel = business.get("contactDigits") or re.sub(r"\D", "", business["contact"])
        cta = (f'<a class="mk-detail-cta" href="tel:{esc(tel)}">Call {esc(business["name"])}</a>')

    return f"""{head(title=title, description=description, url=url, depth=1, ld=ld)}
{nav(1)}
<main id="main">
  {crumbs([("Masinloc, Zambales", "../index.html"),
           ("Marketplace", "../marketplace.html"),
           (business["name"], None)])}

  <article class="mk-detail">
    <header class="mk-detail-head">
      {media}
      <p class="section-label">{esc(label)}</p>
      <h1>{esc(business["name"])}</h1>
      <p class="mk-detail-desc">{esc(business["description"])}</p>
      {cta}
    </header>

    <dl class="mk-facts">
      {chr(10).join("      " + r for r in rows).strip()}
    </dl>

    <p class="mk-back"><a href="../marketplace.html">Back to the Marketplace</a></p>
  </article>
</main>
{footer(1)}
<script src="../site.js?v=20260820-2"></script>
<script type="application/ld+json">
{ld}
</script>
</body>
</html>
"""


def main() -> int:
    problems = validate()
    if problems:
        print("MARKETPLACE BUILD FAILED")
        for problem in problems:
            print(f"- {problem}")
        return 1

    OUT_DIR.mkdir(exist_ok=True)
    HUB.write_text(hub_page(), encoding="utf-8")
    for business in BUSINESSES:
        (OUT_DIR / f"{business['slug']}.html").write_text(detail_page(business), encoding="utf-8")

    used = {b["category"] for b in BUSINESSES}
    print(f"marketplace.html + {len(BUSINESSES)} business page(s)")
    print(f"categories with businesses: {', '.join(sorted(LABEL[c] for c in used))}")
    print(f"categories shown: only those {len(used)}, not all {len(CATEGORIES)}")
    without = [b["name"] for b in BUSINESSES if not b.get("image")]
    if without:
        print(f"no image available for: {', '.join(without)} — text-led cards used")
    return 0


if __name__ == "__main__":
    sys.exit(main())
