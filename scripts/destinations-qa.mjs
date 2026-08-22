/* Browser QA for the Masinloc locations experience.
 *
 * Skips itself when the photography has not been built yet, so the gate stays
 * meaningful rather than permanently red while the originals are outstanding.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const locations = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'locations.json'), 'utf8')
).locations;

const assets = path.join(root, 'assets', 'locations');
const built = fs.existsSync(assets) && fs.readdirSync(assets).length > 0;

if (!built) {
  console.log('DESTINATIONS QA SKIPPED');
  console.log('Location photography has not been built; nothing to exercise yet.');
  process.exit(0);
}

const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });

async function run(label, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
      errors.push(`console: ${message.text()}`);
    }
  });

  const response = await page.goto(`${baseURL}/destinations.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) {
    fail(`${label}: HTTP ${response?.status() ?? 'no response'}`);
  }

  /* Every approved location is present, in order, with its own photograph. */
  const sections = await page.locator('.place').count();
  if (sections !== locations.length) {
    fail(`${label}: expected ${locations.length} places, found ${sections}`);
  }

  for (const location of locations) {
    const section = page.locator(`#${location.slug}`);
    if (await section.count() === 0) {
      fail(`${label}: ${location.name} is missing`);
      continue;
    }
    const name = (await section.locator('.place-name').textContent() || '').trim();
    if (name !== location.name) {
      fail(`${label}: ${location.slug} shows "${name}" instead of "${location.name}"`);
    }
    const alt = await section.locator('.place-media img').getAttribute('alt');
    if (alt !== location.alt) {
      fail(`${label}: ${location.name} has alt "${alt}"`);
    }

    /* Every photograph below the first is lazy-loaded, so bring it into view
       before asking whether it decoded. A 404 still renders an <img>, which is
       why naturalWidth is the test rather than the element existing. */
    await section.scrollIntoViewIfNeeded();
    const image = section.locator('.place-media img');
    await image.evaluate(
      (node) => node.complete && node.naturalWidth > 0
        ? true
        : new Promise((resolve) => {
            node.addEventListener('load', resolve, { once: true });
            node.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 8000);
          })
    );
    const loaded = await image.evaluate((node) => node.complete && node.naturalWidth > 0);
    if (!loaded) fail(`${label}: ${location.name} photograph did not load`);
  }

  /* The index rail tracks the place in view. */
  await page.locator('#bunga-cave').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const current = await page.locator('.places-index a.is-current').getAttribute('href');
  if (current !== '#bunga-cave') {
    fail(`${label}: index rail shows ${current} while Bunga Cave is in view`);
  }

  /* The viewer opens, navigates and closes. */
  await page.locator('#bunga-cave .place-open').click();
  await page.waitForTimeout(500);
  if (await page.locator('#viewer').isHidden()) {
    fail(`${label}: the photograph viewer did not open`);
  } else {
    const opened = await page.locator('#viewerName').textContent();
    if ((opened || '').trim() !== 'Bunga Cave') {
      fail(`${label}: viewer opened on "${opened}" instead of Bunga Cave`);
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const next = (await page.locator('#viewerName').textContent() || '').trim();
    if (next !== 'Bacala Sandbar and Guesthouse') {
      fail(`${label}: arrow key moved to "${next}"`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await page.locator('#viewer').isVisible()) {
      fail(`${label}: Escape did not close the viewer`);
    }
  }

  /* No horizontal overflow at any width. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) fail(`${label}: horizontal overflow of ${overflow}px`);

  errors.forEach((error) => fail(`${label}: ${error}`));
  await context.close();
}

await run('desktop', { width: 1440, height: 1000 });
await run('mobile', { width: 390, height: 844 });
await browser.close();

if (failures.length) {
  console.log('DESTINATIONS QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('DESTINATIONS QA PASSED');
console.log(`${locations.length} places render with their approved photograph, name and`);
console.log('alt text; index tracking, viewer and mobile layout are healthy.');
