#!/usr/bin/env node
// node scripts/build-site.mjs [outDir]
// Builds a static copy of the console with every recorded run in runs/, for hosting anywhere (no server, no keys).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "site"));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "runs"), { recursive: true });

const html = fs
  .readFileSync(path.join(root, "console", "index.html"), "utf8")
  .replace("<html lang=\"en\">", "<html lang=\"en\" data-static=\"1\">")
  .replace('href="/styles.css"', 'href="styles.css"')
  .replace('src="/app.js"', 'src="app.js"');
fs.writeFileSync(path.join(out, "index.html"), html);
for (const f of ["app.js", "styles.css", "logo.svg"]) {
  if (fs.existsSync(path.join(root, "console", f))) fs.copyFileSync(path.join(root, "console", f), path.join(out, f));
}

const index = [];
for (const id of fs.readdirSync(path.join(root, "runs")).sort().reverse()) {
  const dir = path.join(root, "runs", id);
  if (!fs.existsSync(path.join(dir, "events.jsonl"))) continue;
  fs.mkdirSync(path.join(out, "runs", id), { recursive: true });
  const files = fs.readdirSync(dir);
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(out, "runs", id, f));
  const events = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  fs.writeFileSync(path.join(out, "runs", id, "run.json"), JSON.stringify({ id, events, files }));
  const start = events.find((e) => e.type === "run.start");
  const done = events.find((e) => e.type === "run.done");
  index.push({ id, recorded: true, mode: start?.mode ?? "", model: start?.model ?? "", started: events[0]?.t, finished: done?.t ?? null, safe: done?.safe ?? null });
}
fs.writeFileSync(path.join(out, "runs", "index.json"), JSON.stringify(index, null, 2));
console.log(`static console with ${index.length} recorded runs in ${path.relative(root, out) || out}`);
