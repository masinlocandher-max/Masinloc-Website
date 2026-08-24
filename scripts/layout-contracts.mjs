/* Layout contracts for the sections that would be worst to ship broken.

   This is the check that would have caught the "Sambal Tina 101" primer, which
   went out with no CSS at all and passed every other suite in the repository.
   Its rules lived in a stylesheet no page linked, so the markup arrived and
   fell back to browser defaults: three articles stacked full width instead of
   a grid, "01/02/03" as ordinary body text, and the three core vowels running
   together as "AIO". The contrast suite measures text that is painted, the
   responsive suite measures layout that overflows, and unstyled text is
   usually still legible and still fits.

   check-stylesheets.py now catches that particular CAUSE — a class no loaded
   stylesheet defines. This catches the SYMPTOM, whatever the cause: a deleted
   rule, a renamed selector, a media query that collapses a grid at the wrong
   width, a stylesheet that stops being linked. The two nets are independent on
   purpose.

   WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT

   Asserted: what a section lays out AS (grid, flex, block), how many columns it
   resolves to at each width, whether its children genuinely sit beside each
   other, and that it is visible at a sane size.

   Not asserted: pixel dimensions, colours, fonts, spacing, or screenshots.
   Those change for good reasons on almost every design pass. A check that
   cries wolf gets muted, and a muted check protects nothing — so this one only
   fails on the kind of break somebody would call a bug.

   `display` does most of the work here. A <span> is inline until CSS says
   otherwise and a <div> is block, so an element that should be a grid and
   reports "block" has lost its rules. That is precisely what the primer did.

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

/* Measure every contract at one width in one pass, reusing a page per URL. */
async function measure(label, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  let loaded = null;

  for (const contract of contracts) {
    const expected = contract[label];
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
        // A grid's resolved template is a list of track sizes; its length is the
        // column count actually in effect, which is what a media query changes.
        columns: style.gridTemplateColumns && style.gridTemplateColumns !== 'none'
          ? style.gridTemplateColumns.split(' ').filter(Boolean).length
          : null,
        width: Math.round(box.width),
        height: Math.round(box.height),
        childCount: el.children.length,
        kids,
      };
    }, contract.selector);

    const where = `${label}/${contract.page} ${contract.selector} (${contract.section})`;

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
    if (expected.columns != null && found.columns !== expected.columns) {
      fail(`${where}: resolves to ${found.columns} column(s), expected ${expected.columns}`);
    }
    if (contract.minChildren != null && found.childCount < contract.minChildren) {
      fail(`${where}: has ${found.childCount} children, expected at least ${contract.minChildren}`);
    }

    /* A grid can be declared and still be broken. If the children all share an
       x position they are stacked, whatever the computed template says. */
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
console.log(`${contracts.length} critical sections hold their shape at `
  + `${Object.entries(widths).map(([k, v]) => `${k} ${v}px`).join(' and ')}: `
  + 'each lays out as it should, resolves to the right number of columns, and '
  + 'has children that are actually beside each other rather than stacked.');
