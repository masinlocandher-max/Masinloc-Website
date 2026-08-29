/* Browser contract for Masinloc Connect Jobs.
 *
 * Public presentation is intentionally Masinloc Connect-first. Provider names and
 * freshness timestamps are backend/trust details, not list-card marketing. The
 * official application destination remains available when a user needs it.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const failures = [];
const fail = message => failures.push(message);
const browser = await chromium.launch({ headless: true });
await fs.mkdir('artifacts/browser-qa', { recursive: true });

const sampleJob = {
  id: 'qa-live-job-123', external_job_id: 'qa-provider-123', title: 'Production Worker',
  company: 'QA Employer', location: 'SUBIC, ZAMBALES', work_setup: 'On-site',
  employment_type: 'Permanent', salary_text: '₱18,000.00',
  description_excerpt: 'Production work in a supervised manufacturing environment.',
  requirements_excerpt: 'High school graduate. Review the official application page for complete requirements.',
  published_at: '2026-08-27T00:00:00+08:00', expires_at: null,
  source_url: 'https://example.com/source', apply_url: 'https://example.com/apply',
  last_verified_at: new Date().toISOString(), provider_metadata: { entry_level: true },
  provider: { code: 'philjobnet', name: 'PhilJobNet', attribution_label: 'From PhilJobNet', render_mode: 'linkout', application_mode: 'handoff', status: 'testing' },
};

async function stubJobsFeed(page, body = []) {
  await page.route('**/rest/v1/external_jobs*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'content-range': body.length ? `0-${body.length - 1}/${body.length}` : '0-0/0' },
    body: JSON.stringify(body),
  }));
}
function watchErrors(page, bucket) {
  page.on('pageerror', error => bucket.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error' || message.text().includes('favicon.ico')) return;
    bucket.push(`console: ${message.text()}`);
  });
}

async function testJobsEmpty(viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage(); const errors = []; watchErrors(page, errors); await stubJobsFeed(page);
  const response = await page.goto(`${baseURL}/jobs.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/jobs-empty: HTTP ${response?.status() ?? 'no response'}`);
  const state = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, heading: document.querySelector('h1')?.textContent.trim() || '', canonical: document.querySelector('link[rel="canonical"]')?.href || '', robots: document.querySelector('meta[name="robots"]')?.content || '', overflow: document.documentElement.scrollWidth - innerWidth }));
  if (state.h1 !== 1 || state.heading !== 'Explore opportunities in Zambales and beyond.') fail(`${label}/jobs-empty: heading contract drifted`);
  if (state.canonical !== 'https://www.masinloc-zambales.com/jobs.html') fail(`${label}/jobs-empty: canonical is ${state.canonical}`);
  if (!state.robots.includes('noindex')) fail(`${label}/jobs-empty: Jobs route must remain noindex for now`);
  if (state.overflow > 1) fail(`${label}/jobs-empty: horizontal overflow ${state.overflow}px`);
  await page.locator('#jobsEmpty').waitFor({ state: 'visible' });
  const empty = (await page.locator('#jobsEmpty').innerText()).toLowerCase();
  if (!empty.includes('masinloc connect keeps looking for new openings')) fail(`${label}/jobs-empty: ongoing-search promise is missing`);
  if (!(await page.locator('#jobsWorkspace').isHidden())) fail(`${label}/jobs-empty: workspace visible with empty feed`);
  if (!(await page.locator('#jobsSummary').isHidden())) fail(`${label}/jobs-empty: summary visible with empty feed`);
  if (await page.locator('#quickMatchForm').count() !== 1) fail(`${label}/jobs-empty: Quick Match missing`);
  if (await page.locator('#jobFilters .jobs-chip').count() < 8) fail(`${label}/jobs-empty: job filters incomplete`);
  await page.screenshot({ path: `artifacts/browser-qa/jobs-empty-${label}.png`, fullPage: true });
  errors.forEach(error => fail(`${label}/jobs-empty: ${error}`)); await context.close();
}

async function testJobsPopulated(viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage(); const errors = []; watchErrors(page, errors); await stubJobsFeed(page, [sampleJob]);
  const response = await page.goto(`${baseURL}/jobs.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/jobs-live: HTTP ${response?.status() ?? 'no response'}`);
  await page.locator('#jobsWorkspace').waitFor({ state: 'visible' });
  if ((await page.locator('#summaryTotal').innerText()).trim() !== '1') fail(`${label}/jobs-live: total summary wrong`);
  if ((await page.locator('#summaryZambales').innerText()).trim() !== '1') fail(`${label}/jobs-live: Zambales summary wrong`);
  if ((await page.locator('#summaryEntry').innerText()).trim() !== '1') fail(`${label}/jobs-live: entry-level summary wrong`);
  if ((await page.locator('#summaryChecked').innerText()).trim() !== 'Ongoing') fail(`${label}/jobs-live: opportunity search should read Ongoing`);
  if (await page.locator('#jobsList .job-row').count() !== 1) fail(`${label}/jobs-live: vacancy not rendered`);

  const cardText = (await page.locator('#jobsList .job-row').innerText()).toLowerCase();
  if (!cardText.includes('production worker') || !cardText.includes('qa employer') || !cardText.includes('subic, zambales')) fail(`${label}/jobs-live: useful vacancy fields missing from card`);
  if (cardText.includes('philjobnet') || cardText.includes('checked today') || cardText.includes('checked yesterday')) fail(`${label}/jobs-live: provider/freshness leaked into opportunity card`);

  const painted = await page.locator('#jobsWorkspace').evaluate(el => ({ opacity: Number(getComputedStyle(el).opacity), height: el.getBoundingClientRect().height }));
  if (painted.opacity < 0.9 || painted.height < 100) fail(`${label}/jobs-live: workspace is not visibly painted`);

  let detail = (await page.locator('#jobsDetail').innerText()).toLowerCase();
  for (const expected of ['production worker','qa employer','subic, zambales','role','requirements','view official listing','before you continue','resume','masinloc connect found and organized this opportunity for you']) {
    if (!detail.includes(expected)) fail(`${label}/jobs-live: detail missing ${expected}`);
  }
  if (detail.includes('checked today') || detail.includes('checked yesterday') || detail.includes('from philjobnet')) fail(`${label}/jobs-live: provider/freshness dominates public detail`);

  await page.locator('#quickRole').fill('production');
  await page.locator('#quickLocation').selectOption('zambales');
  await page.locator('#quickExperience').selectOption('entry');
  await page.locator('#quickMatchForm button[type="submit"]').click();
  await page.locator('#jobsWorkspace').waitFor({ state: 'visible' });
  if ((await page.locator('#jobsListTitle').innerText()).trim() !== 'Your Quick Match') fail(`${label}/quick-match: heading did not switch`);
  if (await page.locator('#jobsList .job-row').count() !== 1) fail(`${label}/quick-match: matching vacancy missing`);
  const quickNote = (await page.locator('#quickMatchNote').innerText()).toLowerCase();
  if (!quickNote.includes('1 current opportunity')) fail(`${label}/quick-match: useful match count missing`);
  detail = (await page.locator('#jobsDetail').innerText()).toLowerCase();
  if (!detail.includes('why this may fit you') || !detail.includes('zambales preference')) fail(`${label}/quick-match: explanation missing`);
  await page.locator('#resetQuickMatch').click();

  await page.locator('#jobSearch').fill('production subic');
  if (await page.locator('#jobsList .job-row').count() !== 1) fail(`${label}/jobs-live: multi-word search failed`);
  await page.locator('#jobSearch').fill('production pampanga');
  await page.locator('#jobsEmpty').waitFor({ state: 'visible' });
  await page.locator('#clearJobsBtn').click(); await page.locator('#jobsWorkspace').waitFor({ state: 'visible' });
  if ((await page.locator('[data-filter="zambales"] [data-count]').innerText()).trim() !== '1') fail(`${label}/jobs-live: Zambales filter count wrong`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) fail(`${label}/jobs-live: horizontal overflow ${overflow}px`);
  await page.screenshot({ path: `artifacts/browser-qa/jobs-live-${label}.png`, fullPage: true });

  await page.locator('#saveJobBtn').click(); await page.waitForURL('**/career.html?return_job=qa-live-job-123&action=save');
  if (!page.url().includes('return_job=qa-live-job-123')) fail(`${label}/jobs-live: save did not preserve vacancy`);
  await page.goto(`${baseURL}/jobs.html`, { waitUntil: 'networkidle' }); await page.locator('#jobsWorkspace').waitFor({ state: 'visible' });
  await page.locator('#applyJobBtn').click(); await page.waitForURL('**/career.html?return_job=qa-live-job-123&action=apply');
  if (!page.url().includes('action=apply')) fail(`${label}/jobs-live: apply did not preserve intent`);
  errors.forEach(error => fail(`${label}/jobs-live: ${error}`)); await context.close();
}

async function testCareer(viewport, label) {
  const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = []; watchErrors(page, errors);
  const response = await page.goto(`${baseURL}/career.html?return_job=qa-job-123&action=apply`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`${label}/career: HTTP ${response?.status() ?? 'no response'}`);
  const state = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, heading: document.querySelector('h1')?.textContent.trim() || '', canonical: document.querySelector('link[rel="canonical"]')?.href || '', overflow: document.documentElement.scrollWidth - innerWidth }));
  if (state.h1 !== 1 || state.heading !== 'My Career') fail(`${label}/career: H1 contract drifted`);
  if (state.canonical !== 'https://www.masinloc-zambales.com/career.html') fail(`${label}/career: canonical wrong`);
  if (state.overflow > 1) fail(`${label}/career: horizontal overflow ${state.overflow}px`);
  if (!(await page.locator('#authView').isVisible()) || !(await page.locator('#careerView').isHidden())) fail(`${label}/career: privacy/auth gate wrong`);
  if (!(await page.locator('#returnNotice').isVisible())) fail(`${label}/career: pending-job notice hidden`);
  if (!(await page.locator('#returnNotice').innerText()).toLowerCase().includes('same opportunity')) fail(`${label}/career: pending-job preservation unexplained`);
  await page.locator('#authEmail').fill('qa@example.com'); await page.locator('#sendLinkBtn').click();
  if (!(await page.locator('#authMessage').innerText()).toLowerCase().includes('privacy notice')) fail(`${label}/career: privacy gate did not stop sign-in request`);
  await page.screenshot({ path: `artifacts/browser-qa/career-${label}.png`, fullPage: true }); errors.forEach(error => fail(`${label}/career: ${error}`)); await context.close();
}

async function testResumeAuthGuard() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage(); const errors = []; watchErrors(page, errors);
  await page.goto(`${baseURL}/resume.html`, { waitUntil: 'networkidle' }); await page.waitForURL('**/career.html');
  if (!page.url().endsWith('/career.html')) fail(`resume/auth: signed-out resume did not redirect`);
  errors.forEach(error => fail(`resume/auth: ${error}`)); await context.close();
}

for (const [label, viewport] of [['desktop',{width:1280,height:900}],['phone',{width:390,height:844}]]) {
  await testJobsEmpty(viewport, label); await testJobsPopulated(viewport, label); await testCareer(viewport, label);
}
await testResumeAuthGuard(); await browser.close();
if (failures.length) { console.error('JOBS QA FAILED'); failures.forEach(failure => console.error(`- ${failure}`)); process.exit(1); }
console.log('JOBS QA PASSED');
console.log('Masinloc Connect-first presentation, guest Quick Match, search/filter counts, vacancy rendering, readiness guidance, privacy-gated Career entry, pending-job preservation, resume auth guard and responsive widths hold.');
