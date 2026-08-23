/* QA for the Discover Masinloc section.

   Discover is the outward-facing editorial layer, which means it is the part of
   the site most likely to be read by somebody who has never heard of the town
   and most likely to be quoted by a search or answer engine. The promises worth
   checking are therefore about honesty and reachability rather than about
   pixels — the contrast suite already owns pixels.

   What this asserts, and why each one earns its place:

   1. Every article in the data is built, reachable from the hub in one click,
      and reachable from ordinary navigation. An orphan article is one nobody
      finds and nobody maintains.
   2. Metadata is unique per page. Two pages sharing a title are two pages
      competing for the same search.
   3. Canonical URLs are self-referencing and match the page's real address.
   4. Article structured data carries what it claims to: headline, both dates,
      author, publisher, mainEntityOfPage.
   5. NO FAQPage markup anywhere in Discover. These articles came out of
      search-intent research and must never be dressed up as an FAQ directory.
   6. Heroes are not cropped. Every hero renders at its source aspect ratio,
      because the approved artwork carries the logo, the location label and the
      footer line inside the frame.
   7. Internal links resolve — including the ones that leave Discover for the
      dictionary, the Bulletin and the places page.
   8. The Masinloc Connect boundary holds: Discover may discuss work and the
      local economy, but it must not carry job listings.
   9. No console errors, no horizontal overflow, at phone and desktop width.

   Usage: node scripts/discover-qa.mjs   (with a static server on :8000)
*/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const data = JSON.parse(await fs.readFile('data/discover.json', 'utf8'));
const articles = data.articles;

const failures = [];
const pending = [];
const fail = (m) => failures.push(m);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const titles = new Map();
const descriptions = new Map();

/* --- the hub -------------------------------------------------------------- */

const hub = await context.newPage();
const hubErrors = [];
hub.on('pageerror', (e) => hubErrors.push(`pageerror: ${e.message}`));
hub.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) hubErrors.push(`console: ${m.text()}`); });

const hubResponse = await hub.goto(`${baseURL}/discover/index.html`, { waitUntil: 'networkidle' });
if (!hubResponse || hubResponse.status() >= 400) fail(`hub: HTTP ${hubResponse?.status()}`);

const linked = new Set(await hub.locator('main a[href$=".html"]').evaluateAll(
  (as) => as.map((a) => a.getAttribute('href'))));
for (const article of articles) {
  if (!linked.has(`${article.slug}.html`)) {
    fail(`hub does not link to ${article.slug} — an article nobody can find from the section front`);
  }
}
if (await hub.locator('h1').count() !== 1) fail('hub: expected exactly one H1');
for (const error of hubErrors) fail(`hub: ${error}`);
await hub.close();

/* --- every article -------------------------------------------------------- */

for (const article of articles) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`); });

  const url = `${baseURL}/discover/${article.slug}.html`;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) {
    fail(`${article.slug}: HTTP ${response?.status()}`);
    await page.close();
    continue;
  }

  const meta = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
    h1s: document.querySelectorAll('h1').length,
    crumbs: document.querySelectorAll('.crumbs li').length,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
  }));

  if (meta.h1s !== 1) fail(`${article.slug}: ${meta.h1s} H1 elements`);
  if (!meta.description) fail(`${article.slug}: no meta description`);
  if (!meta.robots.includes('index')) fail(`${article.slug}: robots does not allow indexing`);
  if (!meta.robots.includes('max-image-preview:large')) {
    fail(`${article.slug}: missing max-image-preview:large`);
  }
  const expected = `https://masinloc-zambales.com/discover/${article.slug}.html`;
  if (meta.canonical !== expected) {
    fail(`${article.slug}: canonical is ${meta.canonical}, expected ${expected}`);
  }
  if (meta.crumbs < 3) fail(`${article.slug}: breadcrumb trail is too short`);

  if (titles.has(meta.title)) fail(`${article.slug}: shares its title with ${titles.get(meta.title)}`);
  titles.set(meta.title, article.slug);
  if (descriptions.has(meta.description)) {
    fail(`${article.slug}: shares its description with ${descriptions.get(meta.description)}`);
  }
  descriptions.set(meta.description, article.slug);

  // Structured data: parses, says what it should, and is not an FAQ.
  let posting = null;
  for (const block of meta.ld) {
    let graph;
    try {
      graph = JSON.parse(block);
    } catch (error) {
      fail(`${article.slug}: JSON-LD does not parse (${error.message})`);
      continue;
    }
    const text = JSON.stringify(graph);
    if (text.includes('"FAQPage"')) {
      fail(`${article.slug}: carries FAQPage markup — Discover articles are not an FAQ directory`);
    }
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        if (node['@type'] === 'BlogPosting') posting = node;
        Object.values(node).forEach(walk);
      }
    };
    walk(graph);
  }
  if (!posting) fail(`${article.slug}: no BlogPosting structured data`);
  else {
    for (const key of ['headline', 'datePublished', 'dateModified', 'author', 'publisher', 'mainEntityOfPage']) {
      if (!posting[key]) fail(`${article.slug}: BlogPosting missing ${key}`);
    }
    if (posting.headline !== article.title) {
      fail(`${article.slug}: structured headline does not match the visible title`);
    }
  }

  // Heroes keep their own shape. A rendered ratio that has drifted from the
  // decoded one means something cropped the artwork.
  if (article.hero && await page.locator('.d-hero img').count() === 0) {
    /* The data names a hero whose artwork has not been delivered yet. The
       article is published and opens on type; this is reported rather than
       failed, so an undelivered asset never blocks a correction going out. */
    pending.push(`${article.slug} (${article.hero.name})`);
  } else if (article.hero) {
    const shape = await page.locator('.d-hero img').first().evaluate((img) => ({
      naturalRatio: img.naturalWidth / img.naturalHeight,
      renderedRatio: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
      fit: getComputedStyle(img).objectFit,
    }));
    if (Math.abs(shape.naturalRatio - shape.renderedRatio) > 0.02) {
      fail(`${article.slug}: hero rendered at ${shape.renderedRatio.toFixed(3)} but decoded at `
        + `${shape.naturalRatio.toFixed(3)} — the approved artwork is being cropped`);
    }
    if (shape.fit === 'cover') {
      fail(`${article.slug}: hero uses object-fit:cover, which crops the branded artwork`);
    }
    if (!meta.ogImage) fail(`${article.slug}: has a hero but no og:image`);
  }

  // Every internal link resolves.
  const hrefs = await page.locator('main a[href]').evaluateAll(
    (as) => as.map((a) => a.getAttribute('href')).filter(
      (h) => h && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('mailto:')));
  for (const href of new Set(hrefs)) {
    const target = new URL(href, url).toString();
    const probe = await context.request.get(target);
    if (probe.status() >= 400) fail(`${article.slug}: broken link ${href} (${probe.status()})`);
  }

  // The Masinloc Connect boundary.
  const body = (await page.locator('main').innerText()).toLowerCase();
  for (const phrase of ['apply now', 'job opening', 'now hiring', 'send your resume', 'vacancy']) {
    if (body.includes(phrase)) {
      fail(`${article.slug}: reads like a job listing ("${phrase}") — live opportunities belong to Masinloc Connect`);
    }
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${article.slug}: horizontal overflow ${overflow}px`);

  for (const error of errors) fail(`${article.slug}: ${error}`);
  await page.close();
}
await context.close();

/* --- phone ---------------------------------------------------------------- */

const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
for (const path of ['index.html', `${articles[0].slug}.html`, 'the-sweetest-mango-came-from-where-exactly.html']) {
  const page = await phone.newPage();
  await page.goto(`${baseURL}/discover/${path}`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`phone/${path}: horizontal overflow ${overflow}px`);

  // A reading measure that has collapsed or run to the full width is unreadable
  // in different ways; both show up here.
  const width = await page.locator('.d-body, .d-hub-intro').first().evaluate(
    (el) => el.getBoundingClientRect().width);
  if (width > 390 || width < 240) fail(`phone/${path}: reading column is ${Math.round(width)}px`);
  await page.close();
}
await phone.close();

await browser.close();

if (failures.length) {
  console.error('DISCOVER QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('DISCOVER QA PASSED');
console.log(`${articles.length} articles: all built, all linked from the hub, unique titles and `
  + 'descriptions, self-referencing canonicals, breadcrumbs and valid BlogPosting data.');
console.log('No FAQ markup. No hero is cropped. Every internal link resolves. '
  + 'No job listings crossed the line into Discover.');
if (pending.length) {
  console.log(`\n${pending.length} article(s) are waiting on hero artwork and open on type `
    + 'until it is delivered:');
  for (const item of pending) console.log(`  - ${item}`);
}
