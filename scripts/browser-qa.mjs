import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const outputDir = path.resolve('artifacts/browser-qa');
await fs.mkdir(outputDir, { recursive: true });

const pages = [
  ['home', '/index.html'],
  ['closer-look', '/a-closer-look.html'],
  ['sambal-tina', '/sambal-tina.html'],
  ['verified-history', '/verified-history.html'],
  ['bulletin', '/masinloc-bulletin.html'],
  ['connect', '/connect.html'],
  ['admin', '/admin.html'],
  ['not-found', '/404.html'],
];

const expectedNavText = [
  'Home',
  'A Closer Look',
  'Verified History',
  'Masinloc Bulletin',
  'Masinloc Connect',
  'Contact',
];

const expectedCurrentHref = {
  home: 'index.html',
  'closer-look': 'a-closer-look.html',
  /* A sub-page of A Closer Look: the parent keeps the current-page state. */
  'sambal-tina': 'a-closer-look.html',
  'verified-history': 'verified-history.html',
  bulletin: 'masinloc-bulletin.html',
  connect: 'connect.html',
};

const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
];

const browser = await chromium.launch({ headless: true });
const failures = [];

async function revealPage(page) {
  const revealTargets = page.locator('[data-reveal]');
  const count = await revealTargets.count();

  for (let index = 0; index < count; index += 1) {
    const target = revealTargets.nth(index);
    try {
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
    } catch {
      // A detached target is not a visual failure; page-level checks below catch broken layout.
    }
  }

  if (count === 0) {
    await page.evaluate(async () => {
      const step = Math.max(Math.floor(window.innerHeight * 0.72), 360);
      const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      for (let y = 0; y <= max; y += step) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 55));
      }
    });
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(500);
}

async function assertVerifiedImage(page, selector, label) {
  const image = page.locator(selector);
  if (!(await image.isVisible())) {
    failures.push(`${label}: image is not visible`);
    return;
  }
  const state = await image.evaluate(img => ({
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    opacity: Number(getComputedStyle(img).opacity),
  }));
  if (state.naturalWidth !== 1536 || state.naturalHeight !== 864) {
    failures.push(`${label}: image decoded at ${state.naturalWidth}x${state.naturalHeight}, expected 1536x864`);
  }
  if (state.opacity < 0.9) failures.push(`${label}: image opacity ${state.opacity}`);
}

async function assertSharedNavigation(page, pageName, viewportName) {
  const header = page.locator('header').first();
  const logo = header.locator('img[src="assets/masinloc-logo.webp"]').first();
  if (!(await logo.isVisible())) failures.push(`${viewportName}/${pageName}: shared Masinloc header logo is not visible`);

  const nav = header.locator('nav').first();
  const links = nav.locator('a');
  const labels = [];
  for (let index = 0; index < await links.count(); index += 1) {
    labels.push((await links.nth(index).innerText()).trim().replace(/\s+/g, ' '));
  }

  if (JSON.stringify(labels) !== JSON.stringify(expectedNavText)) {
    failures.push(`${viewportName}/${pageName}: navigation labels/order differ: ${JSON.stringify(labels)}`);
  }

  const current = nav.locator('a[aria-current="page"]');
  if (await current.count() !== 1) {
    failures.push(`${viewportName}/${pageName}: expected one current navigation item`);
  } else {
    const href = await current.getAttribute('href');
    if (href !== expectedCurrentHref[pageName]) {
      failures.push(`${viewportName}/${pageName}: current navigation href ${href} != ${expectedCurrentHref[pageName]}`);
    }
  }
}

async function assertAdminSurface(page, viewportName) {
  const login = page.locator('#loginView');
  if (!(await login.isVisible())) failures.push(`${viewportName}/admin: login surface is not visible`);
  const logo = login.locator('img[src="assets/masinloc-logo.webp"]');
  if (!(await logo.isVisible())) failures.push(`${viewportName}/admin: Masinloc logo is not visible`);
  const visibleHeadings = page.locator('h1:visible');
  if (await visibleHeadings.count() !== 1) failures.push(`${viewportName}/admin: expected exactly one visible H1`);
  const noindex = await page.locator('meta[name="robots"]').getAttribute('content');
  if (!noindex?.includes('noindex') || !noindex?.includes('nofollow')) {
    failures.push(`${viewportName}/admin: private workspace indexing protection is missing`);
  }
}

for (const [viewportName, viewport] of viewports) {
  const context = await browser.newContext({ viewport });

  for (const [pageName, pathname] of pages) {
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    try {
      const response = await page.goto(`${baseURL}${pathname}`, { waitUntil: 'networkidle' });
      if (!response || response.status() >= 400) {
        failures.push(`${viewportName}/${pageName}: HTTP ${response?.status() ?? 'no response'}`);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`${viewportName}/${pageName}: horizontal overflow ${overflow}px`);

      if (!['not-found', 'admin'].includes(pageName)) {
        const h1 = page.locator('h1');
        if (await h1.count() !== 1) failures.push(`${viewportName}/${pageName}: expected exactly one H1`);
        else if (!(await h1.isVisible())) failures.push(`${viewportName}/${pageName}: H1 is not visible`);
        await assertSharedNavigation(page, pageName, viewportName);
      }

      if (pageName === 'admin') await assertAdminSurface(page, viewportName);

      if (pageName === 'home') {
        await assertVerifiedImage(page, '.hero-media img', `${viewportName}/home hero`);
      }

      if (pageName === 'connect') {
        await assertVerifiedImage(page, '.landing-view .hero-img', `${viewportName}/connect hero`);
      }

      if (pageName !== 'not-found') {
        await page.screenshot({
          path: path.join(outputDir, `${viewportName}-${pageName}-top.png`),
          fullPage: false,
        });
      }

      if (pageName === 'home') {
        await page.evaluate(() => window.scrollTo(0, 160));
        await page.waitForTimeout(250);
        if (!(await page.locator('#siteNav').evaluate(el => el.classList.contains('is-scrolled')))) {
          failures.push(`${viewportName}/home: sticky/scrolled navigation state did not activate`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      if (viewportName === 'mobile' && !['connect', 'admin', 'not-found'].includes(pageName)) {
        const toggle = page.locator('#menuToggle');
        if (!(await toggle.isVisible())) {
          failures.push(`mobile/${pageName}: menu toggle is not visible`);
        } else {
          await toggle.click();
          if (!(await page.locator('#primaryNav').evaluate(el => el.classList.contains('open')))) {
            failures.push(`mobile/${pageName}: mobile navigation did not open`);
          }
          await page.keyboard.press('Escape');
        }
      }

      if (viewportName === 'mobile' && pageName === 'connect') {
        const connectToggle = page.locator('#overlayNav .connect-menu-toggle');
        if (!(await connectToggle.isVisible())) {
          failures.push('mobile/connect: menu toggle is not visible');
        } else {
          await connectToggle.click();
          if (!(await page.locator('#overlayNav').evaluate(el => el.classList.contains('nav-open')))) {
            failures.push('mobile/connect: responsive navigation did not open');
          }
          if (!(await page.locator('#overlayNav nav').isVisible())) {
            failures.push('mobile/connect: responsive navigation panel is not visible');
          }
          await page.keyboard.press('Escape');
        }
      }

      if (pageName === 'verified-history' || pageName === 'bulletin') {
        const entryCount = await page.locator('time, .article-card, .article-list, .post-card, .story-card').count();
        if (entryCount !== 0) failures.push(`${viewportName}/${pageName}: purpose page is not empty`);
      }

      await revealPage(page);

      const finalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (finalOverflow > 1) failures.push(`${viewportName}/${pageName}: horizontal overflow after interaction ${finalOverflow}px`);

      await page.screenshot({
        path: path.join(outputDir, `${viewportName}-${pageName}.png`),
        fullPage: true,
      });
    } catch (error) {
      failures.push(`${viewportName}/${pageName}: ${error.message}`);
    }

    for (const error of errors) {
      if (!error.includes('favicon.ico')) failures.push(`${viewportName}/${pageName}: ${error}`);
    }
    await page.close();
  }

  await context.close();
}

await browser.close();

if (failures.length) {
  console.error('BROWSER QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('BROWSER QA PASSED');
console.log('Desktop/mobile layout, public navigation, admin shell and current-page styling are consistent.');
