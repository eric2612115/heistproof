// The export that turns a local run into committed evidence must refuse any file that carries a secret, wherever the
// secret came from: here only the process environment knows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");

function fakeRun(id: string, files: Record<string, string>) {
  const dir = path.join(ROOT, ".heistproof", "runs", id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
}

const exportRun = (id: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", "export-run.mjs"), id, id], { cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, encoding: "utf8" });

test("a secret known only to the environment stops the export, in plain or base64 form", () => {
  const id = `test-export-${process.pid}`;
  const secret = "EFAKE-only-in-the-environment-123456";
  const encoded = Buffer.from(`client-abc:${secret}`).toString("base64");
  for (const leak of [`{"auth":"${secret}"}`, `{"basic":"${encoded}"}`]) {
    const src = fakeRun(id, { "events.jsonl": `${leak}\n` });
    try {
      const r = exportRun(id, { PAYPAL_CLIENT_ID: "client-abc", PAYPAL_CLIENT_SECRET: secret, HEISTPROOF_SHARED_ENV: "/nonexistent" });
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, /secret was found in events\.jsonl/);
      assert.equal(fs.existsSync(path.join(ROOT, "runs", id)), false, "nothing is left behind");
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(path.join(ROOT, "runs", id), { recursive: true, force: true });
    }
  }
});

test("a clean run is exported with sandbox e-mails masked", () => {
  const id = `test-export-clean-${process.pid}`;
  const src = fakeRun(id, { "events.jsonl": '{"buyer":"sb-abc123@personal.example.com"}\n', "shop-round0.db": "binary", "round0-shop.log": "log" });
  try {
    const r = exportRun(id, { PAYPAL_CLIENT_SECRET: "EFAKE-not-in-the-run-1234567", HEISTPROOF_SHARED_ENV: "/nonexistent" });
    assert.equal(r.status, 0, r.stderr);
    const out = path.join(ROOT, "runs", id);
    assert.deepEqual(fs.readdirSync(out), ["events.jsonl"], "databases and shop logs stay behind");
    assert.match(fs.readFileSync(path.join(out, "events.jsonl"), "utf8"), /sandbox-buyer@personal\.example\.com/);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, "runs", id), { recursive: true, force: true });
  }
});
