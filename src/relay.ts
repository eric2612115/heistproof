import http from "node:http";
import crypto from "node:crypto";

/**
 * A local pass-through to an Anthropic-protocol model API that holds the real key, so the coding agent's process (and
 * every command it runs) never sees it: Claude Code gets this relay's address and a per-run token instead. Requests
 * without that token are refused, so other local programs cannot spend the key either; and only POST /v1/messages
 * (and its token count) is forwarded, so even the agent, which holds the token, can use the key for nothing but messages
 * during its own run.
 */
export type RelayOptions = {
  baseUrl: string;
  apiKey: string;
  /** How the upstream wants the key: Anthropic's x-api-key, or a bearer token (Meta, DeepSeek and most others). */
  keyHeader: "x-api-key" | "bearer";
  token?: string;
};

export const newToken = () => `hp-${crypto.randomBytes(24).toString("hex")}`;

/** True when a request carries the per-run token, as Claude Code sends it (bearer) or as an API key header. */
export function authorized(req: http.IncomingMessage, token: string): boolean {
  const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
  const key = req.headers["x-api-key"];
  const given = bearer ?? (typeof key === "string" ? key : "");
  return given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

/** The only routes the relay forwards. */
export const ALLOWED = new Set(["/v1/messages", "/v1/messages/count_tokens"]);

const HOP = new Set(["host", "connection", "content-length", "accept-encoding", "authorization", "x-api-key", "transfer-encoding", "keep-alive"]);

export async function startRelay(opts: RelayOptions): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const token = opts.token ?? newToken();
  const server = http.createServer(async (req, res) => {
    if (!authorized(req, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "This relay only serves the Heistproof run that started it." } }));
    }
    // Only what a coding agent needs from a model: messages (and counting their tokens). Nothing else reaches the
    // provider with the real key: not model listings, not files, not batches, not account endpoints.
    const route = new URL(req.url ?? "/", "http://relay").pathname;
    if (req.method !== "POST" || !ALLOWED.has(route)) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `This relay forwards only POST ${[...ALLOWED].join(" and ")}.` } }));
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(",") : v;
    if (opts.keyHeader === "x-api-key") headers["x-api-key"] = opts.apiKey;
    else headers.authorization = `Bearer ${opts.apiKey}`;
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let upstream: Response;
    try {
      upstream = await fetch(`${base}${req.url ?? "/"}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: abort.signal });
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `model API unreachable: ${(err as Error).message}` } }));
    }
    const out: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v;
    });
    res.writeHead(upstream.status, out);
    try {
      if (upstream.body) for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    } catch {
      /* the client went away */
    }
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, token, close: () => new Promise((r) => server.close(() => r())) };
}
