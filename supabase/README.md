# Backend

The pages are static, but three of them talk to Supabase: Masinloc Connect,
the admin console, and the Sambal Tina dictionary. That backend used to exist
only in the Supabase dashboard, which is how the dictionary shipped with a
contribution form pointing at a category and a table that had never been
created — every submission failed with a generic 400, the contributor list
showed an error, and no check in the repo could see it.

So it lives here now.

```
supabase/
  functions/submit-masinloc/index.ts   the public intake endpoint
  migrations/*.sql                     schema, in apply order
```

`scripts/check-backend-contract.py` walks the contract in both directions and
fails the build if a page asks for something the backend does not implement:

```
page  ->  category / resource  ->  edge function  ->  column  ->  migration
admin ->  table / column                          ->  migration
```

It runs in `site-integrity.yml`. Tables that predate this repository are
reported rather than failed, so the remaining gap stays visible.

## Deploying

Both steps need a Supabase login with access to project `uwcqvsitjtknxsaypjxj`.

```bash
supabase link --project-ref uwcqvsitjtknxsaypjxj
supabase db push                             # applies migrations/
supabase functions deploy submit-masinloc --no-verify-jwt
```

`--no-verify-jwt` is required: the endpoint is called by anonymous visitors
submitting a form. It does not rely on Supabase auth for its own protection.
It checks the request origin against an allowlist, rate-limits per IP and
category, verifies a Turnstile token when `TURNSTILE_REQUIRED` is set, drops
anything that trips the honeypot field, validates and length-caps every value,
and sniffs magic bytes on uploads. Deploying it with JWT verification on would
reject every real submission.

## How a word becomes a credit

1. A reader submits a word or a correction on `sambal-tina.html`. It lands in
   `dictionary_submissions` with `status = 'pending'`. Nothing is published.
2. An admin opens the **Sambal Tina** tab in `admin.html`, checks the word
   against the archive, writes verification notes, and sets the status.
3. Setting it to `approved` or `published` is what makes it public. The
   contributor's name then appears in the contributors list on the dictionary
   page — but only if they ticked the consent box when they submitted.

The contributors endpoint (`?resource=dictionary-contributors`) selects only
`credit_name` and `contributor_name`. `contributor_contact` is never in the
query, so it cannot reach the page even by mistake, and the browser has no read
access to the table at all — RLS admits signed-in admins only.
