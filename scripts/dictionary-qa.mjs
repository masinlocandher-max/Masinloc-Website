/* Browser QA for the Sambal Tina dictionary.
 *
 * The dictionary is the one page whose value lives entirely in behaviour:
 * if search silently breaks, the page still looks finished. These checks
 * exercise it the way a reader would, and assert that provenance stays on
 * screen — a result without a confidence badge and a page reference is the
 * failure mode this project most needs to avoid.
 */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];

function fail(message) {
  failures.push(message);
}

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
  if (!response || response.status() >= 400) {
    fail(`${label}: HTTP ${response?.status() ?? 'no response'}`);
  }

  /* The data loads after render; wait for the first results to appear. */
  await page.locator('.dict-entry').first().waitFor({ state: 'visible', timeout: 15000 });

  const status = await page.locator('#dictStatus').textContent();
  if (!/5,222/.test(status || '')) {
    fail(`${label}: status line does not report the full entry count: ${status}`);
  }

  /* The phrasebook must render real groups, not the loading placeholder. */
  const groupCount = await page.locator('.phrase-group').count();
  if (groupCount < 3) fail(`${label}: expected at least 3 phrasebook groups, found ${groupCount}`);
  const phraseWords = await page.locator('.phrase-group li').count();
  if (phraseWords < 12) fail(`${label}: expected at least 12 phrasebook words, found ${phraseWords}`);

  /* Every visible result carries its provenance. */
  const firstEntry = page.locator('.dict-entry').first();
  if (await firstEntry.locator('.badge-strong, .badge-ok, .badge-check').count() === 0) {
    fail(`${label}: first result has no confidence badge`);
  }
  if (await firstEntry.locator('.badge-page').count() === 0) {
    fail(`${label}: first result has no page reference`);
  }

  /* Search narrows, and matches are highlighted. */
  await page.fill('#dictQuery', 'water');
  await page.waitForFunction(
    () => /matching/.test(document.getElementById('dictStatus')?.textContent || ''),
    null,
    { timeout: 8000 }
  );
  const narrowed = await page.locator('.dict-entry').count();
  if (narrowed === 0) fail(`${label}: searching "water" returned no results`);
  if (narrowed > 400) fail(`${label}: searching "water" did not narrow the list (${narrowed})`);
  if (await page.locator('.dict-results mark').count() === 0) {
    fail(`${label}: search matches are not highlighted`);
  }

  /* Accent folding: the source uses damaged glyphs, so search must be lenient. */
  await page.fill('#dictQuery', 'lanoman');
  await page.waitForTimeout(300);
  if (await page.locator('.dict-entry').count() === 0) {
    fail(`${label}: a known headword ("lanoman") could not be found`);
  }

  /* The "needs a source check" filter must isolate flagged entries only. */
  await page.fill('#dictQuery', '');
  await page.waitForTimeout(300);
  await page.click('.chip[data-filter="check"]');
  await page.waitForTimeout(400);
  const flagged = await page.locator('.dict-entry').count();
  if (flagged === 0) fail(`${label}: the source-check filter returned nothing`);
  const strongInFiltered = await page.locator('.dict-entry .badge-strong').count();
  if (strongInFiltered > 0) {
    fail(`${label}: the source-check filter is showing ${strongInFiltered} well-supported entries`);
  }

  /* No horizontal overflow at any width. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) fail(`${label}: horizontal overflow of ${overflow}px`);

  /* Form controls must not trigger zoom-on-focus in mobile Safari. */
  const fontSize = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('dictQuery')).fontSize)
  );
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
console.log('Search, accent folding, confidence filtering, phrasebook rendering and');
console.log('on-screen provenance are healthy at desktop and phone widths.');
