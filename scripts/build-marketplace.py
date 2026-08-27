#!/usr/bin/env python3
"""Build the Masinloc Connect Marketplace from data/marketplace.json.

WHAT THIS IS

A public directory of approved Masinloc businesses. Somebody arrives wanting a
coffee or a caterer, finds the business, and calls it. That is the whole
product. There is no cart, no checkout, no ratings, no seller dashboard and no
inventory, because none of those help with that.

WHAT IT REFUSES TO PRINT

No phone numbers. Not the owner's, and not the business contact number either.
The submission form collects both, and both stay in the submissions table where
only the admin console can see them; the public contact method is Facebook.

The numbers are not held in this repository at all — not in the data file, not
in a key prefixed to mark it private, not commented out. That is the point. A
field that does not exist cannot be rendered into a page, a data attribute, a
script object or a JSON-LD block by a future edit that forgets why it mattered.
The same is true of owner_name, owner_email, reference codes, submission ids,
moderation status and dashboard-interest flags.

That is enforced rather than trusted, in three ways. PUBLIC_FIELDS is the whole
list of keys a business may carry, so an unexpected key fails the build.
FORBIDDEN names the private ones explicitly, so re-adding `contact` is a build
failure and not a silent regression. And every string value is checked against
the shape of a Philippine mobile number, so one pasted into a description is
caught too.

scripts/check-marketplace-privacy.py then re-checks the built pages, because
the data being clean and the pages being clean are different claims.

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
SITE = "https://www.masinloc-zambales.com"

# The only keys a business may carry. Anything else is either private data that
# has no business being in a public file, or a typo that would silently not
# render. Both should stop the build.
PUBLIC_FIELDS = {
    "slug", "name", "category", "location", "barangay", "description",
    "descriptor", "schemaType", "metaDescription", "image", "facebook",
    "context",
}
# Keys that would mean a raw submission row had been pasted in — or that a
# phone number had found its way back. Both businesses submitted a mobile
# number and neither is published; Facebook is the public contact method. The
# numbers are not held anywhere in this repository, because a field that does
# not exist cannot leak into a page, a data attribute or a JSON-LD block.
FORBIDDEN = {
    "owner_name", "owner_email", "owner_phone", "ownerName", "ownerEmail",
    "ownerPhone", "reference_code", "referenceCode", "id", "status",
    "dashboard_interest", "dashboard_interest_at", "internal_notes", "notes",
    "brand_logo_path",
    "contact", "contactDigits", "contact_number", "contactNumber",
    "phone", "telephone", "mobile",
}

# schema.org subtypes a business may claim. Each is a real type on the
# LocalBusiness branch, and each has to be defensible from what the business
# actually said it does — a coffee shop may be a CafeOrCoffeeShop; nothing here
# may claim a Restaurant or a Hotel on a hunch.
SCHEMA_TYPES = {
    "LocalBusiness", "FoodEstablishment", "CafeOrCoffeeShop", "Bakery",
    "Restaurant", "Store", "HealthAndBeautyBusiness", "ProfessionalService",
    "LodgingBusiness", "TouristAttraction",
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

        subtype = business.get("schemaType")
        if subtype is not None and subtype not in SCHEMA_TYPES:
            problems.append(f"{name}: schemaType {subtype!r} is not an allowed schema.org subtype")

        # A phone number reaching a public page is the failure this whole file
        # is arranged to prevent, so it is checked by shape as well as by key
        # name. A number pasted into a description would pass the key check.
        for key, value in business.items():
            if isinstance(value, str) and re.search(r"(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}", value):
                problems.append(
                    f"{name}: {key} contains what looks like a mobile number. "
                    f"The Marketplace publishes no phone numbers.")
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
    {item(f"{up}discover/index.html", "Discover")}
    {item(f"{up}sambal-tina.html", "Sambal Tina")}
    {item(f"{up}marketplace.html", "Marketplace")}
    {item(f"{up}a-closer-look.html", "About Masinloc")}
    {item(f"{up}connect.html", "Masinloc Connect", "connect-link")}
  </nav>
</header>"""


def footer(depth: int) -> str:
    up = "../" if depth else ""
    return f"""<footer class="home-footer">
  <div class="footer-brand"><img src="{up}assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="{up}index.html">Home</a><a href="{up}discover/index.html">Discover</a><a href="{up}sambal-tina.html">Sambal Tina</a><a href="{up}marketplace.html">Marketplace</a><a href="{up}a-closer-look.html">About Masinloc</a><a href="{up}connect.html">Masinloc Connect</a><a href="{up}verified-history.html">Verified History</a><a href="{up}masinloc-bulletin.html">Masinloc Bulletin</a><a href="{up}sources.html">Sources &amp; References</a><a href="{up}contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>"""


def head(*, title: str, description: str, url: str, depth: int, ld: str,
         image: str | None = None) -> str:
    up = "../" if depth else ""
    # A business with a logo shares its own mark rather than the town hero.
    og_image = image or f"{SITE}/assets/stage1/masinloc-hero.avif"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Discover Masinloc">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{og_image}">
<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{up}assets/apple-touch-icon.png">
<link rel="stylesheet" href="{up}tokens.css?v=20260823-1">
<link rel="stylesheet" href="{up}site.css?v=20260825-2">
<link rel="stylesheet" href="{up}site-polish.css?v=20260825-2">
<link rel="stylesheet" href="{up}marketplace.css?v=20260827-1">
<link rel="stylesheet" href="{up}site-stability.css?v=20260825-1">
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
    no aggregate rating, no menu, no served cuisine, no awards. A directory
    that decorates its structured data with guesses is publishing claims the
    business never made, and structured data is the easiest place to do that
    because nobody reads it.

    NO TELEPHONE. Neither business's number is published anywhere on this site,
    and JSON-LD is machine-readable text in the page source like any other — a
    number here would be as public as one printed on the page, and more likely
    to be missed in review.

    The subtype comes from the data rather than being guessed here. A coffee
    shop that says it sells coffee may be a CafeOrCoffeeShop; a caterer is a
    FoodEstablishment, which is true of anyone who prepares food for people,
    rather than a Restaurant, which would assert premises they never claimed.

    `containedInPlace` is the entity link that matters for a directory like
    this: it ties each business to Masinloc as a place, which is the context
    somebody searching "coffee shop Masinloc" is actually using.
    """
    url = f"{SITE}/marketplace/{business['slug']}.html"
    node = {
        "@type": business.get("schemaType", "LocalBusiness"),
        "@id": f"{url}#business",
        "name": business["name"],
        "description": business["description"],
        "address": {"@type": "PostalAddress",
                    "streetAddress": business["location"],
                    "addressLocality": "Masinloc",
                    "addressRegion": "Zambales",
                    "addressCountry": "PH"},
        "areaServed": {"@type": "Place", "name": "Masinloc, Zambales, Philippines"},
        "containedInPlace": {"@type": "Place", "name": "Masinloc, Zambales, Philippines"},
        "url": url,
        "isPartOf": {"@id": f"{SITE}/marketplace.html#directory"},
    }
    # A share link is still a link to the business's own Facebook, so it
    # identifies them. It is not a canonical Page URL and is not described as
    # one anywhere; rewriting it into a tidier form would invent an address.
    if business.get("facebook"):
        node["sameAs"] = [business["facebook"]]
    return node


LOGOS_MANIFEST = ROOT / "data" / "marketplace-logos.json"
LOGOS = (json.loads(LOGOS_MANIFEST.read_text(encoding="utf-8"))
         if LOGOS_MANIFEST.is_file() else {})


def logo(slug: str, *, sizes: str, eager: bool = False) -> str:
    """A business's logo, at whatever widths were actually built.

    Returns "" when there is no logo, which is the normal case rather than an
    error: a business whose artwork has not been supplied, or whose artwork is
    held back, gets the letterform card instead. Nothing here ever emits a
    frame it cannot fill.

    The mark is never cropped. It keeps its own square and its own ground,
    because a logo is finished artwork and trimming it produces a mark the
    business did not design.
    """
    entry = LOGOS.get(slug)
    if not entry or not entry.get("widths"):
        return ""

    widths = entry["widths"]
    largest = widths[-1]
    native = entry["native"]

    def srcset(ext: str) -> str:
        return ", ".join(f"../assets/marketplace/{slug}-{w}.{ext} {w}w" for w in widths)

    loading = ('fetchpriority="high" decoding="async"' if eager
               else 'loading="lazy" decoding="async"')
    return (
        f'<picture>'
        f'<source type="image/avif" sizes="{sizes}" srcset="{srcset("avif")}">'
        f'<source type="image/webp" sizes="{sizes}" srcset="{srcset("webp")}">'
        f'<img src="../assets/marketplace/{slug}-{largest}.jpg" sizes="{sizes}" '
        f'srcset="{srcset("jpg")}" width="{native["width"]}" height="{native["height"]}" '
        f'alt="{esc(entry["alt"])}" {loading}>'
        f'</picture>')


def context_block(business: dict) -> str:
    """Where this business sits in Masinloc, in a sentence and a link or two.

    This exists for a reader first. Somebody who has just found a coffee stall
    reasonably wonders where the Baywalk is, and the site has a page about it.
    That the same link also tells a search engine this page belongs to a body
    of Masinloc content is a consequence of the link being real, not the reason
    for it — which is why there is exactly one, chosen per business, pointing
    at the place its own submitted address names. A block of assorted links to
    unrelated pages would help nobody and would be obvious.
    """
    links = business.get("context") or []
    items = "".join(
        f'<li><a href="{esc(link["href"])}">{esc(link["label"])}</a></li>'
        for link in links)
    return f"""    <section class="mk-context" aria-labelledby="mkContextTitle">
      <h2 id="mkContextTitle">In Masinloc</h2>
      <p>{esc(business["name"])} is listed in the Masinloc Connect Marketplace, a
        directory of businesses in the municipality of Masinloc, Zambales. Listings
        are reviewed before they appear, and show only the details a business
        chose to publish.</p>
      {f'<ul class="mk-context-links">{items}</ul>' if items else ''}
    </section>

"""


def initials(name: str) -> str:
    """Two letters at most, from the words that carry the name.

    "Adaler's Grazing Delights" gives AG, not AGD: three letters start to read
    as an acronym the business does not use. Punctuation and the possessive are
    ignored, so the letters come from the words a person would say.
    """
    words = [w for w in re.split(r"[^A-Za-z]+", name) if w]
    return "".join(w[0] for w in words[:2]).upper() or name[:1].upper()


def row(business: dict) -> str:
    """One business, as a directory entry rather than a product card.

    The composition is horizontal and reads the way somebody scans a printed
    directory: the mark first, then who and where, then what they actually do.

      LOGO  |  NAME / CATEGORY / LOCATION  |  DESCRIPTION

    The logo is the largest thing in the row by a wide margin, and it is not
    put in a circle, a pill or an avatar chip — it sits on the page with room
    around it, at its own proportions. A business that has gone to the trouble
    of having a mark drawn should have it treated as a mark.

    Where there is no logo the placeholder is the initials set in the editorial
    face, with no container. Restrained on purpose: it should read as a
    considered absence, not as a broken image or an invented monogram.

    Location renders only when there is one. Category and location are joined
    by a middot rather than stacked, because at a glance they answer one
    question together — what they are and where.
    """
    href = f"marketplace/{business['slug']}.html"
    label = LABEL[business["category"]]
    location = business.get("location")

    # The logo box is 168px at desktop and 132px on a phone; a 320 or 480 wide
    # derivative covers both at 2x.
    mark = logo(business["slug"], sizes="(max-width: 720px) 132px, 168px")
    if mark:
        media = f'<span class="mk-logo">{mark.replace("../assets/", "assets/")}</span>'
    else:
        # The initials ride in an attribute and are drawn by CSS, not written
        # as a text node. As text they sat immediately before the business
        # name in the DOM, so anything reading the document rather than the
        # rendered page — crawlers, previews, plain-text extraction — read
        # "ZZamgyup 199". aria-hidden already handled screen readers; this
        # handles everything that never looks at aria.
        media = (f'<span class="mk-logo mk-logo-none" aria-hidden="true" '
                 f'data-mono="{esc(initials(business["name"]))}"></span>')

    meta = f'<span class="mk-meta-cat">{esc(label)}</span>'
    if location:
        meta += f'<span class="mk-meta-loc">{esc(location)}</span>'

    haystack = " ".join([business["name"], label, location or "",
                         business.get("barangay", ""), business["description"]]).lower()

    return (
        f'<li class="mk-item" data-category="{esc(business["category"])}" '
        f'data-search="{esc(haystack)}">'
        f'<a href="{href}">'
        f'{media}'
        f'<span class="mk-ident">'
        f'<span class="mk-name">{esc(business["name"])}</span>'
        f'<span class="mk-meta">{meta}</span>'
        f'</span>'
        f'<span class="mk-about">'
        f'<span class="mk-desc">{esc(business["description"])}</span>'
        f'<span class="mk-more">View business</span>'
        f'</span>'
        f'</a></li>')


def hub_page() -> str:
    url = f"{SITE}/marketplace.html"
    used = [c for c in CATEGORIES if any(b["category"] == c["id"] for b in BUSINESSES)]

    title = "Local Businesses in Masinloc, Zambales | Marketplace"
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

    rows = "\n      ".join(row(b) for b in BUSINESSES)
    count = len(BUSINESSES)
    noun = "business" if count == 1 else "businesses"

    return f"""{head(title=title, description=description, url=url, depth=0, ld=ld)}
{nav(0)}
<main id="main">
  {crumbs([("Masinloc, Zambales", "index.html"), ("Marketplace", None)])}

  <section class="mk-hero">
    <p class="section-label">Marketplace</p>
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
    <ul class="mk-list" id="mkGrid">
      {rows}
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
<script src="site.js?v=20260825-1"></script>
<script src="marketplace.js?v=20260825-1"></script>
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

    # Name, what it is, where it is, and whose directory it is on — in that
    # order, because that is the order of usefulness to somebody reading a
    # result. Somebody searching "coffee shop Masinloc" and somebody searching
    # "Diwan Coffee" are both served by the same honest sentence, and neither
    # needs the town repeated three times to find it.
    #
    # The brand segment is dropped when the title would overrun. A search
    # result truncates around sixty-five characters, and with all four segments
    # "Adaler's Grazing Delights | Catering in Masinloc, Zambales | Masinloc
    # Connect" is seventy-seven — so the part that would actually be cut is
    # "Masinloc Connect", the one segment that is pure brand. Losing it in the
    # title costs nothing: it is still the og:site_name, the breadcrumb, the
    # navigation and the sentence under the facts. Losing "in Masinloc,
    # Zambales" to a truncated tail would cost the search this page is for.
    descriptor = business.get("descriptor")
    stem = (f"{business['name']} | {descriptor} in Masinloc, Zambales" if descriptor
            else f"{business['name']} | Masinloc, Zambales")
    with_brand = f"{stem} | Masinloc Connect"
    title = with_brand if len(with_brand) <= 65 else stem
    description = business.get("metaDescription") or business["description"][:300]

    graph = [
        breadcrumb_ld([("Masinloc, Zambales", f"{SITE}/"),
                       ("Marketplace", f"{SITE}/marketplace.html"),
                       (business["name"], url)]),
        local_business_ld(business),
    ]
    ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)

    mark = logo(slug, sizes="(max-width: 720px) 150px, 200px", eager=True)
    media = (f'<figure class="mk-detail-media">{mark}</figure>' if mark
             else f'<p class="mk-detail-mark" aria-hidden="true">{esc(initials(business["name"]))}</p>')

    # Every row here is conditional. An absent field produces no row at all —
    # never an empty one and never a placeholder. There is no Contact row: the
    # only contact method published is Facebook, below.
    rows = [f'<div class="mk-fact"><dt>Category</dt><dd>{esc(label)}</dd></div>',
            f'<div class="mk-fact"><dt>Location</dt>'
            f'<dd>{esc(business["location"])}</dd></div>']
    if business.get("facebook"):
        rows.append(f'<div class="mk-fact"><dt>Contact</dt>'
                    f'<dd><a href="{esc(business["facebook"])}" rel="noopener nofollow" '
                    f'target="_blank">Message {esc(business["name"])} on Facebook</a></dd></div>')

    cta = ""
    if business.get("facebook"):
        cta = (f'<a class="mk-detail-cta" href="{esc(business["facebook"])}" '
               f'rel="noopener nofollow" target="_blank">Message on Facebook</a>')

    og_logo = (f"{SITE}/assets/marketplace/{slug}-{LOGOS[slug]['widths'][-1]}.jpg"
           if LOGOS.get(slug, {}).get("widths") else None)

    return f"""{head(title=title, description=description, url=url, depth=1, ld=ld, image=og_logo)}
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

{context_block(business)}
    <p class="mk-back"><a href="../marketplace.html">Back to the Marketplace</a></p>
  </article>
</main>
{footer(1)}
<script src="../site.js?v=20260825-1"></script>
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
    with_logo = [b["name"] for b in BUSINESSES if LOGOS.get(b["slug"], {}).get("widths")]
    without = [b["name"] for b in BUSINESSES if not LOGOS.get(b["slug"], {}).get("widths")]
    if with_logo:
        print(f"logo published for: {', '.join(with_logo)}")
    if without:
        print(f"no logo published for: {', '.join(without)} — text-led cards used")
    return 0


if __name__ == "__main__":
    sys.exit(main())
