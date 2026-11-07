import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./config.ts";

const sh = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();

export const WORK_ROOT = process.env.HEISTPROOF_WORK ?? path.join(os.homedir(), ".heistproof", "work");

/**
 * Prepares the shop in a work folder outside this project, so the agent never sees Heistproof's own files.
 * A shop that is its own git repository is cloned with its history, and keeps its GitHub origin so the run can open a
 * pull request (only committed files are used). A sample shop from shops/ is copied into a fresh repository.
 */
export function prepareShop(template: string, runId: string): string {
  const src = path.isAbsolute(template) ? template : path.join(ROOT, "shops", template);
  if (!fs.existsSync(path.join(src, "package.json"))) throw new Error(`no shop at ${src}`);
  const dest = path.join(WORK_ROOT, runId, "shop");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(path.join(src, ".git"))) {
    sh("git", ["clone", "-q", "--no-hardlinks", src, dest], path.dirname(dest));
    let origin = "";
    try {
      origin = sh("git", ["remote", "get-url", "origin"], src).trim();
    } catch {}
    if (origin) sh("git", ["remote", "set-url", "origin", origin], dest);
    else sh("git", ["remote", "remove", "origin"], dest);
  } else {
    fs.cpSync(src, dest, { recursive: true, filter: (p) => !/(^|\/)(node_modules|data|\.git)(\/|$)/.test(path.relative(src, p)) });
    sh("git", ["init", "-q", "-b", "main"], dest);
    sh("git", ["add", "-A"], dest);
    sh("git", ["-c", "user.name=Fogline", "-c", "user.email=dev@fogline.example", "commit", "-q", "-m", "Shop before Heistproof"], dest);
  }
  sh("npm", ["install", "--no-audit", "--no-fund", "--silent"], dest);
  return dest;
}

/** The Heistproof commit a run was made with, so a recorded run can be matched to the code. */
export function heistproofCommit(): string | null {
  try {
    return sh("git", ["rev-parse", "--short", "HEAD"], ROOT).trim();
  } catch {
    return null;
  }
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
  if (!sh("git", ["status", "--porcelain"], shopDir).trim()) return; // nothing changed since the last commit
  sh("git", ["-c", "user.name=Heistproof", "-c", "user.email=heistproof@users.noreply.github.com", "commit", "-q", "-m", message], shopDir);
}

/** Installs a shop's dependencies if they are missing (for example a fresh clone of examples/). */
export function ensureInstalled(shopDir: string) {
  if (fs.existsSync(path.join(shopDir, "node_modules"))) return;
  sh("npm", [fs.existsSync(path.join(shopDir, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund", "--silent"], shopDir);
}

/** Puts the shop's work on its own branch (commit it afterwards). */
export function switchBranch(shopDir: string, branch: string) {
  sh("git", ["checkout", "-q", "-B", branch], shopDir);
}

/** When the shop lives on GitHub, pushes the branch and opens a pull request whose body is the evidence report. */
export function openPullRequest(shopDir: string, branch: string, title: string, reportFile: string): string | null {
  let remote = "";
  try {
    remote = sh("git", ["remote", "get-url", "origin"], shopDir).trim();
  } catch {
    return null;
  }
  if (!/github\.com/.test(remote)) return null;
  sh("git", ["push", "-q", "-u", "origin", branch], shopDir);
  return sh("gh", ["pr", "create", "--head", branch, "--title", title, "--body-file", reportFile], shopDir).trim();
}
