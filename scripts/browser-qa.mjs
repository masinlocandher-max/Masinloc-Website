import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const outputDir = path.resolve('artifacts/browser-qa');
await fs.mkdir(outputDir, { recursive: true });

const pages = [
  ['home', '/index.html'],
  ['closer-look', '/a-closer-look.html'],
  ['verified-history', '/verified-history.html'],
  ['bulletin', '/masinloc-bulletin.html'],
  ['connect', '/connect.html'],
  ['not-found', '/404.html'],
];

const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
];

const browser = await chromium.launch({ headless: true });
const failures = [];

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

      if (pageName !== 'not-found') {
        const h1 = page.locator('h1');
        if (await h1.count() !== 1) failures.push(`${viewportName}/${pageName}: expected exactly one H1`);
        else if (!(await h1.isVisible())) failures.push(`${viewportName}/${pageName}: H1 is not visible`);
      }

      if (pageName === 'home') {
        const heroImage = page.locator('.hero-media img');
        if (!(await heroImage.isVisible())) {
          failures.push(`${viewportName}/home: hero image is not visible`);
        } else {
          const heroState = await heroImage.evaluate(img => ({
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            opacity: Number(getComputedStyle(img).opacity),
          }));
          if (heroState.naturalWidth !== 1536 || heroState.naturalHeight !== 864) {
            failures.push(`${viewportName}/home: hero decoded at ${heroState.naturalWidth}x${heroState.naturalHeight}, expected 1536x864`);
          }
          if (heroState.opacity < 0.9) failures.push(`${viewportName}/home: hero opacity ${heroState.opacity}`);
        }

        await page.evaluate(() => window.scrollTo(0, 160));
        await page.waitForTimeout(250);
        if (!(await page.locator('#siteNav').evaluate(el => el.classList.contains('is-scrolled')))) {
          failures.push(`${viewportName}/home: sticky/scrolled navigation state did not activate`);
        }
      }

      if (viewportName === 'mobile' && pageName !== 'connect' && pageName !== 'not-found') {
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

      if (pageName === 'verified-history' || pageName === 'bulletin') {
        const entryCount = await page.locator('time, .article-card, .article-list, .post-card, .story-card').count();
        if (entryCount !== 0) failures.push(`${viewportName}/${pageName}: purpose page is not empty`);
      }

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
console.log('Desktop and mobile screenshots generated for all current public surfaces.');
