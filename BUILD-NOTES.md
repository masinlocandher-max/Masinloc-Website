# Masinloc Website Build Guardrails

This repository is built deliberately by stages. Each stage must remain stable, complete and understandable before the public surface expands.

## Current public surface

- Home
- A Closer Look
  - Sambal Tina Dictionary
- Verified History
- Masinloc Bulletin
- Masinloc Connect
- Contact

`Verified History` and `Masinloc Bulletin` are intentionally live first as purpose pages. They establish the permanent editorial sections without publishing placeholder articles or invented content.

## Stage plan

- Stage 1: stable public shell, A Closer Look, Verified History purpose page, Masinloc Bulletin purpose page, Masinloc Connect, Contact
- Stage 2: Discover Masinloc, destinations, and the first verified history releases
- Stage 3: Sambal Tina, people of Masinloc, and community stories
- Stage 4: Local businesses, professionals, Eat / Stay / Find
- Stage 5: Deeper community features, search, archives, and directory capabilities

## Section purposes

### Verified History

A source-led archive for the documented history of Masinloc. Material belongs here only when it can be supported by records, credible references, archival material, or properly attributed evidence. Documented history must remain clearly separated from oral accounts, local memory, interpretation, and claims still being checked.

### Masinloc Bulletin

The official publishing desk of the independent Masinloc platform. It may publish explainers, news, public-interest updates, features, notices, and other editorial stories relevant to Masinloc. It must never be presented as an official municipal government news service. Published work should make sources, context, and verification status clear.

## Completed hardening checkpoint — August 21, 2026

The mobile and Masinloc Connect hardening pass is complete and merged into `main`.

- Shared mobile brand rendering is governed by `site-stability.css` across the public site, Masinloc Connect, admin, and the 404 page.
- Masinloc Connect drafts expire after seven days. File selections are not persisted as draft data, and full submitted personal information is not retained in the local receipt cache after submission.
- The public submission flow has a frontend honeypot connected to the server-side honeypot check.
- Business, story, and resume uploads have category-specific client and server validation for count, type, size, and server-side file signatures.
- Optional existing-resume upload is supported as one private PDF up to 10 MB in `masinloc-resume-assets`; access is through short-lived admin-only signed URLs.
- The submission rate-limit RPC can be executed only by `service_role`.
- Submission tables and security logs remain protected by RLS and role-based admin policies.
- Admin CSV export neutralizes spreadsheet-formula prefixes before creating a CSV.
- Static production security headers are defined in `vercel.json`.
- Browser QA now includes focused Masinloc Connect checks for mobile wording, logo sizing, overflow, expired drafts, the honeypot, and upload controls.

### Remaining account-level security actions

These are not code regressions and cannot be completed from repository code alone:

- Enable Supabase Auth leaked-password protection in the project Auth settings.
- Cloudflare Turnstile hooks exist in the frontend and submission function, but enforcement must remain off until the correct production site key, secret, allowed hostnames, and `TURNSTILE_REQUIRED=true` are configured together and tested end to end.
- Protect the GitHub `main` branch with required status checks when repository settings access is available. Until then, the merge workflow and written branch policy are operational guardrails rather than a GitHub-enforced rule.
- Confirm that `masinloc-zambales.com` is attached to the intended production deployment and that the deployment source is this repository's `main` branch. Hosting/domain ownership is outside repository code and must be verified at the hosting account.

## Sambal Tina dictionary

**The Masinloc Sambal Tina Dictionary** is a record of the **Mabayani Project
by FMB**, and is credited to the project on the page. The compilation work —
reading the source archive across three layers, cross-linking the main body
against the printed index, reviewing ambiguous glyphs, and assigning
confidence and source status — is the project's own. The compiler name lives
in `COMPILER` in `scripts/build-dictionary.py`; changing it there and
rebuilding updates the data and the page together.

It is published from `data/sambal-tina.json`: one ordinary JSON file, fetched
normally, built by `scripts/build-dictionary.py` from the project's working
master.

Every entry carries the archive page it was transcribed from, a source
status, a confidence rating of 1–5 and any open QA note. **All of that is
carried through to the published data and shown on the page.** A reader can
see how far to trust any entry and which page to check it against.

### Rules for this data

1. **Never silently repair a glyph.** Parts of the record survive only as
   damaged text (`ab61`, `ab6h`, `abanlko`). Publish them under review; do not
   invent a plausible spelling. A wrong guess enters the permanent record for
   a language with few written sources.
2. **Provenance is not optional.** Every entry must keep its confidence
   rating and archive page reference. `scripts/check-dictionary.py` fails the
   build if any entry loses either, if the page stops crediting the compiler,
   if it stops explaining what the page numbers refer to, or if the counts
   stated in the page copy drift from the data.
3. **The visitor phrasebook stays at confidence 4 or better** and carries no
   entry with an open QA note.
4. **Data is served as data.** No gzip streams, no base64, no split
   fragments, no runtime reconstruction — see guardrail 2 below. Vercel
   compresses the file over the wire; 341 KB of JSON ships as about 112 KB.
5. **Corrections come through review.** Changes are checked against the
   archive before the published data moves.

### Internal provenance record

*This section is repository documentation. It is not published on the site.*

The wordlist was transcribed from a printed source held by the project, by
way of the "Sambal Tina Strong Collection" working master exported from the
project's Drive. The public pages present the dictionary as the project's own
compilation and refer to the underlying material as "the source archive"
rather than naming or dating it; that presentation was a deliberate decision
by the project owner.

Two consequences worth keeping in view:

- **Rights in the underlying wordlist have not been established.** The
  compilation, transcription, review and presentation are the project's own
  and are marked as such. The wordlist itself is a separate question.
  Confirm the position — permission, public domain, or government issue —
  before printing the dictionary, licensing the data onward, or promoting it
  beyond this site.
- **The page numbers only mean something against the archive they came
  from.** Keep the archive intact and retrievable. If it is ever lost, the
  citations become unverifiable and the confidence ratings lose their basis.

## Non-negotiable guardrails

1. **Real place photography stays real.** Approved destination/community photography must never be AI-recreated, generatively filled, geographically altered, or have structures invented/removed.
2. **One asset, one job.** Public photography is a normal static asset. Do not split images into HTML tiles, base64 text chunks, runtime reconstruction code, or generated replacements. **This applies to data as much as to images:** a dictionary, a timeline or any dataset ships as one ordinary file that the browser fetches. Compression is the server's job.
3. **Essential content does not depend on JavaScript.** The hero, page identity, copy and navigation destinations must exist in HTML/CSS. JavaScript may enhance interaction, not unlock basic visibility.
4. **Facts need provenance.** Do not identify a landmark, church, barangay, destination, person, historical detail or cultural claim more specifically than verified sources support.
5. **Masinloc Connect is a stable boundary.** Do not refactor its submission flows, data contract, Supabase behavior or admin backend during unrelated public-site work. Backend changes require their own tested change set.
6. **No fake population.** Empty editorial sections stay intentionally empty until real, reviewed material is ready. Do not add sample headlines, fake dates, placeholder articles, invented authors, or synthetic history just to make a page look populated.
7. **No unfinished navigation.** Apart from the intentionally complete purpose pages above, do not add navigation, cards, links or promises for unfinished routes. A new stage becomes public only when its page, content, responsive behavior and QA land together.
8. **One palette, defined once.** `tokens.css` is the only file that may define an identity colour, and it loads first on every surface. Do not restate a brand hex in a page stylesheet, and never hardcode one in JavaScript — inline styles beat every stylesheet, which is how Masinloc Connect drifted onto a superseded palette. `Design consistency` fails on any identity hex found outside `tokens.css`.

9. **Use the shared public design system.** `site.css`, `site-polish.css`, `site-stability.css`, and `site.js` are the shared shell for public editorial pages. Do not create another homepage/hero stylesheet to override them. Masinloc Connect keeps `styles.css`, `connect-polish.css`, and `connect-shell.css` for its functional submission experience, plus the shared stability layer for brand/mobile consistency. Presentation changes must not silently rewrite its data contract.
10. **Route changes are migrations.** Public URL changes require redirects, canonical updates and sitemap review in the same release. Do not casually rename indexed pages.
11. **Mobile is a first-class surface.** Every stage must be checked at desktop and phone widths before merge. No horizontal overflow, hidden essential content, or desktop-only navigation assumptions.
12. **No dead architecture.** Remove superseded loaders, duplicate stylesheets, temporary repair workflows, reconstruction artifacts and abandoned assets after the replacement is verified.
13. **Keep secrets out of the repository.** Local `.env` files stay ignored. Client-safe public keys do not replace server-side authorization or database policies.
14. **The `Site integrity` check must pass before merge.** It validates public routes, local references, SEO essentials, the hero binary/dimensions, admin indexing protection, absence of obsolete hero mechanisms, and absence of unfinished future-stage routes.
15. **No design iteration directly on `main`.** Active work happens on a fresh `agent/*` branch created from the latest `main`. Vercel previews remain disabled for `agent/*` branches unless the deployment policy is deliberately changed. Merge only when the work is ready for production.
16. **One production merge per finished stage whenever practical.** Batch visual refinements, QA fixes, and editorial-shell changes on the stage branch before merging. Avoid chains of tiny production commits.
17. **Do not claim a production deployment from a Git merge alone.** After a production merge, verify the hosting deployment and custom domain separately before saying the public site is updated.

## Non-Vercel development workflow

1. Create a fresh `agent/*` branch from the latest stable `main`.
2. Build and polish there without using the production host as a design preview.
3. Run Site Integrity and Design Consistency after meaningful changes.
4. Run Browser QA and any feature-specific QA before review.
5. Keep Verified History and Masinloc Bulletin empty until reviewed material exists.
6. Do not merge solely to preview a design.
7. When a stage is complete, review the diff, confirm all required checks are green, then merge once.
8. Verify the production deployment/domain after merge as a separate release check.

## Current hero contract

- Source: `assets/stage1/masinloc-hero.avif`
- Expected dimensions: 1536 x 864
- The homepage references it directly in HTML.
- No JavaScript is required for the image to render.
- No alternate hero asset, loader, tile grid or reconstruction path should coexist with it after repair is complete.

## Current public routes

- `/`
- `/a-closer-look.html`
- `/sambal-tina.html`
- `/verified-history.html`
- `/masinloc-bulletin.html`
- `/connect.html`

Only current public routes belong in `sitemap.xml`.

## Future checkpoints

- Before moving `a-closer-look.html` to a cleaner URL: add the redirect and canonical update in the same release.
- Before publishing Verified History entries: record source/provenance, verification status, author/editor, and any unresolved conflict between sources.
- Before publishing Bulletin entries: define article type, date, byline, source/credit rules, correction policy, and social-sharing image requirements.
- Before Stage 2 navigation expands: complete the actual Stage 2 pages, verify facts/assets, update sitemap, and pass desktop/mobile QA.
- Before adding local listings/directories: define source, review, update and removal rules so outdated or unverified listings do not accumulate.
- Before enabling Turnstile enforcement: configure production keys/hostnames and test successful and rejected submissions end to end.
- After any backend schema or authorization change: rerun Supabase security advisors and verify the relevant RLS/storage policies.
