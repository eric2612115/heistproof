// The README's evidence table comes from the recorded runs' own files; a number edited by hand fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");

test("the README's evidence table is exactly what the recorded runs say", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "evidence.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
