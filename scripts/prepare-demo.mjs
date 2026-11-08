#!/usr/bin/env node
// Runs after npm install: installs the two demo shops' own dependencies (one of them builds APIMatic's PayPal SDK from
// GitHub), so the first `npm run demo` takes about a minute and a half instead of five. A failure here only warns:
// `npm run demo` installs whatever is still missing itself.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["shops/fogline-afternoon", "examples/fogline-after"]) {
  const at = path.join(root, dir);
  if (fs.existsSync(path.join(at, "node_modules"))) continue;
  try {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund", "--silent"], { cwd: at, stdio: "inherit", shell: process.platform === "win32" });
  } catch {
    console.warn(`Heistproof: could not install ${dir} now; npm run demo will try again.`);
  }
}
