# Masinloc Website Build Guardrails

This repository is built deliberately by stages. Each stage must remain stable, complete and understandable before the public surface expands.

## Stage plan

- Stage 1: Home, A Closer Look, Masinloc Connect, Contact
- Stage 2: Discover Masinloc, destinations, history and heritage
- Stage 3: Sambal Tina, people of Masinloc, stories
- Stage 4: Local businesses, professionals, Eat / Stay / Find
- Stage 5: Deeper community features, search and directory capabilities

## Non-negotiable guardrails

1. **Real place photography stays real.** Approved destination/community photography must never be AI-recreated, generatively filled, geographically altered, or have structures invented/removed.
2. **One asset, one job.** Public photography is a normal static asset. Do not split images into HTML tiles, base64 text chunks, runtime reconstruction code, or generated replacements.
3. **Essential content does not depend on JavaScript.** The hero, page identity, copy and navigation destinations must exist in HTML/CSS. JavaScript may enhance interaction, not unlock basic visibility.
4. **Facts need provenance.** Do not identify a landmark, church, barangay, destination, person, historical detail or cultural claim more specifically than verified sources support.
5. **Masinloc Connect is a stable boundary.** Do not refactor its submission flows, data contract, Supabase behavior or admin backend during unrelated public-site work. Backend changes require their own tested change set.
6. **No future-stage placeholders.** Do not add navigation, cards, links or promises for unfinished routes. A new stage becomes public only when its page, content, responsive behavior and QA land together.
7. **Use the shared public design system.** `site.css` and `site.js` are the shared shell for public editorial pages. Do not create another homepage/hero stylesheet to override them. Masinloc Connect may retain its app-specific `styles.css` because it is a functional submission experience.
8. **Route changes are migrations.** Public URL changes require redirects, canonical updates and sitemap review in the same release. Do not casually rename indexed pages.
9. **Mobile is a first-class surface.** Every stage must be checked at desktop and phone widths before merge. No horizontal overflow, hidden essential content, or desktop-only navigation assumptions.
10. **No dead architecture.** Remove superseded loaders, duplicate stylesheets, temporary repair workflows, reconstruction artifacts and abandoned assets after the replacement is verified.
11. **Keep secrets out of the repository.** Local `.env` files stay ignored. Client-safe public keys do not replace server-side authorization or database policies.
12. **The `Site integrity` check must pass before merge.** It validates Stage 1 routes, local references, SEO essentials, the hero binary/dimensions, admin indexing protection, absence of obsolete hero mechanisms, and absence of unfinished future-stage routes.

## Current Stage 1 contracts

### Public visual shell

- Shared stylesheet: `site.css`
- Shared navigation enhancement: `site.js`
- Editorial content pages: `index.html`, `a-closer-look.html`
- Functional submission experience: `connect.html` using its dedicated app styles/scripts
- The public shell must remain clean, editorial and location-led rather than dashboard/card-template driven.

### Hero

- Source: `assets/stage1/masinloc-hero.avif`
- Expected dimensions: 1536 x 864
- The homepage references it directly in HTML.
- No JavaScript is required for the image to render.
- No alternate hero asset, loader, tile grid or reconstruction path should coexist with it.

### Current public routes

- `/`
- `/a-closer-look.html`
- `/connect.html`

Only current public routes belong in `sitemap.xml`.

## Future checkpoints

- Before deeper admin features: audit Supabase RLS/policies and authorization behavior.
- Before moving `a-closer-look.html` to a cleaner URL: add the redirect and canonical update in the same release.
- Before Stage 2 navigation ships: complete the actual Stage 2 pages, verify facts/assets, update sitemap, and pass desktop/mobile QA.
- Before adding local listings/directories: define source, review, update and removal rules so outdated or unverified listings do not accumulate.
