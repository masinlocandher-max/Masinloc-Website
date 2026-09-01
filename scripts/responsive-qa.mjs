/* Responsive QA for the Masinloc Website.
 *
 * Mobile is the baseline. Every shipped HTML surface is exercised at common
 * phone widths, while the major public journeys also run across tablet,
 * desktop and the edges of the repository's responsive breakpoints.
 */
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const PHONE_WIDTHS = [320, 390, 414];
const FULL_WIDTHS = [320, 360, 390, 414, 480, 520, 600, 768, 800, 801, 834, 900,
                     980, 981, 1024, 1180, 1280, 1440, 1680, 1920, 2560];

const CORE_PAGES = [
  'index.html',
  'discover/index.html',
  'destinations.html',
  'a-closer-look.html',
  'sambal-tina.html',
  'marketplace.html',
  'jobs.html',
  'leadership.html',
  'verified-history.html',
  'founder-of-masinloc.html',
  'mabayani/index.html',
  'masinloc-bulletin.html',
  'connect.html',
  'emergency/index.html',
  'emergency/access.html',
  'emergency/pnp.html',
  'emergency/mdrrmo.html',
  'contact.html',
  'sources.html',
  'bulletin/was-masinloc-founded-in-1572.html',
  'bulletin/what-binabayani-remembers.html',
  '404.html',
];

const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'artifacts']);
const allHtml = [];
async function collect(dir = '.') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collect(full);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      allHtml.push(full.replace(/^\.\//, '').split(path.sep).join('/'));
    }
  }
}
await collect();
allHtml.sort();

const MIN_FONT = 10;
const failures = [];
const fail = (message) => failures.push(message);
const browser = await chromium.launch({ headless: true });

async function inspect(name, width, context) {
  const page = await context.newPage();
  const response = await page.goto(`${baseURL}/${name}`, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() >= 400) {
    fail(`${width}px ${name}: HTTP ${response?.status() ?? 'no response'}`);
    await page.close();
    return;
  }
  await page.waitForTimeout(220);

  const result = await page.evaluate((floor) => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    const visible = [...document.querySelectorAll('p,li,dd,dt,small,span,label,button,a,strong')]
      .filter((node) => node.textContent.trim() && node.offsetParent !== null);
    const sizes = visible
      .map((node) => parseFloat(getComputedStyle(node).fontSize))
      .filter((size) => size > 0);
    const tiny = visible
      .filter((node) => parseFloat(getComputedStyle(node).fontSize) < floor)
      .slice(0, 3)
      .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`);
    return { overflow, min: sizes.length ? Math.min(...sizes) : null, tiny };
  }, MIN_FONT);

  if (result.overflow > 1) {
    fail(`${width}px ${name}: ${result.overflow}px horizontal overflow`);
  }
  if (result.min !== null && result.min < MIN_FONT) {
    fail(`${width}px ${name}: visible text at ${result.min}px `
      + `(${result.tiny.join(', ')}); ${MIN_FONT}px is the floor`);
  }
  await page.close();
}

/* Every shipped HTML page must work as a phone page, including responder,
   admin, listing, article and less-frequently visited surfaces. */
for (const width of PHONE_WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const name of allHtml) await inspect(name, width, context);
  await context.close();
}

/* Core journeys receive the denser breakpoint sweep. The phone widths above
   are intentionally repeated here: they remain the baseline for the surfaces
   residents are most likely to use. */
for (const width of FULL_WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const name of CORE_PAGES) await inspect(name, width, context);
  await context.close();
}

await browser.close();

if (failures.length) {
  console.log('RESPONSIVE QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('RESPONSIVE QA PASSED');
console.log(`${allHtml.length} shipped HTML pages checked at ${PHONE_WIDTHS.join(', ')}px phone widths.`);
console.log(`${CORE_PAGES.length} core journeys checked across ${FULL_WIDTHS.length} widths from ${FULL_WIDTHS[0]}px to ${FULL_WIDTHS[FULL_WIDTHS.length - 1]}px.`);
console.log('No horizontal overflow and no visible text below the readable floor.');
