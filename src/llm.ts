import { chooseEngine } from "./engine.ts";

/**
 * One question to the configured model, outside Claude Code: used by the AI thief to invent robberies. Anthropic-protocol
 * providers (Anthropic, Meta, DeepSeek) get a Messages call; OpenAI-protocol ones a Chat Completions call.
 */
export async function askModel(system: string, user: string, maxTokens = 16_000): Promise<{ text: string; model: string; provider: string; stop: string | null }> {
  const { spec, key, model: forced } = chooseEngine();
  const model = forced ?? spec.model;
  const base = spec.base.replace(/\/+$/, "");
  if (spec.protocol === "anthropic") {
    const direct = spec.id === "anthropic";
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...(direct ? { "x-api-key": key } : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    const body = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) throw new Error(`${spec.label} answered ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const text = ((body.content ?? []) as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, model, provider: spec.label, stop: body.stop_reason ?? null };
  }
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`${spec.label} answered ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return { text: String(body.choices?.[0]?.message?.content ?? ""), model, provider: spec.label, stop: body.choices?.[0]?.finish_reason ?? null };
}

/** The first JSON object in a model's answer (models sometimes wrap it in prose or a code fence). */
export function firstJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [fenced, text].filter((x): x is string => Boolean(x))) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    // Walk to the matching brace, respecting strings.
    let depth = 0;
    let inString = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}
