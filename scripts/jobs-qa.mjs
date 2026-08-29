/* Browser contract for the Masinloc Connect Jobs MVP.
 *
 * The database/RLS checks own data security. This suite proves the job-seeker
 * experience without depending on a live provider feed or a real email login:
 * public browsing, truthful empty state, guided career entry, pending-job
 * preservation, resume auth guard, responsive layout, and console health.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = (message) => failures.push(message);
const browser = await chromium.launch({ headless: true });

await fs.mkdir('artifacts/browser-qa', { recursive: true });

async function stubJobsFeed(page) {
  await page.route('**/rest/v1/external_jobs*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });
}

function watchErrors(page, bucket) {
  page.on('pageerror', (error) => bucket.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const value = message.text();
    if (value.includes('favicon.ico')) return;
    bucket.push(`console: ${value}`);
  });
}

async function testJobs(viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  await stubJobsFeed(page);

  const response = await page.goto(`${baseURL}/jobs.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/jobs: HTTP ${response?.status() ?? 'no response'}`);

  const state = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    heading: document.querySelector('h1')?.textContent.trim() || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (state.h1 !== 1) fail(`${label}/jobs: expected one H1`);
  if (state.heading !== 'Hanap tayo ng trabahong bagay sa iyo.') fail(`${label}/jobs: unexpected H1: ${state.heading}`);
  if (state.canonical !== 'https://www.masinloc-zambales.com/jobs.html') fail(`${label}/jobs: canonical is ${state.canonical}`);
  if (!state.robots.includes('noindex')) fail(`${label}/jobs: MVP route must remain noindex`);
  if (state.overflow > 1) fail(`${label}/jobs: horizontal overflow ${state.overflow}px`);

  await page.locator('#jobsEmpty').waitFor({ state: 'visible' });
  const empty = (await page.locator('#jobsEmpty').innerText()).toLowerCase();
  if (!empty.includes('live opportunities are being connected')) fail(`${label}/jobs: truthful provider empty state is missing`);
  if (!(await page.locator('#jobsWorkspace').isHidden())) fail(`${label}/jobs: empty feed still exposes job workspace`);
  if (await page.locator('#jobSearch').count() !== 1) fail(`${label}/jobs: search input missing`);
  if (await page.locator('#jobFilters .jobs-chip').count() < 7) fail(`${label}/jobs: guided job filters are incomplete`);
  const careerHref = await page.locator('#careerLink').getAttribute('href');
  if (careerHref !== 'career.html') fail(`${label}/jobs: career CTA does not lead to career.html`);

  await page.screenshot({ path: `artifacts/browser-qa/jobs-${label}.png`, fullPage: true });
  for (const error of errors) fail(`${label}/jobs: ${error}`);
  await context.close();
}

async function testCareer(viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);

  const response = await page.goto(`${baseURL}/career.html?return_job=qa-job-123&action=apply`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/career: HTTP ${response?.status() ?? 'no response'}`);

  const state = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    heading: document.querySelector('h1')?.textContent.trim() || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (state.h1 !== 1 || state.heading !== 'My Career') fail(`${label}/career: H1 contract drifted`);
  if (state.canonical !== 'https://www.masinloc-zambales.com/career.html') fail(`${label}/career: canonical is ${state.canonical}`);
  if (state.overflow > 1) fail(`${label}/career: horizontal overflow ${state.overflow}px`);

  if (!(await page.locator('#authView').isVisible())) fail(`${label}/career: signed-out auth view is not visible`);
  if (!(await page.locator('#careerView').isHidden())) fail(`${label}/career: private form is visible before authentication`);
  if (await page.locator('#authEmail[type="email"]').count() !== 1) fail(`${label}/career: email sign-in input missing`);
  if (await page.locator('#privacyConsent[type="checkbox"]').count() !== 1) fail(`${label}/career: privacy consent control missing`);
  if (await page.locator('#sendLinkBtn').count() !== 1) fail(`${label}/career: passwordless sign-in control missing`);
  if (!(await page.locator('#returnNotice').isVisible())) fail(`${label}/career: pending job notice is hidden`);
  const pendingCopy = (await page.locator('#returnNotice').innerText()).toLowerCase();
  if (!pendingCopy.includes('same opportunity')) fail(`${label}/career: pending-job preservation is not explained`);

  // Privacy acknowledgement is required before any auth request is attempted.
  await page.locator('#authEmail').fill('qa@example.com');
  await page.locator('#sendLinkBtn').click();
  const authMessage = (await page.locator('#authMessage').innerText()).toLowerCase();
  if (!authMessage.includes('privacy notice')) fail(`${label}/career: privacy gate did not stop sign-in request`);

  await page.screenshot({ path: `artifacts/browser-qa/career-${label}.png`, fullPage: true });
  for (const error of errors) fail(`${label}/career: ${error}`);
  await context.close();
}

async function testResumeAuthGuard() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);

  await page.goto(`${baseURL}/resume.html`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/career.html');
  if (!page.url().endsWith('/career.html')) fail(`resume/auth: signed-out resume did not redirect to career.html (${page.url()})`);
  for (const error of errors) fail(`resume/auth: ${error}`);
  await context.close();
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  await testJobs(viewport, label);
  await testCareer(viewport, label);
}
await testResumeAuthGuard();
await browser.close();

if (failures.length) {
  console.error('JOBS QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('JOBS QA PASSED');
console.log('Public browse, truthful provider state, privacy-gated career entry, pending-job preservation, resume auth guard and responsive widths hold.');
