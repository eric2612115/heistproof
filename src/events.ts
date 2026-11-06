import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.ts";
import { redact } from "./secrets.ts";

export type Phase = "prepare" | "migrate" | "build" | "prove" | "attack" | "fix" | "ship";

export type RunEvent = {
  t: string;
  phase: Phase;
  type: string;
  [key: string]: unknown;
};

/** One run of Heistproof: an append-only event log plus an artifacts folder. */
export class Run {
  readonly id: string;
  readonly dir: string;
  private readonly log: string;
  private listeners: Array<(e: RunEvent) => void> = [];

  constructor(id?: string) {
    this.id = id ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    this.dir = path.join(ROOT, ".heistproof", "runs", this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = path.join(this.dir, "events.jsonl");
  }

  emit(phase: Phase, type: string, data: Record<string, unknown> = {}): RunEvent {
    const event: RunEvent = JSON.parse(redact(JSON.stringify({ t: new Date().toISOString(), phase, type, ...data })));
    fs.appendFileSync(this.log, JSON.stringify(event) + "\n");
    for (const l of this.listeners) l(event);
    return event;
  }

  onEvent(listener: (e: RunEvent) => void) {
    this.listeners.push(listener);
  }

  file(name: string) {
    return path.join(this.dir, name);
  }

  writeJson(name: string, data: unknown) {
    fs.writeFileSync(this.file(name), redact(JSON.stringify(data, null, 2)));
  }

  writeText(name: string, text: string) {
    fs.writeFileSync(this.file(name), redact(text));
  }
}

export function events(runDir: string): RunEvent[] {
  const file = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
