#!/usr/bin/env python3
"""Build report.html — the non-emergency message form for the PNP and MDRRMO desks.

THE ONE THING THIS PAGE MUST GET RIGHT. It is not an emergency channel, and a
resident must understand that before they start typing. A form that looks like
a way to summon help, and is read the next working day, is worse than no form:
somebody types instead of dialling, and the minutes that mattered are gone. So
the emergency path is not a footnote at the bottom — it is above the form, and
both desk hotlines are on it as one-tap call buttons.

WHY IT IS GENERATED. Those two hotlines are the same numbers help-desk.html
publishes, and they are read from the same data/help-desk.json. Two pages
printing the same emergency number, maintained by hand, is how one of them goes
stale. check-help-desk.py holds both pages to the one data file.

WHAT IT PROMISES. Nothing it cannot keep. The confirmation says the report was
submitted and that nobody at the desk has opened it yet — because that is what
is true until a desk officer actually opens it, which the database stamps
rather than the page assuming.
"""
import json
import re
import sys
from html import escape as esc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "help-desk.json"
DESK_DATA = ROOT / "data" / "assistance-desks.json"
PAGE = ROOT / "report.html"

SPEC = json.loads(DATA.read_text(encoding="utf-8"))
SERVICES = {s["id"]: s for s in SPEC["municipal"]}
DESK_SPEC = json.loads(DESK_DATA.read_text(encoding="utf-8"))

# The desks come from data/assistance-desks.json, and so does the only field
# that decides what this page is allowed to say: `activated`. A desk is
# activated when a named officer holds an account and has agreed to read what
# arrives — not when the code works. Until then the form is rendered disabled
# and the page says, in plain words, that the desk is not open and to call
# instead. A form that accepts messages nobody can read is the failure this
# whole page is built to avoid.
DESKS = [
    {**desk, "kinds": [tuple(k) for k in desk["kinds"]]}
    for desk in DESK_SPEC["desks"]
]
LIVE = [d for d in DESKS if d["activated"]]
OPEN = bool(LIVE)

TITLE = "Message a Masinloc Desk"
DESCRIPTION = ("Send a non-urgent message to the PNP or MDRRMO desk in Masinloc. "
               "For an emergency, call the hotline instead.")
URL = "https://www.masinloc-zambales.com/report.html"


def dial(number: str) -> str:
    digits = re.sub(r"\D", "", number)
    if not digits.startswith("0") or len(digits) != 11:
        sys.exit(f"REFUSING TO BUILD: {number!r} is not a valid 11-digit mobile number")
    return "+63" + digits[1:]


def emergency_call(desk: dict) -> str:
    service = SERVICES[desk["service"]]
    number = service["numbers"][0]
    return (f'<a class="rp-call" href="tel:{dial(number)}">'
            f'<span class="rp-call-who">{esc(service["name"])}</span>'
            f'<span class="rp-call-number">{esc(number)}</span></a>')


def desk_choice(desk: dict, index: int) -> str:
    checked = " checked" if index == 0 else ""
    return (f'<label class="rp-desk">'
            f'<input type="radio" name="deskCode" value="{esc(desk["code"])}"{checked}>'
            f'<span class="rp-desk-body">'
            f'<strong>{esc(desk["name"])}</strong>'
            f'<span>{esc(desk["what"])}</span></span></label>')


def kind_options(desk: dict) -> str:
    # Rendered per desk and swapped by report.js, so the reasons offered always
    # belong to the desk selected. With scripting off, every option is present
    # under its own desk's group and the browser's own select still works.
    options = "".join(f'<option value="{esc(value)}">{esc(label)}</option>'
                      for value, label in desk["kinds"])
    return f'<optgroup label="{esc(desk["name"])}" data-desk="{esc(desk["code"])}">{options}</optgroup>'


barangays = "".join(f'<option value="{esc(b["barangay"])}">' for b in SPEC["barangay"])

# The closed notice. Named desks, so a reader knows which office is not open
# rather than being told "unavailable" and left guessing whether to keep
# trying. No date is promised, because none is known.
_shut = [d["name"] for d in DESKS if not d["activated"]]
closed_notice = "" if OPEN else f'''
  <section class="rp-closed" aria-labelledby="rpClosedTitle">
    <h2 id="rpClosedTitle">This channel is not open yet.</h2>
    <p>{esc(" and ".join(_shut))} {"have" if len(_shut) != 1 else "has"} no officer signed
      in to read messages sent from here, so nothing sent through this page would reach
      anyone. Rather than take a message that would sit unread, the form below is closed.</p>
    <p>Call the desk instead — the numbers above are the same ones the office answers.
      This page will open once each desk has someone reading it.</p>
  </section>'''

# With no desk open the form is inert in the markup itself, not merely styled
# to look inert: a disabled fieldset cannot be submitted, cannot be focused
# into, and cannot be re-enabled by turning JavaScript off.
form_state = "" if OPEN else " disabled"
form_class = "rp-form" if OPEN else "rp-form is-closed"
submit_label = "Send to the desk" if OPEN else "This channel is not open"

markup = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{TITLE} | Masinloc Connect</title>
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
<link rel="stylesheet" href="tokens.css?v=20260823-1">
<link rel="stylesheet" href="site.css?v=20260825-2">
<link rel="stylesheet" href="site-polish.css?v=20260825-2">
<link rel="stylesheet" href="help-desk.css?v=20260831-1">
<link rel="stylesheet" href="report.css?v=20260831-1">
<link rel="stylesheet" href="site-stability.css?v=20260825-1">
</head>
<body class="about-page help-desk-page report-page">
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
      <li><a href="help-desk.html">Help Desk</a></li>
      <li><span aria-current="page">Message a desk</span></li>
    </ol>
  </nav>

  <!-- Above the form, never below it. Somebody who needs to be dialling
       should reach a number before they reach a text box. -->
  <section class="rp-emergency" aria-labelledby="rpEmergencyTitle">
    <h2 id="rpEmergencyTitle">If this is an emergency, call — do not write.</h2>
    <p>Messages here are read when a desk officer next opens the console. That may be
      hours, or the next working day. If someone is in danger, or something is happening
      now, use the hotline.</p>
    <div class="rp-calls">
      {"".join(emergency_call(desk) for desk in DESKS)}
    </div>
    <p class="rp-emergency-more"><a href="help-desk.html">All Masinloc emergency numbers, including your barangay</a></p>
  </section>

  <section class="rp-intro">
    <p class="section-label">Masinloc Connect</p>
    <h1>Message a Masinloc desk.</h1>
    <p class="lead">For matters that do not need someone dispatched right now — following up
      a report, a hazard worth recording, or a question the desk can answer.</p>
  </section>

{closed_notice}

  <section class="rp-form-section" aria-labelledby="rpFormTitle">
    <h2 id="rpFormTitle" class="visually-hidden">Your message</h2>
    <form class="{form_class}" id="reportForm" novalidate data-open="{str(OPEN).lower()}">
      <fieldset class="rp-all"{form_state}>
      <fieldset class="rp-fieldset">
        <legend>Which desk</legend>
        <div class="rp-desks">
          {"".join(desk_choice(desk, i) for i, desk in enumerate(DESKS))}
        </div>
      </fieldset>

      <div class="rp-field">
        <label for="reportKind">What is this about</label>
        <select id="reportKind" name="reportKind" required>
          {"".join(kind_options(desk) for desk in DESKS)}
        </select>
      </div>

      <div class="rp-field">
        <label for="reportSubject">Subject</label>
        <input id="reportSubject" name="subject" type="text" maxlength="200" required
               placeholder="A few words on what this is about">
      </div>

      <div class="rp-field">
        <label for="reportBody">Details</label>
        <textarea id="reportBody" name="body" rows="7" maxlength="6000" required
                  placeholder="What happened, where, and when. Include anything that would help the desk understand it."></textarea>
        <p class="rp-hint"><span id="bodyCount">0</span> of 6000 characters</p>
      </div>

      <div class="rp-field">
        <label for="reportBarangay">Barangay <span class="rp-optional">optional</span></label>
        <input id="reportBarangay" name="barangay" type="text" list="barangayList" maxlength="120"
               autocomplete="off" placeholder="Where this concerns">
        <datalist id="barangayList">{barangays}</datalist>
      </div>

      <div class="rp-two">
        <div class="rp-field">
          <label for="reporterName">Your name <span class="rp-optional">optional</span></label>
          <input id="reporterName" name="reporterName" type="text" maxlength="160" autocomplete="name">
        </div>
        <div class="rp-field">
          <label for="reporterContact">How the desk can reach you <span class="rp-optional">optional</span></label>
          <input id="reporterContact" name="reporterContact" type="text" maxlength="200"
                 autocomplete="tel" placeholder="Mobile number or email">
        </div>
      </div>

      <p class="rp-privacy">You may send this without leaving your name. A desk can act on an
        unsigned report, but it cannot reply to one. What you send is stored for the desk you
        chose and is not published anywhere on this site. Masinloc Connect processes it in
        accordance with its <a href="privacy.html" target="_blank" rel="noopener">Privacy Notice</a>.</p>

      <div class="hp-field" aria-hidden="true">
        <label for="reportWebsite">Website</label>
        <input id="reportWebsite" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>

      <div class="rp-actions">
        <button class="rp-submit" type="submit" id="reportSubmit"{form_state}>{submit_label}</button>
        <p class="rp-status" id="reportStatus" role="status" aria-live="polite"></p>
      </div>
      </fieldset>
    </form>

    <div class="rp-receipt" id="reportReceipt" hidden>
      <h2>Your message was submitted.</h2>
      <p class="rp-receipt-honest" id="receiptHonest"></p>
      <dl class="rp-receipt-codes">
        <div><dt>Reference code</dt><dd id="receiptReference"></dd></div>
        <div><dt>Your access key</dt><dd id="receiptToken"></dd></div>
      </dl>
      <p class="rp-receipt-keep">Keep both. Together they are the only way to check this
        message later, and neither is shown again. The reference code alone is what a desk
        officer will ask for on the phone.</p>
      <p><a href="help-desk.html">Back to the Help Desk</a></p>
    </div>
  </section>

  {'<section class="rp-check" aria-labelledby="rpCheckTitle">' if OPEN else '<section class="rp-check" aria-labelledby="rpCheckTitle" hidden>'}
    <h2 id="rpCheckTitle">Check a message you already sent</h2>
    <p>Enter the reference code and access key you were given.</p>
    <form class="rp-check-form" id="checkForm" novalidate>
      <div class="rp-field">
        <label for="checkReference">Reference code</label>
        <input id="checkReference" type="text" maxlength="40" autocomplete="off" placeholder="MC-A-…">
      </div>
      <div class="rp-field">
        <label for="checkToken">Access key</label>
        <input id="checkToken" type="text" maxlength="60" autocomplete="off">
      </div>
      <button class="rp-secondary" type="submit">Check status</button>
    </form>
    <p class="rp-check-result" id="checkResult" role="status" aria-live="polite"></p>
  </section>
</main>

<footer class="home-footer">
  <div class="footer-brand"><img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales"><p>By Masinloqueños.<br>For Masinloqueños.<br>With Masinloqueños.</p></div>
  <div class="footer-nav"><a href="index.html">Home</a><a href="discover/index.html">Discover</a><a href="sambal-tina.html">Sambal Tina</a><a href="marketplace.html">Marketplace</a><a href="jobs.html">Jobs</a><a href="help-desk.html">Help Desk</a><a href="a-closer-look.html">About Masinloc</a><a href="connect.html">Masinloc Connect</a><a href="verified-history.html">Verified History</a><a href="masinloc-bulletin.html">Masinloc Bulletin</a><a href="sources.html">Sources &amp; References</a><a href="contact.html">Contact</a></div>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>www.masinloc-zambales.com</span></div>
</footer>
<script src="site.js?v=20260825-2"></script>
<script type="module" src="report.js?v=20260831-1"></script>
</body></html>
"""

PAGE.write_text(markup, encoding="utf-8")
state = f"OPEN ({', '.join(d['name'] for d in LIVE)})" if OPEN else "CLOSED — no desk activated"
print(f"report.html: {len(DESKS)} desks, {len(SPEC['barangay'])} barangays, form {state}")
