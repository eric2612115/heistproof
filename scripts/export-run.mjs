#!/usr/bin/env node
// node scripts/export-run.mjs <runId> [name]
// Copies a run from .heistproof/runs into runs/<name> so it can be committed and replayed by anyone with
// `npm run console`. Databases and shop logs are left out, home-folder paths become "~", sandbox account e-mails are
// masked, and every text file is checked for every secret Heistproof knows about; one hit stops the export.
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

const SECRET_NAME = /SECRET|PASSWORD|KEY|TOKEN/;
const readEnv = (file) => {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
};
// Every place a secret can come from: the process environment, .env.local, and the shared settings and buyers files.
const local = readEnv(path.join(root, ".env.local"));
const pick = (k) => process.env[k] ?? local[k];
const shared = readEnv(pick("HEISTPROOF_SHARED_ENV"));
const all = { ...shared, ...local, ...process.env };
const secrets = new Set();
for (const [k, v] of Object.entries(all)) if (SECRET_NAME.test(k) && typeof v === "string" && v.length >= 8) secrets.add(v);
const buyersFile = pick("HEISTPROOF_BUYERS_FILE") ?? shared.HEISTPROOF_BUYERS_FILE;
if (buyersFile && fs.existsSync(buyersFile)) {
  try {
    for (const b of JSON.parse(fs.readFileSync(buyersFile, "utf8")).buyers ?? []) if (b.password?.length >= 6) secrets.add(b.password);
  } catch {
    throw new Error(`cannot read ${buyersFile}; not exported`);
  }
}
// PayPal's OAuth sends id:secret in base64; that form must not leak either.
if (all.PAYPAL_CLIENT_ID && all.PAYPAL_CLIENT_SECRET) secrets.add(Buffer.from(`${all.PAYPAL_CLIENT_ID}:${all.PAYPAL_CLIENT_SECRET}`).toString("base64"));

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
const home = os.homedir();
const user = os.userInfo().username;
let copied = 0;
try {
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith(".db") || f.endsWith("-shop.log")) continue;
    const from = path.join(src, f);
    if (f.endsWith(".png")) {
      fs.copyFileSync(from, path.join(dest, f));
    } else {
      const text = fs
        .readFileSync(from, "utf8")
        .split(home)
        .join("~")
        .replace(/\/(private\/)?tmp\/claude-\d+\/[^"\s\\)]*/g, "<tmp>")
        .replace(/\bsb-[a-z0-9]+@personal\.example\.com/g, "sandbox-buyer@personal.example.com")
        .replace(/\bsb-[a-z0-9]+@business\.example\.com/g, "sandbox-merchant@business.example.com")
        .split(user)
        .join("user");
      for (const s of secrets) if (text.includes(s)) throw new Error(`a secret was found in ${f}; nothing exported`);
      fs.writeFileSync(path.join(dest, f), text);
    }
    copied++;
  }
} catch (err) {
  fs.rmSync(dest, { recursive: true, force: true });
  console.error(err.message);
  process.exit(1);
}
console.log(`exported ${copied} files to runs/${name} (checked against ${secrets.size} secrets)`);
