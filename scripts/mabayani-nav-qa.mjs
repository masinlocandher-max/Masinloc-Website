/* Wayfinding on /mabayani/.

   MABAYANI is thirty-one narrative sections plus five reference sections, and
   nobody reads it top to bottom in one sitting. So the story map is not
   decoration — it is the only way to move around the page, and this checks the
   things that make it work rather than the things that make it exist.

   Three of these are here because each was broken and nothing caught it:

   1. THE MAP IS ON SCREEN. It and the site masthead were both sticky at top:0,
      and the masthead is taller and on a higher layer, so the map sat behind it
      and was never once visible while reading.
   2. A JUMP LANDS BELOW BOTH BARS. Anchors have to clear the masthead and the
      map together, and the scroll reveal holds an unshown section 26px below
      its real position, which threw every jump off by that much.
   3. THE MAP SAYS WHERE YOU ARE. Thirty-six identical rows are a list, not
      navigation, until one of them is marked as the one you are in.

   And the map stays a plain list of anchors, so it still works with this
   file's scripting switched off.

   Usage: node scripts/mabayani-nav-qa.mjs   (with a static server on :8000)
*/
import { chromium } from "playwright";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:8000";
const b = await chromium.launch({ headless: true });
const fails = [];

for (const [label, vp] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !m.text().includes("favicon")) errs.push(m.text()); });
  await p.goto(`${baseURL}/mabayani/`, { waitUntil: "networkidle" });
  // Wait for scrolling to stop. The baseline is reset each time and the page
  // is given a moment to start moving, otherwise a smooth scroll that has been
  // requested but not yet begun reads as "already settled".
  const settle = async () => {
    await p.evaluate(() => { window.__s = -1; });
    await p.waitForTimeout(250);
    await p.waitForFunction(() => {
      if (window.__s === window.scrollY) return true;
      window.__s = window.scrollY; return false;
    }, null, { polling: 100, timeout: 15000 });
  };

  // Every reference section is now reachable from the map.
  for (const id of ["legend", "research", "people", "sources", "contribute"]) {
    const n = await p.locator(`#storyMap a[href="#${id}"]`).count();
    if (n !== 1) fails.push(`${label}: story map has ${n} links to #${id}`);
  }
  // The story map has to be on screen to be usable at all.
  await p.evaluate(() => window.scrollTo({ top: 9000, behavior: "auto" }));
  await p.waitForTimeout(400);
  const covered = await p.evaluate(() => {
    const m = document.getElementById("storyMap").getBoundingClientRect();
    const mid = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    return !(mid && mid.closest("#storyMap"));
  });
  if (covered) fails.push(`${label}: the story map bar is covered by something else`);
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
  await p.waitForTimeout(300);

  const total = await p.locator("#storyMap a[href^='#']").count();
  if (total !== 36) fails.push(`${label}: story map has ${total} rows, expected 36`);

  // Jump deep into the narrative, then confirm the map says where we are.
  await p.evaluate(() => document.querySelector("section#s13").scrollIntoView({ behavior: "auto" }));
  await settle();
  await p.waitForTimeout(300);
  const here = (await p.locator("#mbHere").textContent() || "").trim();
  const current = await p.locator("#storyMap a.is-here").getAttribute("href").catch(() => null);
  if (current !== "#s13") fails.push(`${label}: marked row is ${current}, expected #s13`);
  if (vp.width > 520 && here !== "13 · 1649: Anim na Caracoa") {
    fails.push(`${label}: the bar reads "${here}", not the part number and its title`);
  }
  const aria = await p.locator("#storyMap a[aria-current='location']").count();
  if (aria !== 1) fails.push(`${label}: ${aria} rows carry aria-current`);

  // Opening the map lands on that row, and does not move the page.
  const before = await p.evaluate(() => window.scrollY);
  await p.evaluate(() => document.querySelector("#storyMap > summary").click());
  await p.waitForTimeout(450);
  await settle();
  const after = await p.evaluate(() => window.scrollY);
  if (Math.abs(after - before) > 3) fails.push(`${label}: opening the map moved the page ${after - before}px`);
  const visible = await p.locator("#storyMap a.is-here").isVisible();
  const inView = await p.locator("#storyMap a.is-here").evaluate(el => {
    const s = el.closest("nav").getBoundingClientRect(), r = el.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
  if (!visible || !inView) fails.push(`${label}: the current row is not shown when the map opens`);

  // A jump from the map closes it and lands on the section. Tested against
  // #legend rather than #sources: sources is the last section on the page, so
  // the document runs out of scroll before it can reach the top and the
  // landing position says more about the page height than about the jump.
  await p.evaluate(() => document.querySelector('#storyMap a[href="#legend"]').click());
  await settle();
  if (await p.locator("#storyMap").evaluate(el => el.open)) fails.push(`${label}: map stayed open after a jump`);
  const top = await p.locator("#legend").evaluate(el => el.getBoundingClientRect().top);
  // The landing must clear the masthead and the story map bar together, and
  // sit close under them rather than half a screen down.
  const bars = await p.evaluate(() => {
    const n = document.getElementById("siteNav").getBoundingClientRect().height;
    const m = document.getElementById("storyMap").getBoundingClientRect().height;
    return Math.round(n + m);
  });
  if (top < bars || top > bars + 26) {
    fails.push(`${label}: after jumping, #legend landed at ${Math.round(top)}px; the two bars end at ${bars}px`);
  }
  const focused = await p.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== "legend") fails.push(`${label}: focus went to "${focused}", not the section jumped to`);
  const hash = await p.evaluate(() => location.hash);
  if (hash !== "#legend") fails.push(`${label}: the URL reads "${hash}" after the jump`);

  const of1 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (of1 > 1) fails.push(`${label}: horizontal overflow ${of1}px`);
  for (const e of errs) fails.push(`${label}: ${e}`);
  await p.close();
}

// With JavaScript off the map is still a complete, working table of contents.
const plain = await b.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
const pp = await plain.newPage();
await pp.goto(`${baseURL}/mabayani/`, { waitUntil: "domcontentloaded" });
const noJs = await pp.locator("#storyMap a[href^='#']").count();
if (noJs !== 36) fails.push(`no-js: story map has ${noJs} rows, expected 36`);
await plain.close();

await b.close();
if (fails.length) { console.log("FAILED"); fails.forEach(f => console.log(" -", f)); process.exit(1); }
console.log("MABAYANI NAV QA PASSED");
console.log("The story map is visible below the masthead at both widths and offers all 36 "
  + "destinations — 31 story parts and 5 reference sections.");
console.log("It marks the section being read, opens on that row, and its jumps close it and "
  + "land clear of both sticky bars with focus and the URL following.");
console.log("With JavaScript off it is still a complete table of contents.");
