import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { redact } from "./secrets.ts";

export type ShopProcess = { url: string; adminKey: string; logs: string[]; stop: () => Promise<void> };

/** Starts the shop with the PayPal sandbox settings. The shop talks to PayPal through the harness proxy. */
export async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use. Stop whatever runs there (or set another port) and try again.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

export async function startShop(opts: { dir: string; port: number; dbFile: string; env: Record<string, string> }): Promise<ShopProcess> {
  await assertPortFree(opts.port);
  fs.mkdirSync(path.dirname(opts.dbFile), { recursive: true });
  const adminKey = `admin-${Math.random().toString(36).slice(2, 12)}`;
  const logs: string[] = [];
  const child: ChildProcess = spawn(process.execPath, ["server.js"], {
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
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`shop exited (${child.exitCode}):\n${logs.slice(-20).join("\n")}`);
    try {
      const r = await fetch(`${url}/api/products`);
      if (r.ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    adminKey,
    logs,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 3000);
      }),
  };
}

export async function shopOrders(shop: ShopProcess): Promise<any[]> {
  const r = await fetch(`${shop.url}/api/admin/orders`, { headers: { "x-admin-key": shop.adminKey } });
  if (!r.ok) throw new Error(`back office answered ${r.status}`);
  return (await r.json()) as any[];
}
