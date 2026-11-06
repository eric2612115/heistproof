import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./config.ts";

const sh = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();

export const WORK_ROOT = process.env.HEISTPROOF_WORK ?? path.join(os.homedir(), ".heistproof", "work");

/** Copies a sample shop into a fresh git repo outside this project, so the agent never sees Heistproof's own files. */
export function prepareShop(template: string, runId: string): string {
  const src = path.isAbsolute(template) ? template : path.join(ROOT, "shops", template);
  if (!fs.existsSync(path.join(src, "package.json"))) throw new Error(`no shop at ${src}`);
  const dest = path.join(WORK_ROOT, runId, "shop");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !/(^|\/)(node_modules|data|\.git)(\/|$)/.test(path.relative(src, p)) });
  sh("git", ["init", "-q", "-b", "main"], dest);
  sh("git", ["add", "-A"], dest);
  sh("git", ["-c", "user.name=Fogline", "-c", "user.email=dev@fogline.example", "commit", "-q", "-m", "Card-only checkout"], dest);
  sh("npm", ["install", "--no-audit", "--no-fund", "--silent"], dest);
  return dest;
}

export function diff(shopDir: string): { stat: string; patch: string } {
  sh("git", ["add", "-A"], shopDir);
  return {
    stat: sh("git", ["diff", "--cached", "--stat", "HEAD"], shopDir),
    patch: sh("git", ["diff", "--cached", "HEAD", "--", ".", ":(exclude)package-lock.json"], shopDir),
  };
}

export function runTests(shopDir: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: sh("npm", ["test", "--silent"], shopDir) };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return { ok: false, output: `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}` };
  }
}

export function commit(shopDir: string, message: string) {
  sh("git", ["add", "-A"], shopDir);
  sh("git", ["-c", "user.name=Heistproof", "-c", "user.email=heistproof@users.noreply.github.com", "commit", "-q", "-m", message], shopDir);
}

/** Installs a shop's dependencies if they are missing (for example a fresh clone of examples/). */
export function ensureInstalled(shopDir: string) {
  if (fs.existsSync(path.join(shopDir, "node_modules"))) return;
  sh("npm", [fs.existsSync(path.join(shopDir, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund", "--silent"], shopDir);
}
