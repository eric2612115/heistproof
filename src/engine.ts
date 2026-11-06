// Which model drives the coding agent. The agent harness is always Claude Code (with APIMatic's PayPal Context
// Plugin); the model behind it is whatever key you have. Anthropic-protocol providers are called directly;
// OpenAI-protocol providers go through the local bridge in bridge.ts.
import { env } from "./config.ts";
import { startBridge } from "./bridge.ts";

export type ProviderSpec = {
  id: string;
  label: string;
  keys: string[];
  protocol: "anthropic" | "openai";
  base: string;
  model: string;
  smallModel?: string;
  /** Picks the newest model of this family from the provider's /models list when no model is set. */
  family?: RegExp;
};

export const PROVIDERS: ProviderSpec[] = [
  { id: "anthropic", label: "Anthropic", keys: ["ANTHROPIC_API_KEY"], protocol: "anthropic", base: "https://api.anthropic.com", model: "claude-sonnet-5-5", smallModel: "claude-haiku-5-5" },
  { id: "openai", label: "OpenAI", keys: ["OPENAI_API_KEY"], protocol: "openai", base: "https://api.openai.com/v1", model: "gpt-5", family: /^gpt-(\d+(?:\.\d+)?)$/ },
  { id: "gemini", label: "Google Gemini", keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], protocol: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", family: /^(?:models\/)?gemini-(\d+(?:\.\d+)?)-pro$/ },
  { id: "meta", label: "Meta Model API", keys: ["MODEL_API_KEY", "META_API_KEY"], protocol: "anthropic", base: "https://api.meta.ai", model: "muse-wonder-1.0", smallModel: "muse-spark-1.3" },
  { id: "openrouter", label: "OpenRouter", keys: ["OPENROUTER_API_KEY"], protocol: "openai", base: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5" },
  { id: "deepseek", label: "DeepSeek", keys: ["DEEPSEEK_API_KEY"], protocol: "anthropic", base: "https://api.deepseek.com/anthropic", model: "deepseek-chat" },
];

export type EngineChoice = { spec: ProviderSpec; key: string; model: string | null };

/** Resolves the provider from the environment: HEISTPROOF_PROVIDER, a custom endpoint, or the first key found. */
export function chooseEngine(): EngineChoice {
  const customBase = env("HEISTPROOF_BASE_URL");
  if (customBase) {
    const key = env("HEISTPROOF_API_KEY") ?? "";
    const protocol = (env("HEISTPROOF_PROTOCOL", "openai") as "anthropic" | "openai") ?? "openai";
    const model = env("HEISTPROOF_MODEL");
    if (!model) throw new Error("HEISTPROOF_BASE_URL is set, so HEISTPROOF_MODEL must name the model.");
    return { spec: { id: "custom", label: new URL(customBase).host, keys: ["HEISTPROOF_API_KEY"], protocol, base: customBase, model }, key, model };
  }
  const forced = env("HEISTPROOF_PROVIDER");
  const candidates = forced ? PROVIDERS.filter((p) => p.id === forced) : PROVIDERS;
  if (forced && !candidates.length) throw new Error(`Unknown HEISTPROOF_PROVIDER "${forced}". Use one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`);
  for (const spec of candidates) {
    const key = spec.keys.map((k) => env(k)).find(Boolean);
    if (key) return { spec, key, model: env("HEISTPROOF_MODEL") ?? null };
  }
  throw new Error(`No model key found. Put one of ${PROVIDERS.flatMap((p) => p.keys).join(", ")} in .env.local (or set HEISTPROOF_BASE_URL, HEISTPROOF_API_KEY and HEISTPROOF_MODEL for any other endpoint).`);
}

async function newestOf(spec: ProviderSpec, key: string): Promise<string | null> {
  if (!spec.family) return null;
  try {
    const r = await fetch(`${spec.base.replace(/\/+$/, "")}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: Array<{ id: string }> };
    const matches = (body.data ?? [])
      .map((m) => ({ id: m.id, v: Number(spec.family!.exec(m.id)?.[1]) }))
      .filter((m) => Number.isFinite(m.v))
      .sort((a, b) => b.v - a.v);
    return matches[0]?.id.replace(/^models\//, "") ?? null;
  } catch {
    return null;
  }
}

export type Engine = { provider: string; label: string; protocol: string; model: string; bridged: boolean; env: Record<string, string>; close: () => Promise<void> };

/** Everything Claude Code needs to talk to the chosen model. The returned env holds the key: never log it. */
export async function openEngine(): Promise<Engine> {
  const { spec, key, model: forcedModel } = chooseEngine();
  const model = forcedModel ?? (await newestOf(spec, key)) ?? spec.model;
  const small = env("HEISTPROOF_SMALL_MODEL") ?? spec.smallModel ?? model;
  const models = { ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: small };
  if (spec.protocol === "anthropic") {
    const direct = spec.id === "anthropic" && !env("HEISTPROOF_BASE_URL");
    return {
      provider: spec.id,
      label: spec.label,
      protocol: "anthropic",
      model,
      bridged: false,
      env: direct ? { ANTHROPIC_API_KEY: key, ...models } : { ANTHROPIC_BASE_URL: spec.base, ANTHROPIC_AUTH_TOKEN: key, ...models },
      close: async () => {},
    };
  }
  const bridge = await startBridge({ baseUrl: spec.base, apiKey: key, maxOutputTokens: Number(env("HEISTPROOF_MAX_OUTPUT_TOKENS", "16000")) });
  return {
    provider: spec.id,
    label: spec.label,
    protocol: "openai",
    model,
    bridged: true,
    env: { ANTHROPIC_BASE_URL: bridge.url, ANTHROPIC_AUTH_TOKEN: "heistproof-bridge", ...models },
    close: bridge.close,
  };
}
