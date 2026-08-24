# Content-Security-Policy readiness

Assessment only. **No security headers were changed.** This records what a CSP
would have to permit, what currently stands in the way, and what it would cost
to remove each obstacle.

Measured against the tree at the time of writing by enumerating every page,
script, stylesheet, network call and external origin the site actually uses.

## The headline

The site is closer to a strict CSP than sites like it usually are, and the
reason is worth stating because it is easy to lose by accident.

**All 41 inline `<script>` blocks are `application/ld+json`.** Browsers do not
execute a script element whose type is not a JavaScript MIME type, so those
blocks are data, not code, and `script-src` does not have to allow inline
script for them. Every executable script on the site is an external
same-origin file. That means `script-src 'self'` is achievable today with no
nonces, no hashes, and no refactoring.

There is no `eval` and no `new Function` anywhere, including in the vendored
`supabase-js` bundle, so `'unsafe-eval'` is not needed either.

The blockers are all on the **style** side, and one of them is large.

## What a policy would have to permit

### `script-src 'self'`
15 external script files, all same-origin relative paths. No CDN, no analytics,
no tag manager, no third-party script of any kind.

`assets/vendor/supabase.js` is vendored locally rather than loaded from a CDN,
which is what keeps this clause clean.

### `style-src` — the blocker
Three separate things need solving, in increasing order of effort:

1. **Two inline `<style>` blocks.** `404.html` (1,454 bytes) and `privacy.html`
   (2,864 bytes). Both are static and could be hashed (`'sha256-…'`) or moved
   into files. Cheap either way.

2. **62 inline `style="…"` attributes** in shipped HTML — 54 in `index.html`,
   8 in `destinations.html`. Style *attributes* are not covered by a hash; CSP
   Level 3 needs `'unsafe-hashes'` for them, which weakens the clause
   noticeably. The clean fix is to move them into classes.

3. **Inline styles written at runtime by JavaScript.** `app-base.js` (4 sites),
   `homepage.js` (2), `app.js` (1) assign `element.style.…`, and `admin.js`
   and `app-base.js` build markup containing `style="…"` from template
   strings — including values interpolated from config (`cfg.color`,
   `cfg.ink`). This is the real work. `element.style.x = …` is *not* blocked
   by `style-src` (it is a DOM property write, not a stylesheet), but the
   `style="…"` attributes inside those template strings are.

**Consequence:** `style-src 'self'` is not reachable without touching
`index.html`, `destinations.html`, `admin.js` and `app-base.js`. A first
deployment would need `style-src 'self' 'unsafe-inline'`, which is honest but
buys much less than the script clause does.

### `connect-src`
- `'self'`
- `https://uwcqvsitjtknxsaypjxj.supabase.co` — three surfaces are used:
  - `/functions/v1/submit-masinloc` (all public form submissions, and the
    `?resource=dictionary-contributors` GET)
  - `/rest/v1/dictionary_entries` (the editable dictionary layer)
  - Supabase Auth, on `admin.html` only

One caveat: the vendored `supabase-js` bundle contains Realtime, which opens
`wss://`. Nothing in this site's own code subscribes to Realtime, so a policy
that omits `wss:` should be safe — but this is the clause most likely to
produce a surprise report, so it is the one to watch in report-only mode.

### `img-src 'self'`
Every image is same-origin. No `data:` image URIs, no remote images, no
tracking pixels. Clean.

### `font-src` — nothing required
There is no `@font-face` anywhere and no Google Fonts. All three families in
`tokens.css` are system stacks. `font-src 'self'` (or omitting it) is correct.

### `form-action 'self'`
Three `<form>` elements, none with an `action` attribute — all submit via
JavaScript to the Supabase function. `'self'` is sufficient.

### `frame-src` / `frame-ancestors`
No `<iframe>`, `<embed>`, `<object>`, `<video>` or `<audio>` anywhere.
`frame-src 'none'` is accurate. `frame-ancestors 'none'` would duplicate the
`X-Frame-Options: DENY` already in `vercel.json`, and is the modern form of it.

### `worker-src`
`supabase-js` contains `new Worker` and `URL.createObjectURL`. `admin.js` and
`app-base.js` also call `createObjectURL`, for file handling rather than
workers. If a worker is ever constructed from a blob, `worker-src` would need
`blob:`. Not currently exercised by any code path this site runs, but it is the
second thing to watch in report-only mode.

### External origins that are links only
`officialgazette.gov.ph`, `psa.gov.ph`, `pia.gov.ph`, `pna.gov.ph`,
`smcglobalpower.com.ph` and similar appear only as `<a href>` citations in the
research pages. Navigation is not governed by `default-src`, so these need
nothing. (`schema.org` and `w3.org` appear only inside JSON-LD `@context`
values and XML namespaces — also not fetched.)

## Suggested sequencing

1. **Report-only first.** Ship `Content-Security-Policy-Report-Only` with the
   strict script clause and a permissive style clause. This is the step that
   catches whatever this static analysis missed, and it cannot break the site.
2. **Enforce the script side.** `script-src 'self'` is ready now and is where
   most of the value is — it is the clause that stops injected script.
3. **Then earn the style side.** Move the 62 inline attributes into classes and
   hash or extract the two `<style>` blocks. Only then drop `'unsafe-inline'`
   from `style-src`.

A first policy would look roughly like:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self';
font-src 'self';
connect-src 'self' https://uwcqvsitjtknxsaypjxj.supabase.co;
form-action 'self';
frame-src 'none';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
```

Not applied. Nothing in `vercel.json` was touched.
