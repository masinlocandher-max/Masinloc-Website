#!/usr/bin/env python3
"""Build the Verified History hub and the founder profile.

Both pages are generated from data/history.json. That file is the compact web
claim register: it keeps the MABAYANI research facts available to the site
without copying the prose or structure of the publishable manuscript.

Usage:
    python3 scripts/build-history.py
    python3 scripts/build-history.py --check
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://www.masinloc-zambales.com"
DATA = json.loads((ROOT / "data" / "history.json").read_text(encoding="utf-8"))
SOURCES = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def source_index() -> dict[str, dict]:
    found: dict[str, dict] = {}
    for section in SOURCES["sections"]:
        for entry in section["entries"]:
            found[entry["id"]] = entry
    return found


SOURCE_BY_ID = source_index()


def verify() -> None:
    problems: list[str] = []
    founding = DATA.get("founding", {})
    founder = DATA.get("founder", {})
    binabayani = DATA.get("binabayani", {})
    timeline = DATA.get("timeline", [])
    san_vicente = DATA.get("sanVicente", {})

    if founding.get("documentedYear") != 1607:
        problems.append("documented founding year must remain 1607")
    if founding.get("misattributedYear") != 1572:
        problems.append("the corrected exploration year must remain identified as 1572")
    if founding.get("founder") != "Fray Andrés del Espíritu Santo":
        problems.append("founder name has drifted from the sourced spelling")
    if founder.get("portraitStatus") != "Portrait to be added from an approved historical source":
        problems.append("founder portrait status must prohibit an unattributed or generated image")
    if "Kristiyano and Aeta" not in binabayani.get("summary", ""):
        problems.append("Binabayani must name the represented sides as Kristiyano and Aeta")
    if "not a separate third side" not in binabayani.get("summary", ""):
        problems.append("Binabayani must say Masinloqueños are not a third side")

    joined_timeline = " ".join(
        f"{item.get('date', '')} {item.get('title', '')} {item.get('text', '')}"
        for item in timeline
    )
    for required in ("1607", "1649", "San Vicente", "1871", "2001", "2021"):
        if required not in joined_timeline:
            problems.append(f"timeline is missing required history: {required}")
    if san_vicente.get("townDate") != "21 April 1871":
        problems.append("Barrio San Vicente must retain its sourced town-separation date")
    if san_vicente.get("parishDate") != "21 June 1892":
        problems.append("Barrio San Vicente must retain its sourced parish-separation date")

    for source_id in DATA.get("sources", []):
        if source_id not in SOURCE_BY_ID:
            problems.append(f"history cites missing source id: {source_id}")

    if problems:
        raise SystemExit("HISTORY DATA CHECK FAILED\n- " + "\n- ".join(problems))


def shell_head(title: str, description: str, canonical: str, *, page_class: str,
               og_type: str = "website", extra: str = "",
               social_image: str = "/assets/discover/binabayani-festival-1672.jpg",
               social_alt: str = "Binabayani performers in Masinloc, Zambales") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{esc(canonical)}">
<meta property="og:type" content="{esc(og_type)}">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:image" content="{SITE}{esc(social_image)}">
<meta property="og:image:alt" content="{esc(social_alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}{esc(social_image)}">
{extra}<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="tokens.css?v=20260823-1">
<link rel="stylesheet" href="site.css?v=20260825-2">
<link rel="stylesheet" href="site-polish.css?v=20260825-2">
<link rel="stylesheet" href="site-stability.css?v=20260901-1">
<link rel="stylesheet" href="history.css?v=20260825-1">
</head>
<body class="about-page {esc(page_class)}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a class="active" href="discover/index.html" aria-current="page">Discover</a>
    <a href="sambal-tina.html">Sambal Tina</a>
    <a href="marketplace.html">Marketplace</a>
    <a href="a-closer-look.html">About Masinloc</a>
    <a class="connect-link" href="connect.html">Masinloc Connect</a>
  </nav>
</header>
"""


def shell_foot(jsonld: dict) -> str:
    return f"""
<footer class="home-footer">
  <div class="footer-brand"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="sambal-tina.html">Sambal Tina</a><a href="marketplace.html">Marketplace</a><a href="a-closer-look.html">About Masinloc</a><a href="connect.html">Masinloc Connect</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="sources.html">Sources &amp; References</a><a href="contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
<script type="application/ld+json">
{json.dumps(jsonld, indent=2, ensure_ascii=False)}
</script>
<script src="site.js?v=20260825-1"></script>
</body>
</html>
"""


def picture() -> str:
    alt = esc(DATA["binabayani"]["imageAlt"])
    return f"""<picture>
      <source type="image/avif" sizes="(min-width: 1180px) 1180px, 100vw" srcset="assets/discover/binabayani-festival-640.avif 640w, assets/discover/binabayani-festival-960.avif 960w, assets/discover/binabayani-festival-1280.avif 1280w, assets/discover/binabayani-festival-1672.avif 1672w">
      <source type="image/webp" sizes="(min-width: 1180px) 1180px, 100vw" srcset="assets/discover/binabayani-festival-640.webp 640w, assets/discover/binabayani-festival-960.webp 960w, assets/discover/binabayani-festival-1280.webp 1280w, assets/discover/binabayani-festival-1672.webp 1672w">
      <img src="assets/discover/binabayani-festival-1280.jpg" sizes="(min-width: 1180px) 1180px, 100vw" srcset="assets/discover/binabayani-festival-640.jpg 640w, assets/discover/binabayani-festival-960.jpg 960w, assets/discover/binabayani-festival-1280.jpg 1280w, assets/discover/binabayani-festival-1672.jpg 1672w" width="1672" height="940" alt="{alt}" loading="lazy" decoding="async">
    </picture>"""


def research_basis() -> str:
    items = []
    for source_id in DATA["sources"]:
        source = SOURCE_BY_ID[source_id]
        items.append(
            f'<li><a href="sources.html#{esc(source_id)}">{esc(source["title"])}</a>'
            f'<span>{esc(source.get("author", source.get("publication", "")))}</span></li>'
        )
    return "".join(items)


def history_page() -> str:
    founding = DATA["founding"]
    founder = DATA["founder"]
    battle = DATA["battle"]
    binabayani = DATA["binabayani"]
    san_vicente = DATA["sanVicente"]

    timeline = "".join(
        f"""<li class="history-timeline-item">
          <p class="history-date">{esc(item['date'])}</p>
          <div><h3>{esc(item['title'])}</h3><p>{esc(item['text'])}</p></div>
        </li>"""
        for item in DATA["timeline"]
    )
    facts = "".join(
        f"""<li class="history-fact">
          <p class="history-fact-number">{esc(item['number'])}</p>
          <h3>{esc(item['title'])}</h3>
          <p>{esc(item['text'])}</p>
        </li>"""
        for item in DATA["facts"]
    )
    battle_steps = "".join(
        f'<li><span>{index:02d}</span><p>{esc(step)}</p></li>'
        for index, step in enumerate(battle["steps"], start=1)
    )

    title = "Masinloc Was Founded in 1607 | Verified History"
    description = ("Masinloc's source-led history: the 1607 founding, Fray Andrés del "
                   "Espíritu Santo, the 1649 coastal battle, Barrio San Vicente, and Binabayani.")
    canonical = f"{SITE}/verified-history.html"
    head = shell_head(title, description, canonical, page_class="history-page")

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Verified History", "item": canonical},
                ],
            },
            {
                "@type": "CollectionPage",
                "@id": f"{canonical}#webpage",
                "url": canonical,
                "name": "Verified History of Masinloc, Zambales",
                "description": description,
                "inLanguage": "en-PH",
                "about": {"@id": f"{SITE}/#place"},
                "hasPart": [
                    {"@id": f"{SITE}/founder-of-masinloc.html#profile"},
                    {"@id": f"{SITE}/bulletin/1649-when-six-caracoas-came.html#article"},
                    {"@id": f"{SITE}/bulletin/what-binabayani-remembers.html#article"},
                ],
            },
        ],
    }

    body = f"""
<main id="main">
  <nav class="history-crumbs" aria-label="Breadcrumb">
    <ol><li><a href="index.html">Masinloc, Zambales</a></li><li><a href="a-closer-look.html">About Masinloc</a></li><li><span aria-current="page">Verified History</span></li></ol>
  </nav>

  <header class="history-hero">
    <p class="history-kicker">MABAYANI · Verified History</p>
    <h1>Masinloc was founded in <strong data-fact="documented-founding-year">{founding['documentedYear']}</strong>.</h1>
    <p class="history-lead">{esc(founding['summary'])}</p>
    <div class="history-answer" aria-label="Founding date correction">
      <div class="history-answer-old"><span>{founding['misattributedYear']}</span><p>Spanish exploration in the wider Zambales story. Not the founding of Masinloc.</p></div>
      <div class="history-answer-new"><span>{founding['documentedYear']}</span><p>The documented founding year of Masinloc's mission town.</p></div>
    </div>
    <p class="history-precision">{esc(founding['precision'])}</p>
  </header>

  <section class="history-founder" aria-labelledby="founderTitle">
    <div class="history-founder-copy">
      <p class="history-kicker">The founder in the record</p>
      <h2 id="founderTitle">{esc(founder['name'])}</h2>
      <p>{esc(founder['intro'])}</p>
      <a class="history-link" href="founder-of-masinloc.html">Read the founder profile <span aria-hidden="true">→</span></a>
    </div>
    <div class="founder-photo-pending" data-photo-status="pending" role="img" aria-label="{esc(founder['portraitStatus'])}">
      <span class="founder-monogram">A</span>
      <p>{esc(founder['portraitStatus'])}</p>
    </div>
  </section>

  <section class="history-timeline" aria-labelledby="timelineTitle">
    <div class="history-section-head">
      <p class="history-kicker">The documented line</p>
      <h2 id="timelineTitle">Eight moments that changed Masinloc</h2>
      <p>This is not every year in the town's history. It is the clearest sequence the sources reviewed can presently carry.</p>
    </div>
    <ol class="history-timeline-list">{timeline}</ol>
  </section>

  <section class="history-battle" aria-labelledby="battleTitle">
    <div class="history-section-head history-section-head-light">
      <p class="history-kicker">1649</p>
      <h2 id="battleTitle">{esc(battle['title'])}</h2>
      <p>{esc(battle['intro'])}</p>
    </div>
    <ol class="battle-sequence">{battle_steps}</ol>
    <p class="battle-note">{esc(battle['caution'])}</p>
    <a class="history-link history-link-light" href="bulletin/1649-when-six-caracoas-came.html">Read the full MABAYANI web account <span aria-hidden="true">→</span></a>
  </section>

  <section class="history-facts" aria-labelledby="factsTitle">
    <div class="history-section-head">
      <p class="history-kicker">Beyond the usual timeline</p>
      <h2 id="factsTitle">Masinloc facts worth knowing</h2>
    </div>
    <ul class="history-fact-grid">{facts}</ul>
  </section>

  <section class="history-san-vicente" aria-labelledby="sanVicenteTitle">
    <div class="history-section-head">
      <p class="history-kicker">From barrio to town</p>
      <h2 id="sanVicenteTitle">{esc(san_vicente['title'])}</h2>
      <p>{esc(san_vicente['intro'])}</p>
    </div>
    <dl class="san-vicente-dates">
      <div><dt>{esc(san_vicente['townDate'])}</dt><dd>{esc(san_vicente['townEvent'])}</dd></div>
      <div><dt>{esc(san_vicente['parishDate'])}</dt><dd>{esc(san_vicente['parishEvent'])}</dd></div>
    </dl>
    <p class="history-evidence-status">{esc(san_vicente['openNote'])}</p>
  </section>

  <figure class="history-binabayani-media">
    {picture()}
    <figcaption>Binabayani is a living Masinloc tradition connected with the feast of San Andres.</figcaption>
  </figure>
  <section class="history-binabayani" aria-labelledby="binabayaniTitle">
    <div>
      <p class="history-kicker">Living tradition</p>
      <h2 id="binabayaniTitle">{esc(binabayani['title'])}</h2>
    </div>
    <div class="history-binabayani-copy">
      <p class="history-binabayani-rule">Kristiyano <span>and</span> Aeta</p>
      <p>{esc(binabayani['summary'])}</p>
      <p class="history-evidence-status">{esc(binabayani['status'])}</p>
      <a class="history-link" href="bulletin/what-binabayani-remembers.html">Read the evidence and oral-history note <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <section class="history-sources" aria-labelledby="historySourcesTitle">
    <div class="history-section-head">
      <p class="history-kicker">Research basis</p>
      <h2 id="historySourcesTitle">The record behind this page</h2>
      <p>The website copy is newly written from the verified research. It does not reproduce the MABAYANI book manuscript.</p>
    </div>
    <ul>{research_basis()}</ul>
    <a class="history-link" href="sources.html">Open the complete Sources &amp; References directory <span aria-hidden="true">→</span></a>
  </section>
</main>
"""
    return head + body + shell_foot(graph)


def founder_page() -> str:
    founder = DATA["founder"]
    founding = DATA["founding"]
    fact_list = "".join(f"<li>{esc(item)}</li>" for item in founder["facts"])

    title = "Fray Andrés del Espíritu Santo | Founder of Masinloc"
    description = ("A source-led profile of Fray Andrés del Espíritu Santo, named in the "
                   "historical record as founder and first parish priest of Masinloc's mission town in 1607.")
    canonical = f"{SITE}/founder-of-masinloc.html"
    head = shell_head(
        title, description, canonical, page_class="founder-page", og_type="profile",
        social_image="/assets/locations/san-andres-church-card-1200.jpg",
        social_alt="San Andres Church in Masinloc, Zambales",
    )

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Masinloc, Zambales", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Verified History", "item": f"{SITE}/verified-history.html"},
                    {"@type": "ListItem", "position": 3, "name": founder["name"], "item": canonical},
                ],
            },
            {
                "@type": "ProfilePage",
                "@id": f"{canonical}#profile",
                "url": canonical,
                "name": title,
                "description": description,
                "inLanguage": "en-PH",
                "mainEntity": {"@id": f"{canonical}#person"},
                "isPartOf": {"@id": f"{SITE}/verified-history.html#webpage"},
            },
            {
                "@type": "Person",
                "@id": f"{canonical}#person",
                "name": founder["name"],
                "birthDate": str(founder["birthYear"]),
                "birthPlace": {"@type": "Place", "name": founder["birthPlace"]},
                "description": founder["role"],
                "subjectOf": {"@id": f"{canonical}#profile"},
            },
        ],
    }

    body = f"""
<main id="main">
  <nav class="history-crumbs" aria-label="Breadcrumb">
    <ol><li><a href="index.html">Masinloc, Zambales</a></li><li><a href="verified-history.html">Verified History</a></li><li><span aria-current="page">Founder</span></li></ol>
  </nav>

  <header class="founder-hero">
    <div class="founder-hero-copy">
      <p class="history-kicker">Founder of Masinloc's documented mission town</p>
      <h1>{esc(founder['name'])}</h1>
      <p class="founder-role">{esc(founder['role'])}</p>
      <dl class="founder-vitals">
        <div><dt>Born</dt><dd>{founder['birthYear']}, {esc(founder['birthPlace'])}</dd></div>
        <div><dt>Masinloc</dt><dd>{founding['documentedYear']}</dd></div>
        <div><dt>Documented role</dt><dd>Founder and first parish priest</dd></div>
      </dl>
    </div>
    <div class="founder-photo-pending founder-photo-large" data-photo-status="pending" role="img" aria-label="{esc(founder['portraitStatus'])}">
      <span class="founder-monogram">A</span>
      <p>{esc(founder['portraitStatus'])}</p>
    </div>
  </header>

  <article class="founder-body">
    <p class="founder-intro">{esc(founder['intro'])}</p>

    <section class="founder-section" aria-labelledby="recordTitle">
      <div><p class="history-kicker">What the record supports</p><h2 id="recordTitle">The work attached to his name</h2></div>
      <ul class="founder-facts">{fact_list}</ul>
    </section>

    <section class="founder-meaning" aria-labelledby="meaningTitle">
      <p class="history-kicker">A necessary distinction</p>
      <h2 id="meaningTitle">Founder does not mean first inhabitant</h2>
      <p>{esc(founder['meaning'])}</p>
    </section>

    <section class="founder-after" aria-labelledby="afterTitle">
      <div><p class="history-kicker">After Masinloc</p><h2 id="afterTitle">One founding became a northern mission network</h2></div>
      <div>
        <p>The historical study places the next stage of his work along the same northern coast: Casborran, now Alaminos, and Bolinao in 1609, then Balincaguin, now Mabini, and Agno in 1610.</p>
        <p>Masinloc itself later served as a center for Recollect activity across northern Zambales, from Iba to Anda. That geography was much larger than the boundaries people associate with Zambales today.</p>
      </div>
    </section>

    <section class="founder-source" aria-labelledby="founderSourceTitle">
      <p class="history-kicker">Research basis</p>
      <h2 id="founderSourceTitle">Why the site identifies him as founder</h2>
      <p>The identification comes from Emmanuel Luis A. Romanillos's academic study of the Masinloc Recollect mission. Its abstract says Andrés del Espíritu Santo founded Masinloc in 1607, and the body identifies him as founder of the new pueblo and builder of its first church.</p>
      <ul><li><a href="sources.html#romanillos-masinloc-recollect-mission">Masinloc, Zambales: Augustinian Recollect Mission (1607–1902)</a><span>Emmanuel Luis A. Romanillos</span></li><li><a href="sources.html#dilg-zambales-history">History of Zambales and its earliest towns</a><span>Department of the Interior and Local Government, Zambales</span></li></ul>
      <a class="history-link" href="verified-history.html">Return to the full Masinloc timeline <span aria-hidden="true">→</span></a>
    </section>
  </article>
</main>
"""
    return head + body + shell_foot(graph)


def main() -> int:
    verify()
    outputs = {
        ROOT / "verified-history.html": history_page(),
        ROOT / "founder-of-masinloc.html": founder_page(),
    }
    checking = "--check" in sys.argv[1:]
    mismatches: list[str] = []
    for path, expected in outputs.items():
        if checking:
            if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                mismatches.append(path.name)
        else:
            path.write_text(expected, encoding="utf-8")
            print(f"built {path.relative_to(ROOT)}")
    if mismatches:
        print("HISTORY BUILD CHECK FAILED")
        for name in mismatches:
            print(f"- {name} is missing or out of date; run python3 scripts/build-history.py")
        return 1
    if checking:
        print("HISTORY BUILD CHECK PASSED")
        print("Verified History and the founder profile match data/history.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
