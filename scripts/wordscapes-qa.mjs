import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];

page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(`${BASE}/wordscapes/`, { waitUntil: "networkidle" });
await page.getByText("ANTAS 1").waitFor();

for (const word of ["APIL", "IKAP", "PIKA", "ALAK", "LIO", "ALIPAOK"]) {
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
}

await page.getByText("NACWA MO!").waitFor();
await page.screenshot({ path: "artifacts/browser-qa/wordscapes-mobile.png", fullPage: true });

const title = await page.title();
const robots = await page.locator('meta[name="robots"]').getAttribute("content");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

if (title !== "MANAMBALI | Sambal Tina Word Connect") throw new Error(`Unexpected title: ${title}`);
if (robots !== "noindex, nofollow") throw new Error(`Unexpected robots value: ${robots}`);
if (overflow) throw new Error("Horizontal overflow detected at 390px");
if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

console.log("WORDSCAPES BROWSER QA PASSED");
console.log("390x844: loaded, completed level 1, showed NACWA MO!, and had no overflow or runtime errors.");

await browser.close();
