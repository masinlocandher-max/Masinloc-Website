# Deploying and verifying the backend

The Supabase backend is version-controlled in `supabase/` and is already deployed to project `uwcqvsitjtknxsaypjxj`.

This runbook is the recovery, redeploy, and verification procedure. Do not infer production state from this file alone: always inspect the linked project first.

## Required pre-deploy checks

From the repository root, all repository checks and all 15 browser suites must pass before a production code push or function redeploy:

```bash
for s in scripts/check-*.py; do python3 "$s"; done
python3 -m http.server 8000 --bind 127.0.0.1 &
```

Then run the browser suites in the exact order in `.github/workflows/browser-qa.yml`.

Never disable or weaken a check to make a deploy pass.

## Establish the live state first

```bash
supabase functions list --project-ref uwcqvsitjtknxsaypjxj
supabase migration list --project-ref uwcqvsitjtknxsaypjxj
```

The two public form functions are:

- `submit-masinloc`
- `business-dashboard-interest`

Both must be deployed with JWT verification disabled. These endpoints are called by anonymous visitors; the functions enforce their own origin allowlist, rate limiting, honeypot, input limits, upload validation, and optional Turnstile checks.

`submit-professional-profile` also exists in the project but is a separate professional-profile flow and is not part of this two-function deploy command.

## Database migrations

Link the project and push pending migrations normally:

```bash
supabase link --project-ref uwcqvsitjtknxsaypjxj
supabase db push
```

The migration directory now contains both the repository migrations and the historical production versions needed to keep migration history reconcilable. Do not delete an apparently duplicated historical migration just because a later idempotent migration covers the same table; the timestamp is part of the deployed history.

The backend depends on:

- `business_submissions`
- `story_submissions`
- `professional_submissions`
- `resume_support_submissions`
- `dictionary_submissions`
- `contact_submissions`
- `dictionary_entries`
- `submission_rate_limits`
- `security_events`
- `check_submission_rate_limit()`

The production project also carries later hardening migrations for professional-profile recovery, business-owner privacy, dashboard interest, security-event categories, function search paths, FK indexes, and dictionary defaults.

### Business Dashboard columns

`business-dashboard-interest` requires:

```sql
alter table public.business_submissions
  add column if not exists dashboard_interest boolean not null default false,
  add column if not exists dashboard_interest_at timestamptz;
```

The statement is safe if the columns already exist. Verify before changing anything.

## Deploy the functions

```bash
supabase functions deploy submit-masinloc --no-verify-jwt
supabase functions deploy business-dashboard-interest --no-verify-jwt
```

Do not omit `--no-verify-jwt` for these two public submission endpoints.

## Optional Turnstile

Turnstile is disabled unless the project secrets enable it:

```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key
supabase secrets set TURNSTILE_REQUIRED=true
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase and should not be set manually.

## HTTP verification

```bash
BASE=https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc

curl -s "$BASE?resource=dictionary-contributors" \
  -H "Origin: https://www.masinloc-zambales.com"

curl -s -o /dev/null -w '%{http_code}\n' \
  "$BASE?resource=dictionary-contributors"

curl -s -w '\n%{http_code}\n' \
  "$BASE?resource=anything-else" \
  -H "Origin: https://www.masinloc-zambales.com"
```

Expected behavior:

- allowed-origin contributors request: HTTP 200 and `{"ok":true,"contributors":[...],"count":...}`
- no Origin header: HTTP 403
- unknown resource from an allowed Origin: HTTP 404 and `{"ok":false,"error":"Not found"}`

A 404 because the Edge Function itself does not exist means the function was not deployed. A 500 from a deployed function usually means its database contract is incomplete or another server-side dependency failed; inspect Edge Function and Postgres logs rather than guessing.

## End-to-end proof

The GET checks only prove that the function answers. The complete path is proven by a real browser submission from the live site followed by a matching production row.

Test both:

1. `https://www.masinloc-zambales.com/contact.html` → `contact_submissions`
2. the contribution form on `https://www.masinloc-zambales.com/sambal-tina.html` → `dictionary_submissions`

For each test, record the HTTP result/reference code, confirm the matching row, then remove only the clearly identified test record. Never delete or modify unrelated submissions.

## Security integrity

`security_events.category` must accept every category handled by `submit-masinloc`: `business`, `story`, `dictionary`, `contact`, `professional`, and `resume`. `scripts/check-backend-contract.py` enforces this relationship so a new form category cannot silently lose security logging.

After schema changes, review Supabase security and performance advisors. Treat service-role-only tables with RLS and no browser policy as intentional only when their grants confirm that design.
