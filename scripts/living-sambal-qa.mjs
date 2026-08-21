/* Browser QA for the separate user-confirmed Sambal Tina living layer. */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

async function expectLivingOnly(word, english, filipino) {
  await search(word);
  const exact = page.locator(`.dict-entry[data-tina="${word}"]`);
  const count = await exact.count();
  if (count !== 1) {
    fail(`${word}: expected one exact living result, found ${count}`);
    return;
  }
  if (await exact.locator('.badge-living').count() !== 1) {
    fail(`${word}: missing User-confirmed badge`);
  }
  if (await exact.locator('.badge-page').count() !== 0) {
    fail(`${word}: living-only entry must not display an archive page`);
  }
  const en = (await exact.locator('.entry-en').textContent() || '').trim();
  const fil = (await exact.locator('.entry-fil').textContent() || '').replace(/^Filipino\s*·\s*/i, '').trim();
  if (!en.includes(english)) fail(`${word}: English meaning does not include ${english!r}: ${en}`);
  if (!fil.includes(filipino)) fail(`${word}: Filipino meaning does not include ${filipino!r}: ${fil}`);
}

await expectLivingOnly('ayama', 'crab', 'alimasag');
await expectLivingOnly('cabatwan', 'river', 'ilog');
await expectLivingOnly('mabanglo', 'fragrant', 'mabango');
await expectLivingOnly('matibya', 'red', 'pula');

/* Archive variants must remain present rather than being overwritten. */
await search('ayamd');
const archiveCrab = page.locator('.dict-entry[data-tina="ayamd"]');
if (await archiveCrab.count() !== 1) fail('ayamd: archival crab form disappeared');
else {
  if (await archiveCrab.locator('.badge-page').count() !== 1) fail('ayamd: archive page reference disappeared');
  if (await archiveCrab.locator('.badge-living').count() !== 0) fail('ayamd: archival variant was incorrectly relabeled as living usage');
}

await search('kabatwan');
const archiveRiver = page.locator('.dict-entry[data-tina="kabatwan"]');
if (await archiveRiver.count() !== 1) fail('kabatwan: archival river form disappeared');
else if (await archiveRiver.locator('.badge-page').count() !== 1) fail('kabatwan: archive page reference disappeared');

/* Exact overlaps remain one record: archive provenance + living confirmation. */
await search('awlo');
const awlo = page.locator('.dict-entry[data-tina="awlo"]');
if (await awlo.count() !== 1) fail(`awlo: expected one exact result, found ${await awlo.count()}`);
else {
  if (await awlo.locator('.badge-page').count() !== 1) fail('awlo: archive page reference disappeared');
  if (await awlo.locator('.badge-living').count() !== 1) fail('awlo: living confirmation badge missing');
}

await search('damolag');
const damolag = page.locator('.dict-entry[data-tina="damolag"]');
if (await damolag.count() !== 1) fail(`damolag: expected one exact result, found ${await damolag.count()}`);
else {
  if (await damolag.locator('.badge-page').count() !== 1) fail('damolag: archive page reference disappeared');
  if (await damolag.locator('.badge-living').count() !== 1) fail('damolag: living confirmation badge missing');
}

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
console.log('User-confirmed forms are searchable, archival variants remain intact,');
console.log('and living-only entries do not receive invented archive citations.');
