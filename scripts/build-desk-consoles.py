#!/usr/bin/env python3
"""Build the private PNP and MDRRMO desk consoles.

ONE IMPLEMENTATION, TWO DOORS. Both consoles are the same page with a
different desk code on the body. desk-console.js reads that code and every
query it makes is scoped by it — but the scoping that actually matters is the
RLS policy on assistance_reports, which lets a signed-in officer read only the
desk they are a member of. If this file rendered the wrong code, the console
would show nothing rather than another desk's reports.

PRIVATE, THE SAME WAY jobs-source-desk.html IS PRIVATE. noindex, nofollow,
noarchive; not in the primary navigation, not in the footer, not in the
sitemap. scripts/check-assistance-desks.py enforces all of that, because a
console linked from a public page is a console somebody finds by accident.

THE PAGE CANNOT LET AN OFFICER MISLEAD A RESIDENT. There is no control here
for editing a report's text, and none for deleting one. An officer moves a
report through its statuses and leaves notes; the acknowledgement timestamp is
written by the database on first move, not offered as a checkbox. That is what
makes the resident-facing "nobody has opened it yet" true rather than hopeful.
"""
import json
from html import escape as esc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESK_DATA = ROOT / "data" / "assistance-desks.json"
HELP_DATA = ROOT / "data" / "help-desk.json"

DESKS = json.loads(DESK_DATA.read_text(encoding="utf-8"))["desks"]
SERVICES = {s["id"]: s for s in json.loads(HELP_DATA.read_text(encoding="utf-8"))["municipal"]}

STATUSES = [
    ("submitted", "New", "Nobody has opened this yet."),
    ("received", "Opened", "A desk officer has read it."),
    ("in_progress", "Working", "The desk is acting on it."),
    ("closed", "Closed", "Nothing further from the desk."),
]


def console(desk: dict) -> str:
    code = desk["code"]
    name = desk["name"]
    service = SERVICES[desk["service"]]
    slug = f"{code}-desk.html"

    filters = "".join(
        f'<button class="dc-chip" type="button" data-status="{esc(value)}">'
        f'{esc(label)} <span data-count>0</span></button>'
        for value, label, _ in STATUSES)

    actions = "".join(
        f'<button class="dc-action" type="button" data-set-status="{esc(value)}" '
        f'title="{esc(hint)}">{esc(label)}</button>'
        for value, label, hint in STATUSES if value != "submitted")

    # A closed desk still gets a console — that is how it gets opened. But it
    # says so, because an officer signing in to an empty queue should know
    # whether that means "no reports" or "the form is not accepting any".
    closed_banner = "" if desk["activated"] else (
        '<p class="dc-not-live">This desk is not accepting messages yet. '
        'report.html shows the public a closed notice and takes nothing, so this '
        'queue stays empty until the desk is activated in data/assistance-desks.json.</p>')

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>{esc(name)} Desk | Masinloc Connect</title>
<meta name="description" content="Private Masinloc Connect workspace for authorized {esc(name)} officers to read and act on non-emergency messages from residents.">
<meta name="robots" content="noindex,nofollow,noarchive">
<link rel="canonical" href="https://www.masinloc-zambales.com/{slug}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masinloc Connect">
<meta property="og:title" content="{esc(name)} Desk | Masinloc Connect">
<meta property="og:description" content="Private Masinloc Connect workspace for authorized {esc(name)} officers.">
<meta property="og:url" content="https://www.masinloc-zambales.com/{slug}">
<meta property="og:image" content="https://www.masinloc-zambales.com/assets/connect/connect-hero-1672.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="tokens.css?v=20260823-1">
<link rel="stylesheet" href="site.css?v=20260825-2">
<link rel="stylesheet" href="site-polish.css?v=20260825-2">
<link rel="stylesheet" href="desk-console.css?v=20260831-1">
<link rel="stylesheet" href="site-stability.css?v=20260825-1">
</head>
<body class="about-page desk-console" data-desk="{esc(code)}" data-desk-name="{esc(name)}">
<a class="skip-link" href="#main">Skip to content</a>

<header class="dc-bar">
  <div class="dc-brand">
    <img src="assets/masinloc-logo.webp" width="320" height="78" alt="Masinloc Zambales">
    <h1 class="dc-desk-name">{esc(name)} Desk</h1>
  </div>
  <div class="dc-bar-right">
    <span class="dc-account" id="deskAccount"></span>
    <button class="dc-quiet" type="button" id="signOutBtn" hidden>Sign out</button>
  </div>
</header>

<main id="main">

  <!-- Sign in -->
  <section class="dc-gate" id="authView">
    <h2>Sign in</h2>
    <p>Private workspace for {esc(service["full"])}. Sign in with the address your
      account was issued to. A link will be sent; no password is used.</p>
    <form class="dc-auth" id="authForm" novalidate>
      <label for="deskEmail">Work email address</label>
      <input id="deskEmail" type="email" autocomplete="email" required>
      <button class="dc-primary" type="submit" id="sendLinkBtn">Send secure sign-in link</button>
    </form>
    <p class="dc-auth-message" id="authMessage" role="status" aria-live="polite"></p>
    <p class="dc-gate-note">This console is not an emergency system. Urgent matters reach
      this office by phone, on {esc(service["numbers"][0])}, and always will.</p>
  </section>

  <!-- Signed in, but not a member of this desk -->
  <section class="dc-gate" id="deniedView" hidden>
    <h2>This account cannot open the {esc(name)} desk.</h2>
    <p>You are signed in, but your account is not on this desk's roster. Access is granted
      by the desk, not requested here.</p>
    <button class="dc-quiet" type="button" id="deniedSignOutBtn">Sign out</button>
  </section>

  <!-- The queue -->
  <section class="dc-desk" id="deskView" hidden>
    <div class="dc-head">
      <h2>Queue</h2>
      <p>Non-emergency messages from residents. Opening a report records that it was
        opened, and the resident is told so.</p>
      {closed_banner}
    </div>

    <div class="dc-escalate">
      <strong>If a report turns out to be urgent, call.</strong>
      <span>{esc(service["name"])} — {esc(service["numbers"][0])}</span>
    </div>

    <div class="dc-controls">
      <div class="dc-filters" role="group" aria-label="Filter by status">
        <button class="dc-chip is-active" type="button" data-status="all">All <span data-count>0</span></button>
        {filters}
      </div>
      <div class="dc-search">
        <label class="visually-hidden" for="deskSearch">Search reports</label>
        <input id="deskSearch" type="search" autocomplete="off" placeholder="Search subject, barangay or reference">
      </div>
    </div>

    <p class="dc-status" id="deskStatus" role="status" aria-live="polite"></p>

    <div class="dc-workspace">
      <ul class="dc-list" id="reportList"></ul>
      <article class="dc-detail" id="reportDetail" aria-live="polite">
        <p class="dc-detail-empty">Choose a report to read it.</p>
      </article>
    </div>
  </section>
</main>

<template id="detailTemplate">
  <div class="dc-detail-inner">
    <div class="dc-detail-head">
      <span class="dc-badge" data-field="status"></span>
      <span class="dc-ref" data-field="reference"></span>
    </div>
    <h2 data-field="subject">Report</h2>
    <dl class="dc-meta">
      <div><dt>Kind</dt><dd data-field="kind"></dd></div>
      <div><dt>Barangay</dt><dd data-field="barangay"></dd></div>
      <div><dt>Received</dt><dd data-field="created"></dd></div>
      <div><dt>From</dt><dd data-field="reporter"></dd></div>
      <div><dt>Contact</dt><dd data-field="contact"></dd></div>
    </dl>
    <div class="dc-body" data-field="body"></div>
    <div class="dc-note-block">
      <label for="deskNote">Desk note</label>
      <textarea id="deskNote" rows="3" maxlength="2000"
                placeholder="What the desk did, or what it is waiting on."></textarea>
      <button class="dc-quiet" type="button" id="saveNoteBtn">Save note</button>
    </div>
    <div class="dc-actions">{actions}</div>
    <p class="dc-action-status" data-field="actionStatus" role="status" aria-live="polite"></p>
    <div class="dc-history">
      <h3>History</h3>
      <ol class="dc-events" data-field="events"></ol>
    </div>
  </div>
</template>

<footer class="site-footer dc-footer">
  <nav class="dc-footer-nav" aria-label="Footer"><a href="index.html">Masinloc, Zambales</a><a href="help-desk.html">Help Desk</a><a href="connect.html">Masinloc Connect</a></nav>
  <div class="footer-bottom"><span>© 2026 Mabayani Project by FMB. All rights reserved.</span><span>Private desk console · masinloc-zambales.com</span></div>
</footer>
<script type="module" src="desk-console.js?v=20260831-1"></script>
</body></html>
"""


for desk in DESKS:
    path = ROOT / f"{desk['code']}-desk.html"
    path.write_text(console(desk), encoding="utf-8")
    state = "activated" if desk["activated"] else "not activated"
    print(f"{path.name}: {desk['name']} console ({state})")
