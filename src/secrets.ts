const secrets = new Set<string>();

/** Values that must never reach a log, a report or a recorded run. */
export function registerSecret(value: string | undefined) {
  if (value && value.length >= 8) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out;
}

export const SECRET_NAMES = [
  "PAYPAL_CLIENT_SECRET",
  "SANDBOX_BUYER_PASSWORD",
  "ADMIN_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MODEL_API_KEY",
  "META_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY",
  "HEISTPROOF_API_KEY",
];
