#!/usr/bin/env python3
"""Build help-desk.html from data/help-desk.json.

WHY THIS PAGE IS GENERATED RATHER THAN HAND-WRITTEN. Every other number on
this site is forbidden — scripts/check-marketplace-privacy.py refuses any
Philippine mobile number appearing anywhere in the Marketplace, because a
business owner's mobile is private data they did not agree to publish. This
page is the deliberate exception, and an exception is only safe while it is
narrow and mechanical: the numbers live in one JSON file, this script is the
only thing that renders them, and scripts/check-help-desk.py refuses any digit
on the page that the JSON does not declare. Hand-editing the HTML would put a
number on the site that nothing checked.

WHY tel: LINKS. Under pressure, on a phone, reading eleven digits across to a
dialler is exactly where people fumble. One tap is the whole point of
publishing these at all. The guard keeps tel: confined to this page so the
site-wide rule holds everywhere else.

NOTHING IS INVENTED. The office descriptions say what the office does. No
address, no operating hours, no landline and no claim about response times
appears anywhere, because none of that was supplied and a wrong detail on an
emergency page is worse than a missing one.
"""
import json
import re
import sys
from html import escape as esc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "help-desk.json"
PAGE = ROOT / "help-desk.html"

SPEC = json.loads(DATA.read_text(encoding="utf-8"))

STAMP_TOKENS = "tokens.css?v=20260823-1"
STAMP_SITE = "site.css?v=20260825-2"
STAMP_POLISH = "site-polish.css?v=20260825-2"
STAMP_STABILITY = "site-stability.css?v=20260825-1"
STAMP_HELP = "help-desk.css?v=20260831-1"

TITLE = "Masinloc Emergency Hotlines &amp; Help Desk"
DESCRIPTION = ("Emergency and assistance numbers for Masinloc, Zambales: MDRRMO, police, "
               "fire, Coast Guard, health, social welfare, ZAMECO, and every barangay.")
URL = "https://www.masinloc-zambales.com/help-desk.html"


def dial(number: str) -> str:
    """+63 form of a printed number, for the tel: href.

    Printed as it is read locally (0921-405-9748); dialled in international
    form so the link also works from a phone roaming on a foreign network,
    which is precisely the situation of a Masinloqueño abroad trying to reach
    someone at home.
    """
    digits = re.sub(r"\D", "", number)
    if not digits.startswith("0") or len(digits) != 11:
        sys.exit(f"REFUSING TO BUILD: {number!r} is not an 11-digit 0-prefixed "
                 f"mobile number. Every number on this page must be dialled "
                 f"exactly as data/help-desk.json declares it.")
    return "+63" + digits[1:]


def numbers(entry: dict) -> str:
    return "".join(
        f'<a class="hd-call" href="tel:{dial(n)}">'
        f'<span class="hd-call-icon" aria-hidden="true">'
        f'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        f'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6'
        f'A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1'
        f'L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>'
        f'</svg></span>'
        f'<span class="hd-call-number">{esc(n)}</span></a>'
        for n in entry["numbers"])


def service(entry: dict) -> str:
    full = (f'<p class="hd-full">{esc(entry["full"])}</p>'
            if entry["full"] != entry["name"] else "")
    return (f'<li class="hd-service" id="svc-{esc(entry["id"])}">'
            f'<div class="hd-service-head">'
            f'<h3>{esc(entry["name"])}</h3>{full}'
            f'<p class="hd-role">{esc(entry["role"])}</p></div>'
            f'<div class="hd-calls">{numbers(entry)}</div></li>')


def barangay_row(entry: dict) -> str:
    # data-name carries the searchable text so the filter never has to read the
    # rendered markup back out of the DOM.
    return (f'<li class="hd-brgy" data-name="{esc(entry["barangay"].lower())}">'
            f'<div class="hd-brgy-head"><h3>{esc(entry["barangay"])}</h3>'
            f'<p>{esc(entry["official"])}</p></div>'
            f'<div class="hd-calls">{numbers(entry)}</div></li>')


priority = [s for s in SPEC["municipal"] if s["priority"]]
support = [s for s in SPEC["municipal"] if not s["priority"]]

if not priority:
    sys.exit("REFUSING TO BUILD: no priority emergency service is declared.")

markup = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{TITLE} | Masinloc, Zambales</title>
<meta name="description" content="{esc(DESCRIPTION)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc, Zambales">
<meta property="og:locale" content="en_PH">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{esc(DESCRIPTION)}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="https://www.masinloc-zambales.com/assets/stage1/masinloc-hero.avif">
<meta property="og:image:alt" content="Masinloc, Zambales from the air">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{TITLE}">
<meta name="twitter:description" content="{esc(DESCRIPTION)}">
<meta name="twitter:image" content="https://www.masinloc-zambales.com/assets/stage1/masinloc-hero.avif">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="{STAMP_TOKENS}">
<link rel="stylesheet" href="{STAMP_SITE}">
<link rel="stylesheet" href="{STAMP_POLISH}">
<link rel="stylesheet" href="{STAMP_HELP}">
<link rel="stylesheet" href="{STAMP_STABILITY}">
</head>
<body class="about-page help-desk-page">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav">
  <a class="brand" href="index.html" aria-label="Masinloc, Zambales home"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"></a>
  <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="primaryNav" aria-label="Open menu"><span></span><span></span></button>
  <nav class="primary-nav" id="primaryNav" aria-label="Primary navigation">
    <a href="discover/index.html">Discover</a>
    <a href="sambal-tina.html">Sambal Tina</a>
    <a href="marketplace.html">Marketplace</a>
    <a href="a-closer-look.html">About Masinloc</a>
    <a class="connect-link" href="connect.html" aria-current="page">Masinloc Connect</a>
  </nav>
</header>

<main id="main">
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="index.html">Masinloc, Zambales</a></li>
      <li><a href="connect.html">Masinloc Connect</a></li>
      <li><span aria-current="page">Help Desk</span></li>
    </ol>
  </nav>

  <section class="hd-hero">
    <p class="section-label">Help Desk</p>
    <h1>Emergency and assistance numbers for Masinloc.</h1>
    <p class="lead">The offices below answer directly. On a phone, tap a number to call it.</p>
    <p class="hd-independent">Masinloc Connect is an independent community platform, not the municipal
      government. These numbers are published so you can reach each office yourself. In an
      emergency, calling is the only way — no message sent through this website summons help.</p>
  </section>

  <section class="hd-emergency" aria-labelledby="emergencyTitle">
    <h2 id="emergencyTitle">Emergency</h2>
    <ul class="hd-services hd-services-priority">
      {"".join(service(s) for s in priority)}
    </ul>
  </section>

  <section class="hd-support" aria-labelledby="supportTitle">
    <h2 id="supportTitle">Assistance and utilities</h2>
    <ul class="hd-services">
      {"".join(service(s) for s in support)}
    </ul>
  </section>

  <section class="hd-guidance" aria-labelledby="guidanceTitle">
    <h2 id="guidanceTitle">When you call</h2>
    <p>Responders work from what they are told first. Leading with these gets help moving sooner.</p>
    <ol class="hd-steps">
      <li><strong>Where.</strong> Barangay, sitio, and the nearest landmark.</li>
      <li><strong>What happened.</strong> In a sentence.</li>
      <li><strong>Who needs help.</strong> How many people, and whether anyone is injured or trapped.</li>
      <li><strong>Your number.</strong> So they can call back if they lose you.</li>
    </ol>
    <p class="hd-steps-note">Stay reachable after the call. If the first number does not connect,
      try the second where one is listed, then your barangay.</p>
  </section>

  <section class="hd-barangay" aria-labelledby="barangayTitle">
    <h2 id="barangayTitle">Barangay contacts</h2>
    <p>Your barangay is often the fastest first call, and the one that knows your area.</p>
    <div class="hd-filter" hidden>
      <label for="brgySearch">Find your barangay</label>
      <input id="brgySearch" type="search" autocomplete="off" placeholder="Type a barangay name">
    </div>
    <p class="hd-filter-status" id="brgyStatus" role="status" aria-live="polite"></p>
    <ul class="hd-brgy-list" id="brgyList">
      {"".join(barangay_row(b) for b in SPEC["barangay"])}
    </ul>
  </section>

  <section class="hd-note">
    <h2>Keeping this accurate</h2>
    <p>These numbers were transcribed from the list supplied to the project on
      {esc(SPEC["reviewed"]["date"])} and read back against it. If a number here has changed or no
      longer connects, <a href="contact.html">tell us</a> and it will be corrected or removed —
      an emergency number that rings nowhere is worse than one that is missing.</p>
  </section>
</main>

<!-- .home-footer, not .site-footer. The two are different structures with
     different stylesheets behind them: .site-footer's parts are styled in
     jobs.css and styles.css, which this page does not load, so copying that
     markup here rendered an unstyled footer. check-stylesheets.py caught it. -->
<footer class="home-footer">
  <div class="footer-brand"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="sambal-tina.html">Sambal Tina</a><a href="marketplace.html">Marketplace</a><a href="jobs.html">Jobs</a><a href="help-desk.html">Help Desk</a><a href="a-closer-look.html">About Masinloc</a><a href="connect.html">Masinloc Connect</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="sources.html">Sources &amp; References</a><a href="contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
<script src="site.js?v=20260825-2"></script>
<script src="help-desk.js?v=20260831-1" defer></script>
</body></html>
"""

PAGE.write_text(markup, encoding="utf-8")
total = sum(len(s["numbers"]) for s in SPEC["municipal"]) + sum(
    len(b["numbers"]) for b in SPEC["barangay"])
print(f"help-desk.html: {len(priority)} emergency services, {len(support)} assistance, "
      f"{len(SPEC['barangay'])} barangays, {total} numbers")
