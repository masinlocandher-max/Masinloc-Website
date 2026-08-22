/* The leadership record, as a visitor actually receives it.

   scripts/check-leadership.py checks the files and the markup. This checks the
   thing that markup cannot promise: that on a real screen, at a real width,
   no leader is rendered larger, sharper, higher or more prominent than any
   other.

   Everything here is measured, not asserted. Card boxes, portrait boxes,
   decoded pixels, name type size, caption padding, hover behaviour and the
   computed styles of the frame are compared across all five leaders, and any
   difference beyond a rounding pixel is a failure.

   Usage: node scripts/leadership-qa.mjs   (with a static server on :8000)
*/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const data = JSON.parse(await fs.readFile('data/leadership.json', 'utf8'));
const leaders = data.leaders;
const current = leaders.find(l => l.status === 'current');

const failures = [];
const fail = (message) => failures.push(message);

/* Two boxes are "the same" if they differ by less than a pixel: sub-pixel
   layout rounding is not favouritism. */
const spread = (values) => Math.max(...values) - Math.min(...values);

const browser = await chromium.launch({ headless: true });

async function measure(page) {
  return page.evaluate(() => [...document.querySelectorAll('.leader')].map((card) => {
    const box = card.getBoundingClientRect();
    const img = card.querySelector('img');
    const frame = card.querySelector('.leader-frame');
    const frameBox = frame.getBoundingClientRect();
    const name = card.querySelector('.leader-name');
    const caption = card.querySelector('figcaption');
    const frameStyle = getComputedStyle(frame);
    const nameStyle = getComputedStyle(name);
    return {
      name: name.textContent.trim(),
      cardW: box.width, cardH: box.height,
      frameW: frameBox.width, frameH: frameBox.height,
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      ratio: +(img.naturalWidth / img.naturalHeight).toFixed(3),
      src: img.currentSrc.split('/').pop(),
      alt: img.alt,
      loading: img.getAttribute('loading') || 'eager',
      nameSize: nameStyle.fontSize,
      nameWeight: nameStyle.fontWeight,
      nameFamily: nameStyle.fontFamily,
      captionPad: getComputedStyle(caption).padding,
      border: `${frameStyle.borderTopWidth} ${frameStyle.borderRightWidth} ${frameStyle.borderBottomWidth} ${frameStyle.borderLeftWidth}`,
      radius: frameStyle.borderRadius,
      filter: getComputedStyle(img).filter,
      opacity: getComputedStyle(img).opacity,
      badges: card.querySelectorAll('.leader-now').length,
    };
  }));
}

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['laptop', { width: 1024, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(`${baseURL}/leadership.html`, { waitUntil: 'networkidle' });
  // Reduced motion means every card is revealed immediately, so measurements
  // are of the settled layout rather than a card mid-fade.
  await page.waitForTimeout(200);

  const cards = await measure(page);
  if (cards.length !== leaders.length) {
    fail(`${label}: ${cards.length} portraits rendered for ${leaders.length} leaders`);
    await context.close();
    continue;
  }

  // --- equal geometry -----------------------------------------------------
  for (const key of ['cardW', 'cardH', 'frameW', 'frameH']) {
    const values = cards.map(c => c[key]);
    if (spread(values) > 1) {
      fail(`${label}: ${key} differs across leaders: ` +
        cards.map(c => `${c.name} ${Math.round(c[key])}`).join(', '));
    }
  }

  // --- equal image quality ------------------------------------------------
  for (const key of ['natural', 'ratio', 'nameSize', 'nameWeight', 'nameFamily',
    'captionPad', 'border', 'radius', 'filter', 'opacity']) {
    const values = new Set(cards.map(c => String(c[key])));
    if (values.size !== 1) {
      fail(`${label}: ${key} is not identical across leaders: ` +
        cards.map(c => `${c.name}=${c[key]}`).join(' | '));
    }
  }

  // Every portrait must have decoded. A leader whose image silently failed is
  // the worst version of "visually diminished".
  for (const card of cards) {
    if (!/\d+x\d+/.test(card.natural) || card.natural.startsWith('0x')) {
      fail(`${label}: ${card.name}'s portrait did not decode (${card.src})`);
    }
  }

  // --- the incumbent is first, and only first -----------------------------
  if (cards[0].name !== current.name) {
    fail(`${label}: ${cards[0].name} is shown first, not the incumbent ${current.name}`);
  }
  const badges = cards.map(c => c.badges);
  if (badges[0] !== 1 || badges.slice(1).some(b => b !== 0)) {
    fail(`${label}: current-office markers are ${badges}, expected exactly one on the incumbent`);
  }
  // The marker must be a word, so it survives greyscale and a screen reader.
  const markerText = (await page.locator('.leader-now').innerText()).trim();
  if (!markerText) fail(`${label}: the current-office marker carries no text`);

  // --- alt text -----------------------------------------------------------
  for (const [index, card] of cards.entries()) {
    if (card.alt !== leaders[index].alt) {
      fail(`${label}: ${card.name} has alt "${card.alt}"`);
    }
  }

  // --- reading order and headings -----------------------------------------
  const headings = await page.locator('main h2').allInnerTexts();
  const expectedHeadings = [
    data.sections.current.heading,
    data.sections.former.heading,
    data.womenInLeadership.heading,
  ];
  // Compared case-insensitively: one heading is uppercased by CSS, and the
  // rendered text is what allInnerTexts returns.
  const seen = headings.map(h => h.trim().toLowerCase());
  if (JSON.stringify(seen) !== JSON.stringify(expectedHeadings.map(h => h.toLowerCase()))) {
    fail(`${label}: section headings are ${JSON.stringify(headings)}`);
  }
  if (await page.locator('main h1').count() !== 1) {
    fail(`${label}: expected exactly one H1`);
  }

  // --- women in leadership: shared, not attributed -------------------------
  const women = await page.locator('.women-lead').innerText();
  if (!women.includes(data.womenInLeadership.fact)) {
    fail(`${label}: the approved sentence is not rendered`);
  }
  for (const name of data.womenInLeadership.recognises) {
    if (!women.includes(name)) fail(`${label}: ${name} is missing from women in leadership`);
  }
  const womenNameSizes = await page.locator('.women-names li').evaluateAll(
    items => items.map(i => getComputedStyle(i).fontSize));
  if (new Set(womenNameSizes).size !== 1) {
    fail(`${label}: the three names are set at different sizes: ${womenNameSizes}`);
  }

  // --- no sideways scroll, and readable type ------------------------------
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow ${overflow}px`);

  const nameFont = parseFloat(cards[0].nameSize);
  if (nameFont < 17) fail(`${label}: names render at ${nameFont}px, too small to carry a person`);

  // A portrait should be substantial on a phone, not a thumbnail in a list.
  if (label === 'mobile' && cards[0].frameW < viewport.width * 0.8) {
    fail(`mobile: portraits are ${Math.round(cards[0].frameW)}px wide in a ${viewport.width}px window`);
  }

  for (const error of errors) {
    if (!error.includes('favicon.ico')) fail(`${label}: ${error}`);
  }
  await context.close();
}

/* --- motion is optional, the record is not --------------------------------- */

const plain = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  javaScriptEnabled: false,
});
const bare = await plain.newPage();
await bare.goto(`${baseURL}/leadership.html`, { waitUntil: 'domcontentloaded' });

const visible = await bare.locator('.leader').evaluateAll(
  cards => cards.filter(c => getComputedStyle(c).opacity !== '0').length);
if (visible !== leaders.length) {
  fail(`no-js: ${visible} of ${leaders.length} portraits are visible without JavaScript`);
}
for (const leader of leaders) {
  if (!(await bare.locator('body').innerText()).includes(leader.name)) {
    fail(`no-js: ${leader.name} is missing`);
  }
}
await plain.close();

/* --- reduced motion actually stills the hover ------------------------------ */

const still = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
const quiet = await still.newPage();
await quiet.goto(`${baseURL}/leadership.html`, { waitUntil: 'networkidle' });
const firstFigure = quiet.locator('.leader figure').first();
await firstFigure.hover();
await quiet.waitForTimeout(300);
const transform = await quiet.locator('.leader img').first()
  .evaluate(img => getComputedStyle(img).transform);
if (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
  fail(`reduced motion: the portrait still scales on hover (${transform})`);
}
await still.close();

await browser.close();

if (failures.length) {
  console.error('LEADERSHIP QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('LEADERSHIP QA PASSED');
console.log(`At three widths, all ${leaders.length} portraits render at the same card size, `
  + 'frame, border, decoded resolution, name type and caption padding.');
console.log(`${current.name} is first and carries the only current-office marker, which is a word.`);
console.log('The three women are named at one size. Every portrait is visible with '
  + 'JavaScript off, and hover motion stops under reduced motion.');
