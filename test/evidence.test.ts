// The README's evidence table comes from the recorded runs' own files; a number edited by hand fails here.
// Every recorded run must also come from the code in this repository: its source fingerprint is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceHash } from "../src/workspace.ts";

const ROOT = path.join(import.meta.dirname, "..");

test("the README's evidence table is exactly what the recorded runs say", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "evidence.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("every recorded run was made with the code in this repository (same source fingerprint, commit and Node recorded)", () => {
  const here = sourceHash();
  for (const id of fs.readdirSync(path.join(ROOT, "runs"))) {
    const file = path.join(ROOT, "runs", id, "events.jsonl");
    if (!fs.existsSync(file)) continue;
    const start = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === "run.start");
    assert.ok(start, `${id} has a run.start event`);
    assert.match(String(start.heistproofCommit), /^[0-9a-f]{7,}$/, `${id} records the commit it ran on`);
    assert.match(String(start.node), /^\d+\.\d+\.\d+$/, `${id} records the Node.js version`);
    assert.equal(start.sourceHash, here, `${id} was recorded with other code (source fingerprint ${start.sourceHash}, now ${here}); record it again`);
  }
});
