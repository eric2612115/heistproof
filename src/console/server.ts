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

function listRuns() {
  const out: Array<Record<string, unknown>> = [];
  for (const d of RUN_DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const id of fs.readdirSync(d)) {
      const dir = path.join(d, id);
      if (!fs.existsSync(path.join(dir, "events.jsonl"))) continue;
      const ev = events(dir);
      const start = ev.find((e) => e.type === "run.start");
      const done = ev.find((e) => e.type === "run.done");
      out.push({ id, recorded: d.endsWith(`${path.sep}runs`) && !d.includes(".heistproof"), mode: start?.mode ?? "", model: start?.model ?? "", started: ev[0]?.t, finished: done?.t ?? null, safe: done?.safe ?? null });
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
