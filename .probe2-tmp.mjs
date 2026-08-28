import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("http://127.0.0.1:8000/mabayani/", { waitUntil: "networkidle" });

await p.evaluate(() => document.getElementById("s13").scrollIntoView());
await p.waitForTimeout(600);
console.log("scrollY at s13:", await p.evaluate(() => Math.round(window.scrollY)));

// A real user taps the visible sticky bar; no auto-scroll involved.
await p.evaluate(() => document.querySelector("#storyMap > summary").click());
await p.waitForTimeout(500);
console.log("after opening map:", await p.evaluate(() => Math.round(window.scrollY)));
console.log("map open:", await p.evaluate(() => document.getElementById("storyMap").open));
console.log("nav scrollTop:", await p.evaluate(() => document.querySelector("#storyMap nav").scrollTop));
console.log("marked offsetParent:", await p.evaluate(() => {
  const a = document.querySelector("#storyMap a.is-here");
  return a ? (a.offsetParent && a.offsetParent.tagName + "." + a.offsetParent.className) : null;
}));

await p.evaluate(() => document.querySelector('#storyMap a[href="#sources"]').click());
await p.waitForTimeout(900);
console.log("after jump, #sources top:", await p.evaluate(
  () => Math.round(document.getElementById("sources").getBoundingClientRect().top)));
console.log("scroll-behavior:", await p.evaluate(
  () => getComputedStyle(document.documentElement).scrollBehavior));
console.log("reveal hidden count:", await p.evaluate(
  () => document.querySelectorAll('[data-reveal]:not(.is-in)').length));
await b.close();
