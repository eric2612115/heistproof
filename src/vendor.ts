import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { APIMATIC } from "./config.ts";

const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

/** Fetch APIMatic's Context Plugin marketplace (only the PayPal plugin) at the pinned commit. */
export function ensureApimaticPlugin(): string {
  const pluginDir = APIMATIC.pluginDir();
  if (fs.existsSync(`${pluginDir}/.claude-plugin/plugin.json`)) {
    const head = git(["rev-parse", "HEAD"], APIMATIC.dir);
    if (head === APIMATIC.commit) return pluginDir;
  }
  fs.rmSync(APIMATIC.dir, { recursive: true, force: true });
  fs.mkdirSync(APIMATIC.dir, { recursive: true });
  git(["clone", "--filter=blob:none", "--no-checkout", APIMATIC.repo, APIMATIC.dir]);
  git(["sparse-checkout", "set", "--no-cone", "/.claude-plugin/", "/plugins/paypal/", "/LICENSE.txt"], APIMATIC.dir);
  git(["checkout", "--quiet", APIMATIC.commit], APIMATIC.dir);
  if (!fs.existsSync(`${pluginDir}/.claude-plugin/plugin.json`)) throw new Error("APIMatic PayPal plugin not found after checkout");
  return pluginDir;
}
