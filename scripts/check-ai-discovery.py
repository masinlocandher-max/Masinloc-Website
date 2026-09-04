#!/usr/bin/env python3
"""Protect the site's crawler-discovery contract.

Search visibility already depends on the normal SEO checks for titles,
canonicals, sitemap membership, structured data and internal links. This file
protects the two discovery surfaces that can be broken without touching a page
at all: robots.txt and llms.txt.

It does not claim that llms.txt is a ranking signal. It only verifies that the
supplemental authority map stays consistent with the site's canonical sitemap
and that search discovery is not accidentally disabled while model-training
permissions remain a separate decision.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://www.masinloc-zambales.com"

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def parse_robots(raw: str) -> dict[str, list[tuple[str, str]]]:
    """Parse the simple robots groups this repository publishes."""
    groups: dict[str, list[tuple[str, str]]] = {}
    agents: list[str] = []
    rules: list[tuple[str, str]] = []

    def flush() -> None:
        nonlocal agents, rules
        if agents:
            for agent in agents:
                groups.setdefault(agent, []).extend(rules)
        agents = []
        rules = []

    for raw_line in raw.splitlines() + [""]:
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            if agents and rules:
                flush()
            continue
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if rules:
                flush()
            agents.append(value.lower())
        elif agents:
            rules.append((key, value))

    return groups


robots_path = ROOT / "robots.txt"
llms_path = ROOT / "llms.txt"
sitemap_path = ROOT / "sitemap.xml"

for required in (robots_path, llms_path, sitemap_path):
    if not required.is_file():
        fail(f"missing required discovery file: {required.name}")

if robots_path.is_file():
    robots_raw = robots_path.read_text(encoding="utf-8")
    groups = parse_robots(robots_raw)

    wildcard = groups.get("*", [])
    searchbot = groups.get("oai-searchbot", [])
    gptbot = groups.get("gptbot", [])

    if ("allow", "/") not in wildcard:
        fail("robots.txt: wildcard crawlers are not explicitly allowed at /")
    if ("allow", "/") not in searchbot:
        fail("robots.txt: OAI-SearchBot must be explicitly allowed at /")
    for private_path in ("/admin.html", "/wordscapes"):
        if ("disallow", private_path) not in wildcard:
            fail(f"robots.txt: wildcard group no longer protects {private_path}")
        if ("disallow", private_path) not in searchbot:
            fail(f"robots.txt: OAI-SearchBot group no longer protects {private_path}")
    if ("disallow", "/") not in gptbot:
        fail("robots.txt: GPTBot training permission changed; review explicitly")

    expected_sitemap = f"Sitemap: {SITE}/sitemap.xml"
    if expected_sitemap not in robots_raw:
        fail(f"robots.txt: missing canonical sitemap declaration {expected_sitemap}")

if llms_path.is_file() and sitemap_path.is_file():
    llms_raw = llms_path.read_text(encoding="utf-8")
    sitemap_raw = sitemap_path.read_text(encoding="utf-8")
    sitemap_urls = set(re.findall(r"<loc>([^<]+)</loc>", sitemap_raw))

    llms_urls = re.findall(r"https://www\.masinloc-zambales\.com(?:/[^\s)]*)?", llms_raw)
    normalized_urls = {url.rstrip(".,;:") for url in llms_urls}

    required_owners = {
        f"{SITE}/",
        f"{SITE}/discover/",
        f"{SITE}/destinations.html",
        f"{SITE}/sambal-tina.html",
        f"{SITE}/verified-history.html",
        f"{SITE}/founder-of-masinloc.html",
        f"{SITE}/discover/masinloc-right-now.html",
        f"{SITE}/discover/thirteen-ways-to-be-masinloc.html",
        f"{SITE}/marketplace.html",
        f"{SITE}/jobs.html",
        f"{SITE}/sources.html",
        f"{SITE}/trust.html",
        f"{SITE}/connect.html",
    }
    missing = sorted(required_owners - normalized_urls)
    if missing:
        fail("llms.txt: missing canonical topic owner(s): " + ", ".join(missing))

    for url in sorted(normalized_urls):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "www.masinloc-zambales.com":
            fail(f"llms.txt: non-canonical site URL: {url}")
        if url not in sitemap_urls:
            fail(f"llms.txt: URL is not an indexable canonical in sitemap.xml: {url}")

    lowered = llms_raw.lower()
    if "not an official website" not in lowered:
        fail("llms.txt: independent/non-government identity boundary is missing")
    if "does not override canonicals, robots directives, or the sitemap" not in lowered:
        fail("llms.txt: discovery file must state that canonical crawler controls win")
    for private_path in ("admin.html", "wordscapes", "resume"):
        if re.search(rf"https://www\.masinloc-zambales\.com/[^\s)]*{re.escape(private_path)}", lowered):
            fail(f"llms.txt: private/non-authority path is listed: {private_path}")

if errors:
    print("AI / CRAWLER DISCOVERY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("AI / CRAWLER DISCOVERY CHECK PASSED")
print("OAI-SearchBot discovery remains allowed, GPTBot training remains separate, "
      "and llms.txt points only at indexable canonical topic owners.")
