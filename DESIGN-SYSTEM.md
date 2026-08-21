# Masinloc Design System

The website should feel like one Masinloc product across editorial pages, community tools, and private operations. Consistency does not mean every page is identical; it means every surface uses the same identity, hierarchy, spacing logic, and interaction language.

## Locked identity

All colours below are defined **once**, in `tokens.css`, which every surface
links before any other stylesheet. No page stylesheet may restate a brand hex,
and no script may hardcode one — an inline style beats every stylesheet, which
is exactly how Masinloc Connect drifted onto a superseded palette. The
`Design consistency` check fails on any identity colour found outside
`tokens.css`.

- Logo asset: `assets/masinloc-logo.webp`
- Favicon: `assets/favicon.svg` (with `assets/apple-touch-icon.png`)
- Primary blue: `#0D3B9E`
- Bright blue: `#1E63E9`
- Red: `#E61E25`
- Yellow: `#FFC700`
- Navy: `#061A46`
- Deep navy: `#03112F`
- Ink: `#111827`
- Soft surface: `#F7F8FB`
- Divider: `#E6E9F0`
- Yellow ink: `#8A5A00` — stands in for yellow wherever the colour carries
  text or sits behind white type, where `#FFC700` fails contrast.

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

Use `tokens.css`, `site.css`, `site-polish.css`, and `site.js`. These pages use generous white space, editorial serif headlines, clean dividers, restrained blue-red-yellow accents, deep-navy footer treatment, and subtle motion.

### Sambal Tina dictionary

A sub-page of A Closer Look rather than a seventh primary destination, so the
permanent six-item navigation does not grow each time a section gains a detail
page. It keeps the editorial shell and adds `sambal-tina.css` for the search
and entry layout. Sub-pages are declared in `scripts/check-design-consistency.py`,
which validates their shell while expecting the parent to hold the
current-page state.

Provenance is part of the design here, not decoration: an entry shows its
review status and archive page alongside the word.

Interaction on this page is reference-grade, not decorative. Search state
(term, status filter, letter) is written to the URL so a result can be linked
and returned to; `/` reaches the search field; filter chips carry live counts;
a headword can be copied in one action. All of it is enhancement — the page's
purpose, method, legend and terms are complete in HTML without JavaScript.

### Register

The public voice is level and documentary. State what is true, name what is
uncertain, and stop. No exclamation, no salesmanship, no encouragement of the
reader, no first-person enthusiasm. An entry that is unresolved is described
as unresolved, not as an opportunity. This is a record, and it should read
like one.

### Places in Masinloc

A sub-page of A Closer Look. This is the one surface where the shared editorial
restraint gives way to full-bleed photography: the picture is the page, and type
sits on it rather than beside it in a card.

- Each place fills the viewport: photograph behind, a scrim carrying it into
  the deep navy, and the name in editorial serif at display size.
- Locality sits under the name in small uppercase; the rhyme follows as the
  emotional line. Nothing else competes.
- Alternating sides give the sequence a rhythm; the scrim flips with it.
- Motion is slow and small — a counter-drift of at most 38px and a settle on
  the copy. It should feel alive, not seasick.
- Mobile is art-directed, not compressed: the same full-bleed frame, a crop
  weighted to the subject, a full-width action, and the index rail as a
  horizontal scroller.

The palette is unchanged — deep navy, white, and yellow for the index and
numerals. Photography is never AI-recreated, re-cropped beyond framing, or
substituted; the mapping in `data/locations.json` is fixed.

### Masinloc Connect

Masinloc Connect is a functional submission product, so its forms and category interactions may use a more application-like layout. It must still use the same logo, palette, navigation order, typography hierarchy, footer family, motion restraint, and responsive standards. Its presentation layers are `tokens.css`, `styles.css`, `connect-polish.css`, and `connect-shell.css`. Mobile navigation for both Connect headers belongs to `connect-shell.css` alone; `connect-polish.css` must not set the header bar, or the two layers fight and one silently wins.

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
- Use the approved homepage hero as a normal static image asset.
- A Closer Look uses its own approved editorial photograph at `assets/editorial/a-closer-look.avif`; do not reuse the homepage hero there.
- Preserve the A Closer Look photograph's full frame and native proportions. Do not crop, stretch, or upscale it beyond its native 798 px width.
- HTML and CSS overlays remain separate from photography.

## Responsive standard

- Mobile is designed, not merely compressed.
- No horizontal overflow.
- Navigation becomes a deliberate hamburger/dropdown system.
- Touch targets should be at least approximately 44 px.
- Form controls use `--control-font` (16 px minimum). Anything smaller makes
  mobile Safari zoom the page on focus.
- Important copy and calls to action must remain legible over imagery.

## Release gate

A stage is not ready until all three checks pass:

- Site Integrity
- Design Consistency
- Browser QA (which includes Masinloc Connect and Sambal Tina dictionary checks)

Browser QA must include desktop and phone-width rendering and screenshots. Visual review happens from those screenshots before production merge.
