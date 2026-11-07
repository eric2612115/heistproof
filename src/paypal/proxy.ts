import http from "node:http";
import { paypal } from "../config.ts";
import { redact } from "../secrets.ts";

export type Fault = { id: string; method: string; path: RegExp; mockResponse: Record<string, unknown>; times: number };
export type ProxiedCall = {
  at: string;
  method: string;
  path: string;
  status: number;
  debugId: string | null;
  injected?: string;
  requestBody?: unknown;
  responseBody?: unknown;
};

/**
 * Its address carries PayPal's sandbox host name as a path prefix (http://127.0.0.1:4418/api-m.sandbox.paypal.com), so
 * shop code that tells sandbox from live by looking at PAYPAL_API_BASE still sees the sandbox. The prefix is optional.
 */
export const SANDBOX_PREFIX = "/api-m.sandbox.paypal.com";

/**
 * Sits between the shop and PayPal (the sandbox, or the offline stand-in). It forwards every call unchanged, records it
 * as evidence, and when a fault is armed it adds PayPal's negative-testing header (PayPal-Mock-Response) to the matching call.
 */
export class PayPalProxy {
  readonly calls: ProxiedCall[] = [];
  private faults: Fault[] = [];
  private server: http.Server | null = null;

  arm(fault: Fault) {
    this.faults.push(fault);
  }

  disarm(id?: string) {
    this.faults = id ? this.faults.filter((f) => f.id !== id) : [];
  }

  async start(port: number): Promise<string> {
    const upstream = paypal.apiBase();
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks);
      const asked = req.url ?? "/";
      const path = asked.startsWith(`${SANDBOX_PREFIX}/`) ? asked.slice(SANDBOX_PREFIX.length) : asked;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (["host", "connection", "content-length", "accept-encoding"].includes(k) || v === undefined) continue;
        headers[k] = Array.isArray(v) ? v.join(",") : v;
      }
      const fault = this.faults.find((f) => f.method === req.method && f.path.test(path.split("?")[0]) && f.times > 0);
      if (fault) {
        fault.times--;
        headers["paypal-mock-response"] = JSON.stringify(fault.mockResponse);
      }
      try {
        const upstreamRes = await fetch(`${upstream}${path}`, { method: req.method, headers, body: raw.length ? raw : undefined });
        const body = Buffer.from(await upstreamRes.arrayBuffer());
        const call: ProxiedCall = {
          at: new Date().toISOString(),
          method: req.method ?? "GET",
          path: path.split("?")[0],
          status: upstreamRes.status,
          debugId: upstreamRes.headers.get("paypal-debug-id"),
          injected: fault ? JSON.stringify(fault.mockResponse) : undefined,
        };
        if (!path.startsWith("/v1/oauth2/token")) {
          call.requestBody = safeJson(raw.toString());
          call.responseBody = safeJson(body.toString());
        }
        this.calls.push(call);
        const out: Record<string, string> = {};
        upstreamRes.headers.forEach((v, k) => {
          if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v;
        });
        res.writeHead(upstreamRes.status, out);
        res.end(body);
      } catch (err) {
        this.calls.push({ at: new Date().toISOString(), method: req.method ?? "GET", path: path.split("?")[0], status: 0, debugId: null, responseBody: String(err) });
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "PROXY_ERROR", message: String(err) }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", resolve);
    });
    return `http://127.0.0.1:${port}${SANDBOX_PREFIX}`;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  since(index: number) {
    return this.calls.slice(index);
  }
}

function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(redact(text));
  } catch {
    return redact(text).slice(0, 2000);
  }
}
