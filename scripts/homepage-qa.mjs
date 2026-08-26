/* Homepage behaviour checks.
 *
 * The homepage is a motion-led sequence, which is exactly the kind of page
 * where a fault is invisible in the markup and obvious to a visitor. These
 * assertions cover the things that actually broke while building it:
 *
 *   - the carousel track is a <ul>, and the browser's default list padding
 *     silently offset every slide by 40px and made each one narrower than
 *     the window it is measured against;
 *   - reveals driven by an observer threshold above 0 can never fire for a
 *     stage taller than the viewport;
 *   - motion must not be the only thing that makes content readable, so the
 *     page has to be complete with JavaScript off and under reduced motion.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const URL = 'http://localhost:8000/index.html';
const problems = [];
const fail = (message) => problems.push(message);

const browser = await chromium.launch();

/* --- the campaign carousel --------------------------------------------- */

for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const rail = await page.$('[data-rail]');
  if (!rail) { fail(`${label}: the campaign carousel is missing`); await page.close(); continue; }

  await rail.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  /* Every slide fills its window exactly. A slide narrower than the window
     means the neighbouring campaign shows through beside it. */
  const geometry = await page.evaluate(() => {
    const win = document.querySelector('.rail-window').getBoundingClientRect();
    const arts = [...document.querySelectorAll('.slide-art')].map((art) => {
      const box = art.getBoundingClientRect();
      return { width: Math.round(box.width), left: Math.round(box.left) };
    });
    return { window: Math.round(win.width), left: Math.round(win.left), arts };
  });
  if (geometry.arts[0].width !== geometry.window) {
    fail(`${label}: slide is ${geometry.arts[0].width}px inside a ${geometry.window}px `
       + `window, so the next campaign shows beside it`);
  }
  if (geometry.arts[0].left !== geometry.left) {
    fail(`${label}: the first slide starts at ${geometry.arts[0].left}px but the `
       + `window starts at ${geometry.left}px`);
  }

  /* The artwork is a finished design: it is shown whole, never cropped. */
  const fit = await page.$eval('.slide-art', (el) => getComputedStyle(el).objectFit);
  if (fit !== 'contain') {
    fail(`${label}: campaign artwork uses object-fit:${fit}; designed artwork must `
       + `not be cropped`);
  }

  /* Every campaign carries alt text naming what it shows. */
  const alts = await page.$$eval('.slide-art', (els) => els.map((el) => el.alt || ''));
  alts.forEach((alt, i) => {
    if (alt.trim().length < 20) fail(`${label}: campaign ${i + 1} has no useful alt text`);
  });

  /* Advancing moves forward and updates the dots. */
  const dots = await page.$$('.dots button');
  if (dots.length < 1) fail(`${label}: the carousel has no pagination`);
  if (dots.length > 1) {
    await page.click('.dots button:nth-child(2)');
    await page.waitForTimeout(900);
    const selected = await page.$$eval('.dots button',
      (els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
    if (selected !== 1) fail(`${label}: choosing the second dot selected ${selected}`);
    const shifted = await page.$eval('.rail-track',
      (el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    if (shifted >= 0) fail(`${label}: the track did not move when a dot was chosen`);
  }

  /* Touch targets stay reachable even though the dot itself is small. */
  const target = await page.$eval('.dots button', (el) => {
    const box = el.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });
  if (target < 24) fail(`${label}: pagination touch target is only ${target}px`);

  /* Nothing may scroll sideways. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) fail(`${label}: the page scrolls sideways by ${overflow}px`);

  await page.close();
}

/* --- the hero is white type on a photograph ------------------------------ */
/* Which means its legibility depends on a scrim, and a scrim tuned for one
   viewport is not tuned for another: the phone crop is effectively a different
   photograph. At 390px the crop put open sky behind the menu button — white
   bars at 6:1 against nothing — and pale rooftops behind the logo.
   Measured against the photograph as rendered, with the foreground hidden and
   only the actual glyph runs sampled: a wide element box over a bright frame
   reports its worst pixel where no letter is. */
{
  const LARGE_TEXT_PX = 24;   // WCAG: large text may sit at 3:1, smaller needs 4.5:1
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const runs = await page.evaluate(() => {
      const out = [];
      /* Everything that sits over the photograph, measured against the
         photograph. The frame is no longer cropped, so what is behind any
         given glyph is now the same picture at every width rather than
         whichever third a crop happened to expose — but it is still a
         photograph, and a scrim over it is still the only thing making white
         type legible. The navigation is included because it is fixed over the
         frame's top edge. */
      /* `.home-nav a` used to be the selector here, and querySelector returned
         the brand anchor rather than a navigation link — so the links were
         never actually measured and the brand's box was measured as if it were
         16px text. The links are named directly now, and every one is sampled
         rather than only the first.

         The menu button is sampled by its bars rather than by its box. The
         button is a rounded plate, so the corners of its bounding rectangle
         fall outside the plate and show bare photograph — sampling the box
         reports the worst pixel from a corner no part of the control is
         painted on, and no amount of darkening the plate can move it. The bars
         are the ink; what is behind them is what matters. */
      const targets = [];
      for (const selector of ['.hero-mark', '.hero h1', '.hero-note',
        '.cta-secondary', '.home-links a', '#menuToggle span']) {
        for (const node of document.querySelectorAll(selector)) {
          targets.push([selector, node]);
        }
      }
      for (const [selector, el] of targets) {
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        // Faded out is not on the photograph either: the brand mark and the
        // drawer links sit at opacity 0 until the bar scrolls or opens.
        if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const size = parseFloat(style.fontSize);
        let rects;
        if (el.tagName === 'IMG' || !el.textContent.trim()) {
          rects = [el.getBoundingClientRect()];
        } else {
          const range = document.createRange();
          range.selectNodeContents(el);
          rects = [...range.getClientRects()];
        }
        for (const r of rects) {
          if (r.width <= 2 || r.height <= 2) continue;
          /* Only what a visitor can actually see. On a phone the navigation
             links live in a drawer that is closed by default and translated
             fully above the viewport; they still report rects, and clamping
             those to the top of the page samples open sky behind links nobody
             is looking at. An element outside the viewport is not sitting on
             the photograph. */
          if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
          if (r.right <= 0 || r.left >= window.innerWidth) continue;
          out.push({ selector, size, x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return out;
    });

    /* Hide the ink, keep the grounds.
       This used to hide .home-nav outright, which was right when the bar was
       bare and the only scrim lived on .hero-media. The bar now carries its own
       gradient and the menu button its own plate, and both are real painted
       layers between the glyphs and the photograph — hiding them would measure
       a background that is not the one behind the text. So each foreground is
       hidden individually and everything it sits on stays painted. */
    await page.addStyleTag({ content: `
      .hero-inner{visibility:hidden !important}
      .home-nav a{visibility:hidden !important}
      .home-nav .brand img{visibility:hidden !important}
      .nav-toggle span,.nav-toggle::before{visibility:hidden !important}
    ` });
    await page.waitForTimeout(150);

    const worst = new Map();
    for (const run of runs) {
      const clip = {
        x: Math.max(0, run.x), y: Math.max(0, run.y),
        width: Math.max(4, Math.min(run.w, width - Math.max(0, run.x))),
        height: Math.max(4, run.h),
      };
      const shot = await page.screenshot({ clip });
      const ratio = await page.evaluate(async (dataUrl) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const px = context.getImageData(0, 0, image.width, image.height).data;
        const linear = (channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        let brightest = -1;
        for (let i = 0; i < px.length; i += 4) {
          brightest = Math.max(brightest,
            0.2126 * linear(px[i]) + 0.7152 * linear(px[i + 1]) + 0.0722 * linear(px[i + 2]));
        }
        return 1.05 / (brightest + 0.05);   // contrast of white against it
      }, `data:image/png;base64,${shot.toString('base64')}`);

      const seen = worst.get(run.selector);
      if (!seen || ratio < seen.ratio) worst.set(run.selector, { ratio, size: run.size });
    }

    for (const [selector, { ratio, size }] of worst) {
      const floor = size >= LARGE_TEXT_PX ? 3 : 4.5;
      if (ratio < floor) {
        fail(`${label}: ${selector} sits on the photograph at ${ratio.toFixed(2)}:1, `
          + `below the ${floor}:1 its ${Math.round(size)}px needs`);
      }
    }
    await page.close();
  }
}

/* --- the entry cards are translucent tints -------------------------------- */
/* Their type sits on a wash the ground shows through, so the contrast depends
   on what the card is over as much as on the card. The check reads each
   element's real colour and alpha and composites it against the pixels
   actually behind it, rather than assuming anything about either. */
{
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (let y = 0; y < 3200; y += 400) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 70));
      }
    });
    await page.evaluate(() => document.querySelector('.entries').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);

    const runs = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.door').forEach((card) => {
        for (const selector of ['.d-name', '.d-what']) {
          const el = card.querySelector(selector);
          if (!el) continue;
          const style = getComputedStyle(el);
          const parts = style.color.match(/[\d.]+/g).map(Number);
          const rgb = parts.slice(0, 3);
          const alpha = parts.length > 3 ? parts[3] : 1;
          const range = document.createRange();
          range.selectNodeContents(el);
          for (const r of range.getClientRects()) {
            const masthead = document.querySelector('.home-nav, .site-nav');
          const mb = masthead ? masthead.getBoundingClientRect().bottom : 0;
          const underMasthead = masthead
            && getComputedStyle(masthead).position === 'fixed'
            && r.top < mb;
          if (r.width > 2 && r.height > 2 && r.top >= 0 && r.bottom <= window.innerHeight
              && !underMasthead) {
              out.push({ selector, rgb, alpha, size: parseFloat(style.fontSize),
                x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
            }
          }
        }
      });
      return out;
    });

    await page.addStyleTag({ content: '.d-name,.d-what,.d-go,.d-icon{visibility:hidden !important}' });
    await page.waitForTimeout(150);

    const worst = new Map();
    for (const run of runs) {
      const shot = await page.screenshot({ clip: {
        x: Math.max(0, run.x), y: Math.max(0, run.y),
        width: Math.max(4, Math.min(run.w, width - Math.max(0, run.x))),
        height: Math.max(4, run.h) } });
      const ratio = await page.evaluate(async ({ dataUrl, rgb, alpha }) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const px = context.getImageData(0, 0, image.width, image.height).data;
        const linear = (channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        const lum = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        let lowest = 99;
        for (let i = 0; i < px.length; i += 4) {
          const bg = [px[i], px[i + 1], px[i + 2]];
          const fg = bg.map((ch, c) => rgb[c] * alpha + ch * (1 - alpha));
          const a = lum(...fg);
          const b = lum(...bg);
          lowest = Math.min(lowest, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
        }
        return lowest;
      }, { dataUrl: `data:image/png;base64,${shot.toString('base64')}`,
           rgb: run.rgb, alpha: run.alpha });

      const seen = worst.get(run.selector);
      if (!seen || ratio < seen.ratio) worst.set(run.selector, { ratio, size: run.size });
    }

    for (const [selector, { ratio, size }] of worst) {
      const floor = size >= 24 ? 3 : 4.5;
      if (ratio < floor) {
        fail(`${label}: ${selector} on the glass cards reaches only ${ratio.toFixed(2)}:1, `
          + `below the ${floor}:1 its ${Math.round(size)}px needs`);
      }
    }
    await page.close();
  }
}

/* --- reveals and the destination story ---------------------------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(600);

  /* A stage taller than the viewport must still reveal. */
  const hidden = await page.$$eval('.rise', (els) =>
    els.filter((el) => !el.classList.contains('is-in')).length);
  if (hidden > 0) fail(`${hidden} revealed elements never became visible after a full scroll`);

  /* The sticky photograph follows whichever place is being read. */
  const second = await page.$$('.place-row');
  if (second.length < 2) fail('the destination story lists fewer than two places');
  else {
    await second[2].scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.place-row')];
      const shots = [...document.querySelectorAll('.discover-shot')];
      return {
        row: rows.findIndex((el) => el.classList.contains('is-live')),
        shot: shots.findIndex((el) => el.classList.contains('is-live')),
        caption: document.querySelector('.discover-caption')?.textContent.trim() || '',
      };
    });
    if (state.row !== state.shot) {
      fail(`the sticky photograph (${state.shot}) does not match the place being `
         + `read (${state.row})`);
    }
    if (!state.caption) fail('the sticky photograph carries no locality caption');
  }

  /* Each place must carry the factual line from data/locations.json — what it
     is, where it is, why it matters — and not the rhyming couplet. The homepage
     is where someone works out what this town actually holds; the rhyme has its
     own home on destinations.html, printed beside the same caption. */
  const locations = JSON.parse(await fs.readFile('data/locations.json', 'utf8')).locations;
  const lines = await page.$$eval('.place-row .place-what',
    (els) => els.map(el => el.textContent.trim()));
  if (lines.length !== locations.length) {
    fail(`${lines.length} place descriptions for ${locations.length} places`);
  }
  locations.forEach((location, index) => {
    if (lines[index] !== location.caption) {
      fail(`${location.name}: the homepage shows "${lines[index]}" instead of its `
        + 'what/where/why caption');
    }
    if (lines[index] === location.rhyme) {
      fail(`${location.name}: the homepage is leading with the rhyme again`);
    }
  });
  await page.close();
}

/* --- the ending ----------------------------------------------------------- */
/* The page used to end on a list of section names. It now ends on the one
   story worth pressing, and the index below it has to be complete: a section
   that exists but is not reachable from the front page is one nobody finds. */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const bulletin = JSON.parse(await fs.readFile('data/bulletin.json', 'utf8'));
  const entry = bulletin.articles.find(a => a.slug === bulletin.entryStory);

  const lead = await page.$('.close-lead');
  if (!lead) {
    fail('the page does not end on a story worth reading');
  } else {
    const href = await lead.getAttribute('href');
    if (href !== `bulletin/${entry.slug}.html`) {
      fail(`the closing story points at ${href}, not the entry story`);
    }
    const title = (await page.textContent('.cl-title') || '').trim();
    if (title !== entry.title) fail(`the closing story is titled "${title}"`);
  }

  const routes = await page.$$eval('.routes a', els => els.map(a => a.getAttribute('href')));
  for (const section of ['destinations.html', 'leadership.html',
    'verified-history.html', 'masinloc-bulletin.html', 'sources.html']) {
    if (!routes.includes(section)) {
      fail(`the closing index does not reach ${section}`);
    }
  }
  /* The five destinations belong to the doors and the footer. Repeating them
     here made the closing block a third site index and a third "start here". */
  for (const dupe of ['discover/index.html', 'sambal-tina.html', 'marketplace.html',
    'a-closer-look.html', 'connect.html']) {
    if (routes.includes(dupe)) {
      fail(`the closing index repeats the destination ${dupe}`);
    }
  }
  /* Reachable from the page as a whole is the claim that matters. */
  const all = await page.$$eval('a', els => els.map(a => a.getAttribute('href')));
  for (const must of ['discover/index.html', 'sambal-tina.html', 'marketplace.html',
    'a-closer-look.html', 'connect.html']) {
    if (!all.includes(must)) fail(`the homepage does not reach ${must}`);
  }
  await page.close();
}

/* --- the archive stage --------------------------------------------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('.archive').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  /* No archival photography exists in the project, so this stage is built from
     type alone. Every specimen must still carry the apparatus that makes it
     evidence rather than decoration: the page it came from, and how settled
     the reading is. */
  /* The archive specimens are gone from the homepage. They were stamped with
     internal status codes ("INTERNAL DUAL-LAYER SUPPORT — READABLE BETA") of
     exactly the kind check-dictionary.py and check-living-sambal.py already
     forbid on the dictionary page. What the homepage keeps is the claim and
     the route to the record. */
  if (await page.$$eval('.slip', els => els.length)) {
    fail('the homepage is showing archive specimens with internal status codes again');
  }
  if (!(await page.$('.archive-note a[href="verified-history.html"]'))) {
    fail('the record block no longer routes to the verified timeline');
  }


  /* The archive stage used to showcase an unsettled reading — `ab6h`, a word
     whose glyphs could not be read off the printed page — as proof that the
     project publishes its uncertainty rather than tidying it away.

     That specimen is now withheld along with the other ninety-six, because a
     dictionary is quoted and a damaged reading left in public long enough gets
     cited back as the real spelling. Showing one on the front page was the
     loudest version of that problem. So the assertion is inverted: the stage
     must NOT put an unconfirmed reading in front of a visitor. The honesty it
     was demonstrating is still on the page — every specimen cites the archive
     page it came from, which is checked above. */
  const unsettled = await page.$$eval('.slip-check', (els) => els.length);
  if (unsettled > 0) {
    fail(`the archive stage shows ${unsettled} unconfirmed reading(s); those are `
      + 'withheld until somebody confirms them against the printed page');
  }

  /* No invented archival imagery, ever. */
  const imgs = await page.$$eval('.archive img', (els) => els.map((el) => el.src));
  if (imgs.length) fail(`the archive stage carries ${imgs.length} image(s); it is built from type only`);
  await page.close();
}

/* --- the page without JavaScript ---------------------------------------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  /* Copy that establishes the page must exist in the HTML, not appear later. */
  const text = (await page.textContent('main')) || '';
  for (const needed of ['The world finds us here', 'Discover Masinloc', 'Sambal Tina',
    'Hamat River', 'About Masinloc']) {
    if (!text.includes(needed)) fail(`with JavaScript off, "${needed}" is missing from the page`);
  }
  const slides = await page.$$eval('.slide-art', (els) => els.length);
  if (slides < 1) fail('with JavaScript off, no campaign artwork is in the markup');

  const headings = await page.$$eval('h1', (els) => els.length);
  if (headings !== 1) fail(`expected exactly one H1, found ${headings}`);
  await page.close();
}

/* --- reduced motion ------------------------------------------------------ */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  /* The story survives without the travel: nothing stays stuck invisible. */
  const faded = await page.$$eval('.rise, .entry', (els) =>
    els.filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.05).length);
  if (faded > 0) fail(`${faded} elements are invisible under reduced motion`);
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('HOMEPAGE QA FAILED');
  problems.forEach((problem) => console.log(`- ${problem}`));
  process.exit(1);
}

console.log('HOMEPAGE QA PASSED');
console.log('Campaign slides fill their window uncropped, pagination and the');
console.log('destination story track together, and the page is complete with');
console.log('JavaScript off and under reduced motion.');
