/* Layout contracts for the sections that would be worst to ship broken.

   This catches structural regressions that ordinary overflow and contrast tests
   miss: a grid losing its stylesheet, a responsive composition collapsing at
   the wrong width, or a deliberately full-bleed hero reverting to an older
   layout model.

   The homepage was intentionally redesigned in September 2026. Its hero is no
   longer the earlier in-flow, native-ratio photograph. It is a mobile-first,
   viewport-filling product hero with an absolutely positioned real Masinloc
   photograph using object-fit:cover. The contract below treats that as the
   approved structure rather than preserving the superseded homepage.

   Usage: node scripts/layout-contracts.mjs   (with a static server on :8000)
*/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const spec = JSON.parse(await fs.readFile('data/layout-contracts.json', 'utf8'));
const { widths, contracts } = spec;

const failures = [];
const fail = (m) => failures.push(m);

const browser = await chromium.launch({ headless: true });

/* The data file predates the approved homepage-v2 redesign and intentionally
   keeps the historical contract text for provenance. Override only those two
   superseded homepage assertions here; every other contract remains data-led. */
function expectedFor(contract, label) {
  if (contract.page === 'index.html' && contract.selector === '.hero-media') {
    return { display: 'block', position: 'absolute' };
  }
  if (contract.page === 'index.html' && contract.selector === '.hero-media img') {
    return { display: 'block', objectFit: 'cover' };
  }
  return contract[label];
}

/* Measure every contract at one width in one pass, reusing a page per URL. */
async function measure(label, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  let loaded = null;

  for (const contract of contracts) {
    const expected = expectedFor(contract, label);
    if (!expected) continue;

    if (contract.page !== loaded) {
      const response = await page.goto(`${baseURL}/${contract.page}`, { waitUntil: 'networkidle' });
      if (!response || response.status() >= 400) {
        fail(`${label}/${contract.page}: HTTP ${response?.status()}`);
        loaded = null;
        continue;
      }
      loaded = contract.page;
    }

    const found = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const kids = [...el.children].map((child) => {
        const r = child.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
      });
      return {
        display: style.display,
        position: style.position,
        objectFit: style.objectFit,
        columns: style.gridTemplateColumns && style.gridTemplateColumns !== 'none'
          ? style.gridTemplateColumns.split(' ').filter(Boolean).length
          : null,
        width: Math.round(box.width),
        height: Math.round(box.height),
        childCount: el.children.length,
        kids,
      };
    }, contract.selector);

    const section = contract.page === 'index.html' && contract.selector === '.hero-media'
      ? 'Homepage v2 full-bleed hero media'
      : contract.page === 'index.html' && contract.selector === '.hero-media img'
        ? 'Homepage v2 real photograph cover treatment'
        : contract.section;
    const where = `${label}/${contract.page} ${contract.selector} (${section})`;

    if (!found) {
      fail(`${where}: not present in the page at all`);
      continue;
    }
    if (found.width < 1 || found.height < 1) {
      fail(`${where}: renders at ${found.width}x${found.height} — it is not visible`);
      continue;
    }

    if (expected.display && found.display !== expected.display) {
      fail(`${where}: lays out as "${found.display}", expected "${expected.display}"`
        + (expected.display !== 'block' && found.display === 'block'
          ? ' — a block here is what losing the stylesheet looks like' : ''));
    }
    if (expected.position && found.position !== expected.position) {
      fail(`${where}: position is "${found.position}", expected "${expected.position}"`);
    }
    if (expected.objectFit && found.objectFit !== expected.objectFit) {
      fail(`${where}: object-fit is "${found.objectFit}", expected "${expected.objectFit}"`);
    }
    if (expected.minWidth != null && found.width < expected.minWidth) {
      fail(`${where}: renders ${found.width}px wide, expected at least ${expected.minWidth}px`);
    }
    if (expected.aspectRatio != null) {
      const actual = found.width / found.height;
      if (Math.abs(actual - expected.aspectRatio) / expected.aspectRatio > 0.02) {
        fail(`${where}: renders at ${actual.toFixed(3)}:1, expected its native `
          + `${expected.aspectRatio}:1 — the frame is being cropped or stretched`);
      }
    }
    if (expected.columns != null && found.columns !== expected.columns) {
      fail(`${where}: resolves to ${found.columns} column(s), expected ${expected.columns}`);
    }
    if (contract.minChildren != null && found.childCount < contract.minChildren) {
      fail(`${where}: has ${found.childCount} children, expected at least ${contract.minChildren}`);
    }

    if (expected.childrenSideBySide && found.kids.length >= 2) {
      const [a, b] = found.kids;
      if (a.x === b.x) {
        fail(`${where}: every child starts at x=${a.x} — they are stacked, not side by side`);
      }
    }
  }

  await context.close();
}

for (const [label, width] of Object.entries(widths)) {
  await measure(label, width);
}
await browser.close();

if (failures.length) {
  console.error('LAYOUT CONTRACTS FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('LAYOUT CONTRACTS PASSED');
console.log(`${contracts.length} critical sections hold their approved structure at `
  + `${Object.entries(widths).map(([k, v]) => `${k} ${v}px`).join(' and ')}.`);
