import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { redact } from "./secrets.ts";
import { loadProfile, normalizeOrder, type ShopProfile, type ShopOrder } from "./shop-profile.ts";

export type ShopProcess = { url: string; adminKey: string; logs: string[]; profile: ShopProfile; stop: () => Promise<void> };

export async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use. Stop whatever runs there, or move all of Heistproof's ports with HEISTPROOF_PORT_BASE (default 4410), and try again.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

/** Starts the shop the way its heistproof.json says (Fogline's `node server.js` by default). The shop talks to PayPal through the harness proxy. */
export async function startShop(opts: { dir: string; port: number; dbFile: string; env: Record<string, string> }): Promise<ShopProcess> {
  await assertPortFree(opts.port);
  fs.mkdirSync(path.dirname(opts.dbFile), { recursive: true });
  const profile = loadProfile(opts.dir);
  const adminKey = `admin-${Math.random().toString(36).slice(2, 12)}`;
  const logs: string[] = [];
  // "node" runs on the same (patched) Node.js as Heistproof itself.
  const [cmd, ...args] = profile.start;
  const child: ChildProcess = spawn(cmd === "node" ? process.execPath : cmd, args, {
    cwd: opts.dir,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PORT: String(opts.port),
      HOST: "127.0.0.1",
      SHOP_DB: opts.dbFile,
      ADMIN_KEY: adminKey,
      NODE_ENV: "development",
      ...opts.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (buf: Buffer) => {
    for (const line of buf.toString().split("\n")) if (line.trim()) logs.push(redact(line).slice(0, 500));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const url = `http://127.0.0.1:${opts.port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    if (child.exitCode !== null) throw new Error(`shop exited (${child.exitCode}):\n${logs.slice(-20).join("\n")}`);
    try {
      up = (await fetch(`${url}${profile.health}`)).ok;
    } catch {
      /* starting */
    }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    });
  if (!up) {
    await stop();
    throw new Error(`the shop did not answer GET ${profile.health} within 30 s:\n${logs.slice(-20).join("\n")}`);
  }
  return { url, adminKey, logs, profile, stop };
}

/** The shop owner's view of every order, read from the back office with the admin key. */
export async function shopOrders(shop: ShopProcess): Promise<ShopOrder[]> {
  const r = await fetch(`${shop.url}${shop.profile.admin.orders}`, { headers: { [shop.profile.admin.keyHeader]: shop.adminKey } });
  if (!r.ok) throw new Error(`back office answered ${r.status}`);
  const body = (await r.json()) as unknown;
  const list = Array.isArray(body) ? body : Array.isArray((body as any)?.orders) ? (body as any).orders : [];
  return list.map((o: Record<string, any>) => normalizeOrder(o, shop.profile));
}

/** The back office page, as the shop owner opens it. */
export const backOfficeUrl = (shop: ShopProcess) => `${shop.url}${shop.profile.admin.page.replace("{key}", encodeURIComponent(shop.adminKey))}`;

/**
 * Waits until the shop's orders stop changing (no change for `quietMs`, at most `maxMs`), instead of a fixed sleep:
 * webhooks and background work land before an attack is judged.
 */
export async function settledOrders(shop: ShopProcess, quietMs = 1500, maxMs = 12_000): Promise<ShopOrder[]> {
  const started = Date.now();
  let last = JSON.stringify(await shopOrders(shop));
  let since = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 250));
    const now = JSON.stringify(await shopOrders(shop));
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) break;
  }
  return (JSON.parse(last) as ShopOrder[]);
}
