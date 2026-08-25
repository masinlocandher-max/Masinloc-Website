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
  ['leadership', '/leadership.html'],
  ['verified-history', '/verified-history.html'],
  ['bulletin', '/masinloc-bulletin.html'],
  ['connect', '/connect.html'],
  ['admin', '/admin.html'],
  ['not-found', '/404.html'],
];

/* Seven items. Verified History came out of the bar for the same reason Sambal
   Tina was never in it: eight was crowded, and it is a section of A Closer Look
   rather than a peer of it. It stays in every footer and A Closer Look carries
   three links to it, so nothing became harder to reach. */
const expectedNavText = [
  'Home',
  'Discover',
  'Marketplace',
  'A Closer Look',
  'Masinloc Bulletin',
  'Masinloc Connect',
  'Contact',
];

const expectedCurrentHref = {
  home: 'index.html',
  'closer-look': 'a-closer-look.html',
  /* A sub-page of A Closer Look: the parent keeps the current-page state. */
  'sambal-tina': 'a-closer-look.html',
  leadership: 'a-closer-look.html',
  'verified-history': 'a-closer-look.html',
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

/* The Masinloc Connect hero is art-directed, so a fixed decoded size is the
   wrong thing to assert — the whole point is that the size and the crop change
   with the viewport. What must hold is that the right crop is chosen.

   A 16:9 graphic in a portrait viewport, covered, shows about a third of its
   width and loses the mark entirely, which is why the phone is served its own
   4:5 crop. If <picture>'s media queries ever stop matching, the phone quietly
   falls back to the landscape file and the hero becomes an unrecognisable
   fragment — visible to a person, invisible to a test that only checks pixels
   decoded. This checks the file that was actually chosen. */
/* The landing hero is a responsive srcset now, so a fixed decoded size is the
   wrong assertion — it would fail on any viewport that legitimately picks a
   different width. What must hold is that the homepage is serving its own hero
   from the approved family, at the source photograph's own 16:9, visible and
   opaque. */
async function assertLandingHero(page, viewportName) {
  const image = page.locator('.hero-media img');
  if (!(await image.isVisible())) {
    failures.push(`${viewportName}/home hero: image is not visible`);
    return;
  }
  const state = await image.evaluate((img) => ({
    src: img.currentSrc || img.src,
    w: img.naturalWidth,
    h: img.naturalHeight,
    opacity: Number(getComputedStyle(img).opacity),
  }));
  if (!/assets\/hero\/landing-hero-/.test(state.src)) {
    failures.push(`${viewportName}/home hero: serving ${state.src}, not the approved landing hero`);
    return;
  }
  if (!state.w || !state.h) {
    failures.push(`${viewportName}/home hero: image did not decode`);
    return;
  }
  const ratio = state.w / state.h;
  if (Math.abs(ratio - 16 / 9) > 0.02) {
    failures.push(`${viewportName}/home hero: decoded at ${ratio.toFixed(3)}, expected 16:9`);
  }
  if (state.opacity < 0.9) {
    failures.push(`${viewportName}/home hero: image opacity ${state.opacity}`);
  }
}

async function assertConnectHero(page, viewportName) {
  const image = page.locator('.landing-view .hero-img');
  if (!(await image.isVisible())) {
    failures.push(`${viewportName}/connect hero: image is not visible`);
    return;
  }
  const state = await image.evaluate(img => ({
    src: img.currentSrc || img.src,
    w: img.naturalWidth,
    h: img.naturalHeight,
    opacity: Number(getComputedStyle(img).opacity),
  }));

  if (!/assets\/connect\/connect-hero/.test(state.src)) {
    failures.push(`${viewportName}/connect hero: serving ${state.src}, not its own hero`);
    return;
  }
  if (!state.w || !state.h) {
    failures.push(`${viewportName}/connect hero: image did not decode`);
    return;
  }
  if (state.opacity < 0.9) {
    failures.push(`${viewportName}/connect hero: image opacity ${state.opacity}`);
  }

  const portrait = state.src.includes('-portrait-');
  const ratio = state.w / state.h;
  if (viewportName === 'mobile') {
    if (!portrait) {
      failures.push(`${viewportName}/connect hero: served the landscape crop `
        + `(${state.src.split('/').pop()}); a portrait viewport crops the mark away`);
    } else if (Math.abs(ratio - 0.8) > 0.02) {
      failures.push(`${viewportName}/connect hero: phone crop is ${ratio.toFixed(3)}, expected 4:5`);
    }
  } else {
    if (portrait) {
      failures.push(`${viewportName}/connect hero: served the phone crop at desktop width`);
    } else if (Math.abs(ratio - 16 / 9) > 0.02) {
      failures.push(`${viewportName}/connect hero: landscape crop is ${ratio.toFixed(3)}, expected 16:9`);
    }
  }
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

/* theme-color tints the browser's own chrome on a phone, so a page that
   declares navy while painting white gets a dark band above a light page.
   It can only be checked against what the page actually renders, which is why
   this lives here and not in the Python guards: several pages were declaring
   #061A46 above a plain white masthead.

   The tolerance is deliberately wide. The bug worth catching is a light page
   declaring a dark chrome or the reverse, which is a difference of ~200 per
   channel. A page whose masthead is a photograph — the homepage — cannot match
   exactly and should not have to: its top pixel is a different part of the
   image at every width, and the declared navy is an approximation of a photo,
   not a mistake. */
async function assertThemeColour(page, pageName, viewportName) {
  const declared = await page.locator('meta[name="theme-color"]').getAttribute('content');
  if (!declared) {
    failures.push(`${viewportName}/${pageName}: no theme-color declared`);
    return;
  }
  const shot = await page.screenshot({ clip: { x: 8, y: 0, width: 8, height: 8 } });
  const painted = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(2, 2, 1, 1).data;
    return [r, g, b];
  }, `data:image/png;base64,${shot.toString('base64')}`);

  const want = [1, 3, 5].map(i => parseInt(declared.slice(i, i + 2), 16));
  const distance = Math.max(...want.map((v, i) => Math.abs(v - painted[i])));
  if (distance > 90) {
    const hex = painted.map(v => v.toString(16).padStart(2, '0')).join('');
    failures.push(`${viewportName}/${pageName}: declares theme-color ${declared} but `
      + `paints #${hex} at the top of the page`);
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
  /* The editable dictionary layer is a third-party host. These checks are
     about the page, not about whether Supabase is reachable, so it is
     served empty here. scripts/dictionary-entries-qa.mjs covers the layer
     itself, including what happens when it cannot be reached. */
  await context.route('**/rest/v1/dictionary_entries*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

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

      if (pageName !== 'admin') await assertThemeColour(page, pageName, viewportName);

      if (pageName === 'home') {
        await assertLandingHero(page, viewportName);
      }

      if (pageName === 'connect') {
        await assertConnectHero(page, viewportName);
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

      // Verified History stays purpose-only until sourced event history exists.
      // The Bulletin has passed that point and is checked the other way round:
      // it must actually list stories, and each must carry a date and route to
      // the evidence directory.
      if (pageName === 'verified-history') {
        const entryCount = await page.locator('time, .article-card, .article-list, .post-card, .story-card').count();
        if (entryCount !== 0) failures.push(`${viewportName}/${pageName}: purpose page is not empty`);
      }

      if (pageName === 'bulletin') {
        const stories = await page.locator('.story, .lead-card').count();
        if (stories < 2) {
          failures.push(`${viewportName}/${pageName}: the archive lists ${stories} stories`);
        }
        const dated = await page.locator('time[datetime]').count();
        if (dated < 1) failures.push(`${viewportName}/${pageName}: no story carries a date`);
        if (!(await page.locator('a[href="sources.html"]').count())) {
          failures.push(`${viewportName}/${pageName}: does not route to the evidence directory`);
        }
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
