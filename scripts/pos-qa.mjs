/* Browser QA for the POS surfaces.
 *
 * WHAT THIS COVERS
 *
 * The three POS pages, loaded in a real browser at the three breakpoints the
 * design system names, checking the things a screenshot review keeps missing:
 * console errors, horizontal overflow, tap targets under 44px, text under
 * 12.5px, unlabelled controls, and -- the part that matters most for a page
 * that is mostly empty until it has data -- that every empty and error state
 * actually says something useful instead of rendering blank.
 *
 * WHAT IT DOES NOT COVER
 *
 * Live data. These pages read from Supabase and the pos-public Edge Function,
 * so with no deployment reachable they render their unauthenticated and
 * unreachable-store states. That is deliberate: those are the states a real
 * visitor hits when something is wrong, and they are the ones nobody tests.
 * The data lifecycle is proven separately, in SQL, by
 * scripts/pos-local-replay/05-order-lifecycle.sql.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const EXECUTABLE = process.env.QA_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const outputDir = path.resolve('artifacts/pos-qa');
await fs.mkdir(outputDir, { recursive: true });

// The breakpoints DESIGN-SYSTEM.md names: the smallest phone the site supports,
// a tablet on the pass, and a desktop.
const VIEWPORTS = [
  ['phone', 320, 720],
  ['tablet', 768, 1024],
  ['desktop', 1280, 900],
];

const PAGES = [
  ['console', '/posmasinloqueno/', 'Sign in to your store'],
  ['storefront-no-slug', '/posmasinloqueno/store/', 'missing the store name'],
  ['storefront-unknown', '/posmasinloqueno/store/?s=no-such-store-here', 'Store unavailable'],
  ['tracking-no-token', '/posmasinloqueno/order/', 'missing its order code'],
];

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });

for (const [name, route, mustSay] of PAGES) {
  for (const [label, width, height] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      // A phone that has never seen this site: no session, no cached anything.
      storageState: undefined,
    });
    const page = await context.newPage();
    const where = `${name} @ ${label}`;

    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    // Give the module scripts their first paint and their first failed fetch.
    await page.waitForTimeout(1500);

    /* 1. The page says the thing a stuck visitor needs to read. --------- */
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (!body.toLowerCase().includes(mustSay.toLowerCase())) {
      fail(where, `expected the page to say "${mustSay}"; it said "${body.slice(0, 200)}"`);
    }

    /* 2. Nothing renders blank. ---------------------------------------- */
    if (body.trim().length < 40) fail(where, 'page rendered almost no text');

    /* 3. No console errors other than the network calls that cannot ----
          succeed without a deployment. */
    const real = consoleErrors.filter((e) =>
      !/Failed to load resource|net::ERR_|Failed to fetch|supabase\.co/i.test(e));
    if (real.length) fail(where, `console errors: ${real.slice(0, 3).join(' | ')}`);

    /* 4. No horizontal scroll. The body must never scroll sideways. ---- */
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) fail(where, `page scrolls horizontally by ${overflow}px`);

    /* 5. Tap targets. Anything a thumb must hit is at least 44px tall. - */
    const small = await page.evaluate(() => {
      const out = [];
      for (const node of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.height < 44) {
          out.push(`${node.tagName.toLowerCase()}"${(node.textContent || node.name || '').trim().slice(0, 30)}" ${Math.round(box.height)}px`);
        }
      }
      return out;
    });
    if (small.length) fail(where, `tap targets under 44px: ${small.join(', ')}`);

    /* 6. Text size. 12.5px is the floor this site settled on. ---------- */
    const tiny = await page.evaluate(() => {
      const out = new Set();
      for (const node of document.querySelectorAll('body *')) {
        if (!node.textContent?.trim()) continue;
        if (node.children.length) continue;
        const size = parseFloat(getComputedStyle(node).fontSize);
        if (size && size < 12.5) out.add(`${node.tagName.toLowerCase()} ${size}px`);
      }
      return [...out];
    });
    if (tiny.length) fail(where, `text under 12.5px: ${tiny.join(', ')}`);

    /* 7. Every control a screen reader meets has a name. ---------------- */
    const unnamed = await page.evaluate(() => {
      const out = [];
      for (const node of document.querySelectorAll('button, input, select, textarea')) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('aria-labelledby')
          || (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`))
          || node.closest('label')
          || (node.tagName === 'BUTTON' && node.textContent.trim());
        if (!labelled) out.push(`${node.tagName.toLowerCase()}#${node.id || '(no id)'}`);
      }
      return out;
    });
    if (unnamed.length) fail(where, `controls without an accessible name: ${unnamed.join(', ')}`);

    /* 8. One h1, and a title. ------------------------------------------ */
    const h1s = await page.locator('h1:visible').count();
    if (h1s !== 1) fail(where, `expected exactly one visible h1, found ${h1s}`);
    if (!(await page.title()).trim()) fail(where, 'page has no title');

    /* 9. noindex, on every POS page. ----------------------------------- */
    const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
    if (!robots || !/noindex/i.test(robots)) fail(where, `robots meta is "${robots}", expected noindex`);

    await page.screenshot({ path: path.join(outputDir, `${name}-${label}.png`), fullPage: true });
    await context.close();
  }
}

/* 10. The console must not render any store data before a session exists. */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/posmasinloqueno/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  if (await page.locator('#app').isVisible()) fail('console', 'the app shell is visible with no session');
  if (await page.locator('#picker').isVisible()) fail('console', 'the store picker is visible with no session');
  if (!(await page.locator('#gate').isVisible())) fail('console', 'the sign-in gate is not visible with no session');
  await context.close();
}

/* 11. The storefront must never load a Supabase client. An anonymous page
      has nothing to authenticate as, and every public read is supposed to go
      through the Edge Function. */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`${BASE}/posmasinloqueno/store/?s=anything`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const vendor = requests.filter((u) => /assets\/vendor\/supabase/.test(u));
  if (vendor.length) fail('storefront', `loaded the Supabase client: ${vendor.join(', ')}`);
  const rest = requests.filter((u) => /supabase\.co\/(rest|auth)\//.test(u));
  if (rest.length) fail('storefront', `called Supabase directly instead of the Edge Function: ${rest.join(', ')}`);
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error(`\nPOS BROWSER QA FAILED — ${failures.length} problem(s)\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.log(`POS BROWSER QA PASSED — ${PAGES.length} pages × ${VIEWPORTS.length} viewports, plus 2 boundary checks.`);
console.log(`Screenshots in ${path.relative(process.cwd(), outputDir)}/`);
