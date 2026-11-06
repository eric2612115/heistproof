// npm run doctor: checks everything a run needs and says what to fix. Prints no secrets.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env, ROOT } from "../config.ts";
import { chooseEngine, PROVIDERS } from "../engine.ts";

type Check = { name: string; ok: boolean | null; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean | null, detail: string) => checks.push({ name, ok, detail });

const [major, minor] = process.versions.node.split(".").map(Number);
add("Node.js 22.5 or newer", major > 22 || (major === 22 && minor >= 5), `found ${process.versions.node}`);

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
add("Sandbox buyer login", env("SANDBOX_BUYER_PASSWORD") ? true : null, env("SANDBOX_BUYER_PASSWORD") ? `${env("SANDBOX_BUYER_EMAIL")} (automatic)` : "not set: you will log in to the PayPal window yourself (HEISTPROOF_HEADED=1)");

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
