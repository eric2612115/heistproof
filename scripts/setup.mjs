#!/usr/bin/env node
// npm run setup [-- paypal | buyer | ai]
// Asks for each setting, hides secrets while you type, checks what it can, and saves everything to .env.local
// (git-ignored, readable only by you). Press Enter to keep a value that is already saved.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env.local");
const env = Object.fromEntries(
  (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const save = () => {
  fs.writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function paypalOAuth(id, secret) {
  const r = await fetch(`${env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com"}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).catch(() => null);
  const body = r ? await r.json().catch(() => ({})) : {};
  return r?.ok ? { ok: true, app: body.app_id } : { ok: false, reason: body.error_description ?? "network error" };
}

async function paypalSection() {
  console.log("\nPayPal sandbox app (developer.paypal.com > Apps & Credentials > Sandbox > your app)");
  const id = await ask(`  Client ID${env.PAYPAL_CLIENT_ID ? ` [${env.PAYPAL_CLIENT_ID.slice(0, 10)}..., Enter keeps it]` : ""}: `);
  if (id) env.PAYPAL_CLIENT_ID = id;
  for (let attempt = 0; attempt < 3; attempt++) {
    const secret = await ask(`  Secret (hidden)${env.PAYPAL_CLIENT_SECRET ? " [Enter keeps the saved one]" : ""}: `, { hidden: true });
    if (secret && secret === env.PAYPAL_CLIENT_ID) {
      console.log("  That is the Client ID. Copy the Secret (the second value on the app page) and paste again.");
      continue;
    }
    const candidate = secret || env.PAYPAL_CLIENT_SECRET;
    if (!candidate) continue;
    const check = await paypalOAuth(env.PAYPAL_CLIENT_ID, candidate);
    if (check.ok) {
      env.PAYPAL_CLIENT_SECRET = candidate;
      save();
      console.log(`  PayPal OK: sandbox app ${check.app} accepted it.`);
      return;
    }
    console.log(`  PayPal refused it (${check.reason}). Paste the Secret of the same app again.`);
  }
}

async function buyerSection() {
  console.log("\nSandbox buyer (developer.paypal.com > Testing Tools > Sandbox Accounts > a Personal account > View/Edit account)");
  console.log("  Optional: with it, the browser agent logs in by itself. Without it, run with HEISTPROOF_HEADED=1 and log in when the PayPal window opens.");
  const email = await ask(`  Buyer email${env.SANDBOX_BUYER_EMAIL ? ` [${env.SANDBOX_BUYER_EMAIL}, Enter keeps it]` : ""}: `);
  if (email) env.SANDBOX_BUYER_EMAIL = email;
  const pw = await ask(`  Buyer password (hidden)${env.SANDBOX_BUYER_PASSWORD ? " [Enter keeps the saved one]" : ""}: `, { hidden: true });
  if (pw) env.SANDBOX_BUYER_PASSWORD = pw;
  save();
  console.log(pw ? `  Saved (${pw.length} characters). The first purchase will show whether PayPal accepts it.` : "  Unchanged.");
}

const PREFIXES = [
  [/^sk-ant-/, "ANTHROPIC_API_KEY", "Anthropic"],
  [/^sk-or-/, "OPENROUTER_API_KEY", "OpenRouter"],
  [/^AIza/, "GEMINI_API_KEY", "Google Gemini"],
  [/^LLM\|/, "MODEL_API_KEY", "Meta Model API"],
  [/^sk-(proj-|svcacct-)/, "OPENAI_API_KEY", "OpenAI"],
];
async function aiSection() {
  console.log("\nAI model for the coding agent (optional: recorded runs and the attacks need none)");
  console.log("  Paste one key from Anthropic, OpenAI, Google Gemini, Meta Model API, OpenRouter or DeepSeek.");
  const key = await ask("  API key (hidden, Enter skips): ", { hidden: true });
  if (!key) return console.log("  Skipped.");
  let match = PREFIXES.find(([re]) => re.test(key));
  if (!match) {
    const pick = await ask("  Which provider is it? 1 OpenAI, 2 DeepSeek, 3 Meta Model API, 4 other: ");
    match = { 1: [null, "OPENAI_API_KEY", "OpenAI"], 2: [null, "DEEPSEEK_API_KEY", "DeepSeek"], 3: [null, "MODEL_API_KEY", "Meta Model API"] }[pick];
    if (!match) {
      env.HEISTPROOF_API_KEY = key;
      env.HEISTPROOF_BASE_URL = await ask("  Base URL of its OpenAI-compatible API (for example https://api.groq.com/openai/v1): ");
      env.HEISTPROOF_MODEL = await ask("  Model id: ");
      save();
      return console.log("  Saved as a custom endpoint.");
    }
  }
  env[match[1]] = key;
  delete env.HEISTPROOF_PROVIDER;
  save();
  console.log(`  Saved as ${match[2]} (${match[1]}). npm run doctor shows which model will be used.`);
}

const only = process.argv[2];
if (!only || only === "paypal") await paypalSection();
if (!only || only === "buyer") await buyerSection();
if (!only || only === "ai") await aiSection();
console.log("\nDone. Next: npm run doctor");
