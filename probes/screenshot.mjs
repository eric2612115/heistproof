import { chromium } from "playwright";
const [url, out, action] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: action === "live" ? "domcontentloaded" : "networkidle" }); if (action === "live") await page.waitForTimeout(3000);
if (action === "bag") { await page.click("#add-FOG-HOODIE"); await page.waitForTimeout(600); }
await page.screenshot({ path: out });
await browser.close();
