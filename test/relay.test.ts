import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startRelay } from "../src/relay.ts";

/** A model API stand-in that records what reached it and streams two events back. */
async function upstream() {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    seen.push({ url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("event: message_start\ndata: {}\n\n");
    setTimeout(() => res.end("event: message_stop\ndata: {}\n\n"), 30);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, seen, close: () => server.close() };
}

test("the relay adds the real key upstream and the agent only ever holds a per-run token", async () => {
  const up = await upstream();
  const relay = await startRelay({ baseUrl: up.url, apiKey: "REAL-MODEL-KEY-123", keyHeader: "bearer" });
  try {
    assert.ok(!relay.token.includes("REAL-MODEL-KEY"));
    const res = await fetch(`${relay.url}/v1/messages?beta=true`, { method: "POST", headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: '{"model":"m"}' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /message_start[\s\S]*message_stop/);
    assert.equal(up.seen[0].url, "/v1/messages?beta=true");
    assert.equal(up.seen[0].headers.authorization, "Bearer REAL-MODEL-KEY-123");
    assert.equal(up.seen[0].headers["anthropic-version"], "2023-06-01");
    assert.equal(up.seen[0].body, '{"model":"m"}');
  } finally {
    await relay.close();
    up.close();
  }
});

test("Anthropic's own API gets the key as x-api-key, never the agent's token", async () => {
  const up = await upstream();
  const relay = await startRelay({ baseUrl: up.url, apiKey: "sk-ant-REAL", keyHeader: "x-api-key" });
  try {
    await (await fetch(`${relay.url}/v1/messages`, { method: "POST", headers: { "x-api-key": relay.token }, body: "{}" })).text();
    assert.equal(up.seen[0].headers["x-api-key"], "sk-ant-REAL");
    assert.equal(up.seen[0].headers.authorization, undefined);
  } finally {
    await relay.close();
    up.close();
  }
});

test("without the run's token the relay refuses and nothing reaches the model", async () => {
  const up = await upstream();
  const relay = await startRelay({ baseUrl: up.url, apiKey: "REAL", keyHeader: "bearer" });
  try {
    for (const headers of [{}, { authorization: "Bearer guess" }, { "x-api-key": "guess" }] as Array<Record<string, string>>) {
      const res = await fetch(`${relay.url}/v1/messages`, { method: "POST", headers, body: "{}" });
      assert.equal(res.status, 401);
    }
    assert.equal(up.seen.length, 0);
  } finally {
    await relay.close();
    up.close();
  }
});
