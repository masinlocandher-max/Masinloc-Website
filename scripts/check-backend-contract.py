#!/usr/bin/env python3
"""Check that the backend the pages call actually exists.

The Sambal Tina dictionary shipped with a contribution form, a contributor
roll and an admin tab, all of them talking to an edge function category and a
database table that had never been created. Every submission failed with a
generic 400 and the contributor list showed an error, and nothing in the repo
noticed, because the backend lived only in the Supabase dashboard.

So the backend now lives in supabase/ alongside the pages, and this walks the
contract in both directions:

    page  ->  category / resource  ->  edge function  ->  column  ->  migration
    admin ->  table / column                          ->  migration

A category the browser posts to, a resource it fetches, a column the function
writes or the admin reads: each has to be implemented somewhere in supabase/,
or this fails. Tables that predate the repo are reported rather than failed,
so the gap stays visible without blocking a build on work nobody asked for.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = ROOT / "supabase" / "functions"
MIGRATIONS = ROOT / "supabase" / "migrations"

errors: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


# --- what the browser asks for -----------------------------------------------

def page_scripts() -> list[Path]:
    """Every script a page can load, ignoring the admin console and vendor."""
    return sorted(
        path for path in ROOT.glob("*.js")
        if path.name != "admin.js"
    )


categories: dict[str, list[str]] = {}
resources: dict[str, list[str]] = {}

for script in page_scripts():
    text = script.read_text(encoding="utf-8")
    for match in re.finditer(r"""append\(\s*['"]category['"]\s*,\s*['"]([\w-]+)['"]""", text):
        categories.setdefault(match.group(1), []).append(script.name)
    for match in re.finditer(r"""[?&]resource=([\w-]+)""", text):
        resources.setdefault(match.group(1), []).append(script.name)

# --- what the edge function implements ---------------------------------------

if not FUNCTIONS.is_dir():
    sys.exit("missing supabase/functions; the backend is not version-controlled")

function_source = "\n".join(
    path.read_text(encoding="utf-8") for path in sorted(FUNCTIONS.rglob("*.ts"))
)

# configs = { name:{table:"...", ... }, ... }
implemented: dict[str, str] = dict(
    re.findall(r"""(\w+)\s*:\s*\{\s*table\s*:\s*["'](\w+)["']""", function_source)
)

for category, used_on in sorted(categories.items()):
    if category not in implemented:
        fail(f"{', '.join(sorted(set(used_on)))} posts category '{category}', "
             f"which the edge function does not handle")

for resource, used_on in sorted(resources.items()):
    if f'"{resource}"' not in function_source and f"'{resource}'" not in function_source:
        fail(f"{', '.join(sorted(set(used_on)))} fetches resource '{resource}', "
             f"which the edge function does not serve")

# --- what the migrations define ----------------------------------------------

migration_source = "\n".join(
    path.read_text(encoding="utf-8") for path in sorted(MIGRATIONS.glob("*.sql"))
) if MIGRATIONS.is_dir() else ""


def table_columns(table: str) -> set[str] | None:
    """Column names in a table's CREATE TABLE, or None if it is not defined here."""
    match = re.search(
        r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?" + re.escape(table)
        + r"\s*\((.*?)\n\);",
        migration_source, re.I | re.S)
    if not match:
        return None
    columns = set()
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith(("--", "constraint", "primary key", "unique", "check")):
            continue
        name = re.match(r"(\w+)\s", line)
        if name:
            columns.add(name.group(1))
    return columns


# Columns each category's row builder writes, read straight out of the function.
for category, table in sorted(implemented.items()):
    columns = table_columns(table)
    if columns is None:
        notes.append(f"{table} (category '{category}') predates this repository "
                     f"and has no migration here")
        continue
    branch = re.search(
        r"""if\s*\(\s*category\s*===\s*["']""" + re.escape(category)
        + r"""["']\s*\)\s*\{(.*?)\n  \}""", function_source, re.S)
    if not branch:
        continue
    written = set(re.findall(r"^\s{6}(\w+)\s*:", branch.group(1), re.M))
    for column in sorted(written - columns):
        fail(f"the edge function writes {table}.{column}, which the migration "
             f"does not define")

# --- what the admin console reads --------------------------------------------

admin = (ROOT / "admin.js")
if admin.is_file():
    admin_source = admin.read_text(encoding="utf-8")
    for entry in re.finditer(
            r"""\w+\s*:\s*\{\s*table\s*:\s*['"](\w+)['"](.*?)\n""", admin_source):
        table, config = entry.group(1), entry.group(2)
        columns = table_columns(table)
        if columns is None:
            continue
        # cols:[['Label','column'], ...] plus r.column accessors
        read = set(re.findall(r"""\[\s*['"][^'"]+['"]\s*,\s*['"](\w+)['"]\s*\]""", config))
        read |= set(re.findall(r"\br\.(\w+)", config))
        # Fields the console offers as editable must exist, or a save fails
        # with a database error the editor cannot act on.
        read |= set(re.findall(r"\{\s*k\s*:\s*['\"](\w+)['\"]", config))
        for column in sorted(read - columns):
            fail(f"admin.js reads {table}.{column}, which the migration does "
                 f"not define")

# --- report -------------------------------------------------------------------

if errors:
    print("BACKEND CONTRACT CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("BACKEND CONTRACT CHECK PASSED")
print(f"{len(categories)} submission categor{'y' if len(categories) == 1 else 'ies'} "
      f"and {len(resources)} read endpoint"
      f"{'' if len(resources) == 1 else 's'} requested by the pages; "
      f"every one is implemented in supabase/.")
for category, used_on in sorted(categories.items()):
    print(f"  category '{category}' -> {implemented[category]} "
          f"({', '.join(sorted(set(used_on)))})")
for resource in sorted(resources):
    print(f"  resource '{resource}' -> served by the edge function")

if notes:
    print()
    print("Not version-controlled here:")
    for note in notes:
        print(f"  - {note}")
