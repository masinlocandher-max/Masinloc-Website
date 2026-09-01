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

The public intake functions are:

- `submit-masinloc`
- `business-dashboard-interest`
- `emergency-response`

All must be deployed with JWT verification disabled. These endpoints are called by anonymous visitors. Each enforces its own origin allowlist, validation, and abuse controls appropriate to its intake contract.

`submit-professional-profile` also exists in the project as a separate professional-profile flow and is included in the complete deploy command below.

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
supabase functions deploy submit-professional-profile --no-verify-jwt
supabase functions deploy emergency-response --no-verify-jwt
```

Do not omit `--no-verify-jwt` for these four public intake endpoints.

`submit-professional-profile` was missing from this list until 2026-08-25, and
its source was missing from the repository entirely. That is why it kept a
broken CORS preflight for two days after the same fault was repaired in the
other two: nobody was looking at it, and nothing deployed it. All three are
version-controlled now, and `scripts/check-security.py` fails the build if any
of them goes missing or reintroduces a 204 with a body.

### Pending redeploy

`submit-professional-profile` in this repository is ahead of the deployed
version. The live copy still returns a body with its 204 preflight and still
trusts any `masinloc-website-*.vercel.app` or `masinloc-connect-*.vercel.app`
origin. Deploying the command above brings production in line.

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

## Emergency Help Desk activation and handoff

The resident Help Desk is operational only when the emergency migrations, Edge Function, and verified responder memberships are all present. The PNP and MDRRMO consoles intentionally show no incident data to an unprovisioned account.

1. Create each responder in Supabase Auth. Do not enable public sign-up for responder access.
2. Independently resolve the Auth user id, agency, and duty role with the receiving office.
3. As a platform administrator, add the user to `public.emergency_agency_members`. Allowed roles are `operator`, `dispatcher`, and `supervisor`.
4. Confirm PNP cannot read MDRRMO-only reports, and MDRRMO cannot read PNP-only reports, unless an authorized responder requests cross-agency support.
5. Submit one clearly labelled acceptance-test report to each agency from `/emergency/`. Verify receipt, acknowledgement, assignment, dispatch/en-route, on-scene, resident reply, private internal note, and resolution.
6. Capture the acceptance record, then remove only the identified test incidents. Never alter or remove resident reports during testing.

Use a verified Auth user id in this statement. The zero UUID is deliberately non-operational and must never be pasted unchanged:

```sql
insert into public.emergency_agency_members
  (user_id, agency, role, display_name, active)
values
  ('00000000-0000-0000-0000-000000000000', 'pnp', 'dispatcher', 'Verified duty officer', true)
on conflict (user_id, agency) do update
set role = excluded.role,
    display_name = excluded.display_name,
    active = excluded.active;
```

Verify the deployed public boundary without creating a report:

```bash
# No browser Origin: must be rejected with HTTP 403.
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/emergency-response

# Production Origin with an invalid report identity: HTTP 404, Report not found.
curl -sS -H 'Origin: https://www.masinloc-zambales.com' \
  -H 'Content-Type: application/json' \
  --data '{"action":"status","client_report_id":"00000000-0000-4000-8000-000000000000","report_secret":"invalid"}' \
  https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/emergency-response
```

The emergency endpoint is anonymous by design and must be deployed with `--no-verify-jwt`. It authenticates resident status and messaging with a high-entropy per-report secret. Agency consoles authenticate through Supabase Auth and RLS. Never place a service-role key in `emergency/` or any browser-delivered asset.
