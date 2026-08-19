# Masinloc Website Build Guardrails

This repository is built deliberately by stages. Each stage must remain stable, complete and understandable before the public surface expands.

## Current public surface

- Home
- A Closer Look
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

## Non-negotiable guardrails

1. **Real place photography stays real.** Approved destination/community photography must never be AI-recreated, generatively filled, geographically altered, or have structures invented/removed.
2. **One asset, one job.** Public photography is a normal static asset. Do not split images into HTML tiles, base64 text chunks, runtime reconstruction code, or generated replacements.
3. **Essential content does not depend on JavaScript.** The hero, page identity, copy and navigation destinations must exist in HTML/CSS. JavaScript may enhance interaction, not unlock basic visibility.
4. **Facts need provenance.** Do not identify a landmark, church, barangay, destination, person, historical detail or cultural claim more specifically than verified sources support.
5. **Masinloc Connect is a stable boundary.** Do not refactor its submission flows, data contract, Supabase behavior or admin backend during unrelated public-site work. Backend changes require their own tested change set.
6. **No fake population.** Empty editorial sections stay intentionally empty until real, reviewed material is ready. Do not add sample headlines, fake dates, placeholder articles, invented authors, or synthetic history just to make a page look populated.
7. **No unfinished navigation.** Apart from the intentionally complete purpose pages above, do not add navigation, cards, links or promises for unfinished routes. A new stage becomes public only when its page, content, responsive behavior and QA land together.
8. **Use the shared public design system.** `site.css` and `site.js` are the shared shell for public editorial pages. Do not create another homepage/hero stylesheet to override them. Masinloc Connect may retain its app-specific `styles.css` because it is a functional submission experience.
9. **Route changes are migrations.** Public URL changes require redirects, canonical updates and sitemap review in the same release. Do not casually rename indexed pages.
10. **Mobile is a first-class surface.** Every stage must be checked at desktop and phone widths before merge. No horizontal overflow, hidden essential content, or desktop-only navigation assumptions.
11. **No dead architecture.** Remove superseded loaders, duplicate stylesheets, temporary repair workflows, reconstruction artifacts and abandoned assets after the replacement is verified.
12. **Keep secrets out of the repository.** Local `.env` files stay ignored. Client-safe public keys do not replace server-side authorization or database policies.
13. **The `Site integrity` check must pass before merge.** It validates public routes, local references, SEO essentials, the hero binary/dimensions, admin indexing protection, absence of obsolete hero mechanisms, and absence of unfinished future-stage routes.

## Current hero contract

- Source: `assets/stage1/masinloc-hero.avif`
- Expected dimensions: 1536 x 864
- The homepage references it directly in HTML.
- No JavaScript is required for the image to render.
- No alternate hero asset, loader, tile grid or reconstruction path should coexist with it after repair is complete.

## Current public routes

- `/`
- `/a-closer-look.html`
- `/verified-history.html`
- `/masinloc-bulletin.html`
- `/connect.html`

Only current public routes belong in `sitemap.xml`.

## Future checkpoints

- Before deeper admin features: audit Supabase RLS/policies and authorization behavior.
- Before moving `a-closer-look.html` to a cleaner URL: add the redirect and canonical update in the same release.
- Before publishing Verified History entries: record source/provenance, verification status, author/editor, and any unresolved conflict between sources.
- Before publishing Bulletin entries: define article type, date, byline, source/credit rules, correction policy, and social-sharing image requirements.
- Before Stage 2 navigation expands: complete the actual Stage 2 pages, verify facts/assets, update sitemap, and pass desktop/mobile QA.
- Before adding local listings/directories: define source, review, update and removal rules so outdated or unverified listings do not accumulate.
