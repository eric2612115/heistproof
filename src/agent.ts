import fs from "node:fs";
import path from "node:path";
import { query, type HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { ROOT, HEISTPROOF_PLUGIN_DIR } from "./config.ts";
import { openEngine } from "./engine.ts";
import { ensureApimaticPlugin } from "./vendor.ts";
import type { Phase, Run } from "./events.ts";

export type AgentResult = {
  ok: boolean;
  summary: string;
  turns: number;
  durationMs: number;
  usage: Record<string, number>;
  skillsLoaded: string[];
  sessionId?: string;
  model: string;
  provider: string;
};

/** Documentation and package hosts the agent may fetch from (PayPal's docs and samples, APIMatic, GitHub, npm). */
const DOC_HOSTS = [/(^|\.)paypal\.com$/, /(^|\.)paypalobjects\.com$/, /(^|\.)github\.com$/, /(^|\.)githubusercontent\.com$/, /(^|\.)apimatic\.io$/, /(^|\.)npmjs\.(com|org)$/, /(^|\.)nodejs\.org$/, /(^|\.)mozilla\.org$/];
const docHost = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && DOC_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
};

// Top-level folders that hold other people's files and secrets; system tool folders are fine.
const PRIVATE_ROOTS = /^\/(Users|home|root|etc|var|private|Library|System|Volumes|opt|mnt|proc|sys|srv|media|Applications|cores|dev)(\/|$)/;
const SYSTEM_OK = /^\/(usr|bin|sbin|opt\/homebrew|dev\/(null|stdout|stderr|tty)|tmp|private\/tmp|var\/folders|private\/var\/folders)(\/|$)/;

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * The guard's decision for one tool call: a reason to refuse, or null to allow. Best effort, in layers: the agent's
 * environment holds no keys at all (see engine.ts), file tools stay inside the shop folder (the plugins' folders are
 * readable), shell commands may not name other folders, home, parent folders or the environment, and fetches go only
 * to documentation hosts. For strict isolation run Heistproof in a container.
 */
export function guardDecision(cwd: string, readable: string[], tool: string, input: Record<string, unknown>): string | null {
  const writes = ["Write", "Edit", "NotebookEdit"].includes(tool);
  for (const key of ["file_path", "path", "notebook_path"]) {
    const p = input?.[key];
    if (typeof p !== "string" || !p) continue;
    const abs = path.resolve(cwd, p.replace(/^~(?=\/|$)/, "/__home__"));
    if (inside(abs, cwd)) continue;
    if (!writes && readable.some((d) => inside(abs, d))) continue;
    return `Stay inside the shop folder (${cwd}).`;
  }
  if (tool === "WebFetch") {
    const url = String(input?.url ?? "");
    if (!docHost(url)) return "Fetching is limited to PayPal's, APIMatic's, GitHub's and npm's documentation over https.";
  }
  if (tool === "Bash") {
    const cmd = String(input?.command ?? "");
    if (/(^|[;&|(]\s*)(env|printenv|set|export|declare\s+-x|compgen\s+-v)\s*($|[;&|)])/.test(cmd) || /\bprintenv\b|\/proc\/[^\s]*environ|\bprocess\.env\b(?![.[])/.test(cmd)) return "Listing the environment is not allowed.";
    if (/\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+[~/]|\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b|\bgit\s+(push|commit)\b/.test(cmd)) return "That command is not allowed here. Do not commit or push; the harness does.";
    if (/(^|[\s;&|(])(nc|ncat|netcat|ssh|scp|sftp|telnet|ftp|rsync)(\s|$)/.test(cmd)) return "Network tools other than package managers and documentation fetches are not allowed.";
    if (/(^|[\s'"=:(])~(\/|$|[\s'"])|\$\{?HOME\}?|\$\{?CLAUDE_CONFIG_DIR\}?/.test(cmd)) return "Stay inside the shop folder: no home folder.";
    if (/(^|[\s'"=:(\/])\.\.(\/|$|[\s'"])/.test(cmd)) return "Stay inside the shop folder: no parent folders.";
    if (/(^|\s)\/(\s|$)/.test(cmd)) return "Stay inside the shop folder: not the root folder.";
    const bare = cmd.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, " ");
    for (const m of bare.matchAll(/(?:^|[\s'"=:(>])(\/[^\s'";|&)<>]+)/g)) {
      const p = m[1];
      if (inside(p, cwd) || SYSTEM_OK.test(p) || readable.some((d) => inside(p, d))) continue;
      if (PRIVATE_ROOTS.test(p)) return `Stay inside the shop folder (${cwd}): ${p} is outside it.`;
    }
    for (const m of cmd.matchAll(/\b(curl|wget|git\s+clone)\b[^;&|]*?\b(https?:\/\/[^\s'"]+)/g)) {
      if (!docHost(m[2])) return "Downloads are limited to PayPal's, APIMatic's, GitHub's and npm's hosts over https.";
    }
  }
  return null;
}

/** Keeps the agent inside its work folder and away from secrets (see guardDecision). */
function guard(cwd: string, readable: string[]): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = guardDecision(cwd, readable, input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
    if (!reason) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason } };
  };
}

function preview(value: unknown, max = 400): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/** Runs Claude Code headless in the shop folder, with APIMatic's PayPal Context Plugin and Heistproof's skills. */
export async function runCodingAgent(opts: { run: Run; phase: Phase; cwd: string; prompt: string; maxTurns?: number; label?: string; withContext?: boolean }): Promise<AgentResult> {
  const { run, phase, cwd, prompt } = opts;
  const engine = await openEngine();
  const apimaticDir = ensureApimaticPlugin();
  const configDir = path.join(ROOT, ".heistproof", "claude-home");
  fs.mkdirSync(configDir, { recursive: true });

  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    LANG: "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: "heistproof/0.1.0",
    ...engine.env,
  };

  run.emit(phase, "agent.start", { label: opts.label ?? phase, provider: engine.provider, providerLabel: engine.label, bridged: engine.bridged, model: engine.model, cwd, prompt, withContext: opts.withContext !== false });
  const started = Date.now();
  const skillsLoaded: string[] = [];
  let summary = "";
  let turns = 0;
  let usage: Record<string, number> = {};
  let sessionId: string | undefined;
  let ok = false;

  const q = query({
    prompt,
    options: {
      cwd,
      model: engine.model,
      env: childEnv,
      settingSources: [],
      // The baseline run gets no PayPal context at all, to measure what the context is worth.
      plugins: opts.withContext === false ? [] : [
        { type: "local", path: apimaticDir },
        { type: "local", path: HEISTPROOF_PLUGIN_DIR },
      ],
      skills: opts.withContext === false ? [] : "all",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Only what a migration needs: read, search, edit, run commands, load skills, keep a todo list.
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill", "TodoWrite", "WebFetch"],
      maxTurns: opts.maxTurns ?? 150,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          "You are Heistproof's migration agent. You change a real shop's code so it can take PayPal, Venmo and Pay Later safely. " +
          "Work only inside the current folder. Never print, read or ask for secrets. Do not run git commit or push.",
      },
      hooks: { PreToolUse: [{ hooks: [guard(path.resolve(cwd), [path.resolve(apimaticDir), path.resolve(HEISTPROOF_PLUGIN_DIR), configDir])] }] },
    },
  });

  try {
  try {
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      run.emit(phase, "agent.init", {
        model: msg.model,
        tools: msg.tools,
        plugins: (msg as { plugins?: unknown }).plugins,
        skills: (msg as { skills?: string[] }).skills,
      });
    } else if (msg.type === "assistant") {
      turns++;
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) run.emit(phase, "agent.text", { text: block.text });
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          if (block.name === "Skill" && typeof input?.skill === "string") skillsLoaded.push(input.skill);
          const file = typeof input?.file_path === "string" ? path.relative(cwd, input.file_path) || input.file_path : undefined;
          const compact = file
            ? { file_path: file, ...(typeof input.content === "string" ? { lines: input.content.split("\n").length } : {}), ...(typeof input.new_string === "string" ? { lines: input.new_string.split("\n").length } : {}) }
            : input;
          run.emit(phase, "agent.tool", { id: block.id, name: block.name, input: preview(compact, 1500), ...(file ? { file } : {}) });
        }
      }
    } else if (msg.type === "user") {
      const content = (msg.message as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === "tool_result") run.emit(phase, "agent.tool_result", { id: block.tool_use_id, error: Boolean(block.is_error), output: preview(block.content, 600) });
        }
      }
    } else if (msg.type === "result") {
      ok = msg.subtype === "success" && !(msg.subtype === "success" && /^(Failed to authenticate|API Error)/.test(msg.result) && msg.num_turns <= 1);
      summary = msg.subtype === "success" ? msg.result : `stopped: ${msg.subtype}`;
      usage = (msg.usage ?? {}) as unknown as Record<string, number>;
      run.emit(phase, "agent.done", { ok, subtype: msg.subtype, turns: msg.num_turns, durationMs: msg.duration_ms, usage, summary: preview(summary, 4000) });
    }
  }
  } catch (err) {
    // A refused key or an unreachable model ends the run with a readable reason instead of a crash.
    const reason = String((err as Error)?.message ?? err).split("\n")[0].slice(0, 300);
    summary = summary || `agent stopped: ${reason}`;
    ok = false;
    run.emit(phase, "agent.error", { reason });
  }
  } finally {
    await engine.close();
  }
  return { ok, summary, turns, durationMs: Date.now() - started, usage, skillsLoaded, sessionId, model: engine.model, provider: engine.label };
}
