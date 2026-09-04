# Masinloc Connect

Masinloc Connect is an independent public community platform for Masinloc, Zambales, Philippines.

**Canonical website:** https://www.masinloc-zambales.com/

The website connects public information about Masinloc's places, culture, Sambal Tina language, local history, opportunities, businesses, and community services. It is the public source of truth for this repository's production website.

Masinloc Connect is not an official website, program, office, or service of the Municipal Government of Masinloc, the Province of Zambales, or any Philippine government agency.

## Main public sections

- Discover Masinloc: https://www.masinloc-zambales.com/discover/
- Places and destinations: https://www.masinloc-zambales.com/destinations.html
- Sambal Tina Dictionary: https://www.masinloc-zambales.com/sambal-tina.html
- Verified History: https://www.masinloc-zambales.com/verified-history.html
- Marketplace: https://www.masinloc-zambales.com/marketplace.html
- Jobs and opportunities: https://www.masinloc-zambales.com/jobs.html
- Sources and references: https://www.masinloc-zambales.com/sources.html
- Trust, privacy, identity and disclosures: https://www.masinloc-zambales.com/trust.html

## Search and crawler integrity

The production site publishes:

- `robots.txt` for crawler permissions
- `sitemap.xml` for canonical indexable URLs
- `llms.txt` as supplemental machine-readable topic guidance
- canonical metadata and structured data on indexable pages

Repository CI checks the site's SEO contract, crawler access, privacy boundaries, security invariants, browser behavior, responsive layout, and content-specific integrity before production changes are accepted.

## Development policy

`main` is the production baseline. New work should start from the latest accepted `main`, stay on a focused working branch, pass the repository's required QA, and merge through review rather than bypassing the existing integrity checks.
