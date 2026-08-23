#!/usr/bin/env python3
"""Fail CI on high-signal security regressions in the static site and Edge Functions."""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

TEXT_EXTS = {".js", ".ts", ".html", ".json", ".yml", ".yaml", ".md"}
SKIP_PARTS = {".git", "node_modules", "assets/vendor"}


def fail(message: str) -> None:
    errors.append(message)


def text_files():
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTS:
            continue
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith("assets/vendor/") or any(part in {".git", "node_modules"} for part in path.parts):
            continue
        yield path, rel


secret_patterns = [
    re.compile(r"sb_secret_[A-Za-z0-9_-]{16,}"),
    re.compile(r"(?:service[_-]?role|secret)[A-Za-z0-9_-]*\s*[:=]\s*['\"]eyJ[A-Za-z0-9._-]{40,}", re.I),
]

for path, rel in text_files():
    content = path.read_text(encoding="utf-8", errors="ignore")
    for pattern in secret_patterns:
        if pattern.search(content):
            fail(f"possible server secret committed in {rel}")
    if rel.endswith((".js", ".html")) and not rel.startswith("supabase/functions/"):
        if "SUPABASE_SERVICE_ROLE_KEY" in content:
            fail(f"service-role environment variable referenced by browser code in {rel}")
    if rel.startswith("supabase/functions/") and rel.endswith("index.ts"):
        if 'Access-Control-Allow-Origin": "*"' in content or "Access-Control-Allow-Origin': '*'" in content:
            fail(f"wildcard CORS in {rel}")
        if 'endsWith(".vercel.app")' in content or "endsWith('.vercel.app')" in content:
            fail(f"broad Vercel preview-origin trust in {rel}; production must use an exact allowlist")
    if rel.endswith(".js") and not rel.startswith("scripts/"):
        if re.search(r"\beval\s*\(", content) or re.search(r"\bnew\s+Function\s*\(", content):
            fail(f"dynamic code execution found in {rel}")

vercel_path = ROOT / "vercel.json"
try:
    vercel = json.loads(vercel_path.read_text(encoding="utf-8"))
    global_headers = {}
    for rule in vercel.get("headers", []):
        if rule.get("source") == "/(.*)":
            global_headers = {h.get("key", "").lower(): h.get("value", "") for h in rule.get("headers", [])}
            break
    required = {
        "content-security-policy",
        "x-content-type-options",
        "referrer-policy",
        "x-frame-options",
        "permissions-policy",
        "strict-transport-security",
    }
    missing = sorted(required - set(global_headers))
    if missing:
        fail("missing global response headers: " + ", ".join(missing))
    csp = global_headers.get("content-security-policy", "")
    for directive in ("default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"):
        if directive not in csp:
            fail(f"CSP missing required directive: {directive}")
except Exception as exc:
    fail(f"could not validate vercel.json: {exc}")

if errors:
    print("SECURITY CHECK FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("Security regression checks passed.")
