# Deploying and verifying the Masinloc backend

Production project: `uwcqvsitjtknxsaypjxj`

The Supabase backend is version-controlled in `supabase/` and is already deployed. This runbook is the recovery, redeploy, and verification procedure. Never infer production state from GitHub alone: inspect the linked project before changing it and verify it again afterward.

## Release gate

Before a production code push or Edge Function redeploy, run every repository check and the browser QA suites defined in `.github/workflows/browser-qa.yml`. Never disable or weaken a check to make a deployment pass.

At minimum:

```bash
for s in scripts/check-*.py; do python3 "$s"; done
```

## Establish the live state first

```bash
supabase functions list --project-ref uwcqvsitjtknxsaypjxj
supabase migration list --project-ref uwcqvsitjtknxsaypjxj
```

Compare those results with this repository. If production contains a migration or function that is missing here, reconcile the drift before deploying unrelated work.

## Production Edge Functions

Three public Edge Functions are part of the Masinloc backend:

- `submit-masinloc` — business, story/history, dictionary, contact, legacy professional intake, and resume-support submissions.
- `submit-professional-profile` — current professional-profile intake, duplicate handling, and recovery challenge flow.
- `business-dashboard-interest` — records a verified business owner's interest in the future dashboard.

All three are intentionally deployed with JWT verification disabled because visitors are not signed in. Their protection is implemented in the function body: exact origin allowlists, method/content-type checks, request-size limits, keyed rate-limit fingerprints, global abuse ceilings, honeypots where applicable, input limits, private storage, upload MIME and magic-byte checks where applicable, and security-event logging.

`SUPABASE_SERVICE_ROLE_KEY` belongs only inside Edge Functions. It must never appear in browser JavaScript, HTML, logs, screenshots, or public documentation. The admin browser client uses a publishable key; RLS is the authorization boundary.

## Database migrations

Link the project and push pending migrations normally:

```bash
supabase link --project-ref uwcqvsitjtknxsaypjxj
supabase db push
```

The migration directory contains both repository migrations and the historical production versions needed to keep deployed history reconcilable. Do not delete an apparently duplicated historical migration merely because a later idempotent migration covers the same object; the timestamp is part of the deployed history.

Security migrations deliberately deny `anon` and ordinary `authenticated` access to internal abuse-prevention, sequence, duplicate-challenge, and recovery-challenge state. Do not grant browser access to those objects to make a client error disappear; fix the calling path instead.

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

### Business Dashboard columns

`business-dashboard-interest` requires:

```sql
alter table public.business_submissions
  add column if not exists dashboard_interest boolean not null default false,
  add column if not exists dashboard_interest_at timestamptz;
```

Verify before changing anything; the statement is safe when the columns already exist.

## Deploy all Masinloc functions

```bash
supabase functions deploy submit-masinloc --no-verify-jwt
supabase functions deploy submit-professional-profile --no-verify-jwt
supabase functions deploy business-dashboard-interest --no-verify-jwt
```

Deploying only a subset creates production drift. If only one function changed, still verify the full inventory and record which versions are active.

## Bot verification / Cloudflare Turnstile

The functions support Turnstile, but `TURNSTILE_REQUIRED=true` must not be enabled until the browser forms render a real Turnstile widget and send its token. Enabling the secret without the frontend integration would reject legitimate visitors.

Once the frontend widget is deployed and verified:

```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key
supabase secrets set TURNSTILE_REQUIRED=true
```

Do not commit either secret. Keep hostname validation restricted to the canonical Masinloc domains and the exact production Vercel alias. Do not trust wildcard `*.vercel.app` preview origins against the production database.

## Admin authentication hardening

The admin console supports password and magic-link login and relies on `app_metadata.role = admin` plus RLS. In Supabase Auth settings:

- keep public sign-up disabled;
- enable leaked-password protection for password login;
- use a unique, strong admin password;
- prefer the magic-link path for routine administrator access.

## HTTP verification

```bash
BASE=https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc

# Allowed origin and known public resource.
curl -s "$BASE?resource=dictionary-contributors" \
  -H "Origin: https://masinloc-zambales.com"

# Missing origin must be refused.
curl -s -o /dev/null -w '%{http_code}\n' \
  "$BASE?resource=dictionary-contributors"
# expect: 403

# Unknown resource must be refused.
curl -s -w '\n%{http_code}\n' \
  "$BASE?resource=anything-else" \
  -H "Origin: https://masinloc-zambales.com"
# expect: 404 and {"ok":false,"error":"Not found"}
```

A 404 because the Edge Function itself does not exist means the function was not deployed. A 500 from a deployed function usually means its database contract is incomplete or another server-side dependency failed. Inspect Edge Function and Postgres logs rather than guessing.

## End-to-end proof

The GET checks prove only that the endpoint answers. Complete one real browser submission from the live site and confirm the matching production row in the private admin console. For test records, remove only the clearly identified test row; never delete unrelated submissions.

## Security integrity

- RLS stays enabled on every table exposed through the Data API.
- Internal security/rate/recovery tables stay service-role only.
- `security_events.category` must accept every submission category handled by `submit-masinloc`.
- Private uploads stay in private Storage buckets and are opened only through short-lived signed URLs for authorized admins.
- Public functions never trust a browser merely because it presents a Vercel-looking hostname.
- Browser code never receives the service-role key.
- Security-event raw IP retention is temporary; keyed pseudonymous fingerprints are used for pattern detection.
- Production and GitHub source must describe the same functions and migrations.

After DDL changes, review Supabase security and performance advisors. A service-role-only table with RLS and no browser policy can be intentional only when its grants confirm that design.
