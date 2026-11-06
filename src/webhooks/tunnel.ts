import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.ts";
import { pp, WEBHOOK_EVENTS } from "../paypal/rest.ts";

/** A public HTTPS address for a local port, so PayPal's sandbox can deliver webhooks to this machine. */
export async function openTunnel(port: number): Promise<{ url: string; close: () => void }> {
  if (process.env.HEISTPROOF_PUBLIC_URL) return { url: process.env.HEISTPROOF_PUBLIC_URL.replace(/\/$/, ""), close: () => {} };
  const child: ChildProcess = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cloudflared did not print a tunnel URL within 45 s")), 45_000);
    const onData = (buf: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared could not start (${err.message}). Install it or set HEISTPROOF_PUBLIC_URL.`));
    });
  });
  // A fresh quick tunnel needs a moment before its hostname resolves.
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.status < 500) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { url, close: () => child.kill("SIGTERM") };
}

const STATE = path.join(ROOT, ".heistproof", "state.json");
const readState = (): Record<string, string> => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
const writeState = (s: Record<string, string>) => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
};

/** Points this app's single Heistproof webhook at the given URL (creates it the first time). Returns the webhook id. */
export async function ensureWebhook(url: string): Promise<string> {
  const state = readState();
  if (state.webhookId) {
    const r = await pp("PATCH", `/v1/notifications/webhooks/${state.webhookId}`, [{ op: "replace", path: "/url", value: url }]);
    if (r.status === 200) return state.webhookId;
  }
  // Only ever touch the webhook this checkout created (its id is in .heistproof/state.json). Other projects may
  // share the sandbox app; their webhooks are left alone.
  const created = await pp("POST", "/v1/notifications/webhooks", { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) });
  if (created.status === 201) {
    writeState({ ...state, webhookId: created.body.id });
    return created.body.id;
  }
  throw new Error(`Could not register a webhook on the sandbox app (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 300)}. PayPal allows 10 per app; remove unused ones in the developer dashboard.`);
}
