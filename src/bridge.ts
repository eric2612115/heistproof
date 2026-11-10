// A local bridge that lets Claude Code (which speaks the Anthropic Messages protocol) drive any model behind an
// OpenAI-compatible Chat Completions endpoint: OpenAI, Gemini, OpenRouter, Groq, Together, Baseten and others.
import http from "node:http";
import { authorized, newToken } from "./relay.ts";
import { randomUUID } from "node:crypto";

type Block = Record<string, any>;
type AnthropicRequest = {
  model: string;
  max_tokens?: number;
  system?: string | Block[];
  messages: Array<{ role: "user" | "assistant"; content: string | Block[] }>;
  tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
  tool_choice?: { type: "auto" | "any" | "tool" | "none"; name?: string };
  stream?: boolean;
  stop_sequences?: string[];
};

export type BridgeOptions = { baseUrl: string; apiKey: string; maxOutputTokens?: number; extraHeaders?: Record<string, string>; token?: string };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: Block) => (b.type === "text" ? b.text : b.type === "image" ? "[image omitted]" : ""))
    .filter(Boolean)
    .join("\n");
};

function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "$schema" || k === "propertyNames") continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

/**
 * Provider data a tool call must carry back on the next turn, keyed by tool call id. Gemini 3 models return a
 * `thought_signature` in `extra_content.google` on each step's function call and refuse the next request (400 "Function
 * call is missing a thought_signature") unless it comes back unchanged. Claude Code keeps only id, name and input, so the
 * bridge remembers the rest.
 */
export type Signatures = Map<string, unknown>;
const isGemini = (upstream: string) => /generativelanguage\.googleapis\.com/.test(upstream);
// Google's documented placeholder for a function call whose signature is not known (for example, history from elsewhere).
const GEMINI_SKIP_SIGNATURE = { google: { thought_signature: "skip_thought_signature_validator" } };

/** Anthropic request -> Chat Completions request. */
export function toChat(req: AnthropicRequest, maxOutputTokens: number, upstream: string, signatures?: Signatures): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  const system = typeof req.system === "string" ? req.system : textOf(req.system ?? []);
  if (system) messages.push({ role: "system", content: system });
  for (const m of req.messages) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      const calls: Array<Record<string, unknown>> = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const extra = signatures?.get(b.id);
          return { id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }, ...(extra ? { extra_content: extra } : {}) };
        });
      // Gemini needs a signature on the first function call of every step; use the documented placeholder if none is known.
      if (calls.length && isGemini(upstream) && !calls.some((c) => c.extra_content)) calls[0].extra_content = GEMINI_SKIP_SIGNATURE;
      messages.push({ role: "assistant", content: text || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn: tool results become "tool" messages (in order), the rest stays a user message.
    for (const b of blocks.filter((x) => x.type === "tool_result")) {
      const body = textOf(b.content) || (b.is_error ? "error" : "ok");
      messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${body}` : body });
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text });
      if (b.type === "image" && b.source?.type === "base64") parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    }
    if (parts.length) messages.push({ role: "user", content: parts.every((p) => p.type === "text") ? parts.map((p) => p.text).join("\n") : parts });
  }
  const body: Record<string, unknown> = { model: req.model, messages, stream: Boolean(req.stream) };
  const limit = Math.min(req.max_tokens ?? maxOutputTokens, maxOutputTokens);
  if (/api\.openai\.com/.test(upstream)) body.max_completion_tokens = limit;
  else body.max_tokens = limit;
  if (req.stream) body.stream_options = { include_usage: true };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: (t.description ?? "").slice(0, 8000), parameters: cleanSchema(t.input_schema ?? { type: "object", properties: {} }) } }));
    const tc = req.tool_choice;
    if (tc?.type === "any") body.tool_choice = "required";
    else if (tc?.type === "tool" && tc.name) body.tool_choice = { type: "function", function: { name: tc.name } };
    else if (tc?.type === "none") body.tool_choice = "none";
  }
  if (req.stop_sequences?.length) body.stop = req.stop_sequences.slice(0, 4);
  return body;
}

const STOP: Record<string, string> = { stop: "end_turn", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "end_turn" };

/** Chat Completions response -> Anthropic message (non-streaming). */
export function fromChat(res: any, model: string, signatures?: Signatures): Record<string, unknown> {
  const choice = res?.choices?.[0] ?? {};
  const content: Block[] = [];
  if (choice.message?.content) content.push({ type: "text", text: String(choice.message.content) });
  for (const c of choice.message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(c.function?.arguments || "{}");
    } catch {
      input = { _raw: c.function?.arguments };
    }
    const id = c.id || `toolu_${randomUUID().slice(0, 12)}`;
    if (c.extra_content) signatures?.set(id, c.extra_content);
    content.push({ type: "tool_use", id, name: c.function?.name, input });
  }
  const hasTools = content.some((b) => b.type === "tool_use");
  return {
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: hasTools ? "tool_use" : STOP[choice.finish_reason] ?? "end_turn",
    stop_sequence: null,
    usage: { input_tokens: res?.usage?.prompt_tokens ?? 0, output_tokens: res?.usage?.completion_tokens ?? 0 },
  };
}

/** Streams Chat Completions chunks out as Anthropic server-sent events. */
async function pipeStream(upstream: Response, res: http.ServerResponse, model: string, signatures?: Signatures) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  send("message_start", { type: "message_start", message: { id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let index = -1;
  let open: "text" | "tool" | null = null;
  const toolBlocks = new Map<number, number>(); // upstream tool index -> our block index
  const toolIds = new Map<number, string>(); // upstream tool index -> the tool_use id we sent
  let finish: string | null = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let sawTool = false;
  const close = () => {
    if (open) send("content_block_stop", { type: "content_block_stop", index });
    open = null;
  };
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = upstream.body!.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        if (open !== "text") {
          close();
          index++;
          open = "text";
          send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
        }
        send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: delta.content } });
      }
      for (const tc of delta.tool_calls ?? []) {
        const key = typeof tc.index === "number" ? tc.index : toolBlocks.size;
        if (!toolBlocks.has(key)) {
          close();
          index++;
          open = "tool";
          sawTool = true;
          toolBlocks.set(key, index);
          const id = tc.id || `toolu_${randomUUID().slice(0, 12)}`;
          toolIds.set(key, id);
          send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id, name: tc.function?.name ?? "", input: {} } });
        }
        if (tc.extra_content && toolIds.has(key)) signatures?.set(toolIds.get(key)!, tc.extra_content);
        const args = tc.function?.arguments;
        if (args) send("content_block_delta", { type: "content_block_delta", index: toolBlocks.get(key), delta: { type: "input_json_delta", partial_json: args } });
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  close();
  send("message_delta", { type: "message_delta", delta: { stop_reason: sawTool ? "tool_use" : STOP[finish ?? "stop"] ?? "end_turn", stop_sequence: null }, usage });
  send("message_stop", { type: "message_stop" });
  res.end();
}

/** Starts the bridge on a free local port; Claude Code is pointed at it with ANTHROPIC_BASE_URL. */
export async function startBridge(opts: BridgeOptions): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const maxOut = opts.maxOutputTokens ?? 16_000;
  // Only the run that started the bridge may use it (Claude Code sends the token as its API key).
  const token = opts.token ?? newToken();
  const signatures: Signatures = new Map();
  const server = http.createServer(async (req, res) => {
    if (!authorized(req, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "This bridge only serves the Heistproof run that started it." } }));
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = (req.url ?? "").split("?")[0];
    const fail = (status: number, message: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error", message } }));
    };
    if (req.method !== "POST") return fail(404, "not found");
    let body: AnthropicRequest;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return fail(400, "invalid JSON");
    }
    if (path.endsWith("/count_tokens")) {
      const chars = JSON.stringify(body.messages ?? []).length + JSON.stringify(body.system ?? "").length + JSON.stringify(body.tools ?? []).length;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: Math.ceil(chars / 4) }));
    }
    if (!path.endsWith("/messages")) return fail(404, `unsupported path ${path}`);
    const chat = toChat(body, maxOut, base, signatures);
    let upstream: Response;
    try {
      upstream = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", ...(opts.extraHeaders ?? {}) },
        body: JSON.stringify(chat),
      });
    } catch (err) {
      return fail(502, `upstream unreachable: ${(err as Error).message}`);
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      return fail(upstream.status, `upstream ${upstream.status}: ${text.slice(0, 800)}`);
    }
    if (body.stream) return pipeStream(upstream, res, body.model, signatures);
    const json = await upstream.json();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(fromChat(json, body.model, signatures)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, token, close: () => new Promise((r) => server.close(() => r())) };
}
