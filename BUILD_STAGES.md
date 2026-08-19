# Masinloc staged build contract

This repository is built deliberately by stages. A future stage may add capability, but it must not weaken or silently replace what an earlier stage already does.

## Stage 1 — current public surface

- Home
- A Closer Look at Masinloc
- Masinloc Connect
- Contact path
- Shared public visual system and navigation
- SEO baseline
- Automated site verification

Stage 1 must feel complete on its own. Do not expose navigation to unfinished pages.

## Planned stages

### Stage 2
Discover Masinloc, destinations, history and heritage.

### Stage 3
Sambal Tina, people of Masinloc and community stories.

### Stage 4
Local businesses, professionals, food, stays and practical discovery.

### Stage 5
Deeper search, directory and community features.

## Permanent guardrails

1. **Real location photography stays real.** Do not use generative replacement, generative fill, invented structures or altered geography for documentary/destination imagery.
2. **One asset, one job.** Hero photography must be a normal static image referenced directly by HTML/CSS. Do not split it into image tiles, base64 text chunks or runtime reconstruction scripts.
3. **No invisible dependencies.** Essential content, imagery, navigation and page identity must render without JavaScript. JavaScript may enhance interaction, not unlock basic visibility.
4. **No future-page placeholders in public navigation.** Add a route only when the page is ready to ship.
5. **Preserve Masinloc Connect.** Future public-site redesigns must not break the existing submission flows or silently change their data contract.
6. **Facts need provenance.** Do not name a landmark, historical claim or cultural fact more specifically than the verified source supports.
7. **Shared visual language.** Public content pages should use the shared site design system instead of introducing page-specific copies of the same navigation, button, typography or spacing rules.
8. **Mobile is a first-class surface.** Every stage must be checked at desktop and phone widths before merge.
9. **No dead files as architecture.** Remove superseded loaders, duplicate stylesheets, temporary repair workflows and abandoned generated assets once the replacement is verified.
10. **Run the verifier before merge.** `python3 scripts/verify_site.py` must pass.

## Stage-change rule

A stage change should be reviewable as one coherent unit: routes, content, assets, navigation changes, responsive behavior and verification should land together. Avoid partial public exposure of a future stage.
