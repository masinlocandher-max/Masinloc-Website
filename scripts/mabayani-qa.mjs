/* QA for the MABAYANI sequence, which lives on Discover.

   This suite exists for the two promises that are easy to break by accident:

   1. The sequence is ordered and complete. It sits above the verified record
      and the open questions, its ten parts run in the order the data declares,
      and the reveal is last — a filterable grid would destroy the argument.
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

  await page.goto(`${baseURL}/discover/index.html`, { waitUntil: 'networkidle' });

  const flagship = page.locator('.d-seq');
  if (!(await flagship.isVisible())) fail(`${label}: the MABAYANI block is not visible`);

  // The sequence sits above the record and the open questions, in that order:
  // the stories first, then what they settled, then what they did not.
  const order = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    };
    const mark = top('.d-seq');
    const record = top('.d-theme[aria-labelledby="record-title"]');
    const questions = top('.d-open');
    if (mark === null || record === null || questions === null) return null;
    return { mark, record, questions };
  });
  if (!order) fail(`${label}: Discover is missing the sequence, the record or the open questions`);
  else {
    if (order.mark >= order.record) fail(`${label}: MABAYANI sits below the verified record`);
    if (order.record >= order.questions) fail(`${label}: open questions are not last`);
  }

  // The entry story is the one door in, and it is the data's entry story.
  const entryHref = await page.locator('.d-seq-entry a').getAttribute('href');
  if (entryHref !== `../bulletin/${data.entryStory}.html`) {
    fail(`${label}: the start-here card points at ${entryHref}, not the entry story`);
  }

  // The whole sequence, in order, with the reveal last.
  const rail = await page.locator('.d-seq-list [data-slug]').evaluateAll(
    steps => steps.map(s => ({
      slug: s.dataset.slug,
      n: s.querySelector('.d-seq-n').textContent.trim(),
      title: s.querySelector('.d-seq-title').textContent.trim(),
    })));
  if (rail.length !== sequence.length) {
    fail(`${label}: the pathway lists ${rail.length} stories, expected ${sequence.length}`);
  }
  sequence.forEach((article, index) => {
    const step = rail[index];
    if (!step) return;
    if (step.slug !== article.slug) {
      fail(`${label}: pathway position ${index + 1} is ${step.slug}, expected ${article.slug}`);
    }
    if (step.n !== String(index + 1)) {
      fail(`${label}: pathway position ${index + 1} is numbered "${step.n}"`);
    }
  });

  // Every story reachable from this page in one click.
  const hrefs = new Set(await page.locator('a[href^="../bulletin/"]').evaluateAll(
    links => links.map(a => a.getAttribute('href'))));
  for (const article of articles) {
    if (!hrefs.has(`../bulletin/${article.slug}.html`)) {
      fail(`${label}: ${article.slug} is not linked from Discover`);
    }
  }

  // Anonymity, as rendered.
  const visible = (await page.locator('body').innerText()).toLowerCase();
  for (const needle of [creator.toLowerCase(), surname.toLowerCase()]) {
    if (visible.includes(needle)) fail(`${label}: Discover names the creator ("${needle}")`);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow ${overflow}px`);

  // Progress is a private note. It stays silent until something has been read.
  const progressBefore = await page.locator('#mabProgress').isVisible();
  if (progressBefore) fail(`${label}: progress is shown to a reader who has read nothing`);

  await page.goto(`${baseURL}/bulletin/${data.entryStory}.html`, { waitUntil: 'networkidle' });
  await page.goto(`${baseURL}/discover/index.html`, { waitUntil: 'networkidle' });
  const progressText = (await page.locator('#mabProgress').textContent() || '').trim();
  if (progressText !== `1 of ${sequence.length} stories explored`) {
    fail(`${label}: after reading one story the progress note reads "${progressText}"`);
  }
  if (!(await page.locator(`.d-seq-item[data-slug="${data.entryStory}"]`)
    .evaluate(el => el.classList.contains('is-read')))) {
    fail(`${label}: the story just read is not marked in the pathway`);
  }

  for (const error of errors) {
    if (!error.includes('favicon.ico')) fail(`${label}: ${error}`);
  }
  await context.close();
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
    fail(`${article.slug}: the last story does not return the reader to Discover`);
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
await page.goto(`${baseURL}/discover/index.html`, { waitUntil: 'domcontentloaded' });

if (await page.locator('.d-seq-list [data-slug]').count() !== sequence.length) {
  fail('no-js: the pathway is incomplete without JavaScript');
}
if (await page.locator('.d-open-list .d-open-item').count() === 0) {
  fail('no-js: the open questions are missing without JavaScript');
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
console.log(`The sequence sits above the verified record and the open questions at both `
  + `widths; all ${sequence.length} stories are reachable from Discover in one click `
  + 'and ordered as the data declares.');
console.log(`The creator is named only in ${reveal.slug}; every other story is attributed to `
  + `${data.publication.name}.`);
console.log('Progress stays silent until something is read. No players, no autoplay. '
  + 'The full sequence survives with JavaScript off.');
