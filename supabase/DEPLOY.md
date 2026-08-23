# Deploying the backend

Everything in `supabase/` is written and tested but **not deployed**. It has to
be run from a machine signed in to Supabase, which this repository's automation
is not and should not be. Until someone runs the steps below, the contact form
and the Sambal Tina contribution form accept what a visitor types and then fail
to send it.

Run these on your own computer, once. Fifteen minutes, mostly waiting.

## What you need

- The Supabase account that owns project `uwcqvsitjtknxsaypjxj`.
- The Supabase CLI. If you have Node: `npx supabase@latest --help` works
  without installing anything. Otherwise `brew install supabase/tap/supabase`
  on a Mac, or see https://supabase.com/docs/guides/local-development/cli.
- The database password for the project, for `db push`. It is in the dashboard
  under **Project Settings → Database**. If nobody remembers it, reset it
  there first — resetting is safe and does not touch any data.

Everything below writes `supabase`; if you are using npx, write
`npx supabase@latest` instead, every time.

## The four commands

```bash
cd /path/to/Masinloc-Website

supabase login                                   # opens a browser
supabase link --project-ref uwcqvsitjtknxsaypjxj # asks for the db password
supabase db push                                 # applies supabase/migrations/
supabase functions deploy submit-masinloc --no-verify-jwt
supabase functions deploy business-dashboard-interest --no-verify-jwt
```

There are **two** functions. `submit-masinloc` carries every form on the site;
`business-dashboard-interest` records a business owner asking to be told when
the dashboard exists. Deploying one and not the other leaves the other's
button failing, so deploy both.

`--no-verify-jwt` is not optional and is not a loosening of security. The
endpoint is called by anonymous visitors filling in a form; nobody signs in to
send a message. With JWT verification on, Supabase rejects every real
submission before the function ever runs. The function does its own protection
instead — origin allowlist, per-IP rate limit, honeypot, length caps, magic-byte
sniffing on uploads, optional Turnstile — and none of that depends on auth.

### What `db push` will apply

Four migrations. All four are written so that running them against a project
where the objects already exist changes nothing: `create table if not exists`
throughout, and the rate-limit function is created only when no function of
that name exists, so a working one made in the dashboard is never replaced.

| Migration | What it creates |
| --- | --- |
| `20260822000000_dictionary_submissions.sql` | `dictionary_submissions` — words and corrections from readers |
| `20260822010000_contact_submissions.sql` | `contact_submissions` — messages from the contact form |
| `20260822020000_dictionary_entries.sql` | `dictionary_entries` — the editable layer over the archive |
| `20260823000000_rate_limit_and_security_events.sql` | `submission_rate_limits` + `check_submission_rate_limit()` + `security_events` |

That last one exists because the edge function calls the rate-limit function on
**every** POST, before anything else, and treats a missing one as a server
error — so without it the forms would fail on a fresh project exactly as they
fail now, just with a different reason. All four were applied to a real
PostgreSQL 16 database in order, twice, and the rate limiter was exercised:
eight submissions through, the ninth refused, a different visitor unaffected,
and the counter starting over once the fifteen-minute window passes.

Four other tables — `business_submissions`, `professional_submissions`,
`resume_support_submissions`, `story_submissions` — were made in the dashboard
before this repository existed and have no migration here. `db push` will not
touch them. `scripts/check-backend-contract.py` lists them every run so they
stay visible rather than forgotten.

### One thing to check on `business_submissions`

`business-dashboard-interest` writes two columns that no migration here can
guarantee exist, because the table itself lives only in the dashboard:
`dashboard_interest` and `dashboard_interest_at`. If they are missing the
function returns 500 and the owner sees "We could not save your interest right
now." In the dashboard's SQL editor:

```sql
alter table public.business_submissions
  add column if not exists dashboard_interest boolean not null default false,
  add column if not exists dashboard_interest_at timestamptz;
```

Safe to run whether or not they are already there — it does nothing if they
are.

### Optional: Turnstile

The bot check is off unless you turn it on. To enable it:

```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key
supabase secrets set TURNSTILE_REQUIRED=true
```

Leave both unset and the function skips the check. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are provided by the platform — do not set them.

## Checking it worked

```bash
BASE=https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc

# 1. The function exists and can read the contributors roll.
curl -s "$BASE?resource=dictionary-contributors" -H "Origin: https://masinloc-zambales.com"
#    expect: {"ok":true,"contributors":[...],"count":0}
#    an empty list is correct — nobody has been approved yet

# 2. A request from nowhere in particular is refused.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE?resource=dictionary-contributors"
#    expect: 403

# 3. An unknown resource is refused rather than guessed at.
curl -s "$BASE?resource=anything-else" -H "Origin: https://masinloc-zambales.com"
#    expect: {"ok":false,"error":"Not found"}
```

If the first one returns `{"ok":false,"error":"Not found"}` with a 404, the
function did not deploy. If it returns a 500, the function deployed but
`db push` did not run.

Then send a real message through https://masinloc-zambales.com/contact.html and
look for it in the admin console. That is the only test that proves the whole
path.

## Until then

Both forms fail. They fail politely — the browser shows *"We could not send
your message just now. Please try again in a few minutes — your message is
still here."*, and the text the visitor typed stays in the box — but the
message does not arrive and there is nowhere for it to have gone. Nothing in
this repository can change that; only the four commands above can.
