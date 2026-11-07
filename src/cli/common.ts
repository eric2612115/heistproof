import { spawnSync } from "node:child_process";
import { env, goOffline } from "../config.ts";
import { chooseEngine } from "../engine.ts";
import { closeBrowser } from "../prove.ts";
import type { Run } from "../events.ts";

/** --offline: PayPal is Heistproof's local stand-in for this whole run (no PayPal account, no tunnel, no network). */
export function offlineFlag(args: string[]): boolean {
  const offline = args.includes("--offline");
  if (offline) goOffline();
  return offline;
}

/** Everything a run needs that is missing, found before anything slow starts. */
export function preflight(needs: { paypal: boolean; model: boolean; tunnel: boolean }): string[] {
  const missing: string[] = [];
  if (needs.paypal) {
    for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) if (!env(k)) missing.push(`${k} is not set. Run npm run setup, or add --offline to use Heistproof's local PayPal stand-in.`);
  }
  if (needs.model) {
    try {
      chooseEngine();
    } catch (err) {
      missing.push((err as Error).message);
    }
  }
  if (needs.tunnel && !env("HEISTPROOF_PUBLIC_URL") && spawnSync("cloudflared", ["--version"]).error) {
    missing.push("cloudflared is not installed (macOS: brew install cloudflared). PayPal's sandbox needs it to deliver webhooks to this machine. Or set HEISTPROOF_PUBLIC_URL, or add --offline.");
  }
  return missing;
}

export function stopIfMissing(missing: string[]) {
  if (!missing.length) return;
  console.error(`Heistproof cannot start:\n- ${missing.join("\n- ")}\nNothing was run; exit code 2.`);
  process.exit(2);
}

/**
 * Runs a command. A crash means the check could not finish: it is recorded in the run and exits 2 (incomplete),
 * never 1 (unsafe), so a CI gate does not blame the shop for Heistproof's own failure.
 */
export async function main(run: Run, fn: () => Promise<number>) {
  try {
    process.exitCode = await fn();
  } catch (err) {
    const reason = String((err as Error)?.message ?? err).split("\n").slice(0, 3).join(" ").slice(0, 400);
    run.emit("ship", "run.done", { safe: false, verdict: "incomplete", error: reason });
    console.error(`\nHeistproof could not finish: ${reason}\nNothing was judged; exit code 2 (incomplete). Events: ${run.file("events.jsonl")}`);
    process.exitCode = 2;
  } finally {
    await closeBrowser().catch(() => {});
    // Servers a crash left open must not keep the process alive.
    setTimeout(() => process.exit(), 3000).unref();
  }
}
