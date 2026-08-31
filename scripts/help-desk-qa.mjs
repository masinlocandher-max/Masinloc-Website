/* Help Desk QA.

   What this suite is actually protecting: a resident opening this page during
   an emergency must be able to reach a working number, on whatever device is
   in their hand, whether or not scripting ran.

   So the assertions are about reachability rather than appearance — every
   number is a real tel: link, every link dials what it prints, the list is
   complete with JavaScript disabled, and nothing overflows off a phone
   screen where a horizontal scroll would hide the numbers on the right.
*/
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const URL = `${BASE}/help-desk.html`;
const browser = await chromium.launch({ headless: true });

const fail = (message) => { throw new Error(message); };
const digits = (value) => value.replace(/\D/g, "").replace(/^63/, "").replace(/^0/, "");

/* --- every call target dials what it shows, at desktop width ------------ */

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });

const calls = await page.$$eval(".hd-call", (nodes) => nodes.map((node) => ({
  href: node.getAttribute("href") || "",
  printed: node.querySelector(".hd-call-number")?.textContent?.trim() || "",
  // A call target that is not actually pressable is the failure this page
  // cannot afford, so the rendered box is measured rather than assumed.
  width: node.getBoundingClientRect().width,
  height: node.getBoundingClientRect().height,
})));

if (calls.length !== 22) fail(`expected 22 call targets, found ${calls.length}`);

for (const call of calls) {
  if (!call.href.startsWith("tel:+63")) {
    fail(`call target "${call.printed}" is not a +63 tel: link (${call.href})`);
  }
  if (digits(call.href) !== digits(call.printed)) {
    fail(`call target shows ${call.printed} but dials ${call.href}`);
  }
  if (call.height < 44) {
    fail(`call target "${call.printed}" is only ${call.height}px tall; ` +
         `a number pressed under pressure needs a 44px target`);
  }
}

const h1 = await page.$$eval("h1", (n) => n.length);
if (h1 !== 1) fail(`expected exactly one H1, found ${h1}`);

/* Every section is painted before it is scrolled to. The site-wide reveal
   holds `main > section` at opacity 0 until an observer fires, which would
   leave the barangay numbers invisible to find-in-page and to a screenshot
   somebody takes to send on. This page opts out; assert that it stays out. */
const faded = await page.$$eval("main > section", (nodes) => nodes
  .filter((node) => Number(getComputedStyle(node).opacity) < 1)
  .map((node) => node.className));
if (faded.length) {
  fail(`sections still transparent before scrolling: ${faded.join(", ")} — ` +
       `emergency content must be painted on load`);
}

/* The boundary statement must be visible, not merely present in the markup:
   a reader who thinks this page contacts an office for them would wait. */
const independent = await page.locator(".hd-independent").first();
if (!(await independent.isVisible())) fail("the independence statement is not visible");

/* --- the barangay filter, and what happens without it ------------------- */

const filterVisible = await page.locator(".hd-filter").isVisible();
if (!filterVisible) fail("the barangay filter did not appear once scripting ran");

await page.fill("#brgySearch", "poblacion");
await page.waitForTimeout(120);
const shown = await page.$$eval(".hd-brgy:not([hidden])", (n) => n.length);
// Substring matching, so "poblacion" must reach both North and South.
if (shown !== 2) fail(`filtering on "poblacion" showed ${shown} barangays, expected 2`);

await page.fill("#brgySearch", "zzzz");
await page.waitForTimeout(120);
const none = await page.$$eval(".hd-brgy:not([hidden])", (n) => n.length);
if (none !== 0) fail("a non-matching search still showed barangays");
const status = await page.textContent("#brgyStatus");
if (!status || !status.includes("emergency numbers above")) {
  fail("a search matching nothing must still point somewhere, not dead-end");
}

await page.keyboard.press("Escape");
await page.waitForTimeout(120);
const restored = await page.$$eval(".hd-brgy:not([hidden])", (n) => n.length);
if (restored !== 13) fail(`Escape restored ${restored} barangays, expected all 13`);

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
await page.close();

/* --- no script at all --------------------------------------------------- */

const noJs = await browser.newContext({ javaScriptEnabled: false });
const bare = await noJs.newPage();
await bare.setViewportSize({ width: 390, height: 844 });
await bare.goto(URL, { waitUntil: "domcontentloaded" });

const bareCalls = await bare.$$eval(".hd-call", (n) => n.length);
if (bareCalls !== 22) {
  fail(`with scripting off only ${bareCalls} of 22 numbers are on the page — ` +
       `an emergency number must never depend on a script`);
}
const bareRows = await bare.$$eval(".hd-brgy:not([hidden])", (n) => n.length);
if (bareRows !== 13) fail(`with scripting off ${bareRows} of 13 barangays are listed`);
// The filter must stay hidden: an input that does nothing when typed into
// reads as a broken page while the number is sitting further down it.
if (await bare.locator(".hd-filter").isVisible()) {
  fail("the barangay filter is shown with scripting off, where it cannot work");
}
await noJs.close();

/* --- widths ------------------------------------------------------------- */

for (const [width, height, label] of [
  [390, 844, "phone"],
  [430, 932, "large phone"],
  [768, 1024, "tablet"],
  [1280, 900, "laptop"],
  [1440, 900, "desktop"],
]) {
  const view = await browser.newPage({ viewport: { width, height } });
  await view.goto(URL, { waitUntil: "networkidle" });

  const overflow = await view.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) fail(`horizontal overflow at ${width}px (${label})`);

  // Numbers must not be clipped by their own card at any width.
  const clipped = await view.$$eval(".hd-call", (nodes) => nodes.filter((node) => {
    const call = node.getBoundingClientRect();
    const card = node.closest(".hd-service, .hd-brgy").getBoundingClientRect();
    return call.right > card.right + 1 || call.left < card.left - 1;
  }).length);
  if (clipped) fail(`${clipped} call targets overflow their card at ${width}px (${label})`);

  await view.screenshot({
    path: `artifacts/browser-qa/help-desk-${width}.png`,
    fullPage: width <= 430,
  });
  await view.close();
}

console.log("HELP DESK QA PASSED");
console.log("22 numbers, each a +63 tel: link dialling exactly what it prints, at a 44px+ " +
            "target. Complete with scripting disabled. No overflow at 390, 430, 768, 1280, 1440.");

await browser.close();
