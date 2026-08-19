# Masinloc Website Build Guardrails

This repository is built in stages. Keep each stage stable before expanding the public surface.

## Stage plan

- Stage 1: Home, A Closer Look, Masinloc Connect, Contact
- Stage 2: Discover Masinloc, destinations, history and heritage
- Stage 3: Sambal Tina, people of Masinloc, stories
- Stage 4: Local businesses, professionals, Eat / Stay / Find
- Stage 5: Deeper community features, search and directory capabilities

## Non-negotiable guardrails

1. Public photography must be a normal static asset. Do not split images into HTML slices, base64 text chunks, runtime reconstruction code, or generated replacements.
2. Approved place photography must not be AI-recreated or geographically altered. Do not invent or remove structures.
3. Do not identify a landmark, church, barangay, destination, person, or historical claim unless it has been verified.
4. Masinloc Connect and the admin/submission backend are a stable boundary. Do not refactor them during unrelated public-site work. Backend changes need their own tested change set.
5. Route changes require redirects and canonical review. Do not casually rename public URLs after they are indexed.
6. Keep secrets out of the repository. Local `.env` files are ignored. Public Supabase keys may be client-safe, but authorization must remain enforced server-side and with database policies.
7. New stages must not create navigation links, cards, or promises for pages that are not ready.
8. The `Site integrity` GitHub check must pass before merging. It verifies Stage 1 pages, local file references, the hero asset, and known obsolete hero mechanisms.

## Current hero contract

- Source used by the site: `assets/stage1/masinloc-hero.avif`
- Expected dimensions: 1536 × 864
- The homepage references it directly in HTML.
- No JavaScript is required for the image to appear.
- `home.css` is the single source of truth for the public Stage 1 hero layout.

## Future checkpoints

Before deeper admin features are added, audit Supabase RLS/policies and authorization behavior. Before moving `a-closer-look.html` to a cleaner URL, add a redirect and update its canonical in the same release. Add future sections to the sitemap only when they are actually public.
