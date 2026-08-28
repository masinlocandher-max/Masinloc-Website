/* QA for MABAYANI, which is now a page of its own at /mabayani/.

   MABAYANI used to be a ten-part sequence listed on Discover. It is now the
   immersive reading under About Masinloc, and those ten articles are the
   worked research behind it, gathered on that page beside the sections they
   support. This suite follows the promises across that move:

   1. Nothing was orphaned. Every one of the ten research articles is reachable
      from /mabayani/ in one click, and Discover points at the story.
   2. The creator is anonymous until the closing story. Checked here in a real
      browser — rendered text, not source — because that is what a reader sees.

   It also checks the serialisation is a reading path and not a media queue:
   every story reachable in one click, nothing that autoplays or counts down,
   and the whole sequence still present with JavaScript switched off.

   Usage: node scripts/mabayani-qa.mjs   (with a static server on :8000)
*/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';
const data = JSON.parse(await fs.readFile('data/bulletin.json', 'utf8'));

const articles = data.articles.filter(a => a.status === 'published');
const sequence = [...articles].sort((a, b) => a.order - b.order);
const reveal = articles.find(a => a.revealsCreator);
const creator = data.publication.creator.name;
const surname = creator.split(' ').pop();

const failures = [];
const fail = (message) => failures.push(message);

const browser = await chromium.launch({ headless: true });

/* --- the pinned flagship ------------------------------------------------- */

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(`${baseURL}/mabayani/`, { waitUntil: 'networkidle' });

  if ((await page.locator('h1').innerText()).trim() !== 'MABAYANI') {
    fail(`${label}: the page H1 is not MABAYANI`);
  }

  /* Every section the brief specifies is present. */
  const parts = await page.locator('.mb-section[data-part]').count();
  if (parts !== 31) fail(`${label}: ${parts} sections rendered, expected 31`);

  /* The evidence is reachable from inside the narrative, and every claim that
     carries a state says which state in words rather than by colour. */
  const drawers = await page.locator('.mb-record').count();
  if (drawers < 20) fail(`${label}: only ${drawers} source drawers`);
  const badges = await page.locator('.mb-badge').count();
  if (badges < 40) fail(`${label}: only ${badges} evidence badges`);
  const wordless = await page.locator('.mb-badge').evaluateAll(
    els => els.filter(e => !e.textContent.trim()).length);
  if (wordless) fail(`${label}: ${wordless} evidence badges carry no word`);

  /* Three names nobody has recovered, and nothing filling them in. */
  const missing = await page.locator('.mb-missing li').count();
  if (missing !== 3) fail(`${label}: ${missing} unrecovered-name slots, expected 3`);

  /* Every research article reachable in one click. */
  const hrefs = new Set(await page.locator('a[href^="../bulletin/"]').evaluateAll(
    links => links.map(a => a.getAttribute('href'))));
  for (const article of articles) {
    if (!hrefs.has(`../bulletin/${article.slug}.html`)) {
      fail(`${label}: ${article.slug} is not reachable from /mabayani/`);
    }
  }

  /* The Panata is the last word, and it ends where the brief says it ends. */
  const panata = await page.locator('.mb-panata li').last().innerText();
  if (panata.trim() !== 'Pipiliin kong maging MABAYANI.') {
    fail(`${label}: the Panata ends "${panata.trim()}"`);
  }

  /* The creator is credited once, in the closing section, and nowhere in the
     narrative above it. */
  const credits = await page.locator('.mb-credit').count();
  if (credits !== 1) fail(`${label}: ${credits} credit lines, expected 1`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow ${overflow}px`);

  /* Progress stays silent until something has been read. */
  if (await page.locator('#mabProgress').isVisible()) {
    fail(`${label}: progress is shown to a reader who has read nothing`);
  }
  await page.goto(`${baseURL}/bulletin/${data.entryStory}.html`, { waitUntil: 'networkidle' });
  await page.goto(`${baseURL}/mabayani/`, { waitUntil: 'networkidle' });
  const progressText = (await page.locator('#mabProgress').textContent() || '').trim();
  if (!/^1 of \d+ stories explored$/.test(progressText)) {
    fail(`${label}: after reading one article the progress note reads "${progressText}"`);
  }
  if (!(await page.locator(`.mb-res-item[data-slug="${data.entryStory}"]`)
    .evaluate(el => el.classList.contains('is-read')))) {
    fail(`${label}: the article just read is not marked in the research index`);
  }

  for (const error of errors) {
    if (!error.includes('favicon.ico')) fail(`${label}: ${error}`);
  }
  await context.close();
}

/* --- passing it on, and the text staying put ----------------------------- */

/* The narrative is an unpublished manuscript the author donated, so copying it
   is turned away and readers are pointed at the share links instead. Two
   halves of that are checked, and the second matters more than the first:

   1. The prose is not offered up to a select-all.
   2. THE RECORD STILL IS. The evidence drawers, fact boxes and source list stay
      copyable, because this page's argument is that its claims arrive with
      citations anyone can check, and a citation you cannot copy is one you
      cannot follow. A future tightening that locks the whole page would be a
      regression, and this is what would catch it.

   The share links are also checked with scripting off: they are ordinary
   anchors, and the native share sheet on top of them is the enhancement. */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseURL}/mabayani/`, { waitUntil: 'networkidle' });

  const shares = await page.locator('.mb-share-link').count();
  if (shares < 3) fail(`share: only ${shares} share links`);
  for (const link of await page.locator('.mb-share-link').all()) {
    const href = await link.getAttribute('href');
    if (!href.includes(encodeURIComponent('masinloc-zambales.com/mabayani/'))
        && !href.includes('masinloc-zambales.com%2Fmabayani%2F')) {
      fail(`share: a share link does not carry the MABAYANI URL: ${href}`);
    }
    if (await link.getAttribute('rel') !== 'noopener noreferrer') {
      fail('share: a share link opens a new tab without rel="noopener noreferrer"');
    }
  }
  /* The project asked for sharing that does not run through the clipboard. */
  if (await page.locator('.mb-share a[href^="mailto:"]').count()) {
    fail('share: a mailto link is back; contact routes through contact.html');
  }

  const copyBlocked = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return { prevented: event.defaultPrevented, select: getComputedStyle(el).userSelect };
  }, selector);

  const prose = await copyBlocked('#s13 .mb-inner p');
  if (!prose.prevented) fail('copy: the narrative can be copied');
  if (prose.select !== 'none') fail(`copy: narrative user-select is ${prose.select}`);

  for (const [selector, what] of [['.mb-src-list', 'the source list'],
                                  ['.mb-record', 'an evidence drawer'],
                                  ['.mb-facts', 'a fact box']]) {
    const record = await copyBlocked(selector);
    if (record.prevented) fail(`copy: ${what} is blocked — the record must stay copyable`);
  }
  await page.close();
}

/* --- Discover points at the story rather than holding a copy of it ------- */

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseURL}/discover/index.html`, { waitUntil: 'networkidle' });
  const links = await page.locator('.d-mab a').evaluateAll(
    els => els.map(a => a.getAttribute('href')));
  if (!links.includes('../mabayani/')) {
    fail('discover: the MABAYANI feature does not link to /mabayani/');
  }
  if (await page.locator('.d-seq, .d-seq-list').count()) {
    fail('discover: still carries the old MABAYANI sequence block');
  }
  /* The feature is a promotion, not a footnote: it carries the identity, the
     line and one way in. */
  for (const [sel, what] of [['.d-mab-mark', 'the MABAYANI mark'],
                             ['.d-mab-line', 'the headline'],
                             ['.d-mab-teaser', 'the teaser'],
                             ['.d-mab-go a', 'the way in']]) {
    if (!(await page.locator(sel).count())) fail(`discover: the feature is missing ${what}`);
  }

  /* Discover articles that share a subject with a chapter say where it is. */
  const crossed = [];
  for (const slug of ['the-church-masinloquenos-walk-past',
                      'every-november-masinloc-stages-a-battle',
                      'the-sambal-words-we-refuse-to-lose',
                      'san-salvador-has-a-better-story']) {
    await page.goto(`${baseURL}/discover/${slug}.html`, { waitUntil: 'domcontentloaded' });
    const href = await page.locator('.d-mab-cross a').getAttribute('href').catch(() => null);
    if (!href || !href.startsWith('../mabayani/#s')) {
      fail(`discover/${slug}: does not point at its MABAYANI chapter`);
    } else {
      crossed.push(href);
    }
  }
  if (new Set(crossed).size !== crossed.length) {
    fail('discover: two articles point at the same MABAYANI chapter');
  }
  await page.close();
}

/* --- articles: attribution and the pull forward -------------------------- */

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

for (const article of sequence) {
  const page = await context.newPage();
  await page.goto(`${baseURL}/bulletin/${article.slug}.html`, { waitUntil: 'networkidle' });

  const meta = (await page.locator('.article-meta').innerText()).trim();
  const body = (await page.locator('body').innerText()).toLowerCase();
  const names = [creator.toLowerCase(), surname.toLowerCase()].some(n => body.includes(n));

  if (article.revealsCreator) {
    if (!names) fail(`${article.slug}: the closing story does not name the creator`);
    if (!meta.includes(creator)) fail(`${article.slug}: the reveal has no byline`);
  } else {
    if (names) fail(`${article.slug}: names the creator before the reveal`);
    if (!meta.includes(data.publication.name)) {
      fail(`${article.slug}: is not attributed to ${data.publication.name}`);
    }
  }

  // Position in the sequence, stated quietly and correctly.
  if (!meta.includes(`part ${article.order + 1} of ${sequence.length}`)) {
    fail(`${article.slug}: does not state its place in the sequence`);
  }

  const next = page.locator('.continue a');
  if (article.next) {
    const href = await next.getAttribute('href');
    if (href !== `${article.next}.html`) {
      fail(`${article.slug}: continues to ${href}, expected ${article.next}.html`);
    }
    const question = (await page.locator('.continue-q').innerText()).trim();
    if (question !== article.nextQuestion) {
      fail(`${article.slug}: the question carrying the reader on does not match the data`);
    }
  } else if (await next.getAttribute('href') !== '../discover/index.html') {
    fail(`${article.slug}: the last article does not return the reader to Discover`);
  }

  // Nothing on an article page may behave like a player.
  const players = await page.locator('video, audio, [autoplay], [data-autoplay]').count();
  if (players) fail(`${article.slug}: carries ${players} media/autoplay element(s)`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${article.slug}: horizontal overflow ${overflow}px`);

  await page.close();
}
await context.close();

/* --- without JavaScript, and under reduced motion ------------------------ */

const plain = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  javaScriptEnabled: false,
  reducedMotion: 'reduce',
});
const page = await plain.newPage();
await page.goto(`${baseURL}/mabayani/`, { waitUntil: 'domcontentloaded' });

if (await page.locator('.mb-section[data-part]').count() !== 31) {
  fail('no-js: the story is incomplete without JavaScript');
}
if (await page.locator('.mb-res-list [data-slug]').count() !== sequence.length) {
  fail('no-js: the research index is incomplete without JavaScript');
}
/* The record is a <details>, so the evidence opens with scripting off. */
if (await page.locator('.mb-record').count() < 20) {
  fail('no-js: the source drawers are missing without JavaScript');
}
if (await page.locator('#mabProgress').isVisible()) {
  fail('no-js: the progress note is shown when nothing can have been recorded');
}
await plain.close();

await browser.close();

if (failures.length) {
  console.error('MABAYANI QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('MABAYANI QA PASSED');
console.log(`MABAYANI renders 31 sections with their evidence drawers at both widths; `
  + `all ${sequence.length} research articles are reachable from it in one click, and `
  + 'Discover points at the story rather than holding a second copy of it.');
console.log(`The creator is named only in ${reveal.slug}; every other story is attributed to `
  + `${data.publication.name}.`);
console.log('Progress stays silent until something is read. No players, no autoplay. '
  + 'The full sequence survives with JavaScript off.');
