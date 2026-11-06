import { chromium } from "playwright";
import fs from "node:fs";
const [svgPath, out, w, h, bg] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.setContent(`<html><body style="margin:0;background:${bg ?? "transparent"};display:grid;place-items:center;width:${w}px;height:${h}px">${svg.replace("<svg ", `<svg width="${Math.min(Number(w), Number(h))}" height="${Math.min(Number(w), Number(h))}" `)}</body></html>`);
await page.screenshot({ path: out, omitBackground: !bg });
await browser.close();
