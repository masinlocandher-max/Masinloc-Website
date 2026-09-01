/* Homepage v2 QA — protect the product-led, mobile-first landing experience.
 *
 * This suite intentionally checks durable behaviour instead of pixel-perfect
 * styling: usable phone actions, required routes, real repository imagery,
 * no horizontal overflow, no-JS readability and reduced-motion safety.
 */
import { chromium } from '@playwright/test';

const URL = 'http://localhost:8000/index.html';
const failures = [];
const fail = (message) => failures.push(message);
const browser = await chromium.launch();

const requiredRoutes = [
  'discover/index.html',
  'sambal-tina.html',
  'marketplace.html',
  'jobs.html',
  'verified-history.html',
  'connect.html',
  'emergency/',
];

for (const [label, width, height] of [
  ['small-phone', 320, 740],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const response = await page.goto(URL, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}: HTTP ${response?.status()}`);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(`${label}: page scrolls sideways by ${overflow}px`);

  const h1Count = await page.locator('h1').count();
  if (h1Count !== 1) fail(`${label}: expected exactly one H1, found ${h1Count}`);

  const heroText = (await page.locator('.hero').innerText()).replace(/\s+/g, ' ').trim();
  if (!heroText.includes('Masinloc, connected.')) fail(`${label}: hero positioning is missing`);
  if (!heroText.includes('Connecting Masinloqueños to the world')) {
    fail(`${label}: core Masinloc Connect positioning is missing`);
  }

  const heroImage = page.locator('.hero-media img');
  const heroState = await heroImage.evaluate(img => ({
    src: img.currentSrc || img.src,
    width: img.naturalWidth,
    height: img.naturalHeight,
  }));
  if (!/assets\/hero\/landing-hero-/.test(heroState.src)) {
    fail(`${label}: hero is not using the approved Masinloc repository image family`);
  }
  if (!heroState.width || !heroState.height) fail(`${label}: hero image did not decode`);

  const ctas = await page.$$eval('.hero-cta a', els => els.map(el => ({
    href: el.getAttribute('href'),
    height: el.getBoundingClientRect().height,
    width: el.getBoundingClientRect().width,
  })));
  for (const route of ['connect.html', 'emergency/', 'discover/index.html']) {
    if (!ctas.some(item => item.href === route)) fail(`${label}: hero does not route to ${route}`);
  }
  if (width <= 390) {
    for (const item of ctas) {
      if (item.height < 44) fail(`${label}: hero CTA ${item.href} is only ${item.height}px tall`);
      if (item.width < 200) fail(`${label}: hero CTA ${item.href} is too narrow for a primary phone action`);
    }
  }

  const actions = await page.$$eval('.action-card', els => els.map(el => el.getAttribute('href')));
  if (actions.length !== 6) fail(`${label}: expected six core action routes, found ${actions.length}`);
  for (const route of ['discover/index.html', 'emergency/', 'sambal-tina.html', 'jobs.html', 'marketplace.html', 'verified-history.html']) {
    if (!actions.includes(route)) fail(`${label}: core action area does not reach ${route}`);
  }

  const helpSteps = await page.locator('.response-flow > li').count();
  if (helpSteps !== 4) fail(`${label}: Help Desk lifecycle has ${helpSteps} steps, expected four`);
  if (!(await page.locator('.helpdesk a[href="emergency/"]').count())) {
    fail(`${label}: Help Desk section has no direct resident entry route`);
  }

  /* Destination photos are intentionally lazy. Scroll to the mosaic before
     asserting decode so the test verifies browser behaviour rather than
     demanding that offscreen images defeat lazy-loading. */
  await page.locator('.place-mosaic').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.place-shot img')]
    .every(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
  { timeout: 5000 }).catch(() => {});

  const discoverImages = await page.$$eval('.place-shot img', imgs => imgs.map(img => ({
    src: img.getAttribute('src') || '', decoded: img.naturalWidth > 0 && img.naturalHeight > 0,
  })));
  if (discoverImages.length < 3) fail(`${label}: destination mosaic has fewer than three real place images`);
  discoverImages.forEach((image, index) => {
    if (!image.src.startsWith('assets/locations/')) fail(`${label}: place image ${index + 1} is not from repository assets`);
    if (!image.decoded) fail(`${label}: place image ${index + 1} did not decode after the mosaic entered view`);
  });

  const cultureSrc = await page.locator('.culture-photo img').getAttribute('src');
  if (!cultureSrc?.startsWith('assets/campaigns/sambal-tina-language-')) {
    fail(`${label}: culture section is not using the approved Sambal Tina campaign asset`);
  }
  const appSrc = await page.locator('.app-media img').getAttribute('src');
  if (!appSrc?.startsWith('assets/campaigns/masinloc-connect-')) {
    fail(`${label}: app section is not using the approved Masinloc Connect campaign asset`);
  }

  const allRoutes = await page.$$eval('a[href]', els => els.map(a => a.getAttribute('href')));
  for (const route of requiredRoutes) {
    if (!allRoutes.includes(route)) fail(`${label}: homepage does not reach ${route}`);
  }
  if (!allRoutes.includes('emergency/')) fail(`${label}: Help Desk is not reachable from homepage links`);

  if (width <= 390) {
    const toggle = page.locator('#menuToggle');
    const size = await toggle.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    if (size.width < 44 || size.height < 44) {
      fail(`${label}: menu touch target is ${size.width}x${size.height}, below 44x44`);
    }
    await toggle.click();
    if (!(await page.locator('#primaryNav').evaluate(el => el.classList.contains('open')))) {
      fail(`${label}: mobile menu did not open`);
    }
    await page.keyboard.press('Escape');
  }

  const mobileSheets = await page.locator('link[href*="mobile-first.css"]').count();
  if (mobileSheets !== 1) fail(`${label}: mobile foundation is loaded ${mobileSheets} times`);

  errors.filter(error => !error.includes('favicon.ico')).forEach(error => fail(`${label}: ${error}`));
  await page.close();
}

/* The page must remain meaningful with JavaScript disabled. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  for (const required of ['Masinloc, connected.', 'Discover Masinloc', 'Sambal Tina', 'Report and get help', 'The website tells you. The app helps you do.']) {
    if (!text.includes(required)) fail(`no-js: "${required}" is missing`);
  }
  if (await page.locator('h1').count() !== 1) fail('no-js: page does not contain exactly one H1');
  const opacityFailures = await page.$$eval('main section', els =>
    els.filter(el => parseFloat(getComputedStyle(el).opacity) < 0.05).length);
  if (opacityFailures) fail(`no-js: ${opacityFailures} sections are invisible`);
  await page.close();
}

/* Reduced motion must keep every section readable and present. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const hidden = await page.$$eval('[data-reveal]', els =>
    els.filter(el => parseFloat(getComputedStyle(el).opacity) < 0.05).length);
  if (hidden) fail(`reduced-motion: ${hidden} reveal targets remain invisible`);
  await page.close();
}

await browser.close();

if (failures.length) {
  console.error('HOMEPAGE QA FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log('HOMEPAGE QA PASSED');
console.log('Mobile-first landing structure, routes, real imagery, touch targets, no-JS and reduced-motion states are intact.');
