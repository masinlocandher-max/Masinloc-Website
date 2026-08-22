/* Browser QA for Sambal Tina community learning, submissions and contributor credits. */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const runtimeErrors = [];
const posts = [];

page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});

await page.route('**/functions/v1/submit-masinloc**', async (route) => {
  const request = route.request();
  if (request.method() === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, contributors: ['Ana Masinloc', 'Ben Sambal'] })
    });
    return;
  }
  posts.push(request.postData() || '');
  await route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, category: 'dictionary', reference_code: `MC-DICT-QA-${posts.length}` })
  });
});

const response = await page.goto(`${baseURL}/sambal-tina.html`, { waitUntil: 'networkidle' });
if (!response || response.status() >= 400) fail(`dictionary page returned HTTP ${response?.status() ?? 'no response'}`);

/* textContent is used here intentionally: it verifies authored copy even when a
   responsive/reveal treatment has not yet made a section measurable by innerText. */
const bodyText = await page.locator('body').textContent() || '';
for (const required of [
  'We gather it',
  'We verify it',
  'We improve it together',
  'A, I, O',
  'C and K',
  'Tinà Sambal is recognized as a distinct language of its own',
  'Submit a word',
  'Send a correction',
  'Contributors'
]) {
  if (!bodyText.includes(required)) fail(`missing community copy: ${required}`);
}
if (/we copied|copied the archive faithfully/i.test(bodyText)) fail('old copy-the-archive framing is still visible');

const correctionButton = page.locator('[data-contribution-type="correction"]').first();
if (await correctionButton.count() !== 1) fail('Send a correction action is missing');
else if ((await correctionButton.textContent() || '').trim() !== 'Send a correction') {
  fail(`correction action has unexpected label: ${(await correctionButton.textContent() || '').trim()}`);
}

await page.locator('.dict-entry').first().waitFor({ state: 'visible', timeout: 15000 });
await page.waitForFunction(() => document.querySelector('#daily') && !document.querySelector('#daily').hidden);
const dailyWord = (await page.locator('.daily-word').textContent() || '').trim().toLowerCase();
const dailyGloss = (await page.locator('.daily-gloss').textContent() || '').toLowerCase();
if (dailyWord !== 'matibya') fail(`word of the day is ${dailyWord || 'blank'}, expected matibya`);
if (!dailyGloss.includes('red') || !dailyGloss.includes('pula')) fail(`matibya gloss is incomplete: ${dailyGloss}`);

/* Public results stay clean: no source pages, source-status prose or internal notes. */
if (await page.locator('.badge-page, .entry-status, .entry-note, .phrase-page').count()) {
  fail('public dictionary exposes internal source/provenance mechanics');
}

await page.locator('[data-contribution-type="new_entry"]').first().click();
const modal = page.locator('#contributionModal');
if (await modal.isHidden()) fail('new-entry contribution modal did not open');
const form = page.locator('#dictionaryContributionForm');
await form.locator('[name="headword"]').fill('salita-test');
await form.locator('[name="filipinoMeaning"]').fill('salitang pagsubok');
await form.locator('[name="englishMeaning"]').fill('test word');
await form.locator('[name="contributionDetails"]').fill('Used in Masinloc QA context.');
await form.locator('[name="exampleUsage"]').fill('Example usage.');
await form.locator('[name="contributorName"]').fill('QA Contributor');
await form.locator('[name="contributorContact"]').fill('qa@example.com');
await form.locator('[name="creditName"]').fill('QA Contributor');
await form.locator('[name="creditConsent"]').check();
await form.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('#dictionaryFormMessage')?.textContent?.includes('MC-DICT-QA-1'));

await page.locator('[data-close-modal]').first().click();
await correctionButton.click();
await form.locator('[name="headword"]').fill('salita-test');
await form.locator('[name="contributionDetails"]').fill('Please correct this spelling to salita-tama.');
await form.locator('[name="contributorName"]').fill('QA Contributor');
await form.locator('[name="contributorContact"]').fill('qa@example.com');
await form.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('#dictionaryFormMessage')?.textContent?.includes('MC-DICT-QA-2'));

if (posts.length !== 2) fail(`expected 2 dictionary submissions, received ${posts.length}`);
if (!posts[0]?.includes('name="category"') || !posts[0]?.includes('dictionary')) fail('new-entry request is not routed to dictionary intake');
if (!posts[0]?.includes('new_entry')) fail('new-entry submission type is missing');
if (!posts[0]?.includes('QA Contributor')) fail('contributor credit data is missing from new-entry request');
if (!posts[1]?.includes('correction')) fail('correction submission type is missing');

await page.locator('[data-close-modal]').first().click();
await page.locator('#contributorsLink').click();
await page.waitForFunction(() => document.querySelector('#contributorsList')?.textContent?.includes('Ana Masinloc'));
const contributorsText = await page.locator('#contributorsList').innerText();
if (!contributorsText.includes('Ben Sambal')) fail('approved contributor list did not render');

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) fail(`community UI causes ${overflow}px horizontal overflow on mobile`);

runtimeErrors.forEach(fail);
await context.close();
await browser.close();

if (failures.length) {
  console.log('SAMBAL COMMUNITY QA FAILED');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

console.log('SAMBAL COMMUNITY QA PASSED');
console.log('Community copy, Matibya word-of-day, clean public results, dictionary submissions,');
console.log('corrections, contributor consent and approved contributor listing all work on mobile.');
