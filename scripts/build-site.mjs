#!/usr/bin/env node
// node scripts/build-site.mjs [outDir] [--url https://host/path/]
// Builds a static copy of the console with every recorded run in runs/, for hosting anywhere (no server, no keys).
// --url (or HEISTPROOF_SITE_URL) is the address the site will be hosted at; it only fills the og: tags for link previews.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/* ---- Run summary for the index. Keep this identical to summarize() in src/console/server.ts. ---- */
const EXPECTED_ATTACKS = 10;
const SHOP_NAMES = { "fogline-express": "the Fogline shop", "fogline-naive": "a hand-written checkout", "fogline-afternoon": "a hand-written checkout", "fogline-after": "the checkout the agent wrote" };
function summarize(id, events) {
  const start = events.find((e) => e.type === "run.start") ?? {};
  const done = events.find((e) => e.type === "run.done");
  let round = 0;
  const results = new Map(); // attack id -> its latest result and the round it ran in
  const robbedEver = new Set();
  let fixes = 0;
  let purchases = 0;
  for (const e of events) {
    if (e.type === "attack.result") {
      results.set(e.id, { verdict: e.verdict, round });
      if (e.verdict === "robbed") robbedEver.add(e.id);
    } else if (e.type === "round.done") round++;
    else if (e.type === "agent.start" && String(e.label ?? "").startsWith("fix")) fixes++;
    else if (e.type === "prove.buttons" && String(e.label ?? "").startsWith("round")) purchases++;
  }
  const last = Math.max(0, ...[...results.values()].map((r) => r.round));
  const final = [...results.values()].filter((r) => r.round === last);
  const count = (v) => final.filter((r) => r.verdict === v).length;
  const mode = start.mode ?? "heistproof";
  const template = start.template ?? String(start.shop ?? "").split("/").pop() ?? "";
  const shop = SHOP_NAMES[template] ?? template ?? "the shop";
  const robbed = count("robbed");
  const title = mode === "check" ? `${shop[0].toUpperCase()}${shop.slice(1)}, checked as it is` : mode === "existing" ? `AI fixes ${shop}` : mode === "baseline" ? "AI adds PayPal without Heistproof" : `AI adds PayPal to ${shop}`;
  return {
    id,
    mode,
    template,
    offline: Boolean(start.offline),
    model: start.model ?? "",
    provider: start.provider ?? "",
    heistproofCommit: start.heistproofCommit ?? null,
    node: start.node ?? null,
    started: events[0]?.t ?? null,
    finished: done?.t ?? null,
    verdict: done ? (done.verdict ?? (done.safe ? "safe" : "unsafe")) : null,
    safe: done?.safe ?? null,
    held: count("held"),
    robbed,
    skipped: count("skipped") + count("error"),
    ran: final.length,
    total: Math.max(EXPECTED_ATTACKS, results.size),
    robbedEver: robbedEver.size,
    rounds: done?.rounds ?? round + (results.size ? 1 : 0),
    fixes,
    purchases,
    branch: done?.branch ?? (done?.branchReady ? "local" : null),
    pr: typeof done?.pr === "string" && done.pr ? done.pr : null,
    title,
  };
}

const index = [];
for (const id of fs.readdirSync(path.join(root, "runs")).sort().reverse()) {
  const dir = path.join(root, "runs", id);
  if (!fs.existsSync(path.join(dir, "events.jsonl"))) continue;
  fs.mkdirSync(path.join(out, "runs", id), { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith(".db"));
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(out, "runs", id, f));
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  fs.writeFileSync(path.join(out, "runs", id, "run.json"), JSON.stringify({ id, events, files }));
  index.push({ ...summarize(id, events), recorded: true });
}
fs.writeFileSync(path.join(out, "runs", "index.json"), JSON.stringify(index, null, 2));
console.log(`static console with ${index.length} recorded runs in ${path.relative(root, out) || out}`);
