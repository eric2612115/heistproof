#!/usr/bin/env node
// node scripts/export-run.mjs <runId> [name]
// Copies a run from .heistproof/runs into runs/<name> so it can be committed and replayed by anyone with
// `npm run console`. Databases are left out, home-folder paths become "~", and every file is checked for secrets.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [runId, name = runId] = process.argv.slice(2);
if (!runId) throw new Error("usage: node scripts/export-run.mjs <runId> [name]");
const src = path.join(root, ".heistproof", "runs", runId);
const dest = path.join(root, "runs", name);
if (!fs.existsSync(path.join(src, "events.jsonl"))) throw new Error(`no run at ${src}`);

const secrets = [];
// Scrub every secret value from .env.local and from the optional shared settings file it names.
const local = path.join(root, ".env.local");
const sharedFile = process.env.HEISTPROOF_SHARED_ENV ?? (fs.existsSync(local) ? /^HEISTPROOF_SHARED_ENV=(.*)$/m.exec(fs.readFileSync(local, "utf8"))?.[1]?.trim() : undefined);
for (const file of [local, sharedFile].filter(Boolean)) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && /SECRET|PASSWORD|KEY|TOKEN/.test(m[1]) && m[2].length >= 6) secrets.push(m[2]);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
const home = os.homedir();
let copied = 0;
for (const f of fs.readdirSync(src)) {
  if (f.endsWith(".db") || f.endsWith("-shop.log")) continue;
  const from = path.join(src, f);
  if (f.endsWith(".png")) {
    fs.copyFileSync(from, path.join(dest, f));
  } else {
    const user = os.userInfo().username;
    let text = fs
      .readFileSync(from, "utf8")
      .split(home)
      .join("~")
      .replace(/\/(private\/)?tmp\/claude-\d+\/[^"\s\\)]*/g, "<tmp>")
      .split(user)
      .join("user");
    for (const s of secrets) if (text.includes(s)) throw new Error(`secret found in ${f}; not exported`);
    fs.writeFileSync(path.join(dest, f), text);
  }
  copied++;
}
console.log(`exported ${copied} files to runs/${name}`);
