#!/usr/bin/env python3
"""Guard the PNP and MDRRMO assistance desks.

Three things can go wrong here, and two of them are dangerous rather than
merely untidy.

THE DANGEROUS ONES.

A resident could be shown a working form for a desk nobody is reading. That is
the failure this whole feature is shaped around: somebody types instead of
dialling, and the message sits in a table until it does not matter any more.
So report.html's state must match `activated` in data/assistance-desks.json —
no desk activated means the form is rendered disabled and the closed notice is
on the page, and a desk activated means it is not.

Or the emergency path could slip below the form. The hotlines must appear
before the first input in document order. A reader who scrolls past a text box
first has already started composing, and the "call instead" that follows is a
paragraph they will not read.

THE UNTIDY ONE. A private console could leak into public navigation, a footer
or the sitemap — the same rule jobs-source-desk.html follows. A console found
by accident is a sign-in page for a service the finder cannot use, on a site
that otherwise never dead-ends.

This file also refuses an 'emergency' report kind anywhere in the stack. If
this channel is ever wanted for urgent traffic, that is a different product
with an on-call rota behind it, and it does not arrive by adding a value to an
enum.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESK_DATA = ROOT / "data" / "assistance-desks.json"
REPORT = ROOT / "report.html"
SITEMAP = ROOT / "sitemap.xml"
MIGRATION = ROOT / "supabase" / "migrations" / "20260831120000_assistance_desks_pnp_mdrrmo.sql"

problems: list[str] = []

if not DESK_DATA.is_file():
    sys.exit("data/assistance-desks.json is missing — the desks have no source of truth")
if not REPORT.is_file():
    sys.exit("report.html has not been built — run scripts/build-report.py")

spec = json.loads(DESK_DATA.read_text(encoding="utf-8"))
desks = spec["desks"]
report = REPORT.read_text(encoding="utf-8")
flat = " ".join(report.split())

activated = [d for d in desks if d["activated"]]
consoles = [f"{d['code']}-desk.html" for d in desks]

# --- 1. the form's state is the truth about who is reading ----------------

form_disabled = bool(re.search(r'<fieldset class="rp-all" disabled>', report))
submit_disabled = bool(re.search(r'id="reportSubmit" disabled', report))
closed_notice = "not open yet" in flat

if activated:
    if form_disabled or submit_disabled:
        problems.append(
            f"{len(activated)} desk(s) are activated but report.html still renders its "
            f"form disabled — residents cannot reach a desk that is open.")
    if closed_notice:
        problems.append(
            "report.html still shows the closed notice while a desk is activated")
else:
    if not form_disabled:
        problems.append(
            "no desk is activated, but report.html's form is not disabled. A form that "
            "accepts a message nobody can read is worse than one that says it is closed: "
            "somebody writes instead of calling.")
    if not submit_disabled:
        problems.append("no desk is activated, but report.html's submit button is enabled")
    if not closed_notice:
        problems.append(
            "no desk is activated, but report.html does not say so. The page must state "
            "plainly that the channel is not open and to call instead.")

# An activated desk has to name who was onboarded and when. Flipping a boolean
# without recording that is how a desk ends up "open" because of a merge.
for desk in activated:
    activation = desk.get("activation") or {}
    if not activation.get("onboarded") or not activation.get("date"):
        problems.append(
            f"desk {desk['code']!r} is activated but records no `onboarded` name and "
            f"`date`. A desk is open because a named person agreed to read it, and that "
            f"belongs on the record.")

# --- 2. the emergency path comes first -------------------------------------

emergency_at = report.find('class="rp-emergency"')
first_input = min(
    (position for position in
     (report.find("<input"), report.find("<textarea"), report.find("<select"))
     if position != -1),
    default=-1)

if emergency_at == -1:
    problems.append("report.html has no emergency block — the hotlines must be on the page")
elif first_input != -1 and emergency_at > first_input:
    problems.append(
        "report.html puts a form field before the emergency hotlines. Somebody who "
        "reaches a text box first has already started writing.")

for phrase, why in (
    ("If this is an emergency, call", "the page must say so before anything else"),
    ("no officer signed" if not activated else "Send to the desk",
     "the page must describe its actual state"),
):
    if phrase not in flat:
        problems.append(f"report.html no longer says {phrase!r} — {why}")

# --- 2b. the conversation must not imply somebody is there -----------------

# A thread invites an expectation a form does not: that there is somebody on
# the other end, roughly now. There is not. So the vocabulary of presence is
# refused outright — not because these words are wrong in general, but because
# on this page each one is a claim about staffing that nothing can keep.
LIVENESS = [
    ("online now", "presence"),
    ("is typing", "presence"),
    ("typing…", "presence"),
    ("live chat", "immediacy"),
    ("chat now", "immediacy"),
    ("we are here", "presence"),
    ("respond immediately", "a response time nobody promised"),
    ("reply immediately", "a response time nobody promised"),
    ("instant reply", "a response time nobody promised"),
    ("24/7", "a staffing claim nobody made"),
]
lowered = flat.lower()
for phrase, why in LIVENESS:
    if phrase in lowered:
        problems.append(
            f"report.html says {phrase!r}, which implies {why}. This channel is "
            f"asynchronous and nothing about it may suggest otherwise.")

# And the page must keep saying, on the thread itself, that it is not watched.
if "rp-thread" in report and "not monitored continuously" not in flat:
    problems.append(
        "report.html shows a conversation without saying it is not monitored "
        "continuously — a thread implies presence unless it says it does not")

# --- 3. no emergency report kind, anywhere --------------------------------

for desk in desks:
    for value, _label in desk["kinds"]:
        if "emergency" in value.lower():
            problems.append(
                f"desk {desk['code']!r} declares the report kind {value!r}. This channel "
                f"is never for emergencies; an urgent channel needs an on-call rota, not "
                f"a new enum value.")

if MIGRATION.is_file():
    sql = MIGRATION.read_text(encoding="utf-8")
    # The quoted values only. The constraint carries line comments, one of
    # which legitimately reads "not an active emergency" — matching the raw
    # text failed the build on a comment that says the right thing.
    kinds = re.search(r"assistance_reports_kind_check.*?in \((.*?)\)", sql, re.S)
    if kinds:
        values = re.findall(r"'([^']+)'", kinds.group(1))
        for value in values:
            if "emergency" in value.lower():
                problems.append(
                    f"the assistance_reports kind constraint allows {value!r}")
    # The resident-facing promise rests on these: no anon insert path that
    # bypasses the Edge Function's rate limiting, and no delete at all.
    if re.search(r"create policy[^;]*assistance_reports[^;]*for insert[^;]*to anon", sql, re.I | re.S):
        problems.append(
            "an anon insert policy on assistance_reports would route around the Edge "
            "Function's origin allowlist, rate limiting and bot check")
    if re.search(r"create policy[^;]*assistance_reports[^;]*for delete", sql, re.I):
        problems.append("a delete policy on assistance_reports — a report once made is kept")

# --- 4. the consoles stay private ------------------------------------------

for name in consoles:
    path = ROOT / name
    if not path.is_file():
        problems.append(f"{name} has not been built — run scripts/build-desk-consoles.py")
        continue
    raw = path.read_text(encoding="utf-8")
    robots = re.search(r'<meta name="robots" content="([^"]+)"', raw)
    directives = {d.strip() for d in (robots.group(1).lower().split(",") if robots else [])}
    for required in ("noindex", "nofollow", "noarchive"):
        if required not in directives:
            problems.append(f"{name}: private console is missing robots {required}")

if SITEMAP.is_file():
    sitemap = SITEMAP.read_text(encoding="utf-8")
    for name in consoles:
        if name in sitemap:
            problems.append(f"sitemap.xml lists the private console {name}")

# Nothing public links to a console. Checked against every page that is not
# itself a console, which is what "not in public navigation" actually means —
# a footer link is as public as a nav one.
for page in sorted(ROOT.glob("*.html")) + sorted(ROOT.glob("*/*.html")):
    if page.name in consoles:
        continue
    raw = page.read_text(encoding="utf-8")
    for name in consoles:
        if f'href="{name}"' in raw or f'href="/{name}"' in raw:
            problems.append(
                f"{page.relative_to(ROOT)} links to the private console {name}")

if problems:
    print("ASSISTANCE DESK CHECK FAILED")
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1)

state = (f"{len(activated)} activated ({', '.join(d['name'] for d in activated)})"
         if activated else "none activated — report.html renders its form closed")
print(f"Assistance desks: {len(desks)} declared, {state}. "
      f"Emergency path first on report.html, no emergency report kind, "
      f"{len(consoles)} consoles private and unlinked.")
