/* Browser contract for the public Marketplace.
 *
 * The Python privacy guard owns field-level publication policy. This suite
 * owns what only a browser can prove: approved rows are all reachable without
 * JavaScript, search and category filters return the right rows, detail-page
 * schema describes the named business, logos decode, and neither layout nor
 * console breaks at desktop or phone width.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const payload = JSON.parse(await fs.readFile('data/marketplace.json', 'utf8'));
const businesses = payload.businesses;
const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      errors.push(message.text());
    }
  });

  const response = await page.goto(`${baseURL}/marketplace.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/hub: HTTP ${response?.status()}`);

  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  if (canonical !== 'https://www.masinloc-zambales.com/marketplace.html') {
    fail(`${label}/hub: canonical is ${canonical}`);
  }
  if (await page.locator('h1').count() !== 1) fail(`${label}/hub: expected one H1`);
  if (await page.locator('.mk-item').count() !== businesses.length) {
    fail(`${label}/hub: rendered ${await page.locator('.mk-item').count()} of ${businesses.length} businesses`);
  }

  const linked = new Set(await page.locator('.mk-item > a').evaluateAll(
    (links) => links.map((link) => link.getAttribute('href'))));
  for (const business of businesses) {
    if (!linked.has(`marketplace/${business.slug}.html`)) {
      fail(`${label}/hub: no link to ${business.slug}`);
    }
  }

  // Every published category filter shows exactly the rows in that category.
  for (const category of new Set(businesses.map((business) => business.category))) {
    await page.locator(`.mk-chip[data-filter="${category}"]`).click();
    const shown = await page.locator('.mk-item:visible').count();
    const expected = businesses.filter((business) => business.category === category).length;
    if (shown !== expected) fail(`${label}/hub: ${category} shows ${shown}, expected ${expected}`);
  }
  await page.locator('.mk-chip[data-filter="all"]').click();

  // Search matches supplied public copy and Escape restores the directory.
  const search = page.locator('#mkSearch');
  await search.fill(businesses[0].name.toLowerCase());
  if (await page.locator('.mk-item:visible').count() !== 1) {
    fail(`${label}/hub: exact business search did not return one row`);
  }
  await search.press('Escape');
  if (await page.locator('.mk-item:visible').count() !== businesses.length) {
    fail(`${label}/hub: Escape did not restore every row`);
  }
  await search.fill('a-business-that-does-not-exist');
  if (!await page.locator('#mkEmpty').isVisible()) fail(`${label}/hub: empty state did not appear`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) fail(`${label}/hub: horizontal overflow ${overflow}px`);
  for (const error of errors) fail(`${label}/hub: ${error}`);
  await page.close();

  for (const business of businesses) {
    const detail = await context.newPage();
    const detailErrors = [];
    detail.on('pageerror', (error) => detailErrors.push(error.message));
    detail.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('favicon')) {
        detailErrors.push(message.text());
      }
    });
    const path = `/marketplace/${business.slug}.html`;
    const result = await detail.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
    if (!result || result.status() >= 400) fail(`${label}/${business.slug}: HTTP ${result?.status()}`);
    const state = await detail.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      name: document.querySelector('h1')?.textContent.trim() || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      overflow: document.documentElement.scrollWidth - innerWidth,
      tel: document.querySelectorAll('a[href^="tel:"]').length,
      broken: [...document.images].filter((image) => image.complete && !image.naturalWidth).length,
      json: [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((script) => script.textContent),
    }));
    if (state.h1 !== 1 || state.name !== business.name) {
      fail(`${label}/${business.slug}: H1 does not match the approved business name`);
    }
    const expectedCanonical = `https://www.masinloc-zambales.com${path}`;
    if (state.canonical !== expectedCanonical) {
      fail(`${label}/${business.slug}: canonical is ${state.canonical}`);
    }
    if (state.overflow > 1) fail(`${label}/${business.slug}: horizontal overflow ${state.overflow}px`);
    if (state.tel) fail(`${label}/${business.slug}: a phone link became public`);
    if (state.broken) fail(`${label}/${business.slug}: ${state.broken} image(s) failed to decode`);

    let entity = null;
    for (const block of state.json) {
      let graph;
      try { graph = JSON.parse(block); }
      catch (error) { fail(`${label}/${business.slug}: JSON-LD does not parse (${error.message})`); continue; }
      const nodes = graph['@graph'] || [graph];
      entity = nodes.find((node) => node['@type'] === business.schemaType) || entity;
    }
    if (!entity) fail(`${label}/${business.slug}: no ${business.schemaType} schema entity`);
    else {
      if (entity.name !== business.name) fail(`${label}/${business.slug}: schema name drifted`);
      if (entity.url !== expectedCanonical) fail(`${label}/${business.slug}: schema URL drifted`);
      for (const invented of ['aggregateRating', 'review', 'priceRange', 'openingHours']) {
        if (invented in entity) fail(`${label}/${business.slug}: schema invents ${invented}`);
      }
    }
    for (const error of detailErrors) fail(`${label}/${business.slug}: ${error}`);
    await detail.close();
  }
  await context.close();
}

// Progressive enhancement: every approved row and detail link exists with JS off.
const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
const staticHub = await nojs.newPage();
await staticHub.goto(`${baseURL}/marketplace.html`, { waitUntil: 'domcontentloaded' });
if (await staticHub.locator('.mk-item').count() !== businesses.length) {
  fail(`no-js/hub: approved listings are not present in static HTML`);
}
await nojs.close();
await browser.close();

if (failures.length) {
  console.error('MARKETPLACE QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('MARKETPLACE QA PASSED');
console.log(`${businesses.length} approved businesses: hub search and category filters, detail schema, `
  + 'privacy boundary, decoded logos, static fallback and both responsive widths hold.');
