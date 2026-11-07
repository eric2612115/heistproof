// npm run demo
// The ten robberies against two checkouts, with Heistproof's offline PayPal stand-in: no PayPal account, no AI key,
// no network. A hand-written checkout (shops/fogline-afternoon) and the one Heistproof's coding agent wrote
// (examples/fogline-after). About a minute and a half; then `npm run console` shows both runs.
import path from "node:path";
import { ROOT } from "../config.ts";
import { checkOffline } from "../offline-check.ts";

const shops = [
  { dir: path.join(ROOT, "shops", "fogline-afternoon"), label: "Hand-written PayPal checkout (shops/fogline-afternoon)" },
  { dir: path.join(ROOT, "examples", "fogline-after"), label: "Checkout Heistproof's coding agent wrote (examples/fogline-after)" },
];

console.log("Heistproof demo: ten robberies, offline (PayPal is Heistproof's local stand-in, src/paypal/stand-in.ts).\n");
const rows: string[] = [];
try {
  for (const s of shops) {
    console.log(`Checking: ${s.label} ...`);
    // The AI thief joins when a model key is set; without one the demo still needs no keys at all.
    const { run, round, verdict } = await checkOffline(s.dir, { label: path.basename(s.dir), thief: {} });
    const robbed = round.attacks.filter((a) => a.verdict === "robbed");
    for (const a of round.attacks) console.log(`  ${a.verdict === "robbed" ? "ROBBED " : a.verdict === "held" ? "blocked" : a.verdict.padEnd(7)}  ${a.title}: ${a.summary.slice(0, 110)}`);
    if (round.thief?.ran) for (const p of round.thief.plans) console.log(`  ${p.verdict === "robbed" ? "ROBBED " : p.verdict === "held" ? "blocked" : "error  "}  AI thief: ${p.name}: ${p.summary.slice(0, 100)}`);
    else console.log(`  (AI thief not run: ${round.thief?.reason ?? "no model key"}; set any model key to let an AI invent robberies of its own)`);
    rows.push(`${String(robbed.length).padStart(2)} of 10 robbed   ${verdict === "safe" ? "SAFE TO SHIP" : verdict === "unsafe" ? "DO NOT SHIP " : "INCOMPLETE  "}  ${s.label}   (run ${run.id})`);
    console.log("");
  }
  console.log(rows.join("\n"));
  console.log("\nSee every step, screenshot and PayPal call: npm run console  (http://127.0.0.1:4410)");
} finally {
  setTimeout(() => process.exit(), 2000).unref();
}
