#!/usr/bin/env bash
# Rebuild assets/vendor/supabase.js.
#
# The admin workspace is the only page with a third-party runtime dependency.
# It is vendored rather than loaded from a CDN so that a CDN outage cannot take
# the private admin offline, and so Browser QA does not fail on an unreachable
# third-party host.
#
# Usage:  scripts/build-vendor.sh [version]
set -euo pipefail

VERSION="${1:-2.112.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund "@supabase/supabase-js@${VERSION}" esbuild >/dev/null

echo "export * from '@supabase/supabase-js';" > entry.js
./node_modules/.bin/esbuild entry.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none --outfile=bundle.js

mkdir -p "$ROOT/assets/vendor"
{
  echo "/* @supabase/supabase-js v${VERSION} — MIT License, Supabase Inc."
  echo "   Bundled for the browser with esbuild (ESM, es2020) and served from this"
  echo "   origin so the private admin does not depend on a third-party CDN being"
  echo "   reachable. Rebuild with scripts/build-vendor.sh. */"
  cat bundle.js
} > "$ROOT/assets/vendor/supabase.js"

echo "wrote assets/vendor/supabase.js (@supabase/supabase-js v${VERSION})"
echo "Remember to bump the ?v= query in admin.js to match."
