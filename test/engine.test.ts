// The coding agent's environment (and so every command it runs) must never hold the model key: Claude Code gets a
// local relay or bridge address and a per-run token instead.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.HEISTPROOF_MODEL = "test-model";
const { openEngine } = await import("../src/engine.ts");

for (const [provider, keyName] of [["meta", "MODEL_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"], ["openai", "OPENAI_API_KEY"]] as const) {
  test(`${provider}: the agent gets a local address and a run token, never the key`, async () => {
    process.env.HEISTPROOF_PROVIDER = provider;
    process.env[keyName] = `${provider}-REAL-KEY-0123456789`;
    const engine = await openEngine();
    try {
      assert.ok(!JSON.stringify(engine.env).includes("REAL-KEY"), JSON.stringify(Object.keys(engine.env)));
      assert.match(engine.env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(engine.env.ANTHROPIC_AUTH_TOKEN, /^hp-[0-9a-f]{48}$/);
      assert.equal(engine.env.ANTHROPIC_API_KEY, undefined);
      const refused = await fetch(`${engine.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: "POST", body: "{}" });
      assert.equal(refused.status, 401, "another local program without the token is refused");
    } finally {
      await engine.close();
      delete process.env[keyName];
    }
  });
}
