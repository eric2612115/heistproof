// npm run doctor: checks everything a run needs and says what to fix. Prints no secrets.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env, ROOT, sandboxBuyer } from "../config.ts";
import { chooseEngine, PROVIDERS } from "../engine.ts";

type Check = { name: string; ok: boolean | null; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean | null, detail: string) => checks.push({ name, ok, detail });

/* Node.js: only lines that still get security fixes, at or above their latest security release.
   October 21, 2026 security release (TLS hostname-check bypasses, a Brotli decoder RCE, DNS truncation):
   https://nodejs.org/en/blog/vulnerability/october-2026-security-releases . Raise these after each new security release. */
const PATCHED: Record<number, [number, number, number]> = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
const NODE_ADVISORY = "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases";
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const floor = PATCHED[major];
const atLeast = (a: number[], b: number[]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];
add(
  "Node.js with current security fixes",
  floor ? atLeast([major, minor, patch], floor) : false,
  floor
    ? atLeast([major, minor, patch], floor)
      ? `found ${process.versions.node}`
      : `found ${process.versions.node}, which has known vulnerabilities; install ${floor.join(".")} or newer (${NODE_ADVISORY})`
    : `found ${process.versions.node}, a line without security support; use the latest 22, 24 (tested) or 26 release`,
);

try {
  const v = execFileSync("cloudflared", ["--version"], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim().split("\n")[0];
  add("cloudflared (public webhook address)", true, v);
} catch {
  add("cloudflared (public webhook address)", env("HEISTPROOF_PUBLIC_URL") ? true : false, env("HEISTPROOF_PUBLIC_URL") ? `using HEISTPROOF_PUBLIC_URL` : "not found: brew install cloudflared (macOS), or see README; webhook attacks need it");
}

const chromium = fs.existsSync(path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright")) || fs.existsSync(path.join(process.env.HOME ?? "", ".cache", "ms-playwright"));
add("Playwright Chromium", chromium, chromium ? "installed" : "run: npx playwright install chromium");

const clientId = env("PAYPAL_CLIENT_ID");
const secret = env("PAYPAL_CLIENT_SECRET");
if (!clientId || !secret) add("PayPal sandbox app", false, "set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (npm run setup)");
else {
  const res = await fetch(`${env("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com")}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).catch(() => null);
  const body = res ? ((await res.json().catch(() => ({}))) as { app_id?: string; error_description?: string }) : {};
  add("PayPal sandbox app", Boolean(res?.ok), res?.ok ? `OAuth OK (app ${body.app_id})` : `refused: ${body.error_description ?? "network error"}`);
}
const buyer = sandboxBuyer();
add("Sandbox buyer login", buyer?.password ? true : null, buyer?.password ? `${buyer.email} (automatic)` : "not set: you will log in to the PayPal window yourself (HEISTPROOF_HEADED=1)");

try {
  const c = chooseEngine();
  add("AI model for the coding agent", true, `${c.spec.label}${c.spec.protocol === "openai" ? " (through the built-in bridge)" : ""}, model ${c.model ?? `${c.spec.model} or newest available`}`);
} catch (err) {
  add("AI model for the coding agent", null, `${(err as Error).message.split(".")[0]}. Only needed to re-run the agent; recorded runs and attacks work without it.`);
}
add("APIMatic plugin cache", fs.existsSync(path.join(ROOT, ".heistproof", "vendor", "plugin-marketplace", "plugins", "paypal")) ? true : null, "fetched automatically on the first agent run");

for (const c of checks) console.log(`${c.ok === true ? "ok  " : c.ok === false ? "FIX " : "note"}  ${c.name}: ${c.detail}`);
console.log(`\nSupported model keys: ${PROVIDERS.map((p) => `${p.keys[0]} (${p.label})`).join(", ")}, or HEISTPROOF_BASE_URL + HEISTPROOF_API_KEY + HEISTPROOF_MODEL for any other endpoint.`);
process.exitCode = checks.some((c) => c.ok === false) ? 1 : 0;
