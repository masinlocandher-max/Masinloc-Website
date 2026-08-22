/* Responsive QA for every public surface.
 *
 * Two failures this catches that a desktop and a phone screenshot do not:
 * a layout that only breaks between the breakpoints (the choice grid once
 * pushed 18px past the viewport at iPad-portrait width), and text that is
 * technically present but too small to read.
 */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';

/* Real device widths plus the edges of every breakpoint in the stylesheets. */
const WIDTHS = [320, 360, 390, 414, 480, 520, 600, 768, 800, 801, 834, 900,
                980, 981, 1024, 1180, 1280, 1440, 1680, 1920, 2560];

const PAGES = [
  'index.html', 'a-closer-look.html', 'sambal-tina.html', 'destinations.html',
  'verified-history.html', 'masinloc-bulletin.html', 'connect.html', 'contact.html', 'sources.html', 'bulletin/was-masinloc-founded-in-1572.html', '404.html',
];

/* Below this, body text stops being comfortably readable on a phone. */
const MIN_FONT = 10;

const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const name of PAGES) {
    const page = await context.newPage();
    const response = await page.goto(`${baseURL}/${name}`, { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) {
      fail(`${width}px ${name}: HTTP ${response?.status() ?? 'no response'}`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(280);

    const result = await page.evaluate((floor) => {
      const root = document.documentElement;
      const overflow = root.scrollWidth - root.clientWidth;

      /* Only visible text counts; hidden panels legitimately hold small type. */
      const visible = [...document.querySelectorAll('p,li,dd,dt,small,span,label,button,a,strong')]
        .filter((node) => node.textContent.trim() && node.offsetParent !== null);
      const sizes = visible
        .map((node) => parseFloat(getComputedStyle(node).fontSize))
        .filter((size) => size > 0);

      const tiny = visible
        .filter((node) => parseFloat(getComputedStyle(node).fontSize) < floor)
        .slice(0, 3)
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`);

      /* Anything that pushes past the right edge, ignoring clipped decoration. */
      const spilling = [...document.querySelectorAll('body *')]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          let parent = node.parentElement;
          while (parent) {
            if (getComputedStyle(parent).overflow !== 'visible') return false;
            parent = parent.parentElement;
          }
          return box.right > root.clientWidth + 2;
        })
        .slice(0, 3)
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`);

      return { overflow, min: sizes.length ? Math.min(...sizes) : null, tiny, spilling };
    }, MIN_FONT);

    if (result.overflow > 1) {
      fail(`${width}px ${name}: ${result.overflow}px horizontal overflow `
        + `(${result.spilling.join(', ') || 'source unclear'})`);
    }
    if (result.min !== null && result.min < MIN_FONT) {
      fail(`${width}px ${name}: visible text at ${result.min}px `
        + `(${result.tiny.join(', ')}); ${MIN_FONT}px is the floor`);
    }

    await page.close();
  }
  await context.close();
}

await browser.close();

if (failures.length) {
  console.log('RESPONSIVE QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('RESPONSIVE QA PASSED');
console.log(`${PAGES.length} pages across ${WIDTHS.length} widths from `
  + `${WIDTHS[0]}px to ${WIDTHS[WIDTHS.length - 1]}px:`);
console.log('no horizontal overflow, and no visible text below the readable floor.');
