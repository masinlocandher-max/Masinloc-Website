/* The editable dictionary layer, as the public page sees it.
 *
 * The archive is a static file and never changes: it records what the source
 * says. Everything an editor adds or corrects lives in the database and is
 * merged in at read time. These checks cover the three things that matter:
 *
 *   - an editor's word actually reaches the page, labelled for what it is;
 *   - a correction visibly replaces the archive reading rather than silently
 *     rewriting it, and keeps its attribution;
 *   - the request asks only for published rows and public columns, so a
 *     widened select cannot quietly start pulling editorial notes into a page.
 *
 * The layer is also allowed to be unreachable. The archive on its own is a
 * complete dictionary, so the page must carry on without it.
 */
import { chromium } from '@playwright/test';

const URL = 'http://localhost:8000/sambal-tina.html';
const problems = [];
const fail = (m) => problems.push(m);

const browser = await chromium.launch();

/* --- what the page asks the database for -------------------------------- */
{
  const page = await browser.newPage();
  let asked = null;
  await page.route('**/rest/v1/dictionary_entries*', (route) => {
    asked = route.request().url();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  if (!asked) {
    fail('the page never requested the editable layer');
  } else {
    const query = decodeURIComponent(asked);
    if (!/status=eq\.published/.test(query)) {
      fail('the request does not restrict to published rows');
    }
    /* Columns that must never be requested by a public page. */
    for (const priv of ['internal_notes', 'source_submission_id']) {
      if (query.includes(priv)) {
        fail(`the public request asks for a private column: ${priv}`);
      }
    }
    if (/select=\*/.test(query)) {
      fail('the public request selects every column instead of naming safe ones');
    }
  }
  await page.close();
}

/* --- a new word and a correction reach the page ------------------------- */
{
  const page = await browser.newPage();
  await page.route('**/rest/v1/dictionary_entries*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      {
        tina: 'lanom', pos: 'n.', en: 'water', fil: 'tubig',
        example: 'Main lanom da.', example_en: 'There is water.',
        note: null, layer: 'correction', credit_name: 'Juan Dela Cruz',
      },
      {
        tina: 'zzztestword', pos: 'n.', en: 'a word only in the editable layer',
        fil: 'pagsubok', example: null, example_en: null,
        note: null, layer: 'new', credit_name: null,
      },
    ]),
  }));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const read = async (term) => {
    await page.fill('#dictQuery', term);
    await page.waitForTimeout(450);
    return page.$$eval('.dict-entry', (els) => els.slice(0, 1).map((el) => ({
      tina: el.querySelector('.entry-tina')?.textContent.trim() || '',
      en: el.querySelector('.entry-en')?.textContent.trim() || '',
      example: el.querySelector('.entry-example')?.textContent.trim() || '',
      credit: el.querySelector('.entry-credit')?.textContent.trim() || '',
      badges: [...el.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
    })));
  };

  const [fresh] = await read('zzztestword');
  if (!fresh || fresh.tina !== 'zzztestword') {
    fail("an editor's new word never appeared in search results");
  } else if (!fresh.badges.some((b) => /community/i.test(b))) {
    fail(`a new word is not labelled as added: ${fresh.badges.join(', ')}`);
  }

  const [fixed] = await read('lanom');
  if (!fixed) {
    fail('the corrected word disappeared from search results');
  } else {
    if (fixed.en !== 'water') {
      fail(`the correction did not replace the archive reading: "${fixed.en}"`);
    }
    if (!fixed.badges.some((b) => /correct/i.test(b))) {
      fail(`a correction is not labelled as one: ${fixed.badges.join(', ')}`);
    }
    if (!fixed.credit.includes('Juan Dela Cruz')) {
      fail('a credited correction lost its attribution');
    }
    if (!fixed.example.includes('Main lanom da.')) {
      fail('the example sentence did not render');
    }
  }
  await page.close();
}

/* --- the layer is allowed to be unreachable ----------------------------- */
{
  const page = await browser.newPage();
  await page.route('**/rest/v1/dictionary_entries*', (route) => route.abort());
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.fill('#dictQuery', 'lanom');
  await page.waitForTimeout(450);
  const found = await page.$$eval('.dict-entry', (els) => els.length);
  if (found < 1) {
    fail('with the editable layer unreachable the archive stopped working; '
       + 'the archive alone is a complete dictionary and must still search');
  }
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('DICTIONARY ENTRIES QA FAILED');
  problems.forEach((p) => console.log(`- ${p}`));
  process.exit(1);
}

console.log('DICTIONARY ENTRIES QA PASSED');
console.log('Editor entries merge over the archive labelled and attributed, the');
console.log('public request asks only for published rows and safe columns, and the');
console.log('archive still searches when the layer cannot be reached.');
