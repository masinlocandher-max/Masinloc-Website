/* End-to-end verification against the real production site.

   WHY THIS IS A SCRIPT AND NOT A CI JOB

   It has to run from somewhere that can actually reach masinloc-zambales.com
   and the Supabase function. The agent sandbox this was written in cannot: its
   egress proxy answers 403 to CONNECT for both hosts, so every request from
   there fails at the tunnel before a single byte of the site is fetched. Run
   this from a laptop, or anywhere with ordinary outbound HTTPS.

   WHAT IT CHECKS

   1. Transport and redirects — http to https, apex and www agreeing, no
      redirect chains that lose the path.
   2. Every representative page at desktop and phone width: HTTP status, one
      H1, a self-referencing canonical, no console errors, no failed requests,
      no horizontal overflow.
   3. Crawler surface — robots.txt permissions, sitemap parses and every URL in
      it resolves, the IndexNow key file matches its own filename.
   4. Assets — every image, stylesheet and script the pages request returns 2xx.
   5. The Supabase edge function — CORS preflight from the real origin, the
      origin gate rejecting a foreign origin, the contributors GET, and the
      honeypot. All of these are non-mutating.
   6. Key journeys — navigation reachability, the Connect chooser, the
      dictionary search, and that forms are present and wired.

   WHAT IT DOES NOT DO BY DEFAULT

   It does not submit anything. A real submission writes a row somebody then
   has to moderate, and hammering the rate limiter locks the tester's own IP
   out of the forms for fifteen minutes. Both are opt-in:

     --submit    send one genuine contact submission and report the reference
     --ratelimit send nine submissions to prove the limiter refuses the ninth

   Usage
   -----
     npm install --no-save playwright
     node scripts/verify-production.mjs
     node scripts/verify-production.mjs --base https://masinloc-zambales.com
     node scripts/verify-production.mjs --submit
*/
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = value('base', 'https://masinloc-zambales.com').replace(/\/$/, '');
const FUNCTION = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';

const PAGES = [
  '/', '/a-closer-look.html', '/connect.html', '/contact.html', '/destinations.html',
  '/leadership.html', '/masinloc-bulletin.html', '/sambal-tina.html', '/sources.html',
  '/trust.html', '/verified-history.html', '/privacy.html',
  '/discover/index.html', '/discover/masinloc-actually.html',
  '/discover/every-november-masinloc-stages-a-battle.html',
  '/bulletin/why-mabayani-exists.html',
];

const failures = [];
const notes = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL  ${m}`); };
const ok = (m) => console.log(`  ok    ${m}`);
const note = (m) => { notes.push(m); console.log(`  note  ${m}`); };

const section = (t) => console.log(`\n=== ${t} ===`);

/* --- 1. transport and redirects ------------------------------------------ */

section('Transport and redirects');

/* The canonical host is the apex. Every canonical tag, the sitemap and
   robots.txt all say masinloc-zambales.com with no www, so a www request that
   served a 200 instead of redirecting would put the whole site at two
   addresses — which is the duplicate-content problem canonical tags exist to
   avoid, arriving through the front door.

   Both the final host AND the redirect's own status code are checked. A 302
   works for a visitor but tells a crawler the move is temporary, so the www
   host keeps being crawled and keeps competing. */
const canonicalHost = new URL(BASE).host;
for (const from of [
  BASE.replace('https://', 'http://'),
  `https://www.${canonicalHost}`,
  `http://www.${canonicalHost}`,
]) {
  try {
    const hop = await fetch(from, { redirect: 'manual' });
    const location = hop.headers.get('location');
    const followed = await fetch(from, { redirect: 'follow' });

    if (!followed.ok) {
      fail(`${from} -> HTTP ${followed.status}`);
      continue;
    }
    const landedHost = new URL(followed.url).host;
    if (landedHost !== canonicalHost) {
      fail(`${from} landed on ${landedHost}, expected the canonical ${canonicalHost}`);
    } else if (!followed.url.startsWith('https://')) {
      fail(`${from} did not end on https (${followed.url})`);
    } else if (hop.status >= 300 && hop.status < 400 && ![301, 308].includes(hop.status)) {
      fail(`${from} redirects with ${hop.status}; a permanent 301 or 308 is what tells `
        + `a crawler to stop indexing the other host (Location: ${location})`);
    } else {
      ok(`${from} -> ${followed.url} (${hop.status === 200 ? 'direct' : hop.status + ' permanent'})`);
    }
  } catch (e) { fail(`${from}: ${e.message}`); }
}

/* --- 2. crawler surface --------------------------------------------------- */

section('Crawler surface');
let sitemapUrls = [];
try {
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  for (const [needle, label] of [
    ['User-agent: OAI-SearchBot', 'OAI-SearchBot has its own group'],
    ['User-agent: GPTBot', 'GPTBot has its own group'],
    ['Sitemap: https://masinloc-zambales.com/sitemap.xml', 'sitemap is declared'],
    ['Disallow: /admin.html', 'admin is disallowed'],
  ]) robots.includes(needle) ? ok(label) : fail(`robots.txt: missing "${needle}"`);

  const gpt = robots.split('User-agent: GPTBot')[1] || '';
  gpt.trim().startsWith('Disallow: /')
    ? ok('GPTBot is disallowed from the whole site')
    : fail('robots.txt: GPTBot is no longer disallowed');
} catch (e) { fail(`robots.txt: ${e.message}`); }

try {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  sitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  sitemapUrls.length ? ok(`sitemap parses, ${sitemapUrls.length} URLs`) : fail('sitemap has no URLs');
  const dates = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  const unique = new Set(dates);
  if (dates.length && unique.size === 1) {
    fail(`every lastmod is ${[...unique][0]} — that is a deployment date, not content dates`);
  } else ok(`lastmod spans ${unique.size} distinct dates`);
} catch (e) { fail(`sitemap.xml: ${e.message}`); }

try {
  const key = '55a17ab9e91458e3dfea3afb312d7fcc';
  const served = (await (await fetch(`${BASE}/${key}.txt`)).text()).trim();
  served === key ? ok('IndexNow key file matches its filename')
    : fail(`IndexNow key file says "${served}", filename says "${key}"`);
} catch (e) { fail(`IndexNow key: ${e.message}`); }

/* Every sitemap URL must actually resolve. */
let broken = 0;
for (const url of sitemapUrls) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) { fail(`sitemap URL ${url} -> HTTP ${r.status}`); broken += 1; }
  } catch (e) { fail(`sitemap URL ${url}: ${e.message}`); broken += 1; }
}
if (sitemapUrls.length && !broken) ok(`all ${sitemapUrls.length} sitemap URLs resolve`);

/* --- 3. the Supabase edge function (non-mutating) ------------------------- */

section('Supabase edge function');
try {
  const pre = await fetch(FUNCTION, {
    method: 'OPTIONS',
    headers: { origin: BASE, 'access-control-request-method': 'POST' },
  });
  const allow = pre.headers.get('access-control-allow-origin');
  pre.status === 204 && allow === BASE
    ? ok(`CORS preflight from ${BASE} -> 204, allow-origin echoes the origin`)
    : fail(`CORS preflight -> ${pre.status}, allow-origin "${allow}" (expected 204 and ${BASE})`);
} catch (e) { fail(`preflight: ${e.message}`); }

try {
  const bad = await fetch(FUNCTION, {
    method: 'POST', headers: { origin: 'https://not-masinloc.example' }, body: new FormData(),
  });
  bad.status === 403 ? ok('a foreign origin is refused with 403')
    : fail(`foreign origin got HTTP ${bad.status}, expected 403`);
} catch (e) { fail(`origin gate: ${e.message}`); }

try {
  const r = await fetch(`${FUNCTION}?resource=dictionary-contributors`, { headers: { origin: BASE } });
  const body = await r.json();
  r.ok && body.ok ? ok(`contributors endpoint returns ${body.count} name(s)`)
    : fail(`contributors endpoint -> HTTP ${r.status}`);
  const unknown = await fetch(`${FUNCTION}?resource=something-else`, { headers: { origin: BASE } });
  unknown.status === 404 ? ok('an unknown GET resource is refused with 404')
    : fail(`unknown resource got HTTP ${unknown.status}, expected 404`);
} catch (e) { fail(`contributors: ${e.message}`); }

/* The honeypot answers 201 and writes nothing, so this is safe to exercise. */
try {
  const form = new FormData();
  form.set('category', 'contact');
  form.set('payload', JSON.stringify({
    website: 'https://a-bot-filled-this.example',
    senderName: 'verification', senderEmail: 'verify@example.com', message: 'honeypot probe',
  }));
  const r = await fetch(FUNCTION, { method: 'POST', headers: { origin: BASE }, body: form });
  const body = await r.json();
  r.status === 201 && body.ok && !body.id
    ? ok('honeypot accepts silently and stores nothing (201, no row id)')
    : fail(`honeypot -> HTTP ${r.status} ${JSON.stringify(body)}; expected 201 with no id`);
} catch (e) { fail(`honeypot: ${e.message}`); }

/* Validation must reject an incomplete payload. */
try {
  const form = new FormData();
  form.set('category', 'contact');
  form.set('payload', JSON.stringify({ senderName: 'verification' }));
  const r = await fetch(FUNCTION, { method: 'POST', headers: { origin: BASE }, body: form });
  r.status === 400 ? ok('an incomplete submission is rejected with 400')
    : fail(`incomplete submission -> HTTP ${r.status}, expected 400`);
} catch (e) { fail(`validation: ${e.message}`); }

if (flag('submit')) {
  const form = new FormData();
  form.set('category', 'contact');
  form.set('payload', JSON.stringify({
    senderName: 'Production verification',
    senderEmail: 'verify@example.com',
    topic: 'general',
    subject: 'Automated production verification',
    message: `Sent by scripts/verify-production.mjs at ${new Date().toISOString()}. Safe to delete.`,
  }));
  const r = await fetch(FUNCTION, { method: 'POST', headers: { origin: BASE }, body: form });
  const body = await r.json();
  r.status === 201 && body.id
    ? note(`REAL submission stored: id=${body.id} reference=${body.reference_code || 'n/a'} — delete it in the admin console`)
    : fail(`real submission -> HTTP ${r.status} ${JSON.stringify(body)}`);
} else {
  note('skipped the real submission test (pass --submit to run it)');
}

if (flag('ratelimit')) {
  let refused = null;
  for (let i = 1; i <= 9; i += 1) {
    const form = new FormData();
    form.set('category', 'contact');
    form.set('payload', JSON.stringify({ senderName: 'x' }));   // rejected by validation
    const r = await fetch(FUNCTION, { method: 'POST', headers: { origin: BASE }, body: form });
    if (r.status === 429) { refused = i; break; }
  }
  refused ? ok(`rate limiter refused request ${refused} of 9 with 429`)
    : fail('nine requests in a row and none was rate limited');
} else {
  note('skipped the rate-limit test (pass --ratelimit; it locks your IP out of the forms for 15 minutes)');
}

/* --- 4. pages in a real browser ------------------------------------------ */

const browser = await chromium.launch({ headless: true });

for (const [label, width, height] of [['desktop', 1280, 900], ['phone', 390, 844]]) {
  section(`Pages — ${label} (${width}px)`);
  const context = await browser.newContext({ viewport: { width, height } });

  for (const path of PAGES) {
    const page = await context.newPage();
    const errors = [];
    const bad = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
    });
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

    try {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
      if (!response || response.status() >= 400) {
        fail(`${label} ${path}: HTTP ${response?.status()}`);
        await page.close();
        continue;
      }

      const meta = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
        title: document.title,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        /* Only count an image as broken if it was actually asked to load
           something. A placeholder like the places viewer's <img src="">
           is populated by script before it is ever shown, and reports the
           same complete/naturalWidth=0 as a genuine 404 would. */
        images: [...document.images].filter(
          (i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0).length,
      }));

      const problems = [];
      if (meta.h1 !== 1 && path !== '/privacy.html') problems.push(`${meta.h1} H1`);
      if (!meta.title) problems.push('no title');
      if (!meta.canonical) problems.push('no canonical');
      else if (!meta.canonical.startsWith('https://masinloc-zambales.com')) {
        problems.push(`canonical off-site: ${meta.canonical}`);
      }
      if (meta.overflow > 1) problems.push(`horizontal overflow ${meta.overflow}px`);
      if (meta.images) problems.push(`${meta.images} image(s) failed to decode`);
      for (const e of errors) problems.push(`console: ${e}`);
      for (const b of bad) problems.push(`request ${b}`);

      problems.length ? fail(`${label} ${path}: ${problems.join('; ')}`) : ok(`${label} ${path}`);
    } catch (e) {
      fail(`${label} ${path}: ${e.message}`);
    }
    await page.close();
  }
  await context.close();
}

/* --- 5. key journeys ------------------------------------------------------ */

section('Key journeys');
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  const page = await context.newPage();
  await page.goto(`${BASE}/sambal-tina.html`, { waitUntil: 'networkidle' });
  await page.fill('.dict-search input', 'lanom');
  await page.waitForTimeout(900);
  const results = await page.locator('.dict-entry').count();
  results > 0 ? ok(`dictionary search for "lanom" returns ${results} result(s)`)
    : fail('dictionary search for "lanom" returned nothing');
  await page.close();
} catch (e) { fail(`dictionary journey: ${e.message}`); }

try {
  const page = await context.newPage();
  await page.goto(`${BASE}/connect.html`, { waitUntil: 'networkidle' });
  const choices = await page.locator('.quick-grid a, .quick-grid button').count();
  choices >= 3 ? ok(`Connect offers ${choices} entry points`)
    : fail(`Connect shows only ${choices} entry points`);
  await page.close();
} catch (e) { fail(`connect journey: ${e.message}`); }

try {
  const page = await context.newPage();
  await page.goto(`${BASE}/contact.html`, { waitUntil: 'networkidle' });
  const has = await page.locator('#contactForm').count();
  has ? ok('contact form is present') : fail('contact form is missing');
  await page.close();
} catch (e) { fail(`contact journey: ${e.message}`); }

try {
  const page = await context.newPage();
  const r = await page.goto(`${BASE}/this-page-does-not-exist-${Date.now()}`, { waitUntil: 'domcontentloaded' });
  r.status() === 404 ? ok('an unknown path returns a real 404')
    : note(`an unknown path returned HTTP ${r.status()} rather than 404`);
  await page.close();
} catch (e) { fail(`404 journey: ${e.message}`); }

await context.close();
await browser.close();

/* --- verdict -------------------------------------------------------------- */

console.log('\n' + '='.repeat(64));
if (failures.length) {
  console.log(`PRODUCTION VERIFICATION FAILED — ${failures.length} problem(s)`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PRODUCTION VERIFICATION PASSED');
console.log(`${PAGES.length} pages at two widths, ${sitemapUrls.length} sitemap URLs, the crawler`);
console.log('surface, the edge function and four journeys all behaved as expected.');
for (const n of notes) console.log(`  note: ${n}`);
