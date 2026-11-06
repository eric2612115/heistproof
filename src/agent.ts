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

/** Keeps the agent inside its work folder and away from secrets. */
function guard(cwd: string): HookCallback {
  const secretFiles = [path.join(ROOT, ".env"), "/.ssh/", "/.aws/", "/.config/gcloud"];
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const text = JSON.stringify(input.tool_input ?? {});
    const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason } });
    if (secretFiles.some((f) => text.includes(f))) return deny("Secrets are not available to the coding agent. Read configuration from process.env in code; the harness supplies it at run time.");
    if (input.tool_name === "Bash") {
      const cmd = String((input.tool_input as { command?: string })?.command ?? "");
      if (/(^|[;&|]\s*)(env|printenv|set|export)\s*($|[;&|])/.test(cmd) || /\bprintenv\b/.test(cmd)) return deny("Listing the environment is not allowed; it holds the harness's keys.");
      if (/\bsudo\b|rm\s+-rf\s+[~/]|\bcurl\b[^|]*\|\s*(ba)?sh|git\s+push|git\s+commit/.test(cmd)) return deny("That command is not allowed here. Do not commit or push; the harness does.");
    }
    for (const key of ["file_path", "path", "notebook_path"]) {
      const p = (input.tool_input as Record<string, unknown>)?.[key];
      if (typeof p === "string" && path.isAbsolute(p) && !path.resolve(p).startsWith(cwd) && !path.resolve(p).includes(`${path.sep}.heistproof${path.sep}vendor${path.sep}`)) {
        return deny(`Stay inside the shop folder (${cwd}).`);
      }
    }
    return {};
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
      hooks: { PreToolUse: [{ hooks: [guard(path.resolve(cwd))] }] },
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
