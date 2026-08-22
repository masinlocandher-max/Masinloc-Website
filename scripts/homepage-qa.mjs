/* Homepage behaviour checks.
 *
 * The homepage is a motion-led sequence, which is exactly the kind of page
 * where a fault is invisible in the markup and obvious to a visitor. These
 * assertions cover the things that actually broke while building it:
 *
 *   - the carousel track is a <ul>, and the browser's default list padding
 *     silently offset every slide by 40px and made each one narrower than
 *     the window it is measured against;
 *   - reveals driven by an observer threshold above 0 can never fire for a
 *     stage taller than the viewport;
 *   - motion must not be the only thing that makes content readable, so the
 *     page has to be complete with JavaScript off and under reduced motion.
 */
import { chromium } from '@playwright/test';

const URL = 'http://localhost:8000/index.html';
const problems = [];
const fail = (message) => problems.push(message);

const browser = await chromium.launch();

/* --- the campaign carousel --------------------------------------------- */

for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const rail = await page.$('[data-rail]');
  if (!rail) { fail(`${label}: the campaign carousel is missing`); await page.close(); continue; }

  await rail.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  /* Every slide fills its window exactly. A slide narrower than the window
     means the neighbouring campaign shows through beside it. */
  const geometry = await page.evaluate(() => {
    const win = document.querySelector('.rail-window').getBoundingClientRect();
    const arts = [...document.querySelectorAll('.slide-art')].map((art) => {
      const box = art.getBoundingClientRect();
      return { width: Math.round(box.width), left: Math.round(box.left) };
    });
    return { window: Math.round(win.width), left: Math.round(win.left), arts };
  });
  if (geometry.arts[0].width !== geometry.window) {
    fail(`${label}: slide is ${geometry.arts[0].width}px inside a ${geometry.window}px `
       + `window, so the next campaign shows beside it`);
  }
  if (geometry.arts[0].left !== geometry.left) {
    fail(`${label}: the first slide starts at ${geometry.arts[0].left}px but the `
       + `window starts at ${geometry.left}px`);
  }

  /* The artwork is a finished design: it is shown whole, never cropped. */
  const fit = await page.$eval('.slide-art', (el) => getComputedStyle(el).objectFit);
  if (fit !== 'contain') {
    fail(`${label}: campaign artwork uses object-fit:${fit}; designed artwork must `
       + `not be cropped`);
  }

  /* Every campaign carries alt text naming what it shows. */
  const alts = await page.$$eval('.slide-art', (els) => els.map((el) => el.alt || ''));
  alts.forEach((alt, i) => {
    if (alt.trim().length < 20) fail(`${label}: campaign ${i + 1} has no useful alt text`);
  });

  /* Advancing moves forward and updates the dots. */
  const dots = await page.$$('.dots button');
  if (dots.length < 1) fail(`${label}: the carousel has no pagination`);
  if (dots.length > 1) {
    await page.click('.dots button:nth-child(2)');
    await page.waitForTimeout(900);
    const selected = await page.$$eval('.dots button',
      (els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
    if (selected !== 1) fail(`${label}: choosing the second dot selected ${selected}`);
    const shifted = await page.$eval('.rail-track',
      (el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    if (shifted >= 0) fail(`${label}: the track did not move when a dot was chosen`);
  }

  /* Touch targets stay reachable even though the dot itself is small. */
  const target = await page.$eval('.dots button', (el) => {
    const box = el.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });
  if (target < 24) fail(`${label}: pagination touch target is only ${target}px`);

  /* Nothing may scroll sideways. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) fail(`${label}: the page scrolls sideways by ${overflow}px`);

  await page.close();
}

/* --- reveals and the destination story ---------------------------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(600);

  /* A stage taller than the viewport must still reveal. */
  const hidden = await page.$$eval('.rise', (els) =>
    els.filter((el) => !el.classList.contains('is-in')).length);
  if (hidden > 0) fail(`${hidden} revealed elements never became visible after a full scroll`);

  /* The sticky photograph follows whichever place is being read. */
  const second = await page.$$('.place-row');
  if (second.length < 2) fail('the destination story lists fewer than two places');
  else {
    await second[2].scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.place-row')];
      const shots = [...document.querySelectorAll('.discover-shot')];
      return {
        row: rows.findIndex((el) => el.classList.contains('is-live')),
        shot: shots.findIndex((el) => el.classList.contains('is-live')),
        caption: document.querySelector('.discover-caption')?.textContent.trim() || '',
      };
    });
    if (state.row !== state.shot) {
      fail(`the sticky photograph (${state.shot}) does not match the place being `
         + `read (${state.row})`);
    }
    if (!state.caption) fail('the sticky photograph carries no locality caption');
  }
  await page.close();
}

/* --- the page without JavaScript ---------------------------------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  /* Copy that establishes the page must exist in the HTML, not appear later. */
  const text = (await page.textContent('main')) || '';
  for (const needed of ['Discover', 'Masinloc', 'Sambal Tina', 'Hamat River']) {
    if (!text.includes(needed)) fail(`with JavaScript off, "${needed}" is missing from the page`);
  }
  const slides = await page.$$eval('.slide-art', (els) => els.length);
  if (slides < 1) fail('with JavaScript off, no campaign artwork is in the markup');

  const headings = await page.$$eval('h1', (els) => els.length);
  if (headings !== 1) fail(`expected exactly one H1, found ${headings}`);
  await page.close();
}

/* --- reduced motion ------------------------------------------------------ */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  /* The story survives without the travel: nothing stays stuck invisible. */
  const faded = await page.$$eval('.rise, .entry', (els) =>
    els.filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.05).length);
  if (faded > 0) fail(`${faded} elements are invisible under reduced motion`);
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('HOMEPAGE QA FAILED');
  problems.forEach((problem) => console.log(`- ${problem}`));
  process.exit(1);
}

console.log('HOMEPAGE QA PASSED');
console.log('Campaign slides fill their window uncropped, pagination and the');
console.log('destination story track together, and the page is complete with');
console.log('JavaScript off and under reduced motion.');
