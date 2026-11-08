#!/usr/bin/env node
// node scripts/build-site.mjs [outDir] [--url https://host/path/]
// Builds a static copy of the console with every recorded run in runs/, for hosting anywhere (no server, no keys).
// --url (or HEISTPROOF_SITE_URL) is the address the site will be hosted at; it only fills the og: tags for link previews.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, shotInfo } from "../src/console/summary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const urlFlag = args.indexOf("--url");
const siteUrl = (urlFlag >= 0 ? args[urlFlag + 1] : process.env.HEISTPROOF_SITE_URL) ?? "";
const outArg = args.filter((a, i) => urlFlag < 0 || (i !== urlFlag && i !== urlFlag + 1))[0];
const out = path.resolve(outArg ?? path.join(root, "site"));
const MARKER = ".heistproof-site";

// Only a folder this script made before (it carries the marker) is emptied; anything else non-empty is left alone.
if (fs.existsSync(out)) {
  const entries = fs.readdirSync(out);
  if (entries.length && !entries.includes(MARKER)) {
    console.error(`refusing to empty ${out}: it is not empty and has no ${MARKER} marker (pick an empty or new folder)`);
    process.exit(1);
  }
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(path.join(out, "runs"), { recursive: true });
fs.writeFileSync(path.join(out, MARKER), `built by scripts/build-site.mjs on ${new Date().toISOString()}\n`);

let html = fs
  .readFileSync(path.join(root, "console", "index.html"), "utf8")
  .replace('<html lang="en">', '<html lang="en" data-static="1">')
  .replace('href="/styles.css"', 'href="styles.css"')
  .replace('src="/app.js"', 'src="app.js"');
if (siteUrl) {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  html = html.replace("</head>", `    <meta property="og:url" content="${base}" />\n    <meta property="og:image" content="${base}logo-512.png" />\n  </head>`);
}
fs.writeFileSync(path.join(out, "index.html"), html);
for (const f of ["app.js", "styles.css", "logo.svg"]) {
  if (fs.existsSync(path.join(root, "console", f))) fs.copyFileSync(path.join(root, "console", f), path.join(out, f));
}
if (fs.existsSync(path.join(root, "assets", "logo-512.png"))) fs.copyFileSync(path.join(root, "assets", "logo-512.png"), path.join(out, "logo-512.png"));

const index = [];
const skipped = [];
for (const id of fs.readdirSync(path.join(root, "runs")).sort().reverse()) {
  const dir = path.join(root, "runs", id);
  if (!fs.existsSync(path.join(dir, "events.jsonl"))) continue;
  fs.mkdirSync(path.join(out, "runs", id), { recursive: true });
  // Back-office screenshots that caught a server error page instead of the back office are not proof: they are left
  // out of the site (the run folder keeps them) and listed, so the console never shows or captions them.
  // Byte-for-byte copies of a screenshot and the outlined order on each back-office page are listed with the run too,
  // so the console never shows one picture twice in a group and can crop a back-office page to the order it proves.
  const all = fs.readdirSync(dir).filter((f) => !f.endsWith(".db"));
  const info = shotInfo(dir, all);
  const broken = info.brokenShots;
  const files = all.filter((f) => !broken.includes(f));
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(out, "runs", id, f));
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  fs.writeFileSync(path.join(out, "runs", id, "run.json"), JSON.stringify({ id, events, files, ...info }));
  if (broken.length) skipped.push(`${id}: ${broken.length}`);
  index.push({ ...summarize(id, events), recorded: true });
}
fs.writeFileSync(path.join(out, "runs", "index.json"), JSON.stringify(index, null, 2));
console.log(`static console with ${index.length} recorded runs in ${path.relative(root, out) || out}`);
if (skipped.length) console.log(`left out back-office screenshots that show a server error page instead (${skipped.join(", ")})`);
