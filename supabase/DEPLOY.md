# Deploying and verifying the Masinloc backend

Production project: `uwcqvsitjtknxsaypjxj`

This directory is the source of truth for the Masinloc database migrations and public Edge Functions. Do not assume the dashboard matches the repository: check production before every deployment and verify it again afterward.

## Production inventory

Three public Edge Functions are part of the Masinloc backend:

- `submit-masinloc` — business, story/history, dictionary, contact, professional legacy intake, and resume-support submissions.
- `submit-professional-profile` — current professional-profile intake, duplicate handling, and recovery challenge flow.
- `business-dashboard-interest` — records a verified business owner's interest in the future dashboard.

All three are intentionally deployed with JWT verification disabled because visitors are not signed in. Their protection is implemented in the function body: exact origin allowlists, method and content-type checks, request-size limits, keyed rate-limit fingerprints, global abuse ceilings, honeypots where applicable, input limits, private storage, upload MIME and magic-byte checks where applicable, and security-event logging.

`SUPABASE_SERVICE_ROLE_KEY` belongs only inside Edge Functions. It must never appear in browser JavaScript, HTML, logs, or screenshots. The public admin client uses a publishable key and RLS is the authorization boundary.

## Before changing production

```bash
cd /path/to/Masinloc-Website

supabase login
supabase link --project-ref uwcqvsitjtknxsaypjxj
supabase migration list --project-ref uwcqvsitjtknxsaypjxj
supabase functions list --project-ref uwcqvsitjtknxsaypjxj
```

Compare those results with this repository. If production contains a migration or function that is missing here, stop and reconcile the drift before deploying unrelated work.

## Apply database migrations

```bash
supabase db push
```

Migrations are additive/idempotent where practical. Security migrations deliberately revoke browser access to internal abuse-prevention, sequence, duplicate-challenge, and recovery-challenge state. Do not grant `anon` or ordinary `authenticated` access to those objects to make a browser error disappear; fix the calling path instead.

## Deploy all Masinloc functions

```bash
supabase functions deploy submit-masinloc --no-verify-jwt
supabase functions deploy submit-professional-profile --no-verify-jwt
supabase functions deploy business-dashboard-interest --no-verify-jwt
```

Deploying only a subset creates production drift. If one function changes, still verify the inventory and record which versions are active.

## Bot verification / Cloudflare Turnstile

The functions support Turnstile, but `TURNSTILE_REQUIRED=true` must not be enabled until the browser forms render a real Turnstile widget and send its token. Enabling the secret without the frontend integration would reject legitimate visitors.

Once the frontend widget is deployed and verified:

```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key
supabase secrets set TURNSTILE_REQUIRED=true
```

Do not commit either secret. Keep hostname validation restricted to the canonical Masinloc domains and the exact production Vercel alias. Do not use wildcard `*.vercel.app` preview origins against the production database.

## Admin authentication hardening

The admin console supports password and magic-link login and relies on `app_metadata.role = admin` plus RLS. In Supabase Auth settings, keep public sign-up disabled and enable leaked-password protection for password login. Prefer the magic-link path for routine admin access and use a unique, strong password for the admin account.

## Verify after deployment

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
curl -s "$BASE?resource=anything-else" \
  -H "Origin: https://masinloc-zambales.com"
# expect: {"ok":false,"error":"Not found"}
```

Then complete one real submission through the production site and confirm it appears in the private admin console. Check the Supabase security and performance advisors after any DDL migration.

## Security invariants

- RLS stays enabled on every table exposed through the Data API.
- Internal security/rate/recovery tables stay service-role only.
- Private uploads stay in private Storage buckets and are opened through short-lived signed URLs for authorized admins only.
- Public functions never trust a browser merely because it presents a Vercel-looking hostname.
- Browser code never receives the service-role key.
- Security-event raw IP retention is temporary; hashed/pseudonymous fingerprints are used for pattern detection.
- Production and GitHub source must describe the same functions and migrations.
