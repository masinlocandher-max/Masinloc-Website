/* Assistance desk QA — report.html and the two private consoles.

   What this protects, in order of how badly it fails if it breaks:

   1. A resident must reach a phone number before a text box. Asserted against
      rendered geometry, not source order: a CSS change that moved the form
      above the hotlines would keep the markup order and still be wrong.
   2. While no desk is activated, nothing on the page may accept a message.
      Checked by actually trying to type and submit.
   3. The consoles must not show a queue to somebody who is not signed in.
*/
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const browser = await chromium.launch({ headless: true });
const fail = (message) => { throw new Error(message); };

/* --- report.html --------------------------------------------------------- */

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/report.html`, { waitUntil: "networkidle" });

// 1. The hotlines are above every field, as painted.
const emergencyTop = await page.locator(".rp-emergency").first()
  .evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
const firstFieldTop = await page.evaluate(() => {
  const field = document.querySelector(".rp-form input, .rp-form textarea, .rp-form select");
  return field ? field.getBoundingClientRect().top + window.scrollY : Infinity;
});
if (emergencyTop >= firstFieldTop) {
  fail(`the emergency block is painted at ${emergencyTop}px, at or below the first form ` +
       `field at ${firstFieldTop}px — the hotlines must come first on screen`);
}

// Both desk hotlines are real, tappable, +63 links.
const calls = await page.$$eval(".rp-emergency .rp-call", (nodes) => nodes.map((node) => ({
  href: node.getAttribute("href") || "",
  printed: node.querySelector(".rp-call-number")?.textContent?.trim() || "",
  height: node.getBoundingClientRect().height,
})));
if (calls.length !== 2) fail(`expected 2 desk hotlines above the form, found ${calls.length}`);
for (const call of calls) {
  if (!call.href.startsWith("tel:+63")) fail(`hotline ${call.printed} is not a +63 tel: link`);
  const a = call.href.replace(/\D/g, "").replace(/^63/, "");
  const b = call.printed.replace(/\D/g, "").replace(/^0/, "");
  if (a !== b) fail(`hotline shows ${call.printed} but dials ${call.href}`);
  if (call.height < 44) fail(`hotline ${call.printed} is only ${call.height}px tall`);
}

// 2. Closed means closed — verified by trying, not by reading a class.
const closed = await page.locator(".rp-closed").count();
if (closed) {
  const subject = page.locator("#reportSubject");
  if (await subject.isEditable()) {
    fail("the channel is closed but the subject field still accepts typing");
  }
  if (await page.locator("#reportSubmit").isEnabled()) {
    fail("the channel is closed but the submit button is still enabled");
  }
  // A disabled fieldset must also be unreachable by keyboard, or somebody
  // tabbing through the page lands in a form that cannot be sent.
  const reachable = await page.evaluate(() => {
    const field = document.querySelector("#reportSubject");
    field?.focus();
    return document.activeElement === field;
  });
  if (reachable) fail("a closed form's fields are still focusable");
} else {
  // Open: the form must actually work as far as validation.
  await page.fill("#reportSubject", "x");
  await page.fill("#reportBody", "too short");
  await page.click("#reportSubmit");
  await page.waitForTimeout(150);
  const status = await page.textContent("#reportStatus");
  if (!status || !status.trim()) fail("an open form gave no feedback on an invalid submission");
}

const h1 = await page.$$eval("h1", (n) => n.length);
if (h1 !== 1) fail(`report.html: expected exactly one H1, found ${h1}`);

if (errors.length) fail(`report.html console errors: ${errors.join(" | ")}`);
await page.close();

/* --- the consoles -------------------------------------------------------- */

for (const desk of ["pnp", "mdrrmo"]) {
  const console_ = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  console_.on("pageerror", (e) => consoleErrors.push(e.message));

  await console_.goto(`${BASE}/${desk}-desk.html`, { waitUntil: "networkidle" });

  // Signed out: the sign-in gate, and no queue.
  if (!(await console_.locator("#authView").isVisible())) {
    fail(`${desk}-desk.html does not show its sign-in gate to a signed-out visitor`);
  }
  if (await console_.locator("#deskView").isVisible()) {
    fail(`${desk}-desk.html shows the report queue to a signed-out visitor`);
  }
  const rows = await console_.locator(".dc-row").count();
  if (rows) fail(`${desk}-desk.html rendered ${rows} report rows while signed out`);

  const robots = await console_.locator('meta[name="robots"]').getAttribute("content");
  for (const directive of ["noindex", "nofollow", "noarchive"]) {
    if (!robots?.includes(directive)) {
      fail(`${desk}-desk.html is missing robots ${directive}`);
    }
  }

  const consoleH1 = await console_.$$eval("h1", (n) => n.length);
  if (consoleH1 !== 1) fail(`${desk}-desk.html: expected one H1, found ${consoleH1}`);

  if (consoleErrors.length) {
    fail(`${desk}-desk.html runtime errors: ${consoleErrors.join(" | ")}`);
  }
  await console_.close();
}

/* --- widths -------------------------------------------------------------- */

for (const [width, height, label] of [
  [390, 844, "phone"], [430, 932, "large phone"], [768, 1024, "tablet"],
  [1280, 900, "laptop"], [1440, 900, "desktop"],
]) {
  for (const path of ["report.html", "pnp-desk.html"]) {
    const view = await browser.newPage({ viewport: { width, height } });
    await view.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
    const overflow = await view.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) fail(`${path}: horizontal overflow at ${width}px (${label})`);
    if (width === 390 || width === 1280) {
      await view.screenshot({
        path: `artifacts/browser-qa/${path.replace(".html", "")}-${width}.png`,
        fullPage: width === 390,
      });
    }
    await view.close();
  }
}

console.log("ASSISTANCE QA PASSED");
console.log("report.html paints its hotlines above every field, honours the closed state " +
            "when nothing is activated, and both consoles show no queue while signed out. " +
            "No overflow at 390, 430, 768, 1280, 1440.");

await browser.close();
