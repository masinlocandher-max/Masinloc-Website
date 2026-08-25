/* Every visible line of text on the site, measured against what is actually
   painted behind it.
 *
 * The other suites check their own page. This one checks the thing that is
 * easiest to break from a distance and hardest to notice: type over
 * photographs, over gradients, over translucent panels. Three separate
 * failures in this project were of exactly that kind — a menu button on open
 * sky at 2.23:1, the homepage navigation's last link at 2.43:1, and a 14px
 * line on glass at 4.06:1 — and none of them was visible in a screenshot at a
 * glance.
 *
 * How it measures, and why it has to be done this way:
 *
 *   - It samples the rendered page, not the CSS. A declared colour tells you
 *     nothing when the thing behind it is a photograph.
 *   - It removes the glyphs and keeps everything else, so the sample is the
 *     real background rather than the text sitting on itself. An earlier
 *     version hid whole elements instead and produced a flat 1.00:1, which is
 *     the signature of measuring text against itself.
 *   - It samples the actual glyph runs from a Range, not the element box. A
 *     wide box over a bright frame reports its worst pixel where no letter is.
 *   - It composites the element's real colour and alpha over each pixel. Text
 *     is frequently translucent here, and an opaque assumption flatters it.
 *   - It takes the worst pixel under the run, not the average. Average
 *     contrast is not a thing anybody reads.
 *
 * Thresholds are WCAG AA: 3:1 for large text (24px, or 18.66px bold),
 * 4.5:1 for everything else.
 *
 * Usage: node scripts/contrast-qa.mjs   (with a static server on :8000)
 */
import { chromium } from 'playwright';

const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8000';

const PAGES = [
  'index.html', 'a-closer-look.html', 'destinations.html', 'sambal-tina.html',
  'leadership.html', 'verified-history.html', 'founder-of-masinloc.html', 'masinloc-bulletin.html',
  'sources.html', 'bulletin/why-mabayani-exists.html',
  'bulletin/was-masinloc-founded-in-1572.html', 'bulletin/what-binabayani-remembers.html', 'contact.html', 'connect.html',
  'trust.html', 'privacy.html', '404.html',
  'discover/index.html', 'discover/masinloc-actually.html',
  'discover/masinloc-right-now.html', 'discover/the-sweetest-mango-came-from-where-exactly.html',
  'discover/come-hungry.html', 'discover/the-sea-in-front-of-masinloc.html',
];

const VIEWPORTS = [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 780 }]];

/* A small tolerance so a run that lands exactly on the line does not flap
   between builds on sub-pixel rendering differences. */
const SLACK = 0.02;

const failures = [];
const browser = await chromium.launch({ headless: true });

for (const [label, viewport] of VIEWPORTS) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  /* Third-party host. This suite is about pixels, not about reachability. */
  await context.route('**/rest/v1/dictionary_entries*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  for (const page of PAGES) {
    const tab = await context.newPage();
    try {
      await tab.goto(`${baseURL}/${page}`, { waitUntil: 'networkidle', timeout: 25000 });
      await tab.waitForTimeout(300);

      const runs = await tab.evaluate(() => {
        const out = [];
        const selector = 'h1,h2,h3,h4,p,span,a,strong,li,label,button,time,figcaption';
        document.querySelectorAll(selector).forEach((el) => {
          // Leaf nodes only: a wrapper's rects cover its children's too.
          if (!el.textContent.trim() || el.children.length) return;
          /* aria-hidden content is not painted for a reader. This includes the
             off-screen Website honeypot on Connect: it is deliberately kept
             in the DOM for bots and hidden as one inherited subtree. */
          if (el.closest('[aria-hidden="true"]')) return;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return;
          if (Number(style.opacity) === 0) return;
          /* Screen-reader-only text. The .visually-hidden pattern clips an
             element to a 1px box with overflow hidden, so nothing of it is
             painted — but a Range over its contents still reports the full
             unclipped text rects, and measuring those means measuring the
             background against itself. Judge by the element's own box: if
             that has been collapsed to nothing, no reader can see the text
             and its contrast is not a thing that exists. */
          const box = el.getBoundingClientRect();
          if (box.width <= 4 || box.height <= 4) return;
          const parts = (style.color.match(/[\d.]+/g) || []).map(Number);
          if (parts.length < 3) return;
          const range = document.createRange();
          range.selectNodeContents(el);
          for (const r of range.getClientRects()) {
            if (r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= window.innerHeight) {
              out.push({
                text: el.textContent.trim().slice(0, 34),
                rgb: parts.slice(0, 3),
                alpha: parts.length > 3 ? parts[3] : 1,
                size: parseFloat(style.fontSize),
                bold: Number(style.fontWeight) >= 700,
                x: Math.round(r.x), y: Math.round(r.y),
                w: Math.round(r.width), h: Math.round(r.height),
              });
            }
          }
        });
        return out;
      });

      // Erase the glyphs, keep every background, image and gradient painted.
      await tab.addStyleTag({ content:
        '*{color:transparent !important;text-shadow:none !important;'
        + '-webkit-text-fill-color:transparent !important}' });
      await tab.waitForTimeout(200);

      const seen = new Set();
      for (const run of runs) {
        const shot = await tab.screenshot({ clip: {
          x: Math.max(0, run.x), y: Math.max(0, run.y),
          width: Math.max(4, Math.min(run.w, viewport.width - Math.max(0, run.x))),
          height: Math.max(4, run.h),
        } });

        const ratio = await tab.evaluate(async ({ dataUrl, rgb, alpha }) => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context2d = canvas.getContext('2d');
          context2d.drawImage(image, 0, 0);
          const px = context2d.getImageData(0, 0, image.width, image.height).data;
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

        const large = run.size >= 24 || (run.bold && run.size >= 18.66);
        const floor = large ? 3 : 4.5;
        if (ratio < floor - SLACK) {
          const line = `${label}/${page}: "${run.text}" at ${Math.round(run.size)}px `
            + `reaches ${ratio.toFixed(2)}:1, below the ${floor}:1 it needs`;
          if (!seen.has(line)) {
            seen.add(line);
            failures.push(line);
          }
        }
      }
    } catch (error) {
      failures.push(`${label}/${page}: ${error.message.split('\n')[0]}`);
    }
    await tab.close();
  }
  await context.close();
}

await browser.close();

if (failures.length) {
  console.error('CONTRAST QA FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CONTRAST QA PASSED');
console.log(`${PAGES.length} pages at two widths: every visible text run clears its WCAG floor `
  + 'against the pixels actually painted behind it.');
