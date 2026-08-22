/* Browser QA for the public Sambal Tina dictionary experience. */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
function fail(message) { failures.push(message); }

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

  const response = await page.goto(`${baseURL}/sambal-tina.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}: HTTP ${response?.status() ?? 'no response'}`);

  await page.locator('.dict-entry').first().waitFor({ state: 'visible', timeout: 15000 });

  const status = await page.locator('#dictStatus').textContent();
  const countMatch = String(status || '').match(/[\d,]+/);
  const count = countMatch ? Number(countMatch[0].replace(/,/g, '')) : 0;
  if (count < 5000) fail(`${label}: status line does not report the full searchable collection: ${status}`);

  const groupCount = await page.locator('.phrase-group').count();
  if (groupCount < 3) fail(`${label}: expected at least 3 phrasebook groups, found ${groupCount}`);
  const phraseWords = await page.locator('.phrase-group li').count();
  if (phraseWords < 12) fail(`${label}: expected at least 12 phrasebook words, found ${phraseWords}`);
  if (await page.locator('.phrase-page').count()) fail(`${label}: phrasebook exposes internal page references`);

  const firstEntry = page.locator('.dict-entry').first();
  if (await firstEntry.locator('.badge-strong, .badge-ok, .badge-check').count() === 0) {
    fail(`${label}: first result has no review label`);
  }
  if (await page.locator('.badge-page, .entry-status, .entry-note').count() > 0) {
    fail(`${label}: public results expose internal source/provenance mechanics`);
  }

  await page.fill('#dictQuery', 'water');
  await page.waitForFunction(
    () => /matching/.test(document.getElementById('dictStatus')?.textContent || ''),
    null,
    { timeout: 8000 }
  );
  const narrowed = await page.locator('.dict-entry').count();
  if (narrowed === 0) fail(`${label}: searching "water" returned no results`);
  if (narrowed > 400) fail(`${label}: searching "water" did not narrow the list (${narrowed})`);
  if (await page.locator('.dict-results mark').count() === 0) fail(`${label}: search matches are not highlighted`);

  await page.fill('#dictQuery', 'lanoman');
  await page.waitForTimeout(300);
  if (await page.locator('.dict-entry').count() === 0) fail(`${label}: known headword "lanoman" could not be found`);

  await page.fill('#dictQuery', '');
  await page.waitForTimeout(300);
  await page.click('.chip[data-filter="check"]');
  await page.waitForTimeout(400);
  const flagged = await page.locator('.dict-entry').count();
  if (flagged === 0) fail(`${label}: review-in-progress filter returned nothing`);
  const verifiedInFiltered = await page.locator('.dict-entry .badge-strong').count();
  if (verifiedInFiltered > 0) fail(`${label}: review-in-progress filter leaked ${verifiedInFiltered} verified entries`);

  const chipCount = await page.locator('.chip[data-filter="all"] .chip-count').textContent();
  if (!/[0-9]/.test(chipCount || '')) fail(`${label}: filter chips show no counts`);

  await page.fill('#dictQuery', 'dagat');
  await page.waitForTimeout(350);
  if (!/q=dagat/.test(page.url())) fail(`${label}: search term is not reflected in the URL`);

  await page.click('h1');
  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement?.id);
  if (focused !== 'dictQuery') fail(`${label}: "/" did not focus the search field`);

  const dailyHidden = await page.locator('#daily').isHidden();
  if (dailyHidden) fail(`${label}: Word of the day did not render`);
  else {
    const word = (await page.locator('.daily-word').textContent() || '').trim().toLowerCase();
    const gloss = (await page.locator('.daily-gloss').textContent() || '').toLowerCase();
    if (word !== 'matibya') fail(`${label}: Word of the day is ${word || 'blank'}, expected matibya`);
    if (!gloss.includes('red') || !gloss.includes('pula')) fail(`${label}: matibya gloss is incomplete: ${gloss}`);
  }

  await page.fill('#dictQuery', '');
  await page.waitForTimeout(300);
  const letterButton = page.locator('.dict-alphabet button[data-letter="b"]');
  if (await letterButton.count()) {
    await letterButton.click();
    await page.waitForTimeout(400);
    const heads = await page.locator('.dict-entry .entry-tina').allTextContents();
    const stray = heads.filter((head) => !head.trim().toLowerCase().startsWith('b'));
    if (heads.length === 0) fail(`${label}: letter filter returned nothing`);
    if (stray.length) fail(`${label}: letter filter leaked ${stray.length} non-B headwords`);
    await page.locator('.dict-alphabet button[data-letter=""]').click();
    await page.waitForTimeout(300);
  }

  await page.evaluate(async () => {
    const step = Math.floor(window.innerHeight * 0.7);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('main > section')]
      .every((section) => getComputedStyle(section).opacity === '1'),
    null,
    { timeout: 6000 }
  ).catch(() => {});

  const invisible = await page.evaluate(() =>
    [...document.querySelectorAll('main > section')]
      .filter((section) => getComputedStyle(section).opacity !== '1')
      .map((section) => section.className)
  );
  if (invisible.length) fail(`${label}: sections never revealed: ${invisible.join(', ')}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow of ${overflow}px`);

  const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('dictQuery')).fontSize));
  if (fontSize < 16) fail(`${label}: search input is ${fontSize}px; 16px is the minimum`);

  errors.forEach((error) => fail(`${label}: ${error}`));
  await context.close();
}

await run('desktop', { width: 1440, height: 1000 });
await run('mobile', { width: 390, height: 844 });
await browser.close();

if (failures.length) {
  console.log('DICTIONARY QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('DICTIONARY QA PASSED');
console.log('Search, filters, phrasebook, matibya Word of the Day, clean public labels,');
console.log('and responsive behaviour are healthy at desktop and phone widths.');
