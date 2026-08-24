# Moving the Marketplace onto live data

The Marketplace currently builds from `data/marketplace.json`. This is what
would have to exist in Supabase for it to read approved businesses directly
instead, and why none of it was done from here.

**Nothing in this file has been applied.** It is a description of work, not a
record of it.

## Why the page does not query the table today

`business_submissions` predates this repository, so there is no migration here
describing it. Two things are missing regardless:

1. **No public read path.** The table has no `anon` SELECT policy. Adding one
   naively would expose `owner_name`, `owner_email` and `owner_phone`, which sit
   on the same row as the public fields.
2. **No category column.** The submission form never collected one, so category
   is editorial classification. It lives in the data file and would need a real
   column, or a mapping table, before it could come from the database.

There is also a third problem that is not about the database at all — see
**Images** below.

The dictionary already solves the first problem properly, and is the pattern to
copy: `sambal-tina.js` reads `dictionary_entries` with an explicit column list
against a `status=eq.published` filter, and the table's grants make that safe
even if the browser asked for more.

## What the public and private columns are

Taken from what `submit-masinloc` actually writes for `category=business`:

| Column | Public? |
| --- | --- |
| `brand_name` | yes |
| `store_locations` | yes |
| `short_description` | yes |
| `contact_number` | yes — the number the business publishes |
| `facebook_page` | yes, when it is a resolvable page URL |
| `brand_logo_path` | only via a signed URL or a public bucket |
| `owner_name` | **no** |
| `owner_email` | **no** |
| `owner_phone` | **no** — this is the owner's own line, not the business number |
| `reference_code`, `id`, `status` | **no** |
| `dashboard_interest`, `dashboard_interest_at` | **no** |

The two phone columns are the whole privacy model. Anything that treats them as
interchangeable is a leak.

## Option A — a resource on the edge function (recommended)

The function already does exactly this for the dictionary contributors roll:
it selects a fixed column list server-side, so the browser cannot ask for more
regardless of what it sends. Adding `?resource=marketplace` alongside it means
no new RLS policy and no new public surface on the table.

Sketch, mirroring `dictionaryContributors()`:

```ts
async function marketplace() {
  const { data, error } = await supabase.from("business_submissions")
    .select("brand_name, store_locations, short_description, contact_number, facebook_page")
    .eq("status", "approved")
    .order("brand_name", { ascending: true })
    .limit(500);
  if (error) { console.error("marketplace_db_error", error.message); throw new Error("DB"); }
  return data ?? [];
}
```

The column list is the security boundary. Do not replace it with `select("*")`
and filter in the browser.

Deploy with `supabase functions deploy submit-masinloc`. Note that
`check-backend-contract.py` walks page → resource → function, so the page may
only fetch `?resource=marketplace` once the function in `supabase/functions/`
implements it — that guard exists precisely to stop a page shipping against an
endpoint that is not deployed.

## Option B — a scoped RLS policy and a direct read

Closer to how the dictionary page reads, but it puts a public surface on a
table that holds private columns, so the grants have to be exactly right.

```sql
alter table public.business_submissions enable row level security;

create policy "approved businesses are publicly readable"
  on public.business_submissions for select to anon
  using (status = 'approved');

revoke all on public.business_submissions from anon;
grant select (brand_name, store_locations, short_description,
              contact_number, facebook_page)
  on public.business_submissions to anon;
```

The column-level `grant` is what actually protects the owner fields; the policy
alone does not. Verify with a request that asks for `owner_email` explicitly and
confirm it is refused rather than returned empty.

## Category

Neither option supplies one. Either:

- add `category text` to the table and to the business branch of the submission
  form, backfilling the existing rows; or
- keep classification editorial and join it in at build time from
  `data/marketplace.json` by slug.

The second keeps a human deciding what "Services" means, which is probably
right for a directory this size.

## Images

This one is not a database problem. `submit-masinloc` creates
`masinloc-business-assets` with `public:false`, so an uploaded logo cannot be
loaded by a public page at all. Both currently approved businesses submitted a
logo and neither can be displayed. Two ways out, and they are not equivalent:

- **Signed URLs.** Keeps the bucket private. Needs the service role, so the URLs
  must be minted server-side — the same edge-function resource in Option A could
  return one per business. They expire, so a statically generated page would
  need regenerating before they do.
- **A public bucket for logos only.** Simpler, and a business logo submitted for
  publication is not sensitive. But it should be a *separate* bucket from the
  one holding story and resume attachments, which are private and must stay so.

The second is probably the right call, but it is a decision about what the
business agreed to publish, so it is not one to make silently.

## Whichever route is taken

`scripts/check-marketplace-privacy.py` inspects the built pages rather than the
data source, so it keeps working unchanged and is worth keeping: it is the check
that would catch a live feed handing a page an owner's phone number.
