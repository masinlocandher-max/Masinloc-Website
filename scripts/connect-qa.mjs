import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ headless: true });
const failures = [];

function fail(message) {
  failures.push(message);
}

async function testMobileConnect() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) errors.push(`console: ${message.text()}`);
  });

  const staleDraft = {
    type: 'professional',
    step: 2,
    data: { fullName: 'QA stale draft', contactNumber: '0000000000' },
    updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  };

  await page.addInitScript(draft => {
    localStorage.setItem('masinlocConnectDraft', JSON.stringify(draft));
  }, staleDraft);

  const response = await page.goto(`${baseURL}/connect.html`, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) fail(`mobile/connect: HTTP ${response?.status() ?? 'no response'}`);

  await page.locator('.quick-card.business').waitFor({ state: 'visible' });

  const heading = (await page.locator('#shareTitle').innerText()).trim();
  if (heading !== 'May gusto kang ibahagi tungkol sa Masinloc?') fail(`mobile/connect: unexpected share heading: ${heading}`);

  if (await page.getByText('May kwento ka tungkol sa Masinloc?', { exact: true }).count()) {
    fail('mobile/connect: stale story-only heading is still rendered');
  }

  const logo = page.locator('#overlayNav img[src="assets/masinloc-logo.webp"]');
  const logoState = await logo.evaluate(img => ({
    visible: !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    renderedWidth: img.getBoundingClientRect().width,
  }));
  if (!logoState.visible) fail('mobile/connect: header logo is not visible');
  if (logoState.naturalWidth < 300 || logoState.naturalHeight < 70) fail(`mobile/connect: logo decoded too small (${logoState.naturalWidth}x${logoState.naturalHeight})`);
  if (logoState.renderedWidth > 122) fail(`mobile/connect: logo is still oversized at ${logoState.renderedWidth}px`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`mobile/connect: horizontal overflow ${overflow}px`);

  const trap = page.locator('#websiteTrap');
  if (await trap.count() !== 1) fail('mobile/connect: honeypot field is missing');
  else {
    const trapState = await trap.evaluate(el => ({
      left: getComputedStyle(el.closest('.hp-field')).left,
      tabIndex: el.tabIndex,
    }));
    if (trapState.tabIndex !== -1) fail('mobile/connect: honeypot is keyboard-focusable');
  }

  const storedDraft = await page.evaluate(() => localStorage.getItem('masinlocConnectDraft'));
  if (storedDraft !== null) fail('mobile/connect: expired draft was not removed');
  if (!(await page.locator('#resumeBar').isHidden())) fail('mobile/connect: expired draft banner is visible');

  await page.locator('.quick-card.business').click();
  await page.locator('#formView').waitFor({ state: 'visible' });
  const businessFile = page.locator('input[name="brandLogo"]');
  if (await businessFile.count() !== 1) fail('mobile/connect: business logo input missing');
  else {
    const attrs = await businessFile.evaluate(input => ({ accept: input.accept, multiple: input.multiple }));
    if (attrs.multiple) fail('mobile/connect: business logo input allows multiple files');
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      if (!attrs.accept.includes(mime)) fail(`mobile/connect: business logo accept is missing ${mime}`);
    }
  }

  const statusText = (await page.locator('#saveStatus').innerText()).trim();
  if (!statusText.includes('7 days')) fail(`mobile/connect: draft retention notice is unclear: ${statusText}`);

  await page.goto(`${baseURL}/connect.html`, { waitUntil: 'networkidle' });
  await page.locator('.quick-card.story').click();
  const storyFile = page.locator('input[name="media"]');
  if (await storyFile.count() !== 1) fail('mobile/connect: story attachment input missing');
  else {
    const attrs = await storyFile.evaluate(input => ({ accept: input.accept, multiple: input.multiple }));
    if (!attrs.multiple) fail('mobile/connect: story attachment input should allow multiple files');
    if (!attrs.accept.includes('application/pdf')) fail('mobile/connect: story attachment input does not allow PDF');
  }

  const appText = await (await page.request.get(`${baseURL}/app.js?v=20260821-1`)).text();
  const securityText = await (await page.request.get(`${baseURL}/security.js?v=20260821-1`)).text();
  if (!appText.includes("category==='resume'")) fail('connect/app: resume upload dispatch is missing');
  if (!appText.includes("name:'existingResume'")) fail('connect/app: resume PDF field is missing');
  if (!securityText.includes("input.name==='existingResume'")) fail('connect/security: resume PDF validation is missing');
  if (!securityText.includes("application/pdf")) fail('connect/security: PDF MIME validation is missing');

  for (const error of errors) fail(`mobile/connect: ${error}`);
  await context.close();
}

async function testDesktopBranding() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  for (const path of ['/index.html', '/a-closer-look.html', '/verified-history.html', '/masinloc-bulletin.html', '/connect.html']) {
    const response = await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
    if (!response || response.status() >= 400) {
      fail(`desktop${path}: HTTP ${response?.status() ?? 'no response'}`);
      continue;
    }
    const logo = page.locator('header img[src="assets/masinloc-logo.webp"]').first();
    if (!(await logo.isVisible())) fail(`desktop${path}: shared logo not visible`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) fail(`desktop${path}: horizontal overflow ${overflow}px`);
  }
  await context.close();
}

await testMobileConnect();
await testDesktopBranding();
await browser.close();

if (failures.length) {
  console.error('CONNECT QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CONNECT QA PASSED');
console.log('Mobile copy, logo sizing, draft expiry, honeypot presence, upload controls and shared desktop branding are healthy.');
