/* QA for the MABAYANI flagship on the Masinloc Bulletin.

   This suite exists for the two promises that are easy to break by accident:

   1. The flagship is pinned. It sits above the archive permanently, whatever
      was published most recently, and it is the first thing on the page after
      the masthead.
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

  await page.goto(`${baseURL}/masinloc-bulletin.html`, { waitUntil: 'networkidle' });

  const flagship = page.locator('.mabayani');
  if (!(await flagship.isVisible())) fail(`${label}: the MABAYANI block is not visible`);

  // Pinned means positioned above the archive, not merely present on the page.
  const order = await page.evaluate(() => {
    const mark = document.querySelector('.mabayani');
    const archive = document.querySelector('.bulletin-archive');
    const questions = document.querySelector('.open-questions');
    if (!mark || !archive || !questions) return null;
    return {
      mark: mark.getBoundingClientRect().top + window.scrollY,
      archive: archive.getBoundingClientRect().top + window.scrollY,
      questions: questions.getBoundingClientRect().top + window.scrollY,
    };
  });
  if (!order) fail(`${label}: the Bulletin is missing one of its three sections`);
  else {
    if (order.mark >= order.archive) fail(`${label}: MABAYANI sits below the archive`);
    if (order.archive >= order.questions) fail(`${label}: open questions are not last`);
  }

  // The entry story is the one door in, and it is the data's entry story.
  const entryHref = await page.locator('.mab-entry').getAttribute('href');
  if (entryHref !== `bulletin/${data.entryStory}.html`) {
    fail(`${label}: the start-here card points at ${entryHref}, not the entry story`);
  }

  // The whole sequence, in order, with the reveal last.
  const rail = await page.locator('.mab-path .path-step').evaluateAll(
    steps => steps.map(s => ({
      slug: s.dataset.slug,
      n: s.querySelector('.path-n').textContent.trim(),
      title: s.querySelector('.path-title').textContent.trim(),
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
  const hrefs = new Set(await page.locator('a[href^="bulletin/"]').evaluateAll(
    links => links.map(a => a.getAttribute('href'))));
  for (const article of articles) {
    if (!hrefs.has(`bulletin/${article.slug}.html`)) {
      fail(`${label}: ${article.slug} is not linked from the Bulletin`);
    }
  }

  // Anonymity, as rendered.
  const visible = (await page.locator('body').innerText()).toLowerCase();
  for (const needle of [creator.toLowerCase(), surname.toLowerCase()]) {
    if (visible.includes(needle)) fail(`${label}: the Bulletin names the creator ("${needle}")`);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`${label}: horizontal overflow ${overflow}px`);

  // Progress is a private note. It stays silent until something has been read.
  const progressBefore = await page.locator('#mabProgress').isVisible();
  if (progressBefore) fail(`${label}: progress is shown to a reader who has read nothing`);

  await page.goto(`${baseURL}/bulletin/${data.entryStory}.html`, { waitUntil: 'networkidle' });
  await page.goto(`${baseURL}/masinloc-bulletin.html`, { waitUntil: 'networkidle' });
  const progressText = (await page.locator('#mabProgress').textContent() || '').trim();
  if (progressText !== `1 of ${sequence.length} stories explored`) {
    fail(`${label}: after reading one story the progress note reads "${progressText}"`);
  }
  if (!(await page.locator(`.path-step[data-slug="${data.entryStory}"]`)
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
  } else if (await next.getAttribute('href') !== '../masinloc-bulletin.html') {
    fail(`${article.slug}: the last story does not return the reader to the Bulletin`);
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
await page.goto(`${baseURL}/masinloc-bulletin.html`, { waitUntil: 'domcontentloaded' });

if (await page.locator('.mab-path .path-step').count() !== sequence.length) {
  fail('no-js: the pathway is incomplete without JavaScript');
}
if (await page.locator('.bulletin-archive .story').count() < sequence.length) {
  fail('no-js: the archive does not list every story without JavaScript');
}
if (await page.locator('.open-questions .q-list li').count() === 0) {
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
console.log(`The flagship is pinned above the archive at both widths; all ${sequence.length} `
  + 'stories are reachable in one click and ordered as the data declares.');
console.log(`The creator is named only in ${reveal.slug}; every other story is attributed to `
  + `${data.publication.name}.`);
console.log('Progress stays silent until something is read. No players, no autoplay. '
  + 'The full sequence survives with JavaScript off.');
