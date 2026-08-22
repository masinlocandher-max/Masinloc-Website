/* Browser QA for Sambal Tina community learning and contribution flows. */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const runtimeErrors = [];
const submissions = [];

page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});

await page.route('**/functions/v1/submit-masinloc', async (route) => {
  submissions.push(route.request().postData() || '');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, reference_code: `MC-QA-${submissions.length}` })
  });
});

const response = await page.goto(`${baseURL}/sambal-tina.html`, { waitUntil: 'networkidle' });
if (!response || response.status() >= 400) fail(`dictionary page returned HTTP ${response?.status() ?? 'no response'}`);

const bodyText = await page.locator('body').innerText();
for (const required of [
  'Gather. Compare. Verify. Keep learning.',
  'Tatlong patinig: A · I · O',
  'Tinà Sambal is recognized as a language in its own right',
  'C or K? You may see both.',
  'Submit a word or expression',
  'Suggest a correction'
]) {
  if (!bodyText.includes(required)) fail(`missing community-learning copy: ${required}`);
}
if (bodyText.includes('We copied the archive faithfully')) fail('old copy-the-archive framing is still visible');

const wordForm = page.locator('#sambalWordForm');
await wordForm.locator('[name="tina"]').fill('salita-test');
await wordForm.locator('[name="filipino"]').fill('salitang pagsubok');
await wordForm.locator('[name="english"]').fill('test word');
await wordForm.locator('[name="place"]').fill('Masinloc');
await wordForm.locator('[name="example"]').fill('Example usage.');
await wordForm.locator('[name="evidence"]').fill('QA speaker context.');
await wordForm.locator('[name="contributorName"]').fill('QA Contributor');
await wordForm.locator('[name="contributorContact"]').fill('qa@example.com');
await wordForm.locator('[name="consent"]').check();
await wordForm.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('#sambalWordForm .language-form-status')?.textContent?.includes('MC-QA-1'));

await page.locator('[data-contribution-tab="correction"]').click();
if (await page.locator('#correctionFormPanel').isHidden()) fail('correction panel did not open');
const correctionForm = page.locator('#sambalCorrectionForm');
await correctionForm.locator('[name="entry"]').fill('salita-test');
await correctionForm.locator('[name="proposed"]').fill('salita-tama');
await correctionForm.locator('[name="correction"]').fill('Correct the spelling.');
await correctionForm.locator('[name="evidence"]').fill('QA source context.');
await correctionForm.locator('[name="contributorName"]').fill('QA Contributor');
await correctionForm.locator('[name="contributorContact"]').fill('qa@example.com');
await correctionForm.locator('[name="consent"]').check();
await correctionForm.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('#sambalCorrectionForm .language-form-status')?.textContent?.includes('MC-QA-2'));

if (submissions.length !== 2) fail(`expected 2 contribution requests, received ${submissions.length}`);
if (!submissions[0]?.includes('Sambal Tina word submission: salita-test')) fail('word submission payload was not mapped to review backend');
if (!submissions[0]?.includes('sambal_tina_word')) fail('word submission kind marker missing');
if (!submissions[1]?.includes('Sambal Tina correction: salita-test')) fail('correction payload was not mapped to review backend');
if (!submissions[1]?.includes('sambal_tina_correction')) fail('correction submission kind marker missing');

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) fail(`community sections cause ${overflow}px horizontal overflow on mobile`);

runtimeErrors.forEach(fail);
await context.close();
await browser.close();

if (failures.length) {
  console.log('SAMBAL COMMUNITY QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('SAMBAL COMMUNITY QA PASSED');
console.log('Learning copy, language classification, C/K and A-I-O lessons,');
console.log('and both contribution flows work on the rendered mobile page.');
