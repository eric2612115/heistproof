import type { Run } from "./events.ts";
import type { Round } from "./pipeline.ts";

const icon = (v: string) => (v === "held" ? "HELD" : v === "robbed" ? "ROBBED" : v === "skipped" ? "skipped" : "error");

/** The evidence report that goes into the pull request: what was bought, what was attacked, and PayPal's own ids for each. */
export function renderReport(opts: { shopDir: string; rounds: Round[]; title?: string; agent?: { provider: string; model: string; skills: string[] } }): string {
  const last = opts.rounds.at(-1);
  const lines: string[] = [];
  lines.push(`# ${opts.title ?? "Heistproof evidence report"}`);
  lines.push("");
  if (last) {
    const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
    const held = last.attacks.filter((a) => a.verdict === "held").length;
    const ship = last.tests && last.prove.ok && last.webhookVerified && robbed === 0 && last.attacks.every((a) => a.verdict !== "error");
    lines.push(`**Verdict: ${ship ? "safe to ship" : "do not ship"}.** ${held} of ${last.attacks.length} attacks held, ${robbed} robbed the shop. Real sandbox purchase: ${last.prove.ok ? "paid and shipped once" : "failed"}. Signed webhook: ${last.webhookVerified ? "verified" : "not verified"}. Tests: ${last.tests ? "pass" : "fail"}.`);
    lines.push("");
    lines.push("All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.");
    lines.push("");
  }
  if (opts.agent) {
    lines.push(`Coding agent: Claude Code (${opts.agent.provider} ${opts.agent.model}) with APIMatic's PayPal Context Plugin. Skills it loaded: ${opts.agent.skills.join(", ") || "none"}.`);
    lines.push("");
  }
  for (const r of opts.rounds) {
    lines.push(`## Round ${r.round}${r.round === 0 ? ": first check" : ": after fixes"}`);
    lines.push("");
    lines.push(`- Tests: ${r.tests ? "pass" : "fail"}`);
    lines.push(`- Buttons shown: ${Object.entries(r.prove.buttons).map(([k, v]) => `${k} ${v ? "yes" : "no"}`).join(", ")}${r.prove.payLaterMessage ? `; Pay Later message: "${r.prove.payLaterMessage}"` : ""}`);
    lines.push(`- Purchase: ${r.prove.verdict}`);
    if (r.prove.paypalOrderId) lines.push(`  - PayPal order \`${r.prove.paypalOrderId}\`, amount ${r.prove.paypalAmount ? `${r.prove.paypalAmount.currency} ${r.prove.paypalAmount.value}` : "?"} (bag total $${r.prove.bagTotal}), capture \`${r.prove.captureId ?? "none"}\` ${r.prove.captureStatus ?? ""}`);
    lines.push(`- Signed PAYMENT.CAPTURE.COMPLETED webhook accepted: ${r.webhookVerified ? "yes" : "no"}`);
    if (r.attacks.length) {
      lines.push("");
      lines.push("| Attack | Rules | Result | What happened |");
      lines.push("|---|---|---|---|");
      for (const a of r.attacks) lines.push(`| ${a.title} | ${a.rule.join(", ")} | ${icon(a.verdict)} | ${a.summary.replace(/\|/g, "/")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReport(run: Run, opts: Parameters<typeof renderReport>[0]): string {
  const md = renderReport(opts);
  run.writeText("REPORT.md", md);
  run.writeJson("rounds.json", opts.rounds);
  return run.file("REPORT.md");
}
