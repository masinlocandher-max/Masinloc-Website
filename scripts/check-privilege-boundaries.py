#!/usr/bin/env python3
"""Stop a SECURITY DEFINER function from shipping without a door on it.

WHY THIS EXISTS. A SECURITY DEFINER function runs with its owner's rights, so
it ignores row-level security. That is the point of it — the emergency
activation helpers need it — but it means each one is a hole through the RLS
wall, and the only thing keeping the hole safe is a check inside the function
body or a grant that stops users calling it at all.

Today every such function in this repository has one or the other. Nothing
enforced that; it was true by care. Care does not survive a hurried migration
written at handover, and the failure is silent: the function works, the tests
pass, and any signed-in account can read residents' emergency reports through
it. This file makes that failure loud instead.

WHAT COUNTS AS SAFE. One of:

  * the body consults who is calling — auth.uid(), auth.jwt(), a
    *_is_platform_admin() / *_is_agency_member() / *_can_access_* helper, or
    the request JWT claims directly;
  * it is a trigger function, which cannot be invoked by a client at all;
  * execution is revoked from public, anon and authenticated, so no user
    reaches it — the rate limiter is the honest example: it takes a
    fingerprint and has no business asking who is calling, so instead nobody
    but the service role may call it.

WHAT THIS CANNOT SEE. Only functions defined in supabase/migrations/. The
project's live database also carries functions that were applied without ever
being written down — check-migrations-apply.py reports that gap by name. Those
are outside this check because they are outside the repository, and pretending
otherwise would be worse than saying so.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SQL = "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS)

# The body consults the caller's identity in some form.
ASKS_WHO = re.compile(
    r"auth\.uid\(\)"
    r"|auth\.jwt\(\)"
    r"|\w*is_platform_admin\s*\("
    r"|\w*is_agency_member\s*\("
    r"|\w*can_access\w*\s*\("
    r"|current_setting\(\s*['\"]request\.jwt",
    re.I,
)

problems: list[str] = []
checked = 0
safe_by_grant: list[str] = []


def revoked_from_users(name: str) -> bool:
    """Execution taken away from every role a browser can present."""
    for match in re.finditer(
        rf"revoke\s+(?:all|execute)[^;]*\bon\s+function\s+(?:public\.)?{re.escape(name)}\s*\([^)]*\)[^;]*;",
        SQL, re.I | re.S,
    ):
        clause = match.group(0).lower()
        if "anon" in clause and "authenticated" in clause:
            # A later grant hands it back. Every grant after the revoke has to
            # be examined, not just the next one: the pattern that actually
            # reopens a function is a revoke, a narrow grant to service_role
            # that looks reassuring, and a wider grant further down.
            after = SQL[match.end():]
            for regranted in re.finditer(
                rf"grant\s+execute\s+on\s+function\s+(?:public\.)?{re.escape(name)}\s*\([^)]*\)\s*to\s+([^;]+);",
                after, re.I | re.S,
            ):
                if re.search(r"\b(anon|authenticated|public)\b", regranted.group(1), re.I):
                    return False
            return True
    return False


for match in re.finditer(
    r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\((.*?)\)(.*?)\$(\w*)\$(.*?)\$\4\$",
    SQL, re.S | re.I,
):
    name, head, body = match.group(1), match.group(3), match.group(5)
    if "security definer" not in head.lower():
        continue
    checked += 1

    if re.search(r"returns\s+trigger", head, re.I):
        continue                      # not reachable from a client
    if ASKS_WHO.search(body):
        continue                      # decides for itself who may proceed
    if revoked_from_users(name):
        safe_by_grant.append(name)
        continue                      # nobody with a browser can call it

    problems.append(
        f"{name}() is SECURITY DEFINER, so it runs past row-level security, but its "
        f"body never asks who is calling and execution is not revoked from anon and "
        f"authenticated. Either check the caller inside it, or revoke execute from "
        f"public, anon, authenticated and grant it only to service_role."
    )

if not MIGRATIONS:
    print("No migrations found.")
    sys.exit(0)

if problems:
    print("PRIVILEGE BOUNDARY CHECK FAILED")
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1)

print(f"Privilege boundaries: all {checked} SECURITY DEFINER functions in "
      f"supabase/migrations either check their caller, are trigger-only, or are "
      f"unreachable by anon and authenticated.")
if safe_by_grant:
    print(f"  Reachable only by the service role: {', '.join(sorted(safe_by_grant))}")
print("  Not covered: functions applied to the hosted database without a migration "
      "file — check-migrations-apply.py names those.")
