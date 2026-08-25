#!/usr/bin/env python3
"""Build the Masinloc municipal leadership record from the approved portraits.

Two jobs, and the first one is the reason this is a script rather than a page.

1. IDENTICAL PORTRAIT TREATMENT. Every portrait is cropped to the same
   aspect ratio, resized through the same width ladder, and encoded at the
   same quality — from one code path, with no per-person parameters beyond a
   vertical focus point used only where a source's own ratio differs. There is
   no way to make one leader's portrait larger, sharper or better framed than
   another's without changing it for all of them, which is exactly the
   guarantee this section has to make.

2. GENERATION. leadership.html is rendered from data/leadership.json. Names
   and offices exist in one place, so a title cannot drift between the visible
   page and the structured data.

Nothing is upscaled: a source narrower than a ladder step simply stops there,
and the guard in scripts/check-leadership.py checks that the ladder each
leader actually got is the same one, or explains itself when a source is
smaller.

Usage
-----
    python3 scripts/build-leadership.py [folder-with-originals]

The originals are not committed. Re-running without the folder rebuilds the
page from the derivatives already in assets/leadership/.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "leadership.json"
OUT = ROOT / "assets" / "leadership"
SITE = "https://www.masinloc-zambales.com"

# Every portrait is shown at 4:5. Four of the five originals are already very
# close to it; the fifth is cropped to match rather than being shown at a
# different shape from everyone else.
RATIO_W, RATIO_H = 4, 5

# The card is capped at 460 CSS px, so 920 covers a 2x screen. Nothing above
# that would ever be displayed, and no source is much wider than it anyway.
WIDTHS = [320, 460, 640, 920]

# These are painted portraits: the canvas texture is high-frequency noise that
# costs a great deal to encode and that nobody is reading. Dropping quality
# until the brushwork stays and the file halves was checked against the faces
# at 1:1, not guessed. One setting for everyone — a per-person quality knob is
# exactly the kind of favouritism this section must not be able to express.
QUALITY = {"avif": 45, "webp": 74, "jpg": 80}

LEADERSHIP = json.loads(DATA.read_text(encoding="utf-8"))
PAGE = LEADERSHIP["page"]
SECTIONS = LEADERSHIP["sections"]
WOMEN = LEADERSHIP["womenInLeadership"]


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


# --- portraits ----------------------------------------------------------------

def crop_to_ratio(image, focus_y: float):
    """Centre-crop to 4:5, biased vertically by focus_y (0 top, 1 bottom).

    Only ever removes pixels. A source already at the target ratio comes back
    untouched, so re-running is not lossy.
    """
    width, height = image.size
    target_height = round(width * RATIO_H / RATIO_W)
    if target_height <= height:
        spare = height - target_height
        top = round(spare * focus_y)
        return image.crop((0, top, width, top + target_height))
    target_width = round(height * RATIO_W / RATIO_H)
    spare = width - target_width
    left = round(spare / 2)
    return image.crop((left, 0, left + target_width, height))


def build_portraits(originals: Path) -> dict[str, list[int]]:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit("Pillow is required to process portraits: pip install Pillow")

    OUT.mkdir(parents=True, exist_ok=True)
    produced: dict[str, list[int]] = {}

    for leader in LEADERSHIP["leaders"]:
        source = originals / leader["source"]
        if not source.is_file():
            sys.exit(f"missing original: {source}")

        with Image.open(source) as opened:
            image = opened.convert("RGB")
            framed = crop_to_ratio(image, leader.get("focusY", 0.5))
            widths = [w for w in WIDTHS if w <= framed.width]
            if not widths:
                sys.exit(f"{leader['slug']}: source is narrower than {WIDTHS[0]}px")

            for width in widths:
                height = round(width * RATIO_H / RATIO_W)
                resized = framed.resize((width, height), Image.LANCZOS)
                stem = OUT / f"{leader['slug']}-{width}"
                resized.save(stem.with_suffix(".jpg"), "JPEG",
                             quality=QUALITY["jpg"], optimize=True, progressive=True)
                resized.save(stem.with_suffix(".webp"), "WEBP", quality=QUALITY["webp"])
                try:
                    resized.save(stem.with_suffix(".avif"), "AVIF", quality=QUALITY["avif"])
                except (KeyError, OSError, ValueError):
                    # Pillow without AVIF support. The <picture> still works:
                    # the browser falls through to WebP and then JPEG.
                    pass

        produced[leader["slug"]] = widths
        print(f"  {leader['slug']:<24} {framed.width}x{framed.height} -> {widths}")

    return produced


def available_widths(slug: str) -> list[int]:
    """The widths actually on disk, so the page never links a missing file."""
    return sorted(w for w in WIDTHS if (OUT / f"{slug}-{w}.jpg").is_file())


# --- page ---------------------------------------------------------------------

def picture(leader: dict, widths: list[int], eager: bool) -> str:
    slug = leader["slug"]
    # One card is never wider than 460 CSS px, and is full-width on a phone.
    sizes = "(min-width:760px) 460px, 92vw"
    largest = widths[-1]

    def srcset(ext: str) -> str:
        return ", ".join(f"assets/leadership/{slug}-{w}.{ext} {w}w" for w in widths)

    sources = ""
    if (OUT / f"{slug}-{largest}.avif").is_file():
        sources += (f'<source type="image/avif" srcset="{srcset("avif")}" '
                    f'sizes="{sizes}">')
    sources += f'<source type="image/webp" srcset="{srcset("webp")}" sizes="{sizes}">'

    loading = 'fetchpriority="high"' if eager else 'loading="lazy"'
    return (f'<picture>{sources}'
            f'<img src="assets/leadership/{slug}-{largest}.jpg" '
            f'srcset="{srcset("jpg")}" sizes="{sizes}" '
            f'width="{RATIO_W * 100}" height="{RATIO_H * 100}" '
            f'alt="{esc(leader["alt"])}" {loading} decoding="async">'
            f'</picture>')


def card(leader: dict, eager: bool = False) -> str:
    """The one card component. Every leader gets this, unchanged.

    The current-office indicator is the single difference, and it is a small
    text marker inside the same card — never a different size, frame or
    treatment. Read by a screen reader it is a word, not a colour.
    """
    widths = available_widths(leader["slug"])
    if not widths:
        sys.exit(f"{leader['slug']}: no portrait derivatives found in {OUT}. "
                 f"Run: python3 scripts/build-leadership.py <folder-with-originals>")

    badge = ""
    if leader["status"] == "current":
        badge = (f'<span class="leader-now">'
                 f'{esc(LEADERSHIP["currentBadge"])}</span>')

    return f"""        <li class="leader">
          <figure>
            <div class="leader-frame">{picture(leader, widths, eager)}</div>
            <figcaption>
              <h3 class="leader-name">{esc(leader['name'])}</h3>
              <p class="leader-office">{esc(leader['office'])}{badge}</p>
            </figcaption>
          </figure>
        </li>"""


def page() -> str:
    url = f"{SITE}/leadership.html"
    current = [l for l in LEADERSHIP["leaders"] if l["status"] == "current"]
    former = [l for l in LEADERSHIP["leaders"] if l["status"] == "former"]
    if len(current) != 1:
        sys.exit(f"expected exactly one current mayor, found {len(current)}")

    women = "".join(f"<li>{esc(name)}</li>" for name in WOMEN["recognises"])

    # Structured data names the office holders and nothing else. No terms, no
    # employer relationship: this site does not speak for the municipality.
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "A Closer Look", "item": f"{SITE}/a-closer-look.html"},
                    {"@type": "ListItem", "position": 3, "name": "Municipal Leadership", "item": url},
                ],
            },
            {
                "@type": "WebPage",
                "@id": f"{url}#webpage",
                "url": url,
                "name": "Municipal Leadership",
                "description": PAGE["description"],
                "isPartOf": {"@id": f"{SITE}/#website"},
                "about": {"@id": f"{SITE}/#place"},
                "inLanguage": "en-PH",
            },
            {
                "@type": "ItemList",
                "name": "Municipal Mayors of Masinloc, Zambales",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": index + 1,
                        "item": {
                            "@type": "Person",
                            "name": leader["name"],
                            "jobTitle": leader["office"],
                            "image": f"{SITE}/assets/leadership/{leader['slug']}-{available_widths(leader['slug'])[-1]}.jpg",
                        },
                    }
                    for index, leader in enumerate(LEADERSHIP["leaders"])
                ],
            },
        ],
    }
    jsonld = ('<script type="application/ld+json">\n'
              + json.dumps(graph, indent=2, ensure_ascii=False) + "\n</script>\n")

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(PAGE['metaTitle'])}</title>
<meta name="description" content="{esc(PAGE['description'])}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{esc(PAGE['metaTitle'])}">
<meta property="og:description" content="{esc(PAGE['description'])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<meta property="og:image:alt" content="Masinloc, Zambales from the air">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(PAGE['metaTitle'])}">
<meta name="twitter:description" content="{esc(PAGE['description'])}">
<meta name="twitter:image" content="{SITE}/assets/stage1/masinloc-hero.avif">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="tokens.css?v=20260823-1">
<link rel="stylesheet" href="site.css?v=20260825-2">
<link rel="stylesheet" href="site-polish.css?v=20260825-2">
<link rel="stylesheet" href="site-stability.css?v=20260825-1">
<link rel="stylesheet" href="leadership.css?v=20260825-1">
</head>
<body class="about-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="marketplace.html">Marketplace</a>
    <a class="active" href="a-closer-look.html" aria-current="page">A Closer Look</a>
    <a class="connect-link" href="connect.html">Masinloc Connect</a>
    <a href="contact.html">Contact</a>
  </nav>
</header>

<main id="main">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="index.html">Masinloc, Zambales</a></li>
      <li><a href="a-closer-look.html">A Closer Look</a></li>
      <li><span aria-current="page">Municipal Leadership</span></li>
    </ol>
  </nav>

  <section class="lead-hero">
    <p class="section-label">{esc(PAGE['eyebrow'])}</p>
    <h1>{esc(PAGE['title'])}</h1>
    <p class="lead">{esc(PAGE['lead'])}</p>
  </section>

  <section class="lead-group" aria-labelledby="currentTitle">
    <div class="group-head">
      <h2 id="currentTitle">{esc(SECTIONS['current']['heading'])}</h2>
      <p>{esc(SECTIONS['current']['blurb'])}</p>
    </div>
    <ol class="leader-grid is-single">
{card(current[0], eager=True)}
    </ol>
  </section>

  <section class="lead-group" aria-labelledby="formerTitle">
    <div class="group-head">
      <h2 id="formerTitle">{esc(SECTIONS['former']['heading'])}</h2>
      <p>{esc(SECTIONS['former']['blurb'])}</p>
    </div>
    <ol class="leader-grid">
{chr(10).join(card(l) for l in former)}
    </ol>
  </section>

  <section class="women-lead" aria-labelledby="womenTitle">
    <div class="women-inner">
      <h2 id="womenTitle">{esc(WOMEN['heading'])}</h2>
      <p class="women-fact">{esc(WOMEN['fact'])}</p>
      <p class="women-note">{esc(WOMEN['note'])}</p>
      <ul class="women-names">{women}</ul>
    </div>
  </section>

  <p class="lead-provenance">{esc(PAGE['provenance'])} <a href="a-closer-look.html">How this record is kept</a>.</p>
</main>

<footer class="home-footer">
  <div class="footer-brand"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="marketplace.html">Marketplace</a><a href="a-closer-look.html">A Closer Look</a><a href="leadership.html">Municipal Leadership</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="connect.html">Masinloc Connect</a><a href="contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
{jsonld}<script src="site.js?v=20260825-1"></script>
<script src="leadership.js?v=20260822-1"></script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("originals", nargs="?",
                        help="folder holding the approved portrait originals")
    args = parser.parse_args()

    if args.originals:
        print("portraits (identical crop, ladder and quality for everyone):")
        build_portraits(Path(args.originals))

    (ROOT / "leadership.html").write_text(page(), encoding="utf-8")

    leaders = LEADERSHIP["leaders"]
    print(f"built leadership.html: 1 current mayor, {len(leaders) - 1} former, "
          f"all at {RATIO_W}:{RATIO_H}")
    for leader in leaders:
        print(f"  {leader['name']:<28} {leader['office']:<24} "
              f"{available_widths(leader['slug'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
