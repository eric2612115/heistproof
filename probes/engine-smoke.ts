// Smoke test for one model provider: a tiny Claude Code task (write a file, read it back) through openEngine().
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Run } from "../src/events.ts";
import { runCodingAgent } from "../src/agent.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-smoke-"));
fs.writeFileSync(path.join(dir, "price.js"), "export const priceCents = 4900;\n");
const run = new Run(`smoke-${Date.now()}`);
const r = await runCodingAgent({
  run, phase: "migrate", cwd: dir, maxTurns: 12, label: "smoke",
  prompt: "Read price.js. Then create amount.js that exports a function toPayPalAmount(cents) returning a dollars string with two decimals, and export const hoodie = toPayPalAmount(priceCents) importing priceCents from ./price.js. Then run `node -e \"import('./amount.js').then(m => console.log(m.hoodie))\"` and reply with exactly what it printed.",
});
console.log(JSON.stringify({ ok: r.ok, provider: r.provider, model: r.model, turns: r.turns, ms: r.durationMs, answer: r.summary.slice(0, 200), files: fs.readdirSync(dir) }));
