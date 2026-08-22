/* Browser QA for the separate user-confirmed Sambal Tina living layer. */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
/* The editable dictionary layer is a third-party host. These checks are
   about the page, not about whether Supabase is reachable, so it is
   served empty here. scripts/dictionary-entries-qa.mjs covers the layer
   itself, including what happens when it cannot be reached. */
await context.route('**/rest/v1/dictionary_entries*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const page = await context.newPage();
const runtimeErrors = [];

page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});

const response = await page.goto(`${baseURL}/sambal-tina.html`, { waitUntil: 'networkidle' });
if (!response || response.status() >= 400) {
  fail(`dictionary page returned HTTP ${response?.status() ?? 'no response'}`);
}
await page.locator('.dict-entry').first().waitFor({ state: 'visible', timeout: 15000 });

async function search(word) {
  await page.fill('#dictQuery', word);
  await page.waitForFunction(
    (term) => (document.getElementById('dictStatus')?.textContent || '').includes(term),
    word,
    { timeout: 8000 }
  );
  await page.waitForTimeout(180);
}

async function expectConfirmedMeaning(word, english, filipino) {
  await search(word);
  const exact = page.locator(`.dict-entry[data-tina="${word}"]`);
  const count = await exact.count();
  if (count !== 1) {
    fail(`${word}: expected one exact community-confirmed result, found ${count}`);
    return;
  }
  if (await exact.locator('.badge-living').count() !== 1) {
    fail(`${word}: missing Community-confirmed badge`);
  }
  if (await exact.locator('.badge-page, .entry-status, .entry-note').count() !== 0) {
    fail(`${word}: public result exposes internal source/provenance mechanics`);
  }
  const enLocator = exact.locator('.entry-en');
  const filLocator = exact.locator('.entry-fil');
  if (await enLocator.count() !== 1) {
    fail(`${word}: confirmed English meaning is not rendered`);
  } else {
    const en = (await enLocator.textContent() || '').trim();
    if (!en.includes(english)) {
      fail(`${word}: English meaning does not include ${JSON.stringify(english)}: ${en}`);
    }
  }
  if (await filLocator.count() !== 1) {
    fail(`${word}: confirmed Filipino meaning is not rendered`);
  } else {
    const fil = (await filLocator.textContent() || '').trim();
    if (!fil.includes(filipino)) {
      fail(`${word}: Filipino meaning does not include ${JSON.stringify(filipino)}: ${fil}`);
    }
  }
}

await expectConfirmedMeaning('ayama', 'crab', 'alimasag');
await expectConfirmedMeaning('cabatwan', 'river', 'ilog');
await expectConfirmedMeaning('mabanglo', 'fragrant', 'mabango');
await expectConfirmedMeaning('matibya', 'red', 'pula');

/* Historical variants remain searchable but are not falsely relabeled as community-confirmed. */
await search('ayamd');
const archiveCrab = page.locator('.dict-entry[data-tina="ayamd"]');
if (await archiveCrab.count() !== 1) fail('ayamd: historical variant disappeared');
else {
  if (await archiveCrab.locator('.badge-living').count() !== 0) fail('ayamd: historical variant was incorrectly relabeled as community-confirmed');
  if (await archiveCrab.locator('.badge-page, .entry-status, .entry-note').count() !== 0) fail('ayamd: public result exposes internal source mechanics');
}

await search('kabatwan');
const archiveRiver = page.locator('.dict-entry[data-tina="kabatwan"]');
if (await archiveRiver.count() !== 1) fail('kabatwan: historical variant disappeared');
else {
  if (await archiveRiver.locator('.badge-living').count() !== 0) fail('kabatwan: historical variant was incorrectly relabeled as community-confirmed');
  if (await archiveRiver.locator('.badge-page, .entry-status, .entry-note').count() !== 0) fail('kabatwan: public result exposes internal source mechanics');
}

/* Exact overlaps remain one searchable record and also show community confirmation. */
await expectConfirmedMeaning('awlo', 'day', 'araw');
await expectConfirmedMeaning('damolag', 'carabao', 'kalabaw');

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth
);
if (overflow > 1) fail(`living results cause ${overflow}px horizontal overflow on mobile`);

runtimeErrors.forEach(fail);
await context.close();
await browser.close();

if (failures.length) {
  console.log('LIVING SAMBAL QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('LIVING SAMBAL QA PASSED');
console.log('Community-confirmed forms and historical variants remain searchable and distinct,');
console.log('while internal source/provenance mechanics stay out of the public interface.');
