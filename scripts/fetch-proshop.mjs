#!/usr/bin/env node
// npm run fetch:proshop
// Fetches ProShop v2 (https://github.com/bradtraversy/proshop-v2, MIT), a widely copied MERN course shop that takes
// PayPal, as it was before its public payment fixes (pull request #15, base 68ceb22), adds Heistproof's adapter
// (shops/proshop-v2) and builds it. ProShop's own code is not changed.
// Then, with MongoDB running (brew services start mongodb-community) and a PayPal sandbox app set up:
//   npm run check -- .heistproof/third-party/proshop-v2-before
// HEISTPROOF_THIRD_PARTY moves the folder the copy goes into.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(process.env.HEISTPROOF_THIRD_PARTY ?? path.join(root, ".heistproof", "third-party"));
const REPO = "https://github.com/bradtraversy/proshop-v2";
const VERSIONS = {
  before: "68ceb22cb3190e175bd0eae1c06af37fe98e7984", // the base of pull request #15 (July 2023): as taught, before the payment fixes
};
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

fs.mkdirSync(base, { recursive: true });
const src = path.join(base, "proshop-v2-src");
if (!fs.existsSync(path.join(src, ".git"))) run("git", ["clone", "--quiet", REPO, src], base);
for (const [name, commit] of Object.entries(VERSIONS)) {
  const dir = path.join(base, `proshop-v2-${name}`);
  if (!fs.existsSync(dir)) run("git", ["worktree", "add", "--quiet", "--detach", dir, commit], src);
  for (const f of ["heistproof.json", "heistproof-adapter.mjs"]) fs.copyFileSync(path.join(root, "shops", "proshop-v2", f), path.join(dir, f));
  if (!fs.existsSync(path.join(dir, "frontend", "build", "index.html"))) run("npm", ["run", "build"], dir);
  console.log(`ProShop v2 (${name}, ${commit.slice(0, 7)}) ready: ${path.relative(root, dir)}`);
}
