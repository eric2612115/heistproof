import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSecret, SECRET_NAMES } from "./secrets.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = readEnvFile(path.join(ROOT, ".env.local"));
// Optional: a settings file shared by several local projects (lowest priority), only when HEISTPROOF_SHARED_ENV names it.
const sharedPath = process.env.HEISTPROOF_SHARED_ENV ?? fileEnv.HEISTPROOF_SHARED_ENV;
const sharedEnv = sharedPath ? readEnvFile(sharedPath) : {};
export const env = (name: string, fallback?: string): string | undefined => process.env[name] ?? fileEnv[name] ?? sharedEnv[name] ?? fallback;
for (const name of SECRET_NAMES) registerSecret(env(name));
export const requireEnv = (name: string): string => {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set. Run: npm run setup`);
  return v;
};

/**
 * The sandbox buyer who approves purchases: SANDBOX_BUYER_EMAIL / SANDBOX_BUYER_PASSWORD, or a buyer from a shared
 * JSON file ({ buyers: [{ label, email, password }] }) read at run time only. Returns null when there is none.
 */
export function sandboxBuyer(): { email: string; password: string | null } | null {
  const email = env("SANDBOX_BUYER_EMAIL");
  const password = env("SANDBOX_BUYER_PASSWORD");
  if (email && password) return { email, password };
  const file = env("HEISTPROOF_BUYERS_FILE");
  if (file && fs.existsSync(file)) {
    try {
      const buyers = (JSON.parse(fs.readFileSync(file, "utf8")).buyers ?? []) as Array<{ email?: string; password?: string }>;
      const pick = buyers.find((b) => b.email === email && b.password) ?? (email ? undefined : buyers.find((b) => b.email && b.password));
      if (pick?.email && pick.password) {
        registerSecret(pick.password);
        return { email: pick.email, password: pick.password };
      }
    } catch {
      /* unreadable file: fall through */
    }
  }
  return email ? { email, password: null } : null;
}

/** Offline mode: for this whole process PayPal is Heistproof's local stand-in (src/paypal/stand-in.ts), not the sandbox. */
let offlineMode = false;
export function goOffline() {
  offlineMode = true;
}
export const isOffline = () => offlineMode;

/** The stand-in serving the current round: the shop and the harness talk to it instead of the sandbox. */
let standIn: { clientId: string; clientSecret: string; apiBase: string } | null = null;
export function usePayPalStandIn(target: { clientId: string; clientSecret: string; apiBase: string } | null) {
  standIn = target;
  if (target) registerSecret(target.clientSecret);
}

export const paypal = {
  clientId: () => standIn?.clientId ?? requireEnv("PAYPAL_CLIENT_ID"),
  clientSecret: () => standIn?.clientSecret ?? requireEnv("PAYPAL_CLIENT_SECRET"),
  apiBase: () => standIn?.apiBase ?? env("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com")!,
};

/** Waits meant for PayPal's sandbox; the local stand-in answers at once, so offline runs wait a quarter as long. */
export const pace = (ms: number) => (offlineMode ? Math.max(100, Math.round(ms / 4)) : ms);

// Every local port Heistproof uses, moved together with HEISTPROOF_PORT_BASE (default 4410).
const PORT_BASE = Number(env("HEISTPROOF_PORT_BASE", "4410"));
export const PORTS = {
  console: PORT_BASE,
  shop: PORT_BASE + 1,
  paypalStandIn: PORT_BASE + 6,
  webhookTap: PORT_BASE + 7,
  paypalProxy: PORT_BASE + 8,
  probe: PORT_BASE + 9,
};

/** The APIMatic Context Plugin for PayPal, pinned to the marketplace commit this project was built against. */
export const APIMATIC = {
  repo: "https://github.com/context-plugins/plugin-marketplace.git",
  commit: env("APIMATIC_MARKETPLACE_COMMIT", "7cbdf85dc95f09d9ede8c5d349506686684fa0d4")!,
  dir: path.join(ROOT, ".heistproof", "vendor", "plugin-marketplace"),
  pluginDir: () => path.join(ROOT, ".heistproof", "vendor", "plugin-marketplace", "plugins", "paypal"),
};

export const HEISTPROOF_PLUGIN_DIR = path.join(ROOT, "plugin");
