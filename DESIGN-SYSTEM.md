# Masinloc Design System

The website should feel like one Masinloc product across editorial pages, community tools, and private operations. Consistency does not mean every page is identical; it means every surface uses the same identity, hierarchy, spacing logic, and interaction language.

## Locked identity

- Logo asset: `assets/masinloc-logo.webp`
- Primary blue: `#0D3B9E`
- Bright blue: `#1E63E9`
- Red: `#E61E25`
- Yellow: `#FFC700`
- Navy: `#061A46`
- Deep navy: `#03112F`
- Ink: `#111827`
- Soft surface: `#F7F8FB`
- Divider: `#E6E9F0`

The blue-red-yellow rule is a restrained brand accent, not a decorative pattern to repeat everywhere.

## Typography

- Interface and navigation: system/SF Pro/Segoe-style sans serif.
- Large destination identity: strong modern sans serif.
- Editorial headlines and story-led statements: Georgia/Times-style serif.
- Body copy: highly readable system sans serif, except deliberate editorial lead paragraphs.

Do not introduce a new display font for an individual page.

## Public navigation

The permanent order is:

1. Home
2. A Closer Look
3. Verified History
4. Masinloc Bulletin
5. Masinloc Connect
6. Contact

Every public page shows the same destinations, labels, order, logo, mobile menu behavior, and exactly one current-page state.

## Surface families

### Editorial public pages

Files: Home, A Closer Look, Verified History, Masinloc Bulletin.

Use `site.css`, `site-polish.css`, and `site.js`. These pages use generous white space, editorial serif headlines, clean dividers, restrained blue-red-yellow accents, deep-navy footer treatment, and subtle motion.

### Masinloc Connect

Masinloc Connect is a functional submission product, so its forms and category interactions may use a more application-like layout. It must still use the same logo, palette, navigation order, typography hierarchy, footer family, motion restraint, and responsive standards. Its presentation layers are `styles.css`, `connect-polish.css`, and `connect-shell.css`.

### Admin workspace

The admin is private and operational, not a public editorial page. It may prioritize density and controls, but it still uses the Masinloc palette, system typography, logo, rounded control language, restrained shadows, and tricolor accent through `admin-polish.css`.

### 404

The 404 page is a deliberate exception: a minimal deep-navy recovery screen using the white Masinloc logo, editorial headline, and existing public button language.

## Motion

- Motion should communicate hierarchy or state, never decorate for its own sake.
- Use short fades, restrained translate transitions, subtle hero parallax, and clear button/hover feedback.
- No bouncing, looping, spinning, or excessive entrance animation.
- Always respect `prefers-reduced-motion`.

## Photography

- Real Masinloc photography stays real.
- No generative recreation, invented structures, altered geography, or fake destination imagery.
- Use the approved hero as a normal static image asset.
- HTML and CSS overlays remain separate from photography.

## Responsive standard

- Mobile is designed, not merely compressed.
- No horizontal overflow.
- Navigation becomes a deliberate hamburger/dropdown system.
- Touch targets should be at least approximately 44 px.
- Important copy and calls to action must remain legible over imagery.

## Release gate

A stage is not ready until all three checks pass:

- Site Integrity
- Design Consistency
- Browser QA

Browser QA must include desktop and phone-width rendering and screenshots. Visual review happens from those screenshots before production merge.
