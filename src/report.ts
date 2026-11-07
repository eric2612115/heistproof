import type { Run } from "./events.ts";
import { verdictOf, type Round, type Verdict } from "./pipeline.ts";

const RESULT: Record<string, string> = { held: "Blocked", robbed: "ROBBED", skipped: "Not run", error: "Error" };

const HEADLINE: Record<Verdict, string> = {
  safe: "safe to ship",
  unsafe: "do not ship",
  incomplete: "incomplete; nothing got through, but not every robbery ran, so run it again",
};

/** The real purchase in one phrase, money first. */
function purchaseLine(r: Round): string {
  const p = r.prove;
  if (p.ok) return "paid and shipped once";
  if (p.captureStatus === "COMPLETED") return `PayPal took the money, but ${p.verdict.replace(/^Capture COMPLETED; /, "")}`;
  return `did not complete (${p.verdict})`;
}

function webhookLine(r: Round): string {
  if (r.webhook === "accepted" || r.webhook === "verified") return `PayPal's genuine PAYMENT.CAPTURE.COMPLETED event for this order was accepted (HTTP 2xx)${r.webhookEvent ? ` (event ${r.webhookEvent})` : ""}; whether the shop checks signatures is what the forged-webhook robbery tests`;
  if (r.webhook === "refused") return `PayPal's genuine PAYMENT.CAPTURE.COMPLETED event was REFUSED by the shop${r.webhookEvent ? ` (event ${r.webhookEvent})` : ""}`;
  return "PayPal did not deliver the PAYMENT.CAPTURE.COMPLETED event during this run";
}

const roundTitle = (n: number) => `Round ${n + 1}: ${n === 0 ? "first check" : `after fix ${n}`}`;

/** The evidence report that goes into the pull request: what was bought, what was attacked, and PayPal's own ids for each. */
export function renderReport(opts: { shopDir: string; rounds: Round[]; title?: string; offline?: boolean; agent?: { provider: string; model: string; skills: string[] } }): string {
  const last = opts.rounds.at(-1);
  const lines: string[] = [];
  lines.push(`# ${opts.title ?? "Heistproof evidence report"}`);
  lines.push("");
  if (last) {
    const robbed = last.attacks.filter((a) => a.verdict === "robbed").length;
    const held = last.attacks.filter((a) => a.verdict === "held").length;
    const thiefRobbed = last.thief?.plans.filter((p) => p.verdict === "robbed").length ?? 0;
    const thiefLine = last.thief?.ran ? ` The AI thief tried ${last.thief.plans.length} robberies of its own: ${thiefRobbed ? `${thiefRobbed} GOT THROUGH` : "none got through"}.` : "";
    const booksLine = last.books?.mismatches.length ? ` The shop's books do not match PayPal's (${last.books.mismatches.length} order${last.books.mismatches.length === 1 ? "" : "s"}).` : "";
    lines.push(`**Verdict: ${HEADLINE[verdictOf(last)]}.** ${held} of 10 scripted robberies blocked, ${robbed} robbed the shop${last.attacks.length < 10 ? ` (${last.attacks.length} ran)` : ""}.${thiefLine}${booksLine} Real purchase: ${purchaseLine(last)}. Tests: ${last.tests ? "pass" : "fail"}.`);
    lines.push("");
    lines.push(
      opts.offline
        ? "Offline run: PayPal was Heistproof's local stand-in (src/paypal/stand-in.ts), not the real sandbox. Order and capture ids are the stand-in's."
        : "All payments ran in the PayPal sandbox (no real money). Order and capture ids below are PayPal's own and can be looked up in the merchant's sandbox account.",
    );
    lines.push("");
  }
  if (opts.agent) {
    lines.push(`Coding agent: Claude Code (${opts.agent.provider} ${opts.agent.model})${opts.agent.skills.length ? ` with APIMatic's PayPal Context Plugin. Skills it loaded: ${opts.agent.skills.join(", ")}.` : ", with no PayPal skills (baseline)."}`);
    lines.push("");
  }
  for (const r of opts.rounds) {
    lines.push(`## ${roundTitle(r.round)}`);
    lines.push("");
    lines.push(`- Tests: ${r.tests ? "pass" : "fail"}`);
    lines.push(`- Buttons shown: ${Object.entries(r.prove.buttons).map(([k, v]) => `${k} ${v ? "yes" : "no"}`).join(", ")}${r.prove.payLaterMessage ? `; Pay Later message: "${r.prove.payLaterMessage}"` : ""}`);
    lines.push(`- Purchase: ${r.prove.verdict}`);
    if (r.prove.paypalOrderId) lines.push(`  - PayPal order \`${r.prove.paypalOrderId}\`, amount ${r.prove.paypalAmount ? `${r.prove.paypalAmount.currency} ${r.prove.paypalAmount.value}` : "?"} (bag total $${r.prove.bagTotal}), capture \`${r.prove.captureId ?? "none"}\` ${r.prove.captureStatus ?? ""}`);
    lines.push(`- Webhook: ${webhookLine(r)}`);
    if (r.books) lines.push(`- Books: ${!r.books.matched ? "not matched (the back office shows no PayPal ids)" : r.books.mismatches.length ? `DO NOT MATCH PayPal's records: ${r.books.mismatches.map((m) => `order ${m.order}: ${m.problem}`).join("; ")}` : `${r.books.paid} PayPal order(s) the shop calls paid, checked against PayPal's records: each backed by a completed capture that covers it, none shipped more than once${r.books.otherPaid ? ` (${r.books.otherPaid} paid another way, not PayPal's to check)` : ""}`}`);
    if (r.attacks.length) {
      lines.push("");
      lines.push("| Robbery | What it tries | Rules | Result | What happened |");
      lines.push("|---|---|---|---|---|");
      for (const a of r.attacks) {
        const note = a.untested?.length ? ` Not tested: ${a.untested.join("; ")}.` : "";
        lines.push(`| ${a.title} | ${a.what ?? ""} | ${a.rule.join(", ")} | ${RESULT[a.verdict] ?? a.verdict} | ${`${a.summary}${note}`.replace(/\|/g, "/")} |`);
      }
    }
    if (r.thief) {
      lines.push("");
      if (!r.thief.ran) lines.push(`AI thief: not run (${r.thief.reason ?? "no model key"}).`);
      else {
        const robbed = r.thief.plans.filter((p) => p.verdict === "robbed").length;
        lines.push(`AI thief (${r.thief.source === "replay" ? "plans replayed from an earlier run" : `${r.thief.provider} ${r.thief.model}`}): read only what any visitor can see and tried ${r.thief.plans.length} robberies of its own; ${robbed ? `${robbed} GOT THROUGH` : "none got through"}. The books against PayPal's records decide each one, not the model.`);
        lines.push("");
        lines.push("| AI thief's robbery | Its idea | Result | What happened |");
        lines.push("|---|---|---|---|");
        for (const p of r.thief.plans) lines.push(`| ${p.name.replace(/\|/g, "/")} | ${p.idea.replace(/\|/g, "/")} | ${p.verdict === "robbed" ? "ROBBED" : p.verdict === "held" ? "Blocked" : "Error"} | ${p.summary.replace(/\|/g, "/")} |`);
      }
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
