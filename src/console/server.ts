// npx tsx src/console/server.ts  ->  http://127.0.0.1:4410
// Read-only console for Heistproof runs: live runs from .heistproof/runs and recorded runs from runs/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, PORTS } from "../config.ts";
import { events } from "../events.ts";

const STATIC = path.join(ROOT, "console");
const RUN_DIRS = [path.join(ROOT, "runs"), path.join(ROOT, ".heistproof", "runs")];
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".patch": "text/plain; charset=utf-8" };

function findRun(id: string): string | null {
  if (!/^[\w.-]+$/.test(id)) return null;
  for (const d of RUN_DIRS) if (fs.existsSync(path.join(d, id, "events.jsonl"))) return path.join(d, id);
  return null;
}

/* ---- Run summary for the index: what the console's run cards and headline need. Keep identical to summarize() in scripts/build-site.mjs. ---- */
const EXPECTED_ATTACKS = 10;
const SHOP_NAMES: Record<string, string> = { "fogline-express": "the Fogline shop", "fogline-naive": "a hand-written checkout", "fogline-afternoon": "a hand-written checkout", "fogline-after": "the checkout the agent wrote" };
function summarize(id: string, ev: ReturnType<typeof events>) {
  const start = (ev.find((e) => e.type === "run.start") ?? {}) as Record<string, unknown>;
  const done = ev.find((e) => e.type === "run.done") as Record<string, unknown> | undefined;
  let round = 0;
  const results = new Map<string, { verdict: string; round: number }>(); // attack id -> its latest result and the round it ran in
  const robbedEver = new Set<string>();
  let fixes = 0;
  let purchases = 0;
  for (const e of ev) {
    if (e.type === "attack.result") {
      results.set(String(e.id), { verdict: String(e.verdict), round });
      if (e.verdict === "robbed") robbedEver.add(String(e.id));
    } else if (e.type === "round.done") round++;
    else if (e.type === "agent.start" && String(e.label ?? "").startsWith("fix")) fixes++;
    else if (e.type === "prove.buttons" && String(e.label ?? "").startsWith("round")) purchases++;
  }
  const last = Math.max(0, ...[...results.values()].map((r) => r.round));
  const final = [...results.values()].filter((r) => r.round === last);
  const count = (v: string) => final.filter((r) => r.verdict === v).length;
  const mode = String(start.mode ?? "heistproof");
  const template = String(start.template ?? String(start.shop ?? "").split("/").pop() ?? "");
  const shop = SHOP_NAMES[template] ?? template ?? "the shop";
  const robbed = count("robbed");
  const title = mode === "check" ? `${shop[0].toUpperCase()}${shop.slice(1)}, checked as it is` : mode === "existing" ? `AI fixes ${shop}` : mode === "baseline" ? "AI adds PayPal without Heistproof" : `AI adds PayPal to ${shop}`;
  return {
    id,
    mode,
    template,
    offline: Boolean(start.offline),
    model: start.model ?? "",
    provider: start.provider ?? "",
    heistproofCommit: start.heistproofCommit ?? null,
    node: start.node ?? null,
    started: ev[0]?.t ?? null,
    finished: done?.t ?? null,
    verdict: done ? (done.verdict ?? (done.safe ? "safe" : "unsafe")) : null,
    safe: done?.safe ?? null,
    held: count("held"),
    robbed,
    skipped: count("skipped") + count("error"),
    ran: final.length,
    total: Math.max(EXPECTED_ATTACKS, results.size),
    robbedEver: robbedEver.size,
    rounds: done?.rounds ?? round + (results.size ? 1 : 0),
    fixes,
    purchases,
    branch: done?.branch ?? (done?.branchReady ? "local" : null),
    pr: typeof done?.pr === "string" && done.pr ? done.pr : null,
    title,
  };
}

function listRuns() {
  const out: Array<Record<string, unknown>> = [];
  for (const d of RUN_DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const id of fs.readdirSync(d)) {
      const dir = path.join(d, id);
      if (!fs.existsSync(path.join(dir, "events.jsonl"))) continue;
      const ev = events(dir);
      out.push({ ...summarize(id, ev), recorded: d.endsWith(`${path.sep}runs`) && !d.includes(".heistproof") });
    }
  }
  return out.sort((a, b) => String(b.started).localeCompare(String(a.started)));
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "runs" && parts.length === 2) return send(res, 200, JSON.stringify(listRuns()));
  if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
    const dir = findRun(parts[2]);
    if (!dir) return send(res, 404, JSON.stringify({ error: "no such run" }));
    if (parts.length === 3) {
      const files = fs.readdirSync(dir);
      return send(res, 200, JSON.stringify({ id: parts[2], events: events(dir), files }));
    }
    if (parts[3] === "file" && parts[4]) {
      const name = path.basename(decodeURIComponent(parts[4]));
      const file = path.join(dir, name);
      if (!fs.existsSync(file) || name.endsWith(".db")) return send(res, 404, "not found", "text/plain");
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(name)] ?? "text/plain; charset=utf-8");
    }
    if (parts[3] === "stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      let sent = Number(url.searchParams.get("from") ?? 0);
      const tick = () => {
        const ev = events(dir);
        for (; sent < ev.length; sent++) res.write(`data: ${JSON.stringify(ev[sent])}\n\n`);
      };
      tick();
      const timer = setInterval(tick, 700);
      req.on("close", () => clearInterval(timer));
      return;
    }
  }
  let file = path.join(STATIC, url.pathname === "/" || parts[0] === "run" ? "index.html" : url.pathname);
  if (!file.startsWith(STATIC) || !fs.existsSync(file)) file = path.join(STATIC, "index.html");
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "text/plain");
});

const port = Number(process.env.PORT ?? PORTS.console);
server.listen(port, "127.0.0.1", () => console.log(`Heistproof console on http://127.0.0.1:${port}`));
