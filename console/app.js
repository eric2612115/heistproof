// Heistproof console: renders recorded (or live) runs for someone who has never seen Heistproof.
// Home: why it matters, what Heistproof caught (computed from the runs), one card per run; the visitor's own runs first.
// One run: the verdict, the key moments in a few lines, the six steps, the ten robberies as a checklist (a row opens
// to its result, the money facts, large captioned proofs and PayPal's own ids), PayPal's answers, and the story round
// by round with the raw agent log folded inside it. Every number comes from the run's events, nothing is hard-coded.
// In the static build (data-static="1" on <html>) it reads recorded runs from plain files, so it can be hosted anywhere.
const STATIC = document.documentElement.dataset.static === "1";
const api = {
  list: () => (STATIC ? "runs/index.json" : "/api/runs"),
  run: (id) => (STATIC ? `runs/${id}/run.json` : `/api/runs/${id}`),
  file: (id, f) => (STATIC ? `runs/${id}/${encodeURIComponent(f)}` : `/api/runs/${id}/file/${encodeURIComponent(f)}`),
};
const LINKS = { github: "https://github.com/eric2612115/heistproof", video: "" };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (a) => (!a ? "" : !a.currency || a.currency === "USD" || a.currency_code === "USD" ? money(a.value) : `${a.value} ${a.currency ?? a.currency_code}`);
/** "$4,900" or "$0.01": cents only when there are some. */
const money0 = (v) => (Number(v) % 1 ? money(v) : `$${Number(v).toLocaleString("en-US")}`);
const robberies = (n) => (n === 1 ? "1 robbery" : `${n} robberies`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The engine's "3 parcel(s)" and "1 labels", in plain plurals. */
const plurals = (s) => String(s ?? "").replace(/\b(\d+) ([a-z]+)\(s\)/gi, (m, n, w) => `${n} ${w}${n === "1" ? "" : "s"}`).replace(/\b1 (label|parcel|order|capture|robbery|file|step|turn)s\b/g, "1 $1");
const times = (n) => (n === 2 ? "twice" : `${n} times`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const mins = (ms) => Math.max(1, Math.round((ms ?? 0) / 60000));

/* The ten robberies: the short name, and what the thief tries, in plain words. New runs carry both in their
   attack.result events (title and what); this list is the fallback for older recordings and must match the engine's. */
const ATTACKS = [
  ["price-tamper", "Price tampering", "Pay $0.01 for a full-price bag"],
  ["bad-bag", "Negative quantity", "Buy -1, 0.5 or 1,000 of an item, or a product that doesn't exist"],
  ["capture-unapproved", "Payment nobody approved", "Claim payment for an order no buyer approved"],
  ["approved-not-captured", "Approval without payment", "Get it shipped before PayPal takes the money"],
  ["double-capture", "Double click", "Capture twice at once to get two shipments"],
  ["declined-capture", "Declined card", "Get it shipped after the card is declined"],
  ["forged-webhook", "Forged webhook", "Fake PayPal's 'payment completed' message"],
  ["webhook-replay", "Webhook replay", "Resend PayPal's real message to ship again"],
  ["out-of-order", "Late event", "Send 'approved' after 'completed' to roll an order back"],
  ["secret-leak", "Secret in the browser", "Look for the PayPal secret in every page and script"],
];
const ATTACK_NAME = Object.fromEntries(ATTACKS.map(([id, name]) => [id, name]));
const ATTACK_WHAT = Object.fromEntries(ATTACKS.map(([id, , what]) => [id, what]));
// One word per outcome, everywhere: a robbery that could not run (skipped, failed to start, or never reached because the
// purchase it needs did not complete) is "Could not run", never Skipped, Error or Not run.
const STAMP = { waiting: "Waiting", running: "Trying…", held: "Blocked", robbed: "Robbed", skipped: "Could not run", error: "Could not run", notrun: "Could not run", repeat: "Repeat" };
const VERDICT = { running: "Running", safe: "Safe to ship", unsafe: "Do not ship", incomplete: "Incomplete" };
const BUTTONS = { paypal: "PayPal", venmo: "Venmo", paylater: "Pay Later" };
const KEY_FACTS = ["PayPal order", "Capture", "Signed webhook"];

/* Recorded runs that tell the story, with hand-written titles and leads; every number in them is read from the run's
   own summary (a run recorded again keeps its words true). Any other run gets a title from its own events. */
const FEATURED = {
  "2026-11-08-full-run": {
    title: (r) => (r.refusal ? "AI adds PayPal; PayPal refuses; AI fixes it" : null),
    short: "AI + Heistproof",
    desc: (r) => (r.refusal ? `The shop's ${r.refusal.testsPassed ? `${r.refusal.testsPassed} ` : ""}tests (the coding agent's included) passed, but PayPal's real sandbox refused its first ${refusedWhat(r.refusal)} with HTTP ${r.refusal.status}. Heistproof sent PayPal's answer back and the agent fixed it. Then ${outcome(r, { paid: true })}.` : null),
  },
  "2026-11-08-ai-alone": { title: () => "AI alone, with no PayPal skills", short: "AI alone", desc: (r) => `The control: the same model, with no APIMatic plugin and no Heistproof skills, wrote a checkout on its own. ${cap(outcome(r, { paid: true }))}. Heistproof does not assume AI code is unsafe; it proves a checkout either way.` },
  "2026-11-08-afternoon-robbed": { title: (r) => (r.robbed > 1 ? `A hand-written checkout, robbed ${r.robbed} ways` : null), short: "Hand-written", desc: (r) => `A sample PayPal checkout written by hand with planted mistakes, checked as it is with no coding agent. ${cap(outcome(r))}.` },
  "2026-11-08-naive-penny-heist": {
    title: (r) => (r.mismatch ? `A ${money0(r.mismatch.paypal)} order stopped${r.cheap ? `, then the ${cheapWords(r)}` : ""}` : null),
    short: (r) => (r.mismatch ? `${money0(r.mismatch.paypal)} charge stopped` : null),
    desc: (r) => (r.mismatch ? `The purchase was stopped before any money moved: PayPal would have charged ${money0(r.mismatch.paypal)} for a ${money0(r.mismatch.bag)} bag. Then the robberies that need no buyer: ${r.cheap ? `${low(plainSentence(r.cheap.summary)).replace(/\.$/, "")}; ` : ""}${outcome(r, { buy: false })}.` : null),
  },
  "2026-11-08-copper-kettle": { title: () => "A second shop, built differently", short: "Copper Kettle", desc: (r) => `No framework, a session cookie and a CSRF token on every request, other routes and fields. ${cap(outcome(r))}.` },
  "2026-11-08-naive-hardened": {
    title: () => "AI fixes a hand-written checkout",
    short: "AI fixes it",
    desc: (r) => `A hand-written checkout with planted mistakes, handed to the coding agent. The first check ${r.mismatch ? `stopped a ${money0(r.mismatch.paypal)} charge for a ${money0(r.mismatch.bag)} bag and ` : ""}caught ${robberies(r.robbedEver)}; ${r.fixes ? `${r.fixes === 1 ? "one fix" : `${r.fixes} fixes`} later, ` : ""}${outcome(r, { paid: true })}.`,
  },
  "2026-11-08-agent-checkout-recheck": { title: () => "The agent's checkout, checked again", short: "Recheck", desc: (r) => `The checkout the coding agent wrote in an earlier run, checked again as it is, with no coding agent. ${cap(outcome(r))}.` },
  "2026-11-08-thief-binding": {
    title: (r) => (r.thief?.robbed ? "The AI thief finds a mistake the ten cannot" : "The AI thief against a planted mistake"),
    short: "AI thief finds it",
    desc: (r) => `A test shop with one planted mistake that none of the ten scripted robberies can reach: its capture route lets a field in the request choose which order a payment pays for. ${cap(outcome(r))}.`,
  },
};
/** A featured run's own words, or null when the run does not (or no longer) bear them out. */
const featured = (r, key) => {
  const f = FEATURED[r?.id]?.[key];
  return typeof f === "function" ? f(r) : (f ?? null);
};
const HANDWRITTEN = new Set(["fogline-naive", "fogline-afternoon"]);
const SHOPS = {
  "fogline-express": "Fogline, a card-only shop",
  "fogline-naive": "a hand-written PayPal checkout",
  "fogline-afternoon": "a hand-written PayPal checkout",
  "fogline-after": "Fogline, with the checkout Heistproof's agent wrote",
  "copper-kettle": "Copper Kettle, a second shop built differently on purpose",
  "copper-kettle-binding": "Copper Kettle with one planted mistake, a test shop",
  "copper-kettle-bug-binding": "Copper Kettle with one planted mistake, a test shop",
};
/** "About this shop", for the sample shops that carry planted mistakes on purpose. */
const HAND_NOTE = (t, why) => `About this shop: ${t} is a sample PayPal checkout written by hand with planted mistakes (it ${why}). It is kept in shops/ as a test target, not as a survey of real shops.`;
const BINDING_NOTE = (t) => `About this shop: ${t} is Copper Kettle with one planted mistake: its capture route lets a field in the request choose which order the payment pays for, so one payment can pay for two orders. None of the ten scripted robberies can reach it; it is kept in shops/ to show what the AI thief finds, judged by the books.`;
const SHOP_NOTE = {
  "fogline-afternoon": HAND_NOTE("fogline-afternoon", "takes the amount from the browser, ships whatever the capture returned and trusts every message that claims to be from PayPal"),
  "fogline-naive": HAND_NOTE("fogline-naive", "sends cents as dollars, takes the amount from the browser, ships whatever the capture returned and trusts every message that claims to be from PayPal"),
  "copper-kettle-binding": BINDING_NOTE("copper-kettle-binding"),
  "copper-kettle-bug-binding": BINDING_NOTE("copper-kettle-bug-binding"),
};
/** Why a hand-written shop printed several shipping labels for one order: it ships each time it hears the order is paid. */
const SHOP_LABELS = {
  "fogline-afternoon": "This shop prints a shipping label each time it is told the order is paid: once at the capture, and again for every message that says it comes from PayPal.",
  "fogline-naive": "This shop prints a shipping label each time it is told the order is paid: once at the capture, and again for every message that says it comes from PayPal.",
};
const MODES = { heistproof: "AI adds PayPal", check: "checked as it is, no coding agent", existing: "AI fixes the checkout", baseline: "AI adds PayPal without Heistproof" };
const RAIL_DEFAULT = { migrate: "AI coding agent", prove: "real sandbox purchase", attack: "10 robberies", thief: "a model invents robberies", books: "the shop against PayPal's records", ship: "fix what failed, then ship" };
/** The round's own purchase ("round1-purchase", "round0-purchase-try2"); robberies and the AI thief buy under other labels. */
const ROUND_PURCHASE = /^round\d+-purchase(-(?:paypal|venmo|paylater))?(-try\d+)?$/;
const isRoundPurchase = (e) => !e.label || ROUND_PURCHASE.test(String(e.label));

/* ---------- Words that depend on the run: the sandbox or the offline stand-in, and what was bought ---------- */
const STANDIN = "Heistproof's offline PayPal stand-in";
const offline = () => Boolean(state?.offline);
/** "in PayPal's sandbox" or "with Heistproof's offline PayPal stand-in" */
const inPayPal = () => (offline() ? `with ${STANDIN}` : "in PayPal's sandbox");
/** "for real in PayPal's sandbox" or "with Heistproof's offline PayPal stand-in" */
const forReal = () => (offline() ? `with ${STANDIN}` : "for real in PayPal's sandbox");
/** "a real purchase in PayPal's sandbox" or "a purchase with Heistproof's offline PayPal stand-in" */
const aPurchase = () => (offline() ? `a purchase with ${STANDIN}` : "a real purchase in PayPal's sandbox");
/** What the shopper buys: "a hoodie" when the run's events name it, else nothing (the words then say "from the shop"). */
const anItem = () => (state?.item ? `${/^[aeiou]/i.test(state.item) ? "an" : "a"} ${state.item}` : "");
const theItem = () => state?.item ?? "order";
/** The engine's result text for an offline run: what it says PayPal did, the stand-in did. */
function byStandIn(s) {
  const text = String(s ?? "");
  if (!offline()) return text;
  const out = text
    .replace(/\bPayPal's (own )?records\b/g, "the stand-in's records")
    .replace(/\bPayPal's '(approved|completed|payment completed)'/g, "the stand-in's '$1'")
    .replace(/\bPayPal (captured|refused|answered|holds|says|would|took|charged|captures)\b/g, "the stand-in $1");
  return /^PayPal\b/.test(text) ? cap(out) : out;
}

let RUNS = [];
let state;
let source;
let replayTimer = null;
let replaying = false;

/* ======================================================================================
   Routing: the home, or one run. Static build: #run-id; server: /run/run-id.
   ====================================================================================== */

const runHref = (id) => (STATIC ? `#${id}` : `/run/${id}`);
const currentId = () => (STATIC ? decodeURIComponent(location.hash.slice(1)) : location.pathname.startsWith("/run/") ? decodeURIComponent(location.pathname.slice(5)) : "");

function go(id, anchor = "") {
  const path = STATIC ? (id ? `#${id}` : anchor ? `#${anchor}` : "#") : `${id ? `/run/${id}` : "/"}${location.search}${anchor ? `#${anchor}` : ""}`;
  history.pushState(null, "", path);
  route();
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
}

function route() {
  const id = currentId();
  const run = id && id !== "how" && RUNS.find((r) => r.id === id) ? id : "";
  if (run) showRun(run);
  else showHome();
  // "#how" opens the home page at "How a run goes", whether it was clicked or loaded (static site or server). The jump
  // waits for the layout (and the web fonts) to settle, and is instant, so nothing scrolls it back to the top.
  if (id === "how" || (!run && location.hash === "#how")) {
    const jump = () => document.getElementById("how")?.scrollIntoView({ block: "start", behavior: "instant" });
    requestAnimationFrame(() => requestAnimationFrame(jump));
    document.fonts?.ready.then(() => requestAnimationFrame(jump));
  }
}

function showHome() {
  closeViewers();
  source?.close();
  stopReplay(false);
  state = null;
  $("#run").hidden = true;
  $("#home").hidden = false;
  $("#engine").innerHTML = "";
  $("#nav-runs").setAttribute("aria-current", "page");
  document.title = "Heistproof: recorded PayPal sandbox robberies";
  renderHome();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeViewers() {
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  closeTips();
}

function showRun(id) {
  closeViewers();
  $("#home").hidden = true;
  $("#run").hidden = false;
  $("#nav-runs").removeAttribute("aria-current");
  if (state?.runId !== id) {
    window.scrollTo(0, 0);
    open(id);
  }
  renderChips();
}

/* ======================================================================================
   Home
   ====================================================================================== */

const runTitle = (r) => featured(r, "title") ?? r.title ?? r.id;
const runShort = (r) => featured(r, "short") ?? (r.mode === "check" ? "Hand-written" : r.mode === "existing" ? "AI fixes it" : r.mode === "baseline" ? "AI alone" : "AI + Heistproof");
const verdictClass = (r) => r.verdict ?? "running";
const verdictWord = (r) => VERDICT[r.verdict ?? "running"];
/** A safe verdict without the AI thief is safe against the scripted robberies only, and says so. */
const safeScope = (r) => (r.verdict === "safe" && !r.thief ? `${r.total ?? 10} scripted robberies; the AI thief did not run` : "");
/** "capture", "order" or "payment": what a refused PayPal call was, from its path. */
const refusedWhat = (x) => (/\/capture$/.test(String(x?.call ?? "")) ? "capture" : /\/orders$/.test(String(x?.call ?? "")) ? "order" : "payment");
/** "$0.01 hoodie": what the price tampering robbery got, from the run's summary. */
const cheapWords = (r) => {
  const item = /the \$[\d,.]+ ([a-z][\w-]*)/i.exec(String(r.cheap?.summary ?? ""))?.[1] ?? "order";
  const v = /^([\d.,]+)/.exec(String(r.cheap?.captured ?? ""))?.[1];
  return v ? `${money0(v)} ${item}` : item;
};
/** "PayPal's" or "the stand-in's" records, for a run summary. */
const recordsOf = (r) => (r.offline ? "the stand-in's" : "PayPal's");

/** How the round's own purchase ended, in a few words ("paid, but the shop shipped 3 times"); "" when it paid once. */
function purchaseWords(r) {
  const p = r.purchase;
  const by = r.offline ? "the stand-in" : "PayPal";
  if (p) {
    if (p.status === "paid") return "";
    if (p.status === "overshipped") return p.labels ? `the purchase paid, but the shop shipped it ${times(p.labels)}` : "the purchase paid, but nothing shipped";
    if (p.status === "refused") return `${by} refused the purchase${p.http ? ` (HTTP ${p.http})` : ""}`;
    if (p.status === "mismatch") return r.mismatch ? `the purchase was stopped: ${by} would have charged ${money0(r.mismatch.paypal)} for a ${money0(r.mismatch.bag)} bag` : "the purchase was stopped: wrong amount";
    if (p.status === "nobutton") return "the PayPal button never appeared, so no purchase was possible";
    return "the purchase did not complete";
  }
  // Summaries from before purchases were told apart: only what is certain.
  if (r.paid === false) return r.refusal ? `${by} refused the purchase (HTTP ${r.refusal.status})` : r.mismatch ? "the purchase was stopped: wrong amount" : "the purchase did not pay once";
  return "";
}

/** The run's result in one plain clause: the purchase when it went wrong (or, with paid, when it went right), the
    robberies, the AI thief, the books. buy: false leaves the purchase out (the sentence before it told it already). */
function outcome(r, { paid = false, buy = true } = {}) {
  if (!r.verdict) return "the run is still going";
  const parts = [];
  const bought = buy ? purchaseWords(r) : "";
  if (bought) parts.push(bought);
  else if (buy && paid && r.purchase?.status === "paid") parts.push(`the ${r.rounds > 1 ? "last " : ""}purchase paid${r.purchase.amount ? ` $${r.purchase.amount}` : ""} once`);
  const notRun = Math.max(0, (r.total ?? 10) - (r.ran ?? 0)) + (r.skipped ?? 0);
  if (r.robbed) parts.push(`${r.robbed} of the ${r.ran} scripted robberies worked${notRun ? ` (${notRun} could not run)` : ""}`);
  else if (r.ran && notRun) parts.push(`${r.held} scripted ${r.held === 1 ? "robbery was" : "robberies were"} blocked (${notRun} could not run)`);
  else if (r.ran) parts.push(`all ${r.ran} scripted robberies were blocked`);
  else parts.push("no scripted robbery ran");
  if (r.thief) parts.push(r.thief.robbed ? `the AI thief got ${r.thief.robbed} of its ${robberies(r.thief.tried)} through` : r.thief.repeat ? `the AI thief only repeated problems the books already showed` : `nothing the AI thief invented got through`);
  if (r.booksMismatches) parts.push(`${plural(r.booksMismatches, "order")} in the shop's books ${r.booksMismatches === 1 ? "does" : "do"} not match ${recordsOf(r)} records`);
  else if (r.booksError) parts.push(`the shop's books could not be matched against ${recordsOf(r)} records`);
  else if (r.booksMismatches === 0 && r.thief) parts.push(`the books match ${recordsOf(r)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

/** One line a judge can read on a card, from the run's own numbers. */
function runDesc(r) {
  const own = featured(r, "desc");
  if (own) return own;
  const shop = SHOPS[r.template] ?? (r.template || "the shop");
  const before = r.robbedEver > r.robbed ? ` (${robberies(r.robbedEver)} worked before the fixes)` : "";
  const result = `${cap(outcome(r))}${before}.`;
  if (r.mode === "check") return `${cap(shop)}, checked as it is with no coding agent${r.offline ? `, with ${STANDIN}` : ""}. ${result}`;
  if (r.mode === "existing") return `An AI coding agent fixed ${shop} after each failed check, ${plural(r.rounds, "round")} in all. ${result}`;
  if (r.mode === "baseline") return `An AI coding agent added PayPal to ${shop} on its own, without APIMatic's plugin or Heistproof's skills. ${result}`;
  return `An AI coding agent added PayPal to ${shop}${r.fixes ? `, with ${plural(r.fixes, "fix round")} after ${r.offline ? "checks against the stand-in" : "real sandbox checks"}` : ""}. ${result}`;
}

/** "8 of 10 robbed", "2 robbed, 6 could not run", plus the AI thief when it got through. */
function robbedCount(r, short = false) {
  if (!r.verdict) return "running";
  if (!r.ran) return "no robbery ran";
  const notRun = Math.max(0, (r.total ?? 10) - r.ran) + (r.skipped ?? 0);
  const base = notRun ? `${r.robbed} robbed, ${notRun} could not run` : short ? `${r.robbed}/${r.ran} robbed` : `${r.robbed} of ${r.ran} robbed`;
  return r.thief?.robbed ? `${base} · AI thief ${r.thief.robbed} of ${r.thief.tried}` : base;
}

/* ---------- The result in two numbers, then what Heistproof caught: all computed from the run summaries ---------- */

const newest = (list) => [...list].sort((a, b) => String(b.started).localeCompare(String(a.started)))[0] ?? null;

/** The run behind each claim: recorded sandbox runs first, the visitor's own sandbox runs when no recorded run has it. */
function catches(runs) {
  const sandbox = runs.filter((r) => r.verdict && !r.offline);
  const recorded = sandbox.filter((r) => r.recorded !== false);
  const pick = (test, order = newest) => order(recorded.filter(test)) ?? order(sandbox.filter(test));
  const mostRobbed = (list) => [...list].sort((a, b) => b.robbed - a.robbed || String(b.started).localeCompare(String(a.started)))[0] ?? null;
  const complete = (r) => r.ran >= r.total && r.thief;
  return {
    refused: pick((r) => r.refusal && (r.mode === "heistproof" || r.mode === "existing")),
    mismatch: pick((r) => r.mismatch),
    hand: pick((r) => r.mode === "check" && HANDWRITTEN.has(r.template) && r.robbed > 0 && r.ran >= r.total, mostRobbed) ?? pick((r) => r.mode === "check" && HANDWRITTEN.has(r.template) && r.robbed > 0, mostRobbed),
    // The checkout Heistproof's own coding agent wrote: added in a full run, safe against everything, else checked again as it is.
    agent: pick((r) => r.mode === "heistproof" && r.verdict === "safe" && complete(r)) ?? pick((r) => r.template === "fogline-after" && r.verdict === "safe" && complete(r)),
    control: pick((r) => r.mode === "baseline"),
    // The AI thief getting through where the ten scripted robberies could not (a shop with a mistake only it can see).
    thief: pick((r) => r.thief?.robbed > 0 && !r.robbed),
  };
}

/** After the catch: what the run did next, from its own numbers. */
function afterwards(r) {
  const end = r.verdict === "safe" ? `all ${r.held} robberies blocked` : r.robbed ? `${r.robbed} of ${robberies(r.ran)} still worked` : r.skipped ? `${r.held} of ${r.ran} robberies blocked, ${r.skipped} could not run` : `${r.held} of ${r.total} robberies blocked`;
  if (r.mode === "check") return `Checked as it is: ${end}.`;
  return r.fixes ? `The coding agent fixed it in ${plural(r.fixes, "round")}; then ${end}.` : `Not fixed in this run; ${end}.`;
}

const catchVerdict = (r) => `<span class="catch-verdict"><span class="vdot ${verdictClass(r)}"></span><b>${esc(verdictWord(r))}${safeScope(r) ? ` (${esc(safeScope(r))})` : ""}</b><span>${esc(runTitle(r))}</span></span>`;

/** A catch card takes the colour of its own run's final verdict; only the number it caught stays red. */
function catchCard(r, big, line, then) {
  return `<a class="catch ${verdictClass(r)}" href="${runHref(r.id)}" data-run="${esc(r.id)}"><span class="catch-num">${esc(big)}</span><span class="catch-line">${esc(line)}</span><span class="catch-then">${esc(then)}</span>${catchVerdict(r)}</a>`;
}

/** "Shipped the $49.00 hoodie after PayPal captured USD 0.01 (order …); the shop's back office says fulfilled." -> its first plain sentence. */
function plainSentence(s) {
  const first = String(s ?? "").split(/;|\s\(|\.\s/)[0].replace(/\bUSD (\d[\d,]*\.\d\d)\b/g, (m, v) => money(v)).replace(/\.$/, "").trim();
  return first ? `${cap(first)}.` : "";
}

/** One of the two numbers: how many of the ten robberies worked on a checkout, and whether it may ship. */
function resultTile(r, who, sub) {
  const v = verdictClass(r);
  const notRun = Math.max(0, r.total - r.ran) + (r.skipped ?? 0);
  return `<a class="tile ${v}" href="${runHref(r.id)}" data-run="${esc(r.id)}">
    <span class="who">${esc(who)}</span>
    <span class="num">${r.robbed} of ${r.total}<small>${r.robbed === 1 ? "robbery worked" : "robberies worked"}${notRun ? `, ${notRun} could not run` : ""}</small></span>
    <span class="ship"><span class="vdot ${v}"></span>${esc(verdictWord(r))}</span>
    <span class="sub">${esc(sub)}</span>
    <span class="open">${esc(runTitle(r))}</span>
  </a>`;
}

function renderResult(c) {
  const tiles = [];
  if (c.hand) {
    const h = c.hand;
    const sub = [h.cheap?.summary ? plainSentence(h.cheap.summary) : "", h.booksMismatches ? `${plural(h.booksMismatches, "order")} in its books ${h.booksMismatches === 1 ? "does" : "do"} not match PayPal's.` : ""].filter(Boolean).join(" ");
    tiles.push(resultTile(h, "A hand-written PayPal checkout with planted mistakes", sub || `${cap(outcome(h))}.`));
  }
  if (c.agent) {
    const a = c.agent;
    const x = a.refusal;
    const lead = x ? `PayPal's sandbox refused its first ${refusedWhat(x)} (HTTP ${x.status})${x.testsPassed ? ` although the shop's ${x.testsPassed} tests, the agent's included, passed` : ""}; the agent fixed it. Then ` : "";
    const who = a.mode === "heistproof" ? "The checkout Heistproof's coding agent wrote" : "The coding agent's checkout, checked again";
    tiles.push(resultTile(a, who, `${lead}${lead ? outcome(a) : cap(outcome(a))}.`));
  }
  $("#result-tiles").innerHTML = tiles.join("");
  $("#result").hidden = tiles.length === 0;
}

function renderCatches(recordedAndLocal) {
  const c = catches(recordedAndLocal);
  renderResult(c);
  const cards = [];
  if (c.refused) {
    const x = c.refused.refusal;
    const whose = c.refused.mode === "heistproof" ? "the AI's" : "the checkout's";
    const tests = x.testsPassed ? `; the shop's ${x.testsPassed} tests, the agent's included, had passed` : "";
    cards.push(catchCard(c.refused, `HTTP ${x.status}`, `PayPal's sandbox refused ${whose} ${refusedWhat(x)}${tests}.`, afterwards(c.refused)));
  }
  if (c.mismatch) {
    const m = c.mismatch.mismatch;
    const then = c.mismatch.mode === "existing" ? afterwards(c.mismatch) : c.mismatch.robbed ? `Then the robberies that need no buyer: ${c.mismatch.robbed} of ${robberies(c.mismatch.ran)} worked.` : afterwards(c.mismatch);
    cards.push(catchCard(c.mismatch, m.paypal != null ? money(m.paypal) : "Wrong amount", `PayPal would have charged this for a ${money(m.bag)} bag; Heistproof stopped the purchase before any money moved.`, then));
  }
  if (c.thief) {
    const t = c.thief.thief;
    const m = c.thief.booksMismatches;
    cards.push(catchCard(c.thief, `${t.robbed} of ${t.tried}`, `of the AI thief's own robberies got through where all ${c.thief.held} scripted robberies were blocked.`, m ? `The books caught ${m === 1 ? "it" : "them"}: ${plural(m, "order")} in the shop's books ${m === 1 ? "does" : "do"} not match PayPal's records.` : ""));
  }
  // The hand-written checkout leads the page already (the first of the two numbers); it is a catch card only when the
  // two numbers could not be shown.
  if (c.hand && !c.agent) {
    const h = c.hand;
    const parts = [h.cheap?.summary ? plainSentence(h.cheap.summary) : "", h.booksMismatches ? `${plural(h.booksMismatches, "order")} in the shop's books no longer ${h.booksMismatches === 1 ? "matches" : "match"} PayPal's.` : ""].filter(Boolean);
    cards.push(catchCard(h, `${h.robbed} of ${h.ran}`, "robberies got through a hand-written checkout with planted mistakes.", parts.join(" ")));
  }
  $("#compare").innerHTML = cards.join("");
  $("#compare").hidden = cards.length === 0;
  const ctl = c.control;
  const note_ = $("#compare-note");
  if (ctl) {
    const result = ctl.verdict === "safe" && ctl.rounds <= 1 ? "a checkout that was safe at the first try" : ctl.robbed ? `a checkout that was robbed ${ctl.robbed} ways` : `a checkout Heistproof called ${verdictWord(ctl).toLowerCase()}`;
    note_.innerHTML = `The same model with no PayPal skills wrote <a href="${runHref(ctl.id)}" data-run="${esc(ctl.id)}">${esc(result)}</a>: Heistproof does not assume AI code is unsafe, it proves a checkout either way.`;
  } else note_.textContent = cards.length ? "Every number here is read from the run's own event log." : "";
  $(".compare").hidden = cards.length === 0 && !ctl;
}

const LOCAL_CARDS = 6;

function renderHome() {
  const recorded = RUNS.filter((r) => r.recorded !== false);
  const local = RUNS.filter((r) => r.recorded === false).sort((a, b) => String(b.started).localeCompare(String(a.started)));
  renderCatches(RUNS);

  // The visitor's own runs come first: the newest as cards, the rest folded into a list (still with real titles).
  $("#your-runs").hidden = local.length === 0;
  $("#your-cards").innerHTML = local.slice(0, LOCAL_CARDS).map((r) => card(r, true)).join("");
  const older = local.slice(LOCAL_CARDS);
  $("#more-runs").hidden = older.length === 0;
  $("#more-summary").textContent = `${plural(older.length, "older run")} on this machine`;
  $("#more-list").innerHTML = older
    .map((r) => `<li><a href="${runHref(r.id)}" data-run="${esc(r.id)}">${esc(runTitle(r))}</a><span>${esc(when(r, true))}${r.verdict ? ` · ${esc(verdictWord(r))} · ${esc(robbedCount(r))}` : " · unfinished"}${r.offline ? " · offline stand-in" : ""}</span></li>`)
    .join("");

  const order = featuredOrder(recorded);
  $("#cards").innerHTML = order.map((r) => card(r)).join("");
  $("#recorded-runs").hidden = order.length === 0;
  $("#nav-video").hidden = !LINKS.video;
  if (LINKS.video) $("#nav-video").href = LINKS.video;
}

/** Featured runs in their story order, then any other recorded run. */
const featuredOrder = (recorded) => [...Object.keys(FEATURED).map((id) => recorded.find((r) => r.id === id)).filter(Boolean), ...recorded.filter((r) => !FEATURED[r.id])];

/** "Nov 8, 2026", or with the time for the visitor's own runs (several a day). */
function when(r, withTime = false) {
  if (!r.started) return "";
  const d = new Date(r.started);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return withTime ? `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : day;
}

function card(r, local = false) {
  const v = verdictClass(r);
  const meta = [MODES[r.mode] ?? r.mode, r.rounds > 1 ? plural(r.rounds, "round") : "", r.model ? `model ${r.model}` : "", r.thiefModel && !r.model ? `AI thief ${r.thiefModel}` : "", when(r, local)].filter(Boolean);
  return `<a class="card ${v}" href="${runHref(r.id)}" data-run="${esc(r.id)}">
    <span class="verdict-line"><span class="vdot ${v}"></span>${esc(verdictWord(r))}<span class="count">${esc(robbedCount(r))}</span></span>${safeScope(r) ? `<span class="verdict-qual">(${esc(safeScope(r))})</span>` : ""}
    <h3>${esc(runTitle(r))}</h3>
    <span class="desc">${esc(runDesc(r))}</span>
    <span class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}${r.offline ? `<span class="offline">offline · PayPal stand-in</span>` : ""}</span>
  </a>`;
}

function renderChips() {
  const recorded = RUNS.filter((r) => r.recorded !== false);
  const order = featuredOrder(recorded);
  const current = state?.runId;
  $("#chips").innerHTML = order
    .map((r) => `<a class="${verdictClass(r)}" href="${runHref(r.id)}" data-run="${esc(r.id)}"${r.id === current ? ' aria-current="page"' : ""}><span class="vdot ${verdictClass(r)}"></span>${esc(runShort(r))} <b>${esc(robbedCount(r, true))}</b></a>`)
    .join("");
  if (current && !order.some((r) => r.id === current)) {
    const r = RUNS.find((x) => x.id === current) ?? { id: current };
    $("#chips").insertAdjacentHTML("afterbegin", `<a class="${verdictClass(r)}" aria-current="page" href="${runHref(current)}" data-run="${esc(current)}"><span class="vdot ${verdictClass(r)}"></span>Your run <b>${esc(robbedCount(r, true))}</b></a>`);
  }
  // The open run's chip is always in view, however far along the strip it sits.
  const strip = $("#chips");
  const chip = strip.querySelector('[aria-current="page"]');
  if (chip) requestAnimationFrame(() => {
    const s = strip.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    if (c.left < s.left || c.right > s.right) strip.scrollLeft += c.left - s.left - (s.width - c.width) / 2;
  });
}

/* ======================================================================================
   One run: state
   ====================================================================================== */

/** The AI thief's robberies: what it guessed, and what the books said. */
function renderThief() {
  const t = state.thief;
  if (!t) return;
  const plans = [...t.plans.values()];
  const robbed = plans.filter((p) => p.verdict === "robbed").length;
  const held = plans.filter((p) => p.verdict === "held").length;
  const repeat = plans.filter((p) => p.verdict === "repeat").length; // only repeated a problem the books already showed
  const failed = plans.filter((p) => p.verdict === "error").length;
  $("#thief").hidden = false;
  const done = held + robbed + repeat + failed;
  const rep_ = `${repeat ? ` · ${repeat} repeat${repeat === 1 ? "" : "s"}` : ""}${failed ? ` · ${failed} could not run` : ""}`;
  const chip = $("#thief-chip");
  chip.textContent = t.skipped ? "did not run" : robbed ? `${robbed} of ${plans.length} got through${rep_}` : (held || repeat || failed) && done === plans.length ? `none of ${plans.length} got through${rep_}` : held ? `${held} of ${plans.length} blocked${rep_}` : `${plans.length} invented`;
  chip.classList.toggle("bad", robbed > 0);
  const note_ = $("#thief-note");
  if (t.skipped) {
    // A short, plain reason; the engine's full text stays one click away.
    note_.innerHTML = `${esc(thiefWhy(t.skipped))}<details class="thief-why"><summary>Details</summary><code>${esc(t.skipped)}</code></details>`;
    note_.title = String(t.skipped);
  } else {
    note_.removeAttribute("title");
    const got = robbed ? ` ${robbed === 1 ? "One of them" : `${robbed} of them`} got through: ${robbed === 1 ? "a way in" : "ways in"} that none of the ten scripted robberies found.` : "";
    note_.textContent = `${t.source === "replay" ? "Robberies an AI thief invented in an earlier run, replayed here." : `An AI model${t.model ? ` (${t.model})` : ""} played a dishonest shopper.`} It saw what any visitor can see (the storefront's code, the page's own requests) and invented these robberies itself. The shop's books against ${offline() ? "the stand-in's" : "PayPal's own"} records decide each one, not the model.${got}`;
  }
  // Each row leads with the robbery's name (bold), then what happened, then the model's idea (grey).
  $("#thief-rows").innerHTML = plans
    .map((p) => {
      const outcome = thiefOutcome(p);
      return `<li class="row ${esc(p.verdict)}"><span class="stamp">${esc(STAMP[p.verdict] ?? (p.verdict === "running" ? "Trying…" : "Waiting"))}</span><div class="thief-text"><b class="thief-name">${esc(p.name ?? "A robbery")}</b>${outcome ? `<span class="thief-outcome">${esc(outcome)}</span>` : ""}${p.idea ? `<span class="thief-idea">The model's idea: ${esc(p.idea)}</span>` : ""}</div></li>`;
    })
    .join("");
}

/** What one of the AI thief's robberies did, in plain words: a robbery that got through says how, in the books' terms. */
function thiefOutcome(p) {
  if (p.verdict === "running") return "Trying it now…";
  if (p.verdict === "waiting") return "";
  const s = byStandIn(plurals(p.summary ?? ""));
  if (p.verdict === "error") return s ? `Could not run: ${low(s)}` : "Could not run.";
  if (p.verdict === "robbed" && /already pays for order/.test(s)) return `${s.replace(/\.$/, "")}. One payment now pays for two orders.`;
  return s;
}
/** Why the AI thief did not run, in a few plain words. */
function thiefWhy(reason) {
  const r = String(reason ?? "");
  if (/no model key/i.test(r)) return "The AI thief did not run: no model key. Add one with npm run setup.";
  if (/no plan/i.test(r)) return "The AI thief did not run: the model gave no robbery Heistproof could carry out.";
  if (/could not be asked/i.test(r)) return "The AI thief did not run: the model could not be reached.";
  const first = r.split(/[.:;(]/)[0].trim();
  return `The AI thief did not run${first ? `: ${first.length > 90 ? `${first.slice(0, 90).replace(/\s+\S*$/, "")}…` : first}` : ""}.`;
}

function reset(runId) {
  state = {
    runId,
    files: [],
    mode: null,
    template: null,
    offline: false,
    plugin: null,
    phase: null,
    done: new Set(),
    bad: new Set(),
    round: 0,
    lastRound: 0,
    rounds: 1,
    R: [], // per round: tests, the purchase, the robberies, the agent's work, the webhook
    skills: new Map(),
    files_: new Map(),
    thief: null, // the AI thief's robberies: { source, model, provider, skipped, plans: Map(index -> plan) }
    books: null, // the latest books.reconciled event
    results: new Map(), // attack id -> latest verdict
    history: new Map(), // attack id -> [{ round, verdict }]
    names: new Map(), // attack id -> { name, what }
    refusals: [],
    paid: null,
    mismatch: null,
    sentBack: 0,
    fixes: 0,
    finished: false,
    safe: null,
    verdict: null,
    branch: null,
    pr: null,
    shots: [],
    labels: {}, // purchase label -> { bag, pp, ok }
    facts: new Map(),
    logCount: 0,
    t0: null,
    now: null,
    activity: "",
    latest: "",
    duration: "",
    attack: null,
    planned: null,
    autoOpened: false,
    item: null, // what the shopper buys, when the run's events name it ("hoodie")
    broken: new Set(), // back-office screenshots that caught a server error page, not the back office
    same: {}, // screenshot -> the first screenshot with the same pixels (never shown twice in one group)
    focus: {}, // back-office screenshot -> where the outlined order is (see shotInfo in src/console/summary.ts)
    signedIn: new Set(), // purchases whose buyer signed in to PayPal (their "-paypal" screenshot is the sign-in page)
    hasAgent: false, // a coding agent ran: only then is there an agent log to show
    fixText: "",
    shipText: "",
  };
  $("#headline").textContent = runTitle(RUNS.find((x) => x.id === runId) ?? { id: runId, title: "Add PayPal. Then try to rob it." });
  $("#timeline").innerHTML = "";
  $("#agent-log").innerHTML = "";
  $("#log-box").hidden = true;
  $("#log-box").open = false;
  $("#rows").innerHTML = "";
  for (const [id, name, what] of ATTACKS) ensureRow(id, name, what);
  $("#notrun-note").hidden = true;
  $("#thief").hidden = true;
  $("#thief-rows").innerHTML = "";
  $("#books-line").hidden = true;
  $("#proof-facts").innerHTML = "";
  $("#proof-more-facts").innerHTML = "";
  $("#proof-links").innerHTML = "";
  $("#shots").innerHTML = "";
  // A replay starts from an empty proof panel: no amount, no refusal, no robbery box left over from the run's end.
  for (const id of ["#amount", "#heist-box", "#refusal"]) {
    const box = $(id);
    box.hidden = true;
    box.innerHTML = "";
    delete box.dataset.show;
    delete box.dataset.kind;
  }
  $("#evidence-links").innerHTML = "";
  $("#shop-note").hidden = true;
  $("#beats").innerHTML = "";
  fold($("#proof-btn"), false);
  fold($("#tl-btn"), window.innerWidth > 1100);
  $("#engine").innerHTML = "";
  for (const el of document.querySelectorAll("#rail > div")) el.className = "";
  for (const [phase, text] of Object.entries(RAIL_DEFAULT)) note(phase, text);
  setTips();
  render();
}

const R = (r = state.round) => (state.R[r] ??= { tests: null, buy: null, attacks: new Map(), agent: null, webhook: null });

/* ---------- Folding: the fold buttons, the robbery rows, the "i" tips ---------- */

function fold(btn, open) {
  const target = document.getElementById(btn.getAttribute("aria-controls"));
  btn.setAttribute("aria-expanded", String(open));
  target.hidden = !open;
  if (btn.dataset.open) btn.firstChild.textContent = open ? btn.dataset.open : btn.dataset.closed;
  btn.closest(".panel")?.classList.toggle("open", open);
}

function toggleRow(head, open = head.getAttribute("aria-expanded") !== "true") {
  head.setAttribute("aria-expanded", String(open));
  document.getElementById(head.getAttribute("aria-controls")).hidden = !open;
}

/** The explanations behind the "i" buttons, for the sandbox or for the offline stand-in. */
function setTips() {
  const off = offline();
  $("#tip-verdict").innerHTML = `<b>Safe to ship</b> means ${off ? "the purchase with Heistproof's offline PayPal stand-in" : "the real sandbox purchase"} went through once, all 10 scripted robberies were blocked, nothing the AI thief tried got through and the shop's books match ${off ? "the stand-in's" : "PayPal's"} records (when the AI thief did not run, the verdict says so). <b>Do not ship</b> means at least one robbery worked, or the purchase itself failed. <b>Incomplete</b> means not every robbery could run, or the books could not be matched, so there is no verdict on the rest; an incomplete check is never called safe.`;
  $("#tip-rows").innerHTML = `Each robbery is a real attempt on the running shop ${off ? `with ${STANDIN} (no network, no PayPal account)` : "through PayPal's sandbox, not a simulation"}. <b>Blocked</b>: the shop refused it. <b>Robbed</b>: it worked, and the shop would have lost money or goods. <b>Could not run</b>: it needs something this run did not have (a paid order, say), so it was not blocked either. Open a row for the result, the screenshots and ${off ? "the stand-in's" : "PayPal's own"} ids.`;
  $("#tip-proof").innerHTML = off
    ? `Everything here comes from ${STANDIN}, which answers like PayPal's sandbox without a network or an account; no money moves. <b>PayPal order</b>: the stand-in's id for the purchase. <b>Capture</b>: the moment the stand-in took the money. <b>Signed webhook</b>: the stand-in's "payment completed" message. The raw answers are the recorded calls, byte for byte.`
    : `Everything here comes from PayPal's sandbox, so no real money moves. <b>PayPal order</b>: PayPal's id for the purchase. <b>Capture</b>: the moment PayPal actually took the money. <b>Signed webhook</b>: PayPal's own "payment completed" message, its signature checked with PayPal. The raw answers are the recorded calls, byte for byte.`;
}

function closeTips() {
  for (const b of document.querySelectorAll('.info-btn[aria-expanded="true"]')) {
    b.setAttribute("aria-expanded", "false");
    document.getElementById(b.getAttribute("aria-controls")).hidden = true;
  }
}

/** Shows the explanation under an "i" button: below the card or panel header it sits in, never over what it explains. */
function toggleTip(btn) {
  const wasOpen = btn.getAttribute("aria-expanded") === "true";
  closeTips();
  if (wasOpen) return;
  const tip = document.getElementById(btn.getAttribute("aria-controls"));
  const anchor = btn.closest(".verdict-card, .panel > header") ?? btn;
  const r = anchor.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  tip.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const top = r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(Math.max(16, Math.min(b.left - 8, window.innerWidth - w - 16)))}px`;
}

/* ---------- Rail ---------- */

function setPhase(phase) {
  // "Fix, then ship" is never done before the run ends: after a fix the checkout is checked again first.
  if (state.phase && state.phase !== phase && state.phase !== "ship") state.done.add(state.phase);
  state.phase = phase;
  paintRail();
}

function paintRail() {
  const unused = state.mode === "check" || state.mode === "existing" ? ["migrate"] : [];
  const c = counts();
  const v = verdictOf(c);
  const thiefRan = state.thief && !state.thief.skipped && state.thief.plans.size > 0;
  for (const el of document.querySelectorAll("#rail > div")) {
    const p = el.dataset.phase;
    let cls = unused.includes(p) ? "unused" : state.bad.has(p) ? "bad" : p === state.phase && !state.finished ? "active" : state.done.has(p) || (state.finished && p === "ship") ? "done" : "";
    // A finished run never shows a green tick it has not earned: the last step follows the verdict, "Rob it" needs at
    // least one blocked robbery, the AI thief must have run, and the books must have been matched against PayPal's.
    if (state.finished && p === "ship") cls = v === "safe" ? "done" : v === "unsafe" ? "bad" : "";
    if (state.finished && p === "attack" && cls === "done" && c.tried === 0) cls = "";
    if (p === "thief" && cls === "done" && !thiefRan) cls = "";
    if (p === "books" && cls === "done" && !state.books?.matched) cls = "";
    el.className = cls;
  }
}

function note(phase, text) {
  const el = document.getElementById(`note-${phase}`);
  if (el) el.textContent = text;
}

/** Step 6, "Fix, then ship", tells both halves: what the fixing did, and what shipped. */
function setFix(text) {
  state.fixText = text;
  note("ship", [state.fixText, state.shipText].filter(Boolean).join(" · ") || RAIL_DEFAULT.ship);
}
function setShip(text) {
  state.shipText = text;
  note("ship", [state.fixText, state.shipText].filter(Boolean).join(" · ") || RAIL_DEFAULT.ship);
}

/* ---------- What happened: the story round by round ---------- */

function elapsed() {
  if (!state.t0 || !state.now) return "";
  const s = Math.max(0, Math.round((new Date(state.now) - new Date(state.t0)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function roundGroup(r) {
  let li = document.getElementById(`round-${r}`);
  if (!li) {
    li = document.createElement("li");
    li.className = "round";
    li.id = `round-${r}`;
    li.innerHTML = `<header><b>Round ${r + 1}</b><span>${r === 0 ? "first check" : `after fix ${r}`}</span></header><ol></ol>`;
    $("#timeline").append(li);
  }
  return li.querySelector("ol");
}

/** One line of the story; the same key updates the line in place and keeps the time it first appeared unless restamped. kind: ok | bad | run | info */
function step(key, kind, title, detail = "", r = state.round, restamp = false) {
  let li = document.getElementById(`t-${key}`);
  if (!li) {
    li = document.createElement("li");
    li.id = `t-${key}`;
    li.dataset.at = elapsed();
    roundGroup(r).append(li);
  }
  if (restamp) {
    li.dataset.at = elapsed();
    li.parentElement.append(li);
  }
  state.lastRound = r;
  li.className = kind;
  li.innerHTML = `<span class="dot"></span><div><b>${title}</b>${detail ? `<small>${detail}</small>` : ""}</div><time>${li.dataset.at}</time>`;
  state.latest = li.querySelector("b").textContent;
}

/** Gives a line of the story the time something happened, when an event reports it later (the resends, say). */
function stampAt(key, iso) {
  const li = document.getElementById(`t-${key}`);
  if (!li || !iso || !state.t0) return;
  const sec = Math.max(0, Math.round((new Date(iso) - new Date(state.t0)) / 1000));
  if (!Number.isFinite(sec)) return;
  li.dataset.at = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const t = li.querySelector("time");
  if (t) t.textContent = li.dataset.at;
  // In its place in time among the round's lines.
  const secs = (x) => x.split(":").reduce((n, v) => n * 60 + Number(v), 0);
  const later = [...li.parentElement.children].find((x) => x !== li && x.dataset.at && secs(x.dataset.at) > sec);
  if (later) li.parentElement.insertBefore(li, later);
}

/** Did the AI thief run in the last round (at least one of its robberies carried out)? */
const thiefRan = () => {
  const t = state.R[state.R.length - 1]?.thief;
  return Boolean(t && !t.skipped && t.tried);
};
const buyStep = (r, kind, title, detail) => step(`buy-${r}`, kind, title, detail, r);
/** "Buying a hoodie in PayPal's sandbox" / "Buying from the shop with Heistproof's offline PayPal stand-in" */
const buyTitle = () => `${anItem() ? `Buying ${anItem()}` : "Buying from the shop"} ${inPayPal()}`;

function log(kind, key, html) {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="k">${esc(key)}</span><span class="v">${html}</span>`;
  $("#agent-log").append(li);
  state.logCount++;
  // A run with no coding agent has no agent log to offer (its few lines are all in the story already).
  $("#log-box").hidden = !state.hasAgent;
  $("#log-count").textContent = `(${state.logCount} ${state.logCount === 1 ? "step" : "steps"})`;
}

function shortInput(input) {
  let o = {};
  try {
    o = JSON.parse(input);
  } catch {
    const m = /"file_path":"([^"]+)"/.exec(String(input));
    return esc(m ? m[1].split("/shop/").pop() : String(input).slice(0, 140));
  }
  if (o.file_path) return esc(`${o.file_path.split("/shop/").pop()}${o.lines ? `  (${o.lines} lines)` : ""}`);
  if (o.command) return esc(o.command.slice(0, 140));
  if (o.pattern) return esc(`${o.pattern}${o.path ? ` in ${o.path.split("/shop/").pop()}` : ""}`);
  return esc(JSON.stringify(o).slice(0, 140));
}

const inRound = (map) => {
  if (!map.has(state.round)) map.set(state.round, new Set());
  return map.get(state.round);
};

/* ---------- Counting ---------- */

const attackName = (id) => state.names.get(id)?.name ?? ATTACK_NAME[id] ?? id;
const totalAttacks = () => (state.planned ? Math.max(state.planned.length, state.results.size) : Math.max(ATTACKS.length, state.results.size, state.names.size));

function counts() {
  let blocked = 0;
  let robbed = 0;
  let skipped = 0;
  for (const v of state.results.values()) {
    if (v === "held") blocked++;
    else if (v === "robbed") robbed++;
    else skipped++;
  }
  const ran = blocked + robbed + skipped;
  const total = totalAttacks();
  return { blocked, robbed, skipped, ran, total, tried: blocked + robbed, notRun: total - ran };
}

function verdictOf(c) {
  if (!state.finished) return "running";
  if (state.verdict) return state.verdict;
  if (state.safe === true) return "safe";
  if (c.robbed || state.safe === false) return "unsafe";
  return "incomplete";
}

/** The robbery that cost the most, for the headline facts: the one-cent purchase if it worked, else the first that did. */
function worstRobbery(attacks = state.R.map((x) => [...x.attacks.values()]).flat()) {
  const robbed = attacks.filter((a) => a.verdict === "robbed");
  return robbed.find((a) => a.id === "price-tamper") ?? robbed[0] ?? null;
}

/** What the thief got, in money words, from an attack's evidence. */
function moneyFact(a) {
  const ev = a.evidence ?? {};
  const ft = ev.followThrough;
  if (ft?.captured) {
    const bag = state.labels["round0-purchase"]?.bag ?? state.R[0]?.buy?.bag;
    const price = ft.shopPaidCents ? money(ft.shopPaidCents / 100) : bag ? money(bag) : "";
    return `${offline() ? "the stand-in" : "PayPal"} captured ${amt(ft.captured)} and the shop ${ft.shopStatus === "fulfilled" || ft.shopStatus === "shipped" ? "shipped" : "marked paid"} the ${price ? `${price} ` : "full-price "}${theItem()}`;
  }
  return low(byStandIn(plurals(String(a.summary ?? "").replace(/\.$/, ""))));
}

/** What the shop did after the worst robbery, in one sentence. */
function shopLine(a) {
  const ft = a.evidence?.followThrough;
  const figs = moneyFigures(a).filter(([, l]) => !/captured$|^shop recorded/.test(l));
  const extra = figs.length ? ` ${figs.map(([n, l]) => `${n} ${l}`).join(", ")}.` : "";
  if (ft?.captured) return `The shop recorded ${ft.shopPaidCents ? money(ft.shopPaidCents / 100) : "the full price"} as paid${ft.shopStatus === "fulfilled" || ft.shopStatus === "shipped" ? ` and shipped the ${theItem()}` : ""}.${extra}`;
  return `${cap(moneyFact(a))}.${extra}`;
}

/** Shipping labels a robbery added: one label is one parcel leaving the warehouse. */
function labelCount(a) {
  const ev = a.evidence ?? {};
  const orders = Array.isArray(ev.orders) ? ev.orders : [];
  return ev.followThrough?.labelsAdded ?? ev.labelsAdded ?? (typeof ev.labelsAfter === "number" && typeof ev.labelsBefore === "number" ? ev.labelsAfter - ev.labelsBefore : orders.length ? orders.reduce((n, o) => n + ((o.labelsAfter ?? 0) - (o.labelsBefore ?? 0)), 0) : 0);
}

/** The figures behind a robbery that worked: what PayPal took, what the shop recorded, what left the warehouse. */
function moneyFigures(a) {
  const ev = a.evidence ?? {};
  const out = [];
  const ft = ev.followThrough;
  const took = offline() ? "the stand-in captured" : "PayPal captured";
  if (ft?.captured) out.push([amt(ft.captured), cap(took)]);
  if (ft?.shopPaidCents) out.push([money(ft.shopPaidCents / 100), `shop recorded as paid${ft.shopStatus ? `, ${ft.shopStatus}` : ""}`]);
  const orders = Array.isArray(ev.orders) ? ev.orders : [];
  const labels = labelCount(a);
  const oneOrder = Boolean(ft) || orders.length <= 1;
  // A shipping label is a parcel on its way: say what that means for the shop, not just the count.
  if (labels) out.push([String(labels), labels === 1 ? "shipping label printed: the order ships" : oneOrder ? `shipping labels printed for one order: it would ship ${times(labels)}` : `shipping labels printed across ${plural(orders.length, "order")}`]);
  const paid = typeof ev.paidAfter === "number" && typeof ev.paidBefore === "number" ? ev.paidAfter - ev.paidBefore : orders.length ? orders.filter((o) => ["paid", "fulfilled"].includes(o.after) && !["paid", "fulfilled"].includes(o.before)).length : null;
  if (paid && !ft) out.push([String(paid), paid === 1 ? "order marked paid" : "orders marked paid"]);
  if (ev.injected?.status) out.push([`HTTP ${ev.injected.status}`, `${ev.injected.issue ?? "refused"} from ${offline() ? "the stand-in" : "PayPal"}, ignored by the shop`]);
  return out;
}

/* ---------- The story in one sentence, the disclosure, the key moments ---------- */

function story(c, shop) {
  const running = !state.finished;
  const robbing = state.R.some((x) => x.attacks.size > 0);
  const refusal = state.refusals[0];
  const total = c.total;
  const tried = state.finished && c.ran < total ? (c.ran === 1 ? `ran the ${low(attackName([...state.results.keys()][0]))} robbery` : `ran ${c.ran} of the ${total} robberies`) : `${running ? "is trying" : "tried"} ${robberies(total)}`;
  const payPal = offline() ? "the stand-in" : "PayPal";
  // "bought a hoodie" when the run names what it bought; "bought from the shop" when it does not.
  const buy = (verb) => (anItem() ? `${verb} ${anItem()}` : `${verb} from the shop`);
  const onShop = anItem() ? "on the shop" : "on it";
  const refused = refusal ? `HTTP ${refusal.status}${refusal.name ? ` ${refusal.name}` : ""}` : "";
  if (state.mode === "heistproof" || state.mode === "baseline") {
    const alone = state.mode === "baseline" ? "On its own, without APIMatic's plugin or Heistproof's skills, an" : "An";
    const what = state.mode === "baseline" ? "PayPal" : "PayPal, Venmo and Pay Later";
    const added = `${alone} AI coding agent added ${what} to ${shop}.`;
    if (running && state.phase === "migrate") return `${alone} AI coding agent is adding ${what} to ${shop}. Heistproof will then ${buy("buy")} ${forReal()} and try ${robberies(total)} ${onShop}.`;
    if (running && !robbing) return `${added} Heistproof is now ${buy("buying")} ${forReal()}, before trying ${robberies(total)} ${onShop}.`;
    if (refusal && !state.paid) return `${added} Heistproof then started ${aPurchase()}, which ${payPal} refused (${refused}), and ${tried} on the shop.`;
    if (refusal && state.paid) return `${added} ${cap(payPal)} refused Heistproof's first purchase (${refused})${state.R[0]?.tests?.ok ? " although the shop's tests, the agent's included, passed" : ""}; the agent fixed it, and Heistproof then ${buy("bought")} ${forReal()} and ${tried} ${onShop}.`;
    return `${added} Heistproof then ${buy("bought")} ${forReal()} and ${tried} ${onShop}.`;
  }
  if (state.mode === "check") {
    if (running && !robbing) return `Heistproof is checking ${shop}, as it is: ${buy("buying")} ${forReal()}, then trying ${robberies(total)} ${onShop}. No AI changes any code in this run.`;
    if (state.mismatch && !state.paid) return `Heistproof checked ${shop}, as it is. It started ${aPurchase()}, but ${payPal} would have charged ${money(state.mismatch.paypal)} for the ${money(state.mismatch.bag)} bag, so it stopped before any money moved; then it ${tried} on the shop. No AI changed any code in this run.`;
    if (!state.paid && state.finished) return `Heistproof checked ${shop}, as it is. It started ${aPurchase()}; the purchase did not complete, and it ${tried} on the shop. No AI changed any code in this run.`;
    const last = [...state.R].reverse().find((x) => x.buy)?.buy;
    if (state.finished && last?.status === "overshipped") return `Heistproof checked ${shop}, as it is: it ${buy("bought")} ${forReal()}, paid ${last.amount || "once"} but the shop shipped it ${last.labels ? times(last.labels) : "a wrong number of times"}, and it ${tried} ${onShop}. No AI changed any code in this run.`;
    return `Heistproof checked ${shop}, as it is: it ${buy("bought")} ${forReal()} and ${tried} ${onShop}. No AI changed any code in this run.`;
  }
  if (state.mode === "existing") {
    const rounds = state.rounds > 1 ? ` (${plural(state.rounds, "round")} in all)` : "";
    if (running) return `Heistproof is checking ${shop} with ${aPurchase()} and ${robberies(total)}; an AI coding agent fixes every problem it finds, and Heistproof checks again.`;
    return `Heistproof checked ${shop} with ${aPurchase()} and ${robberies(total)}; an AI coding agent fixed every problem it found, and Heistproof checked again${rounds}.`;
  }
  return "";
}

/** The key moments, one line per round, with the money facts; read from the events, nothing hand-written. */
function beats(c) {
  const out = [];
  const total = c.total;
  const multi = state.rounds > 1 || state.R.length > 1;
  const lastIndex = state.R.length - 1;
  const payPal = offline() ? STANDIN : "PayPal's sandbox";
  const whoseTests = state.mode === "heistproof" || state.mode === "baseline" ? "the agent's" : "the shop's";
  if (state.mode === "heistproof" || state.mode === "baseline") {
    const a = state.R[0]?.agent;
    if (a?.done) out.push(["ok", `The AI coding agent added ${state.mode === "baseline" ? "PayPal" : "PayPal, Venmo and Pay Later"} in ${a.min} min (${a.turns} turns${a.files ? `, ${plural(a.files, "file")}` : ""})${a.skills ? `, working from ${plural(a.skills, "skill")} of APIMatic's PayPal plugin` : ""}${a.plan ? ", plan first" : ""}.`]);
    else if (a) out.push(["run", "The AI coding agent is adding PayPal…"]);
  }
  state.R.forEach((x, r) => {
    const parts = [];
    let bad = false;
    const fix = r > 0 && x.agent ? ` (after fix ${r}${x.agent.done ? `, ${x.agent.turns} turns, ${x.agent.min} min` : ""})` : "";
    const prefix = multi ? `Round ${r + 1}${fix}: ` : "";
    const b = x.buy;
    if (b?.status === "refused") {
      bad = true;
      parts.push(`${x.tests?.pass ? `${whoseTests} ${x.tests.pass} tests passed, but ` : ""}${payPal} refused the ${refusedWhat(b.refusal)} with HTTP ${b.refusal.status} ${b.refusal.name ?? ""}`.trim());
    } else if (b?.status === "mismatch") {
      bad = true;
      parts.push(`${offline() ? "the stand-in" : "PayPal"} would have charged ${money(b.pp)} for the ${money(b.bag)} bag, so the purchase was stopped before any money moved`);
    } else if (b?.status === "nobutton") {
      bad = true;
      parts.push(`the PayPal button never appeared${r > 0 ? " after the fix" : ""}, so no purchase was possible; the real purchase caught it`);
    } else if (b?.status === "overshipped") {
      bad = true;
      parts.push(`paid ${b.amount}, but the shop shipped ${times(b.labels)}${x.webhook?.accepted && b.labels === 2 ? " (once at capture, once more when PayPal's webhook arrived)" : ""}`);
    } else if (b?.status === "paid") parts.push(`paid ${b.amount} and shipped once`);
    else if (b?.status === "failed") {
      bad = true;
      parts.push(`the purchase did not complete (${low(b.verdict ?? "")})`);
    } else if (b?.status === "buying") parts.push(`${anItem() ? `buying ${anItem()}` : "buying from the shop"} ${inPayPal()}…`);
    // Blocked, robbed and could-not-run are counted apart: a robbery that could not run was never blocked.
    const A = [...x.attacks.values()].filter((a) => !a.pending);
    const robbed = A.filter((a) => a.verdict === "robbed");
    const held = A.filter((a) => a.verdict === "held");
    const skipped = A.filter((a) => a.verdict !== "robbed" && a.verdict !== "held");
    const closed = state.finished || r < lastIndex;
    const declined = held.find((a) => a.id === "declined-capture")?.evidence?.injected;
    const decline = declined?.status ? `, including ${offline() ? "the stand-in's" : "PayPal's"} card decline (${declined.status}${declined.issue ? ` ${declined.issue}` : ""})` : "";
    const couldNot = skipped.length ? `; ${skipped.length} could not run (${skipped.map((a) => attackName(a.id)).join(", ")})` : "";
    if (robbed.length) {
      bad = true;
      parts.push(A.length === 1 ? `the one robbery that ran worked: ${moneyFact(worstRobbery(A))}` : `${robbed.length} of ${robberies(A.length)} worked: ${moneyFact(worstRobbery(A))}`);
    } else if (A.length && closed) {
      if (skipped.length) parts.push(held.length ? `${held.length} of ${robberies(A.length)} blocked${couldNot}` : `no robbery could run (${skipped.map((a) => attackName(a.id)).join(", ")})`);
      else parts.push(`${A.length < total ? `${A.length} robberies tried, all blocked` : `all ${A.length} robberies blocked`}${decline}`);
    } else if (A.length) parts.push(`${A.length} of ${total} robberies tried, ${held.length} blocked so far…`);
    const t = x.thief;
    if (t && !t.skipped && t.tried && closed) {
      if (t.robbed) bad = true;
      const repeats = t.repeat ? ` (${t.repeat} only repeated a problem the books already showed)` : "";
      parts.push(`${t.robbed ? `${t.robbed} of the AI thief's ${robberies(t.tried)} got through` : `none of the AI thief's ${robberies(t.tried)} got through`}${repeats}`);
    }
    const mism = x.books?.mismatches?.length ?? 0;
    if (mism && closed) {
      bad = true;
      parts.push(`${plural(mism, "order")} in the shop's books ${mism === 1 ? "does" : "do"} not match ${offline() ? "the stand-in's" : "PayPal's"}`);
    }
    if (parts.length) {
      const text = `${prefix}${parts.map((p, i) => (i === 0 && prefix ? p : cap(p))).join(". ")}`;
      out.push([bad ? "bad" : closed ? "ok" : "run", text.endsWith("…") ? text : `${text}.`]);
    }
  });
  if (state.finished && c.ran && c.ran < total) out.push(["info", notRunReason(c, false)]);
  return out.slice(0, 5);
}

/** Why fewer than the ten robberies ran, in one sentence. */
function notRunReason(c, withNames = true) {
  const missing = (state.planned ?? ATTACKS.map(([id]) => id)).filter((id) => !state.results.has(id));
  const names = withNames ? ` (${missing.map((id) => attackName(id)).join(", ")})` : "";
  const n = c.notRun;
  if (c.ran === 1) return `This recording ran only the ${low(attackName([...state.results.keys()][0]))} robbery; the other ${n}${names} were not part of it.`;
  const last = state.R[state.R.length - 1];
  if (last?.buy && last.buy.status !== "paid" && last.buy.status !== "overshipped") return `The ${offline() ? "" : "real "}purchase did not complete, so the ${n} robberies that need a paid order${names} could not run.`;
  return `${n} of the ${c.total} robberies${names} were not part of this recording.`;
}

/** Why a finished run may not ship, in a few words: the robberies first, then the AI thief, the purchase, the books. */
function unsafeWhy(c) {
  const t = state.R[state.R.length - 1]?.thief;
  const buy = [...state.R].reverse().find((x) => x.buy)?.buy;
  const mism = state.books?.mismatches?.length ?? 0;
  const who = offline() ? "the stand-in" : "PayPal";
  if (c.robbed) return c.ran === 1 ? `the ${low(attackName([...state.results.keys()][0]))} robbery worked` : `${c.robbed} of ${robberies(c.ran)} worked`;
  if (t?.robbed) return `the AI thief got ${t.robbed} of its ${robberies(t.tried)} through${mism ? ` · ${plural(mism, "order")} in the books ${mism === 1 ? "does" : "do"} not match` : ""}`;
  if (buy?.status === "overshipped") return buy.labels ? `paid, but the shop shipped ${times(buy.labels)}` : "paid, but nothing shipped";
  if (buy?.status === "mismatch" || state.mismatch) return "the purchase was stopped: wrong amount";
  if (buy?.status === "refused") return `${who} refused the purchase${buy.refusal?.status ? ` (HTTP ${buy.refusal.status})` : ""}`;
  if (buy?.status === "nobutton") return "the PayPal button never appeared";
  if (mism) return `${plural(mism, "order")} in the books ${mism === 1 ? "does" : "do"} not match ${offline() ? "the stand-in's" : "PayPal's"}`;
  return `the ${offline() ? "" : "real "}purchase did not complete`;
}

/* ---------- Render everything that depends on state ---------- */

function render() {
  const c = counts();
  const shop = SHOPS[state.template] ?? (state.template ? state.template : "the shop");
  const eyebrow = [cap(shop), MODES[state.mode] ?? state.mode, state.rounds > 1 ? plural(state.rounds, "round") : "", state.plugin ? "APIMatic's PayPal plugin" : "", state.offline ? "offline · PayPal stand-in" : ""].filter(Boolean).join(" · ");
  $("#eyebrow").textContent = state.mode ? eyebrow : "";
  // The run's own title, as on its card; a run the index does not know yet gets the slogan for its kind.
  const slogan = state.mode === "check" ? "Try to rob a PayPal checkout." : state.mode === "existing" ? "Fix a PayPal checkout. Then try to rob it." : "Add PayPal. Then try to rob it.";
  const known = RUNS.find((x) => x.id === state.runId);
  $("#headline").textContent = known ? runTitle(known) : slogan;
  $("#proof-title").textContent = offline() ? "Proof from Heistproof's PayPal stand-in" : "Proof from PayPal";
  $("#proof-chip").textContent = offline() ? "no real money" : "sandbox, no real money";
  $("#proof-empty").textContent = offline() ? "The stand-in's answers appear here once the purchase starts." : "PayPal's answers appear here once the real purchase starts.";
  $("#story").textContent = story(c, shop) || "Loading the run…";
  const about = SHOP_NOTE[state.template];
  $("#shop-note").hidden = !about;
  if (about) $("#shop-note").textContent = about;
  $("#beats").innerHTML = beats(c).map(([kind, text]) => `<li class="${kind}">${esc(text)}</li>`).join("");

  const v = verdictOf(c);
  $("#verdict-card").className = `verdict-card ${v === "running" ? "pending" : v}`;
  $("#verdict-text").textContent = v === "running" && !state.mode ? "Loading" : VERDICT[v];
  let vnote = "";
  if (v === "running") vnote = state.activity;
  else if (v === "safe") vnote = [thiefRan() ? `all ${c.tried} blocked` : `${c.total} scripted robberies; the AI thief did not run`, state.paid ? `paid ${state.paid.amount} once` : "", state.pr ? "pull request opened" : state.branch ? "branch ready" : ""].filter(Boolean).join(" · ");
  else if (v === "unsafe") vnote = unsafeWhy(c);
  else vnote = [c.notRun ? `only ${c.ran} of ${c.total} robberies ran` : "", c.skipped ? `${c.skipped} could not run` : "", state.books && !state.books.matched ? "the books could not be matched" : "", "an incomplete check is never called safe"].filter(Boolean).join(" · ");
  $("#verdict-note").textContent = vnote;

  const cells = [];
  if (state.mode) {
    cells.push(`<div class="blocked"><b>${c.blocked}</b><span>blocked</span></div>`);
    cells.push(`<div class="robbed"><b>${c.robbed}</b><span>robbed</span></div>`);
    const couldNot = c.skipped + (state.finished ? c.notRun : 0);
    if (couldNot) cells.push(`<div class="other"><b>${couldNot}</b><span>could not run</span></div>`);
    const t = state.R[state.R.length - 1]?.thief;
    if (t?.robbed) cells.push(`<div class="robbed"><b>${t.robbed}</b><span>by the AI thief</span></div>`);
  }
  $("#tally").innerHTML = cells.join("");
  $("#replay-btn").hidden = !(state.finished || replaying);
  // While a replay plays, the hint is its clock: how far into the real run the replay has got.
  const hint = $("#replay-hint");
  hint.hidden = $("#replay-btn").hidden;
  hint.textContent = replaying ? `${elapsed() || "0:00"} into the run` : (state.replayHint ?? "");

  $("#board-chip").textContent = state.finished ? (c.ran < c.total ? `${c.ran} of ${c.total} ran` : "") : state.activity && state.phase === "attack" ? state.activity : "";
  $("#proof-empty").hidden = state.facts.size > 0 || !$("#amount").hidden || !$("#refusal").hidden || !$("#heist-box").hidden;
  $("#proof-btn").hidden = !($("#proof-more-facts").children.length || $("#shots").children.length);
  $("#tl-chip").textContent = state.finished ? [state.rounds > 1 ? plural(state.rounds, "round") : "", state.duration].filter(Boolean).join(" · ") : state.latest;
  renderNotRun(c);
  renderHeistBox(c, v);
  for (const g of $("#shots").children) g.querySelector(".shots-title").textContent = shotGroupTitle(g.id.slice(6));
  if (state.finished && !state.autoOpened) {
    state.autoOpened = true;
    const worst = worstRobbery();
    const head = worst && document.querySelector(`#row-${CSS.escape(worst.id)} .row-head`);
    if (head && !head.disabled) toggleRow(head, true);
  }
}

/** Rows that never ran fold into one sentence that says why, instead of nine "Not run" rows. */
function renderNotRun(c) {
  const note_ = $("#notrun-note");
  if (!state.finished || !c.notRun) {
    note_.hidden = true;
    for (const row of document.querySelectorAll(".row.notrun")) row.hidden = false;
    return;
  }
  for (const row of document.querySelectorAll(".row.notrun")) row.hidden = true;
  note_.hidden = false;
  note_.textContent = notRunReason(c);
}

/** On a robbed run the proof panel leads with the worst robbery's money facts, never with a reassuring green box. */
function renderHeistBox(c, v) {
  const box = $("#heist-box");
  const worst = c.robbed ? worstRobbery() : null;
  if (!worst) {
    box.hidden = true;
    $("#amount").hidden = $("#amount").dataset.show !== "1";
    return;
  }
  const figs = moneyFigures(worst);
  const bag = state.labels[`round${state.lastRound}-purchase`]?.bag ?? state.labels["round0-purchase"]?.bag ?? "49.00";
  const captured = worst.evidence?.followThrough?.captured;
  box.hidden = false;
  box.innerHTML = `<div class="amount-round">${esc(attackName(worst.id))}: ${esc(state.names.get(worst.id)?.what ?? ATTACK_WHAT[worst.id] ?? "")}</div>
    <div class="labels"><span>Bag total</span><span>${captured ? (offline() ? "The stand-in captured" : "PayPal captured") : "Result"}</span></div>
    <div class="big"><span>${money(bag)}</span><span>${captured ? esc(amt(captured)) : "robbed"}</span></div>
    <div class="shop-line">${esc(shopLine(worst))}</div>`;
  // The legit purchase's green "amounts match" box is not the point on a robbed run.
  $("#amount").hidden = v === "unsafe" && $("#amount").dataset.kind !== "bad";
}

/* ======================================================================================
   Events
   ====================================================================================== */

function onEvent(e) {
  if (e.t) {
    state.t0 ??= e.t;
    state.now = e.t;
  }
  // The engine closes every round with round.done, the last one too; the next round begins with its first own event.
  if (state.pendingRound && e.type !== "run.done") startRound();
  if (e.type === "prove.logged_in" && e.label) state.signedIn.add(String(e.label));
  const phase = railPhase(e);
  if (phase) setPhase(phase);
  if (e.type === "prove.amount_check" && e.label) state.labels[e.label] = { bag: e.bagTotal, pp: e.paypalAmount?.value ?? null, ok: e.ok, currency: e.paypalAmount?.currency };
  // Only the round's own purchase speaks for "Buy it" and the proof panel. A robbery's purchase is that robbery's row;
  // the AI thief's purchases are its own (their screenshots go under "All evidence", named after the thief's idea).
  const label = String(e.label ?? "");
  if (e.type.startsWith("prove.") && !isRoundPurchase(e)) {
    if (/-thief-\d+/.test(label)) {
      if (Array.isArray(e.screenshots)) addShots(e.screenshots);
    } else attackProgress(e);
  } else {
    handle(e);
    if (Array.isArray(e.screenshots)) addShots(e.screenshots);
  }
  render();
}

/** Which of the six steps an event belongs to (null: none). The AI thief and the books run in the engine's "attack"
    phase; the agent's fixing and the verdict share the last step, "Fix, then ship". */
function railPhase(e) {
  if (!e.phase || ["prepare", "build"].includes(e.phase) || e.type === "agent.tool_result") return null;
  if (e.type.startsWith("thief.") || /-thief-\d+/.test(String(e.label ?? ""))) return "thief";
  if (e.type === "books.reconciled") return "books";
  if (e.phase === "fix") return e.type.startsWith("prove") ? "prove" : "ship";
  if (e.type === "prove.webhook" || e.type === "webhook.resends") return null; // told after the robberies; it belongs to the purchase, not to a new step
  return e.phase;
}

/** A new round starts from its own tally and its own steps: the robberies wait again (each row keeps its earlier
    rounds as history), the steps after the fix are pending again, and the AI thief and the books are cleared until this
    round's own come in. Nothing from the round before is shown as done before it happens again. */
function startRound() {
  state.pendingRound = false;
  state.results = new Map();
  state.attack = null;
  for (const row of document.querySelectorAll("#rows .row")) {
    const id = row.id.slice(4);
    row.hidden = false;
    row.className = "row waiting";
    row.querySelector(".stamp").textContent = STAMP.waiting;
    clearRow(row, state.names.get(id)?.what ?? ATTACK_WHAT[id] ?? "");
    const hist = state.history.get(id) ?? [];
    row.querySelector(".history").textContent = hist.map((h) => `Round ${h.round + 1}: ${STAMP[h.verdict]?.toLowerCase() ?? h.verdict}`).join(" · ");
  }
  for (const p of ["prove", "attack", "thief", "books"]) {
    state.done.delete(p);
    state.bad.delete(p);
  }
  state.phase = null;
  for (const p of ["attack", "thief", "books"]) note(p, `round ${state.round + 1}: ${RAIL_DEFAULT[p]}`);
  state.thief = null;
  $("#thief").hidden = true;
  $("#thief-rows").innerHTML = "";
  state.books = null;
  $("#books-line").hidden = true;
  paintRail();
}

/** A purchase made by a robbery: a short live note on that robbery's row, its screenshots kept for the row. */
function attackProgress(e) {
  const row = state.attack && document.getElementById(`row-${state.attack}`);
  if (!row) return;
  if (Array.isArray(e.screenshots)) {
    const a = R().attacks.get(state.attack) ?? (R().attacks.set(state.attack, { id: state.attack, pending: true, shots: [] }).get(state.attack));
    a.shots = [...new Set([...(a.shots ?? []), ...e.screenshots])];
  }
  if (!row.classList.contains("running")) return;
  const what = row.querySelector(".what");
  if (e.type === "prove.buttons") what.textContent = `Starting ${aPurchase()}…`;
  else if (e.type === "prove.tampered") what.textContent = `The thief's browser sends ${e.body?.total ? money(e.body.total) : "a tampered amount"} for the bag…`;
  else if (e.type === "prove.amount_check" && e.paypalAmount) what.textContent = e.ok ? `PayPal order created for ${money(e.paypalAmount.value)}…` : `PayPal order created for ${amt(e.paypalAmount)} on a ${money(e.bagTotal)} bag…`;
  else if (e.type === "prove.approved") what.textContent = "Buyer approved; now the capture…";
  else if (e.type === "prove.sandbox_retry") what.textContent = "PayPal's sandbox page failed, trying again…";
  else if (e.type === "prove.result" && e.verdict) what.textContent = e.verdict;
}

/** What the shopper bought, when the run's events name it: an item name on the purchase's own events, or the price
    tampering robbery's "for the $49 hoodie" when that price fits the bag (older recordings say "hoodie" for every shop). */
function learnItem(e) {
  const named = typeof e.item === "string" ? e.item : e.item?.name ?? e.itemName ?? e.product?.name;
  if (named && ROUND_PURCHASE.test(String(e.label ?? ""))) {
    state.item = String(named).trim().toLowerCase();
    return;
  }
  if (state.item || e.id !== "price-tamper" || !e.what) return;
  const m = /for the \$([\d,.]+) ([a-z][\w -]*)$/i.exec(String(e.what));
  const bag = Number(state.labels["round0-purchase"]?.bag ?? state.R[0]?.buy?.bag);
  if (!m || !bag || /^(item|order|bag|product)s?$/i.test(m[2])) return;
  const ratio = bag / Number(m[1].replace(/,/g, ""));
  if (ratio >= 1 && Math.abs(ratio - Math.round(ratio)) < 0.001) state.item = m[2].trim().toLowerCase();
}

/** While the coding agent works, the verdict card and the rail say what it has done so far (skills read, the plan,
    files changed, steps taken), so a replay shows the work moving from its first seconds. */
function agentProgress(e) {
  const a = R().agent ?? (R().agent = { fixing: !(state.round === 0 && (state.mode === "heistproof" || state.mode === "baseline")), done: false, turns: 0, min: 0, files: 0, skills: 0, plan: false, steps: 0 });
  a.steps = (a.steps ?? 0) + 1;
  let file = "";
  try {
    file = String(JSON.parse(e.input).file_path ?? "").split("/shop/").pop();
  } catch {}
  const skills = state.skills.get(state.round)?.size ?? 0;
  const files = [...(state.files_.get(state.round) ?? [])].filter((f) => f !== "paypal-plan.md").length;
  const now = e.name === "Skill" ? "reading a skill" : ["Edit", "Write", "MultiEdit"].includes(e.name) ? (file ? `editing ${file}` : "editing") : e.name === "Bash" ? "running a command" : ["Read", "Grep", "Glob"].includes(e.name) ? (file ? `reading ${file}` : "reading the code") : "";
  const did = [skills ? `${plural(skills, "skill")} read` : "", a.plan ? "plan written" : "", files ? `${plural(files, "file")} changed` : ""].filter(Boolean);
  state.activity = `${a.fixing ? "The AI coding agent is fixing what failed" : "The AI coding agent is adding PayPal"}: step ${a.steps}${now ? `, ${now}` : ""}${did.length ? ` · ${did.join(", ")}` : ""}…`;
  const said = `at work: step ${a.steps}${did.length ? ` · ${did.join(", ")}` : ""}`;
  if (a.fixing) setFix(said);
  else note("migrate", said);
}

/** The robbery's plain description, with a price that no longer fits this shop's bag replaced by the bag itself. */
function whatFor(id, what) {
  if (!what || state.item) return what;
  const bag = state.labels["round0-purchase"]?.bag ?? state.R[0]?.buy?.bag;
  if (!bag) return what;
  // Older recordings say "the $49 hoodie" for every shop; on another shop that would name the wrong thing.
  return String(what).replace(/for the \$[\d,.]+ [a-z][\w -]*$/i, `for the ${money(bag)} bag`).replace(/\bhoodies\b/g, "items").replace(/\bhoodie\b/g, "item");
}

function handle(e) {
  const r = state.round;
  // Belt and braces (onEvent already routes them away): a purchase labelled for a robbery or the AI thief never
  // changes the round's purchase, the rail's "Buy it", or the proof panel.
  if (e.type.startsWith("prove.") && !isRoundPurchase(e)) return;
  if (e.type.startsWith("prove.")) learnItem(e);
  switch (e.type) {
    case "run.start": {
      state.mode = e.mode ?? "heistproof";
      state.template = e.template ?? String(e.shop ?? "").split("/").pop();
      state.offline = Boolean(e.offline);
      setTips();
      note("prove", state.offline ? "purchase, offline stand-in" : RAIL_DEFAULT.prove);
      if (Array.isArray(e.attacks) && e.attacks.length) {
        state.planned = e.attacks.map(String);
        for (const row of document.querySelectorAll(".row")) if (!state.planned.includes(row.id.slice(4))) row.remove();
      }
      const shop = SHOPS[state.template] ?? state.template;
      const meta = [e.model ? `Model <b>${esc(e.model)}</b>${e.provider === "meta" ? " · Meta Model API" : e.provider ? ` · ${esc(e.provider)}` : ""}` : "No coding agent in this run: checking only", e.node ? `Node ${esc(e.node)}` : "", e.heistproofCommit ? `Heistproof <code>${esc(String(e.heistproofCommit).slice(0, 7))}</code>` : ""].filter(Boolean);
      $("#engine").innerHTML = meta.join(" · ");
      $("#engine").title = "The coding agent runs in a Claude Code harness; the model is the one named here.";
      if (state.mode === "check") {
        note("migrate", "not used: PayPal already added");
        setFix("no fixing: check only");
      }
      if (state.mode === "existing") note("migrate", "PayPal already in the shop");
      step("start", "info", state.mode === "check" ? "Check an existing PayPal checkout" : state.mode === "existing" ? "Harden an existing PayPal checkout" : "A customer asks: “Do you take Venmo?”", esc(cap(shop)) + (state.offline ? ` · offline: ${STANDIN}, not the sandbox` : ""));
      state.activity = "Starting…";
      document.title = `${runTitle(RUNS.find((x) => x.id === state.runId) ?? { id: state.runId })} · Heistproof`;
      paintRail();
      break;
    }
    case "agent.start": {
      const fixing = !(r === 0 && (state.mode === "heistproof" || state.mode === "baseline"));
      R().agent = { fixing, done: false, turns: 0, min: 0, files: 0, skills: 0, plan: false, steps: 0 };
      state.hasAgent = true;
      $("#log-box").hidden = false;
      if (fixing) state.fixes++;
      step(`agent-${r}`, "run", fixing ? "The AI coding agent fixes what failed" : "The AI coding agent adds PayPal", `model ${esc(e.model)}${e.providerLabel ? ` via ${esc(e.providerLabel)}` : ""}`);
      if (fixing) setFix("AI coding agent at work…");
      else note("migrate", "AI coding agent at work…");
      state.activity = fixing ? "The AI coding agent is fixing what failed…" : "The AI coding agent is adding PayPal…";
      log("sys", "agent", `Coding agent started (${esc(e.model)})`);
      break;
    }
    case "agent.init": {
      const apimatic = (e.plugins ?? []).find((p) => p.name === "paypal");
      if (apimatic) {
        state.plugin = apimatic.version ?? "";
        log("sys", "plugin", `<span class="tag apimatic">APIMatic</span>PayPal Context Plugin ${esc(apimatic.version)} loaded`);
      }
      break;
    }
    case "agent.text":
      log("say", "agent", esc(e.text).slice(0, 400));
      break;
    case "agent.tool": {
      if (e.name === "Skill") {
        let skill = "";
        try {
          skill = JSON.parse(e.input).skill;
        } catch {}
        inRound(state.skills).add(skill);
        const now = [...state.skills.get(r)];
        const ap = now.filter((s) => !s.startsWith("heistproof:"));
        const ours = now.filter((s) => s.startsWith("heistproof:"));
        if (R().agent) R().agent.skills = ap.length;
        step(`skills-${r}`, "info", r === 0 && !R().agent?.fixing ? `Read ${plural(ap.length, "skill")} from APIMatic's PayPal plugin first` : `Read ${plural(now.length, "skill")} again before fixing`, `${ap.map((s) => esc(s.replace(/^paypal:typescript-/, ""))).join(", ")}${ours.length ? ` · plus Heistproof's ${ours.map((s) => esc(s.replace(/^heistproof:/, ""))).join(", ")}` : ""}`);
        log("skill", "skill", `<span class="tag ${skill.startsWith("heistproof:") ? "ours" : "apimatic"}">${skill.startsWith("heistproof:") ? "Heistproof" : "APIMatic"}</span>${esc(skill)}`);
      } else if (["Edit", "Write", "MultiEdit"].includes(e.name)) {
        let file = "";
        let lines = 0;
        try {
          const o = JSON.parse(e.input);
          file = String(o.file_path ?? "").split("/shop/").pop();
          lines = o.lines ?? 0;
        } catch {}
        if (file === "paypal-plan.md" && e.name === "Write") {
          if (R().agent) R().agent.plan = true;
          step(`plan-${r}`, "info", r === 0 ? "Wrote the plan before the PayPal code: paypal-plan.md" : "Rewrote the plan: paypal-plan.md", `${lines ? `${lines} lines, ` : ""}grounded in the SDK's own map`);
        }
        if (file) inRound(state.files_).add(file);
        const files = [...(state.files_.get(r) ?? [])];
        // The "changed files" line waits for the first edit to real shop code, so the plan stays listed before the code it preceded.
        if (files.some((f) => !["package.json", "package-lock.json", "paypal-plan.md"].includes(f))) step(`files-${r}`, "info", `Changed ${plural(files.length, "file")}`, files.map((f) => `<code>${esc(f)}</code>`).join(" "));
        log("edit", e.name.toLowerCase(), shortInput(e.input));
      } else if (e.name === "Bash") log("cmd", "run", shortInput(e.input));
      else if (["Read", "Grep", "Glob"].includes(e.name)) log("sys", e.name.toLowerCase(), shortInput(e.input));
      agentProgress(e);
      break;
    }
    case "agent.done": {
      const files = state.files_.get(r)?.size ?? 0;
      const a = R().agent ?? (R().agent = { fixing: !(r === 0 && (state.mode === "heistproof" || state.mode === "baseline")) });
      Object.assign(a, { done: true, turns: e.turns ?? 0, min: mins(e.durationMs), files });
      step(`agent-${r}`, "ok", a.fixing ? `The AI coding agent made fix ${r || state.fixes}` : "The AI coding agent added PayPal, Venmo and Pay Later", `${esc(e.turns)} turns · ${a.min} min${files ? ` · ${plural(files, "file")} changed` : ""}`, r, true);
      if (a.fixing) setFix(`fix ${r || state.fixes} made (${a.min} min), checking again`);
      else note("migrate", `done · ${plural(files, "file")} changed`);
      state.activity = "Running the shop's own tests…";
      log("sys", "done", `${esc(e.turns)} turns, ${a.min} min`);
      break;
    }
    case "build.tests": {
      const out = String(e.output ?? "");
      const pass = (out.match(/✔/g) ?? []).length;
      const fail = (out.match(/✖/g) ?? []).length;
      R().tests = { ok: e.ok, pass, fail };
      step(`tests-${r}`, e.ok ? "ok" : "bad", e.ok ? `${pass ? `${pass} unit tests` : "Unit tests"} pass` : `${fail || "Some"} unit tests fail`, `the shop's own tests, before any ${offline() ? "" : "real "}PayPal call`);
      log(e.ok ? "sys" : "say", "tests", e.ok ? "npm test passes" : "npm test FAILS");
      break;
    }
    case "sandbox.ready":
      fact("Webhook", e.webhookId);
      state.activity = offline() ? `Starting ${STANDIN}…` : "Opening PayPal's sandbox…";
      break;
    case "prove.buttons": {
      const shown = Object.entries(e.buttons ?? {}).map(([k, v]) => `${BUTTONS[k] ?? k} ${v ? "✓" : "✗"}`).join("  ");
      fact("Buttons", shown);
      if (e.payLaterMessage) fact("Pay Later", e.payLaterMessage);
      const b = (R().buy = { status: "buying", bag: e.bagTotal, shown });
      if (e.buttons && !e.buttons.paypal) {
        b.status = "nobutton";
        state.bad.add("prove");
        buyStep(r, "bad", "The PayPal button never appeared", `${esc(shown)} · no purchase possible`);
        note("prove", "no PayPal button");
        state.activity = "The PayPal button never appeared";
      } else {
        state.bad.delete("prove");
        buyStep(r, "run", buyTitle(), `${esc(shown)} · bag ${money(e.bagTotal)}`);
        note("prove", offline() ? "buying from the stand-in…" : "buying in the sandbox…");
        state.activity = `${cap(anItem() ? `buying ${anItem()}` : "buying from the shop")} ${forReal()}…`;
      }
      paintRail();
      break;
    }
    case "prove.order_created":
      if (e.paypalOrderId) {
        fact("PayPal order", e.paypalOrderId);
        const b = (R().buy ??= { status: "buying" });
        b.order = e.paypalOrderId;
        buyStep(r, "run", buyTitle(), `PayPal order <code>${esc(e.paypalOrderId)}</code> created · checking the amount…`);
      }
      break;
    case "prove.amount_check": {
      const b = (R().buy ??= { status: "buying" });
      const pp = e.paypalAmount ? amt(e.paypalAmount) : "?";
      b.bag = e.bagTotal;
      b.pp = e.paypalAmount?.value;
      const box = $("#amount");
      box.dataset.show = "1";
      box.dataset.kind = e.ok ? "good" : "bad";
      box.className = `amount ${e.ok ? "good" : "bad"}`;
      // Shipping, handling, insurance or tax on top of the goods: "bag $64.00 + $5.00 shipping = PayPal $69.00".
      const extras = (Array.isArray(e.extras) ? e.extras : []).filter((x) => x && Number(x.value));
      const sum = extras.length ? `bag ${money(e.goods ?? e.bagTotal)} + ${extras.map((x) => `${money(x.value)} ${esc(x.kind ?? "extra")}`).join(" + ")}` : `bag ${money(e.bagTotal)}`;
      box.innerHTML = `${state.rounds > 1 || r > 0 ? `<div class="amount-round">Round ${r + 1} purchase</div>` : ""}<div class="labels"><span>Bag total</span><span>${offline() ? "The stand-in will charge" : "PayPal will charge"}</span></div>
        <div class="big"><span>${money(e.bagTotal)}</span><span>${esc(pp)}</span></div>${extras.length ? `<div class="amount-extra">${sum}</div>` : ""}
        <div class="verdict-line">${e.ok ? "Amounts match: approve" : "Mismatch: purchase stopped before any money moved"}</div>`;
      if (e.ok) {
        buyStep(r, "run", buyTitle(), `${sum} = PayPal ${esc(pp)} · amounts match, approving…`);
        state.activity = "Amounts match: approving the purchase…";
      } else {
        if (e.paypalAmount) state.mismatch = { bag: e.bagTotal, paypal: e.paypalAmount.value };
        b.status = "mismatch";
        state.bad.add("prove");
        buyStep(r, "bad", "Purchase stopped before any money moved", `PayPal would have charged ${esc(pp)} for a ${money(e.bagTotal)} bag · order <code>${esc(b.order ?? "")}</code> · debug id <code>${esc(e.debugId ?? "")}</code>`);
        note("prove", `stopped: wrong amount (${pp})`);
        state.activity = "Purchase stopped: PayPal's amount is wrong";
        paintRail();
      }
      break;
    }
    case "prove.approved":
      if (!state.bad.has("prove")) {
        buyStep(r, "run", buyTitle(), `buyer approved order <code>${esc(e.paypalOrderId ?? "")}</code> · capturing the payment…`);
        state.activity = "Buyer approved: capturing the payment…";
      }
      break;
    case "prove.sandbox_retry":
      if (!state.bad.has("prove")) buyStep(r, "run", buyTitle(), "PayPal's sandbox page failed, trying again…");
      break;
    case "prove.paypal_errors": {
      const real = (e.errors ?? []).filter((x) => !String(x.call).includes("/oauth2/"));
      if (!real.length) break;
      const x = real[0];
      state.refusals.push(x);
      state.bad.add("prove");
      const b = (R().buy ??= {});
      b.status = "refused";
      b.refusal = x;
      const box = $("#refusal");
      box.hidden = false;
      const who = offline() ? "the stand-in" : "PayPal";
      box.innerHTML = `<b>Round ${r + 1} purchase refused by ${who}: HTTP ${esc(x.status)} ${esc(x.name ?? "")}</b><code>${esc(x.call)}</code><br>debug id <button type="button" class="raw-link" data-raw="${esc(x.debugId)}">${esc(x.debugId)}</button>${x.message ? ` · ${esc(x.message)}` : ""}`;
      const tests = R().tests?.ok ? ` · the ${state.mode === "heistproof" || state.mode === "baseline" ? "agent's" : "shop's"} tests passed, ${offline() ? "the stand-in" : "PayPal's real API"} said no` : "";
      buyStep(r, "bad", `${cap(who)} refused the ${refusedWhat(x)}`, `${esc(x.status)} ${esc(x.name ?? "")} on <code>${esc(x.call)}</code> · debug id <code>${esc(x.debugId)}</code>${b.shopOrder ? ` · shop order <code>${esc(b.shopOrder)}</code> stayed unpaid` : ""}${tests}`);
      note("prove", `${who === "PayPal" ? "PayPal" : "stand-in"} refused (${x.status})`);
      state.activity = `${cap(who)} refused the ${refusedWhat(x)} (${x.status} ${x.name ?? ""})`;
      log("say", "paypal", `PayPal refused ${esc(x.call)}: ${esc(x.status)} ${esc(x.name ?? "")}`);
      paintRail();
      break;
    }
    case "prove.result": {
      if (e.captureId) fact("Capture", e.captureId);
      if (e.shopOrder) fact("Shop order", e.shopOrder);
      const b = (R().buy ??= {});
      b.shopOrder = e.shopOrder;
      b.capture = e.captureId;
      b.verdict = e.verdict;
      const verdict = String(e.verdict ?? "");
      const amount = /Paid (\$[\d.,]+)/.exec(verdict)?.[1] ?? (b.pp ? money(b.pp) : "");
      b.amount = amount;
      const earlier = state.R.slice(0, r).map((x) => x.buy).filter(Boolean).map((p) => (p.status === "refused" ? `refused ${p.refusal?.status ?? ""}`.trim() : p.status === "mismatch" ? `${money(p.pp)} stopped` : p.status === "nobutton" ? "no button" : p.status === "overshipped" ? `shipped ${times(p.labels ?? 2)}` : p.status === "failed" ? "failed" : ""))
        .filter(Boolean);
      if (e.ok && e.captureId) {
        b.status = "paid";
        state.paid = { ...e, amount };
        state.bad.delete("prove");
        buyStep(r, "ok", `Paid${amount ? ` ${amount}` : ""}, shipped once`, `capture <code>${esc(e.captureId)}</code> · shop order <code>${esc(e.shopOrder ?? "")}</code>`);
        note("prove", `${earlier.length ? `${earlier.join(", ")}, then ` : ""}paid${amount ? ` ${amount}` : ""}`);
        state.activity = `Paid${amount ? ` ${amount}` : ""} · now the robberies`;
      } else if (!e.ok && String(e.label).includes("purchase")) {
        state.bad.add("prove");
        if (b.status === "mismatch" && /would charge/i.test(verdict)) break; // already told at the amount check
        const labels = /with (\d+) labels?/.exec(verdict);
        if (e.captureId && labels && Number(labels[1]) !== 1) {
          const n = Number(labels[1]);
          b.status = "overshipped";
          b.labels = n;
          state.paid = { ...e, amount };
          const went = n === 0 ? "nothing shipped" : `shipped ${times(n)}`;
          buyStep(r, "bad", `Paid${amount ? ` ${amount}` : ""}, but ${went}`, `${esc(plurals(verdict))} · capture <code>${esc(e.captureId)}</code>`);
          note("prove", `paid, but ${went}`);
          state.activity = `Paid, but ${went}`;
        } else {
          if (b.status !== "nobutton" && b.status !== "refused") b.status = "failed";
          buyStep(r, "bad", "The purchase did not complete", esc(plurals(verdict))); // PayPal's own refusal, when it follows, replaces this line
          note("prove", "purchase failed");
          state.activity = "The purchase did not complete";
        }
      }
      paintRail();
      break;
    }
    case "prove.webhook": {
      const accepted = e.ok || e.status === "accepted" || e.status === "verified";
      R(e.round ?? r).webhook = { accepted, status: accepted ? "accepted" : e.status, eventId: e.eventId, shopStatus: e.shopStatus };
      fact("Signed webhook", accepted ? `accepted (HTTP ${e.shopStatus}) · ${e.eventId}` : e.status === "not-delivered" ? "__webhook_pending__" : `refused by the shop (HTTP ${e.shopStatus}) · ${e.eventId ?? ""}`);
      if (accepted) step(`webhook-${e.round ?? r}`, "ok", offline() ? "The stand-in's signed webhook accepted" : "PayPal's signed webhook accepted", `event <code>${esc(e.eventId)}</code> · signature checked with ${offline() ? "the stand-in" : "PayPal"}`, e.round ?? r);
      break;
    }
    case "attack.start": {
      if (!R().attacks.size) state.bad.delete("attack");
      state.attack = e.id;
      learnItem(e);
      if (e.what) state.names.set(e.id, { name: e.title, what: whatFor(e.id, e.what) });
      const name = attackName(e.id);
      const what = state.names.get(e.id)?.what ?? ATTACK_WHAT[e.id] ?? e.title ?? "";
      const row = ensureRow(e.id, name, what);
      row.hidden = false;
      row.className = "row running";
      row.querySelector(".stamp").textContent = STAMP.running;
      clearRow(row, what);
      const prior = R().attacks.get(e.id);
      R().attacks.set(e.id, { id: e.id, pending: true, shots: prior?.shots ?? [] });
      const n = R().attacks.size;
      note("attack", `trying ${n} of ${totalAttacks()}…`);
      state.activity = `Robbery ${n} of ${totalAttacks()}: ${name}…`;
      break;
    }
    case "thief.start": {
      state.thief = { source: e.source, model: e.model, provider: e.provider, skipped: null, plans: new Map((e.plans ?? []).map((p, i) => [i, { ...p, verdict: "waiting", summary: "" }])) };
      R(e.round ?? r).thief = { tried: 0, robbed: 0, repeat: 0, skipped: null };
      state.bad.delete("thief");
      if (e.model && !state.mode?.match(/heistproof|baseline|existing/)) $("#engine").insertAdjacentHTML("beforeend", ` · AI thief <b>${esc(e.model)}</b>`);
      const planned = e.plans?.length ?? e.planned ?? 0;
      note("thief", planned ? `${robberies(planned)} invented…` : "inventing robberies…");
      renderThief();
      break;
    }
    case "thief.skipped": {
      state.thief = { ...(state.thief ?? { plans: new Map() }), skipped: e.reason };
      R(e.round ?? r).thief = { tried: 0, robbed: 0, repeat: 0, skipped: e.reason };
      note("thief", /no model key/i.test(String(e.reason)) ? "did not run: no model key" : "did not run");
      renderThief();
      break;
    }
    case "thief.plan": {
      if (!state.thief) state.thief = { plans: new Map() };
      state.thief.plans.set(e.index, { name: e.name, idea: e.idea, verdict: "running", summary: "" });
      state.activity = `AI thief: trying "${e.name}"`;
      renderThief();
      break;
    }
    case "thief.result": {
      if (!state.thief) state.thief = { plans: new Map() };
      state.thief.plans.set(e.index, { name: e.name, idea: e.idea, verdict: e.verdict, summary: e.summary });
      const t = (R(e.round ?? r).thief ??= { tried: 0, robbed: 0, repeat: 0, skipped: null });
      t.tried++;
      if (e.verdict === "robbed") {
        t.robbed++;
        state.bad.add("thief");
      } else if (e.verdict === "repeat") t.repeat = (t.repeat ?? 0) + 1;
      note("thief", `${t.robbed ? `${t.robbed} of ${t.tried} got through` : `${t.tried} tried, none got through`}${t.repeat ? ` · ${t.repeat} repeat${t.repeat === 1 ? "" : "s"}` : ""}`);
      state.activity = `AI thief: ${t.tried} of ${state.thief.plans.size} tried${t.robbed ? `, ${t.robbed} got through` : ""}`;
      // One line in the story for the AI thief, kept up to date as its robberies come in.
      const through = [...state.thief.plans.values()].filter((p) => p.verdict === "robbed").map((p) => esc(p.name));
      step(`thief-${e.round ?? r}`, t.robbed ? "bad" : "ok", t.robbed ? `The AI thief got ${t.robbed} of its ${robberies(t.tried)} through` : `None of the AI thief's ${robberies(t.tried)} got through`, t.robbed ? `${through.join(", ")}: a way in none of the ten scripted robberies found` : `judged by the books${t.repeat ? ` · ${t.repeat} only repeated a problem the books already showed` : ""}`, e.round ?? r);
      renderThief();
      break;
    }
    case "books.reconciled": {
      state.books = e;
      R(e.round ?? r).books = e;
      renderBooks(e);
      const mism = e.mismatches?.length ?? 0;
      const theirs = offline() ? "the stand-in's" : "PayPal's";
      state.activity = !e.matched ? "The books could not be matched" : mism ? `Books: ${plural(mism, "order")} ${mism === 1 ? "does" : "do"} not match` : `Books: they match ${theirs} records`;
      step(`books-${e.round ?? r}`, !e.matched ? "info" : mism ? "bad" : "ok", !e.matched ? `The books could not be matched against ${theirs} records` : mism ? `${plural(mism, "order")} in the books ${mism === 1 ? "does" : "do"} not match ${theirs} records` : `The books match ${theirs} records`, !e.matched ? esc(plurals(e.error ?? e.reason ?? "the back office shows no PayPal ids")) : `${plural(e.paid ?? 0, "paid order")} checked against ${offline() ? "the stand-in's" : "PayPal's"} captures`, e.round ?? r);
      if (e.mismatches?.length) state.bad.add("books");
      else state.bad.delete("books");
      note("books", !e.matched ? (e.error ? "could not be read" : "not matched") : e.mismatches?.length ? `${plural(e.mismatches.length, "order")} do${e.mismatches.length === 1 ? "es" : ""} not match` : `${plural(e.paid, "paid order")} match ${offline() ? "the stand-in" : "PayPal"}`);
      break;
    }
    case "attack.result": {
      learnItem(e);
      if (e.what) state.names.set(e.id, { name: e.title, what: whatFor(e.id, e.what) });
      const name = attackName(e.id);
      const what = state.names.get(e.id)?.what ?? ATTACK_WHAT[e.id] ?? (e.what ? "" : e.title) ?? "";
      state.results.set(e.id, e.verdict);
      if (!state.history.has(e.id)) state.history.set(e.id, []);
      state.history.get(e.id).push({ round: r, verdict: e.verdict });
      const prior = R().attacks.get(e.id);
      const a = { ...e, pending: false, shots: [...new Set([...(prior?.shots ?? []), ...(e.evidence?.screenshots ?? [])])] };
      R().attacks.set(e.id, a);
      const row = ensureRow(e.id, name, what);
      row.hidden = false;
      row.className = `row ${e.verdict}`;
      row.querySelector(".stamp").textContent = STAMP[e.verdict] ?? e.verdict;
      row.querySelector(".what").textContent = what;
      fillRow(row, a, r);
      if (e.verdict === "robbed") state.bad.add("attack");
      const inThis = [...R().attacks.values()];
      const held = inThis.filter((x) => x.verdict === "held").length;
      const robbed = inThis.filter((x) => x.verdict === "robbed").length;
      const skipped = inThis.filter((x) => x.verdict && x.verdict !== "held" && x.verdict !== "robbed").length;
      // Blocked, robbed and could-not-run, each counted on its own: a robbery that could not run was never blocked.
      const title = robbed ? `${robberies(robbed)} worked` : held && skipped ? `${held} of ${robberies(held + skipped)} blocked; ${skipped} could not run` : held ? `${robberies(held)} tried, all blocked` : `${robberies(skipped)} could not run`;
      step(`attacks-${r}`, robbed ? "bad" : held ? "ok" : "info", title, `${held} blocked · ${robbed} robbed${skipped ? ` · ${skipped} could not run` : ""}`);
      note("attack", robbed ? `${robbed} robbed · ${held} blocked` : `${held} blocked${skipped ? ` · ${skipped} could not run` : ""}`);
      state.activity = `${held + robbed + skipped} of ${totalAttacks()} robberies tried · ${held} blocked · ${robbed} robbed`;
      break;
    }
    case "webhook.resends": {
      // The sandbox had not delivered an event in time, so Heistproof asked PayPal to send it again. One line per event
      // type however often it asked, stamped with the time of the first ask.
      const who = offline() ? "The stand-in" : "PayPal";
      const round = e.round ?? r;
      const byType = new Map();
      for (const x of e.resends ?? []) {
        const type = x.eventType ?? "an event";
        const g = byType.get(type) ?? { asks: 0, resent: new Set(), at: x.at };
        g.asks++;
        for (const id of x.resent ?? []) if (id) g.resent.add(id);
        byType.set(type, g);
      }
      [...byType].forEach(([type, g], i) => {
        const ids = [...g.resent];
        step(`resend-${round}-${i}`, "info", `${who} had not delivered ${esc(type)} in time; Heistproof asked ${offline() ? "it" : "PayPal"} to send it again${g.asks > 1 ? ` (${times(g.asks)})` : ""}`, ids.length ? `${ids.length === 1 ? "event" : `${ids.length} events`} resent: ${ids.map((id) => `<code>${esc(id)}</code>`).join(", ")}` : "nothing was resent", round);
        stampAt(`resend-${round}-${i}`, g.at);
      });
      break;
    }
    case "round.done":
      if (e.failures > 0) {
        state.sentBack += e.failures;
        step(`sent-${r}`, "info", `${plural(e.failures, "problem")} sent back to the coding agent`, "with PayPal's own evidence: status, issue name, debug id");
        setFix(`${plural(e.failures, "problem")} sent to the agent`);
        state.activity = `${plural(e.failures, "problem")} sent back to the coding agent…`;
        log("say", "round", `Round ${r + 1}: ${plural(e.failures, "problem")} sent back to the coding agent`);
        state.rounds = Math.max(state.rounds, r + 2);
      } else if (state.sentBack) setFix(fixNote());
      state.round++;
      state.pendingRound = true;
      break;
    case "run.done": {
      state.finished = true;
      state.safe = e.safe;
      state.verdict = e.verdict === "safe" || e.verdict === "unsafe" || e.verdict === "incomplete" ? e.verdict : null;
      // Older runs wrote branchReady; newer ones write the branch name and, when the shop is on GitHub, the pull request URL.
      state.branch = e.branch ?? (e.branchReady ? "local" : null);
      state.pr = typeof e.pr === "string" && e.pr ? e.pr : null;
      const total = state.t0 ? Math.round((new Date(state.now) - new Date(state.t0)) / 1000) : 0;
      state.duration = total >= 60 ? `took ${Math.round(total / 60)} min` : total ? `took ${total} s` : "";
      if (e.rounds) state.rounds = e.rounds;
      setPhase("ship");
      state.done.add("ship");
      for (const row of document.querySelectorAll(".row.waiting, .row.running")) {
        row.className = "row notrun";
        row.querySelector(".stamp").textContent = STAMP.notrun;
        clearRow(row, ATTACK_WHAT[row.id.slice(4)] ?? "");
      }
      if (state.mode !== "check") setFix(state.sentBack ? fixNote() : "nothing to fix");
      const c = counts();
      const v = verdictOf(c);
      step("verdict", v === "unsafe" ? "bad" : v === "safe" ? "ok" : "info", VERDICT[v], v === "safe" ? `${thiefRan() ? "every robbery blocked" : `all ${c.total} scripted robberies blocked; the AI thief did not run`}${state.pr ? " · pull request opened" : state.branch ? " · branch ready" : ""}` : v === "incomplete" ? `${c.blocked} of ${c.total} robberies blocked, ${c.skipped + c.notRun} could not run` : unsafeWhy(c), state.lastRound);
      setShip(`${VERDICT[v]}${v === "safe" && state.pr ? " · pull request opened" : v === "safe" && state.branch ? " · branch ready" : ""}`);
      if (!state.thief) note("thief", "did not run in this recording");
      if (!state.books) note("books", "not matched in this run");
      state.activity = "";
      paintRail();
      renderEvidenceLinks();
      renderProofLinks();
      renderFacts(); // "not delivered yet" becomes what it was at the end
      break;
    }
  }
}

/** The books line: on a robbed run a count by kind, with the orders folded underneath; otherwise one plain sentence. */
function renderBooks(e) {
  const line = $("#books-line");
  const records = offline() ? "the stand-in's" : "PayPal's";
  if (!e.matched) {
    // The books could not be read or matched: say why, since an unmatched check is never called safe.
    line.hidden = !e.error && !e.reason;
    line.className = "books-line info";
    line.textContent = `The shop's books could not be matched against ${records} records${e.error || e.reason ? `: ${plurals(e.error ?? e.reason)}` : ""}. The check stays incomplete until they are.`;
    return;
  }
  line.hidden = false;
  const list = e.mismatches ?? [];
  line.className = `books-line ${list.length ? "bad" : "ok"}`;
  if (!list.length) {
    line.textContent = `Books: ${plural(e.paid ?? 0, offline() ? "order" : "PayPal order")} the shop calls paid, each backed by a completed ${offline() ? "capture at the stand-in" : "PayPal capture"} that covers it; none shipped more than once.`;
    return;
  }
  const kind = (m) => (/already pays for order/i.test(m.problem) ? "paid with a payment that already pays for another order" : /no completed capture/i.test(m.problem) ? (/with 0 parcel/i.test(m.problem) ? "marked paid with no completed payment" : "shipped with no completed payment") : /parcels? for \d+ completed capture/i.test(m.problem) ? "shipped more parcels than were paid for" : /^PayPal captured \$[\d.,]+ for an order of/i.test(m.problem) ? "paid less than the order costs" : /same goods as the real purchase/i.test(m.problem) ? "shipped the same goods for less" : "do not match for another reason");
  const kinds = new Map();
  for (const m of list) kinds.set(kind(m), (kinds.get(kind(m)) ?? 0) + 1);
  const parts = [...kinds].sort((a, b) => a[1] - b[1]).map(([k, n]) => `${n} ${k}`);
  line.innerHTML = `<b>${esc(plural(list.length, "order"))} ${list.length === 1 ? "does" : "do"} not match ${esc(records)} records: ${esc(parts.join(", "))}.</b><details><summary>The ${list.length === 1 ? "order" : "orders"}</summary><ul>${list.map((m) => `<li><code>${esc(m.order)}</code> ${esc(byStandIn(plurals(m.problem)))}</li>`).join("")}</ul></details>`;
}

/** "fixed in 1 min (43 turns)" or "2 fixes · 10 min": what the fix step says once the fixing is over. */
function fixNote() {
  const fixes = state.R.map((x) => x.agent).filter((a) => a?.fixing && a.done);
  if (!fixes.length) return "fixed";
  if (fixes.length === 1) return `fixed in ${fixes[0].min} min (${fixes[0].turns} turns)`;
  return `${fixes.length} fixes · ${fixes.reduce((n, a) => n + a.min, 0)} min`;
}

/* ======================================================================================
   The robbery rows
   ====================================================================================== */

function ensureRow(id, name, what) {
  let row = document.getElementById(`row-${id}`);
  if (row) {
    row.querySelector(".name").textContent = name;
    return row;
  }
  row = document.createElement("li");
  row.className = "row waiting";
  row.id = `row-${id}`;
  row.innerHTML = `<button type="button" class="row-head" aria-expanded="false" aria-controls="row-${esc(id)}-body" disabled><span class="stamp">${STAMP.waiting}</span><span class="row-text"><span class="name">${esc(name)}</span><span class="what">${esc(what)}</span><span class="history"></span></span><span class="chev" aria-hidden="true"></span></button><div class="row-body" id="row-${esc(id)}-body" hidden><p class="said"></p><div class="money"></div><p class="untested"></p><div class="ids"></div><div class="proofs"></div></div>`;
  $("#rows").append(row);
  return row;
}

function clearRow(row, what) {
  const head = row.querySelector(".row-head");
  head.disabled = true;
  toggleRow(head, false);
  row.querySelector(".what").textContent = what;
  row.querySelector(".history").textContent = "";
  row.querySelector(".said").textContent = "";
  row.querySelector(".money").innerHTML = "";
  row.querySelector(".money").hidden = true;
  row.querySelector(".untested").textContent = "";
  row.querySelector(".ids").innerHTML = "";
  row.querySelector(".proofs").innerHTML = "";
}

/** Fills an open row: the result, the money figures, what could not be tested, PayPal's ids, large captioned proofs. */
function fillRow(row, a, r) {
  row.querySelector(".said").textContent = byStandIn(plurals(a.summary ?? ""));
  const hist = state.history.get(a.id) ?? [];
  const earlier = hist.slice(0, -1).filter((h) => h.verdict !== a.verdict);
  row.querySelector(".history").textContent = earlier.length ? `${earlier.map((h) => `Round ${h.round + 1}: ${STAMP[h.verdict]?.toLowerCase() ?? h.verdict}`).join(" · ")} · Round ${r + 1}: ${STAMP[a.verdict]?.toLowerCase() ?? a.verdict}` : "";
  const money_ = row.querySelector(".money");
  const figs = a.verdict === "robbed" ? moneyFigures(a) : [];
  const labels = a.verdict === "robbed" ? labelCount(a) : 0;
  const why = labels > 1 && SHOP_LABELS[state.template] ? `<p class="money-why">${esc(SHOP_LABELS[state.template])}</p>` : "";
  money_.hidden = figs.length === 0;
  money_.innerHTML = figs.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join("") + why;
  const untested = Array.isArray(a.untested) ? a.untested : [];
  row.querySelector(".untested").textContent = untested.length ? `Could not be tested in this run: ${untested.join(", ")}.` : "";
  row.querySelector(".ids").innerHTML = evidenceIds(a.evidence)
    .map(({ label, ids }) => {
      const links = ids.map((id) => `<button type="button" class="raw-link" data-raw="${esc(id)}" title="${esc(offline() ? "The stand-in's" : "PayPal's")} raw answer for ${esc(id)}">${esc(id)}</button>`).join("");
      return ids.length > 2 ? `<details class="id-line"><summary>${esc(label)} (${ids.length})</summary><span class="id-list">${links}</span></details>` : `<p class="id-line"><span>${esc(label)}:</span> ${links}</p>`;
    })
    .join("");
  // Each picture once: byte-for-byte copies collapse into one (the later file, whose caption says more), and two
  // screenshots with the same caption keep only the later one.
  const shots = onePerPicture((a.shots ?? []).filter((f) => showShot(f, a)));
  const big = shots.filter((f) => /-(review|backoffice|stuck|paypal-wrong-amount)\.png$/.test(f));
  const byCaption = new Map();
  for (const f of big.length ? big : shots.slice(0, 2)) byCaption.set(captionFor(f, a), f);
  const large = [...byCaption.values()];
  const shown = new Set(large.map((f) => state.same[f] ?? f));
  const small = shots.filter((f) => !large.includes(f) && !shown.has(state.same[f] ?? f) && !big.includes(f));
  // Back-office pages first and full width: they are the proof of what the shop did.
  large.sort((x, y) => Number(Boolean(state.focus[y])) - Number(Boolean(state.focus[x])));
  row.querySelector(".proofs").innerHTML = `${large.map((f) => figureFor(f, a)).join("")}${small.length ? `<div class="thumbs">${small.map((f) => imgFor(f, a)).join("")}</div>` : ""}`;
  row.querySelector(".row-head").disabled = false;
}

/** One file per picture: of byte-for-byte copies, the last one listed (in the place of the first). */
function onePerPicture(files) {
  const seen = new Map();
  for (const f of files) seen.set(state.same[f] ?? f, f);
  return [...seen.values()];
}

/** The shop order a blocked robbery aimed at, as the back office showed it afterwards (or null). */
function blockedOrder(a) {
  const ev = a.evidence ?? {};
  const o = (Array.isArray(ev.orders) ? ev.orders : []).find((x) => x?.id);
  if (o) return { id: o.id, before: o.before, after: o.after, labels: (o.labelsAfter ?? 0) - (o.labelsBefore ?? 0) };
  if (ev.targetShopOrder) return { id: ev.targetShopOrder, before: ev.before, after: ev.after, labels: 0 };
  return null;
}

/** A screenshot earns its place: never an error page, and a blocked robbery's back office only when it shows the order it aimed at. */
function showShot(f, a) {
  if (state.broken.has(f)) return false;
  if (parseShot(f).token !== "backoffice") return true;
  return a?.verdict === "robbed" || Boolean(a && blockedOrder(a));
}

const PAID = ["paid", "fulfilled", "shipped", "completed"];
/** The back office's caption follows the robbery's verdict: marked paid only when it was robbed. */
function backOfficeCaption(a) {
  if (a?.verdict === "robbed") return "The shop's back office: the outlined order is marked paid, with its shipping labels";
  const o = a && blockedOrder(a);
  if (!o) return "The shop's back office after the robbery";
  const paidAfter = PAID.includes(String(o.after).toLowerCase());
  const paidBefore = PAID.includes(String(o.before).toLowerCase());
  if (paidAfter && paidBefore) return `The shop's back office: order ${o.id} stayed ${o.after}${o.labels ? "" : ", with no extra shipping label"}`;
  if (paidAfter) return `The shop's back office: order ${o.id} paid once, with ${plural(Math.max(o.labels, 0), "shipping label")}`;
  return `The shop's back office: order ${o.id} stayed unpaid${o.after ? ` (${o.after})` : ""}`;
}

/** A human caption for a screenshot, from its file name and the amounts seen in that purchase. */
const SHOT_TOKENS = ["paypal-wrong-amount", "checkout", "paypal", "review", "after", "backoffice", "stuck"];
/** "round0-attack-penny-3-review.png" -> { label: "round0-attack-penny", token: "review" }; "round0-attack-bad-bag-backoffice.png" works too. */
function parseShot(f) {
  const base = f.replace(/\.png$/, "");
  const token = SHOT_TOKENS.find((t) => base.endsWith(`-${t}`)) ?? base.split("-").pop();
  const label = base.slice(0, Math.max(0, base.length - token.length - 1)).replace(/-\d+[a-z]?$/, "");
  return { label, token };
}

function captionFor(f, a = null) {
  const { label, token } = parseShot(f);
  const seen = state.labels[label] ?? {};
  const bag = seen.bag ? money(seen.bag) : "the";
  const pp = seen.pp != null ? amt({ value: seen.pp, currency: seen.currency }) : "";
  const who = /(^|-)attack-/.test(label) ? "the thief's browser" : /-thief-\d+/.test(label) ? "the AI thief's browser" : "the shopper's browser";
  const paypal = offline() ? "The stand-in's" : "PayPal's own";
  switch (token) {
    case "checkout":
      return seen.bag ? `The shop's checkout in ${who}: a ${bag} bag` : `The shop's checkout in ${who}`;
    case "paypal":
      // The buyer signs in on the first purchase only; later purchases open straight on PayPal's review page.
      if (offline()) return "The stand-in's approval page";
      return state.signedIn.has(label) ? "PayPal's sandbox sign-in" : "PayPal's review page (the buyer was already signed in)";
    case "review":
      return pp && seen.ok === false ? `${paypal} review page: ${pp} for the ${bag} bag` : `${paypal} review page${pp || seen.bag ? `: ${pp || bag}` : ""}`;
    case "after":
      return "The shop after the purchase";
    case "backoffice":
      return backOfficeCaption(a);
    case "stuck":
      return "PayPal's sandbox page failed (\"Things don't appear to be working\"); Heistproof tried again";
    case "paypal-wrong-amount":
      return `${paypal} page: ${pp} for the ${bag} bag, so the purchase was stopped`;
    default:
      return token.replace(/-/g, " ");
  }
}
const imgFor = (f, a = null) => `<img src="${api.file(state.runId, f)}" alt="${esc(captionFor(f, a))}" data-view data-caption="${esc(captionFor(f, a))}"${state.focus[f] ? ` data-focus="${esc(f)}"` : ""} loading="lazy" />`;
const captionHtml = (f, a) => esc(captionFor(f, a)).replace(/(\$[\d,.]+( [A-Z]{3})?)/g, "<b>$1</b>");
/** A screenshot with its caption; a back-office page is shown as strips of its own pixels (the column headings and the
    outlined order), large enough to read, and opens whole on click. */
function figureFor(f, a = null) {
  const z = state.focus[f];
  if (!z) return `<figure>${imgFor(f, a)}<figcaption>${captionHtml(f, a)}</figcaption></figure>`;
  const cw = z.x[1] - z.x[0];
  const caption = esc(captionFor(f, a));
  const pct = (n) => `${Math.round(n * 10000) / 100}%`;
  const wins = z.windows
    .map(([y0, y1], i) => `<span class="win" style="aspect-ratio: ${cw} / ${y1 - y0}"><img src="${api.file(state.runId, f)}" alt="${i ? "" : caption}" data-view data-caption="${caption}" data-focus="${esc(f)}" loading="lazy" style="width: ${pct(z.w / cw)}; left: ${pct(-z.x[0] / cw)}; top: ${pct(-y0 / (y1 - y0))}" /></span>`)
    .join("");
  return `<figure class="bo"><span class="crop">${wins}</span><figcaption>${captionHtml(f, a)} <span class="zoom-hint">Open the whole page.</span></figcaption></figure>`;
}

/** PayPal's own ids from an attack's evidence, each group labelled with what it is: enough to look the robbery up in
    the sandbox account or in the raw calls. */
function evidenceIds(ev = {}) {
  const groups = [];
  const pp = offline() ? "Stand-in" : "PayPal";
  const add = (label, ids) => {
    const list = [...new Set(ids.filter(Boolean))].filter((id) => !groups.some((g) => g.ids.includes(id)));
    if (list.length) groups.push({ label, ids: list });
  };
  const ft = ev.followThrough;
  if (ft?.paypalOrderId) add(ft.captured ? `${pp} order captured for ${amt(ft.captured)}` : `${pp} order of the robbery's purchase`, [ft.paypalOrderId]);
  add(`${pp} order it aimed at`, [ev.targetPayPalOrder]);
  add(`${pp} order`, [ev.paypalOrderId]);
  add(`${pp} orders the tampered requests created`, (ev.tries ?? []).map((t) => t.paypalOrderId));
  add(`${pp} ${(ev.paypalCaptures ?? []).length === 1 ? "capture" : "captures"}`, (ev.paypalCaptures ?? []).map((c) => c.id));
  add(`${pp} event it sent again`, [ev.eventId]);
  add(`${pp}'s "approved" event`, [ev.approvedWebhook]);
  add(`${pp} debug id of the card decline`, [ev.injected?.debugId]);
  return groups;
}

/* ======================================================================================
   Proof from PayPal
   ====================================================================================== */

function fact(label, value) {
  state.facts.set(label, value);
  renderFacts();
}

function renderFacts() {
  const show = (k) => {
    const v = state.facts.get(k);
    const by = offline() ? "the stand-in" : "the sandbox";
    if (v === "__webhook_pending__") return `<span class="note">${state.finished ? (state.paid?.captureId ? `not delivered by ${by} during this run` : "none expected: nothing was captured") : `not delivered by ${by} yet`}</span>`;
    return esc(v);
  };
  // Offline, the ids are the stand-in's, and the labels say so.
  const name = (k) => (offline() ? { "PayPal order": "Stand-in order", Capture: "Stand-in capture", "Signed webhook": "Stand-in webhook" }[k] ?? k : k);
  const list = (keys) => keys.map((k) => `<dt>${esc(name(k))}</dt><dd>${show(k)}</dd>`).join("");
  $("#proof-facts").innerHTML = list(KEY_FACTS.filter((k) => state.facts.has(k)));
  $("#proof-more-facts").innerHTML = list([...state.facts.keys()].filter((k) => !KEY_FACTS.includes(k)));
}

/** A title for a group of screenshots: "Round 2 purchase", "The real purchase, try 2", "AI thief: Duplicate SKU lines". */
function shotGroupTitle(group) {
  const multi = state.rounds > 1 || state.R.length > 1;
  const buy = /^round(\d+)-purchase(?:-(paypal|venmo|paylater))?(?:-try(\d+))?$/.exec(group);
  if (buy) {
    const n = Number(buy[1]);
    const base = multi || n > 0 ? `Round ${n + 1} purchase` : offline() ? "The purchase" : "The real purchase";
    return `${base}${buy[2] && buy[2] !== "paypal" ? ` with ${BUTTONS[buy[2]] ?? buy[2]}` : ""}${buy[3] ? `, try ${buy[3]}` : ""}`;
  }
  const thief = /^round(\d+)-thief-(\d+)-buy/.exec(group);
  if (thief) {
    const plan = state.thief?.plans.get(Number(thief[2]));
    return `AI thief${multi ? `, round ${Number(thief[1]) + 1}` : ""}: ${plan?.name ?? `robbery ${Number(thief[2]) + 1}`}`;
  }
  return group.replace(/-/g, " ");
}

/** The shopper's screenshots (and the AI thief's purchases), grouped by purchase ("round0-purchase-3-review.png" -> Round 1 purchase). */
function addShots(files) {
  for (const f of files) {
    if (state.shots.includes(f) || state.broken.has(f)) continue;
    state.shots.push(f);
    const group = parseShot(f).label || "shots";
    let g = document.getElementById(`shots-${group}`);
    if (!g) {
      g = document.createElement("div");
      g.id = `shots-${group}`;
      g.innerHTML = `<p class="shots-title">${esc(shotGroupTitle(group))}</p><div class="shots-grid"></div>`;
      $("#shots").append(g);
    }
    // The same picture twice in one purchase (PayPal's review page saved as two files): one figure, the later file.
    const same = state.same[f] ?? f;
    const html = `<figure data-same="${esc(same)}">${imgFor(f)}<figcaption>${esc(captionFor(f))}</figcaption></figure>`;
    const twin = [...g.querySelectorAll("figure")].find((x) => x.dataset.same === same);
    if (twin) twin.outerHTML = html;
    else g.querySelector(".shots-grid").insertAdjacentHTML("beforeend", html);
  }
}

const callFiles = () => state.files.filter((f) => /paypal-calls\.json$/.test(f));
const webhookFiles = () => state.files.filter((f) => /webhooks\.json$/.test(f));

function renderProofLinks() {
  const links = [];
  if (callFiles().length) links.push(`<button type="button" data-doc="calls">${offline() ? "The stand-in's raw answers" : "PayPal's raw answers"}</button>`);
  if (webhookFiles().length) links.push(`<button type="button" data-doc="webhooks">${offline() ? "The stand-in's webhooks, byte for byte" : "PayPal's webhooks, byte for byte"}</button>`);
  for (const f of state.files.filter((x) => /shop\.log$/.test(x))) links.push(`<button type="button" data-doc="text" data-file="${esc(f)}">Shop log${/round(\d+)/.test(f) ? ` (round ${Number(/round(\d+)/.exec(f)[1]) + 1})` : ""}</button>`);
  $("#proof-links").innerHTML = links.join("");
}

function renderEvidenceLinks() {
  const links = [];
  if (state.files.includes("REPORT.md")) links.push(`<button type="button" data-doc="md" data-file="REPORT.md">Evidence report</button>`);
  const rank = (f) => (f === "migrate.patch" ? 0 : /^fix-(\d+)/.test(f) ? 1 + Number(/^fix-(\d+)/.exec(f)[1]) : f === "final.patch" ? 1000 : 500);
  const patches = state.files.filter((f) => f.endsWith(".patch")).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const f of patches) {
    const label = f === "migrate.patch" ? "Agent's changes" : /^fix-(\d+)/.test(f) ? `Fix ${/^fix-(\d+)/.exec(f)[1]}` : f === "final.patch" ? "Final diff" : f;
    links.push(`<button type="button" data-doc="patch" data-file="${esc(f)}" id="link-${esc(f.replace(/\W/g, "-"))}">${esc(label)}</button>`);
  }
  // An empty final.patch means the last fix was already the final code; a link to nothing would only puzzle.
  if (patches.includes("final.patch")) fetch(api.file(state.runId, "final.patch")).then((x) => x.text()).then((t) => {
    if (!t.trim()) document.getElementById("link-final-patch")?.remove();
  }).catch(() => {});
  if (callFiles().length) links.push(`<button type="button" data-doc="calls">${offline() ? "The stand-in's raw answers" : "PayPal's raw answers"}</button>`);
  if (state.files.includes("events.jsonl")) links.push(`<button type="button" data-doc="text" data-file="events.jsonl">Event log</button>`);
  if (state.pr) links.push(`<a href="${esc(state.pr)}" rel="noopener" target="_blank">Pull request</a>`);
  $("#evidence-links").innerHTML = links.join("");
}

/* ======================================================================================
   Viewers: a screenshot, or a file rendered for reading
   ====================================================================================== */

async function openDoc(kind, file, match = "") {
  const doc = $("#doc");
  const body = $("#doc-body");
  const title = $("#doc-title");
  body.innerHTML = "<p>Loading…</p>";
  $("#doc-raw").href = file ? api.file(state.runId, file) : api.file(state.runId, callFiles()[0] ?? "");
  title.textContent = kind === "calls" ? (offline() ? "The stand-in's raw answers (recorded through the proxy)" : "PayPal's raw answers (recorded through the proxy)") : kind === "webhooks" ? (offline() ? "The stand-in's webhooks, as delivered" : "PayPal's webhooks, as delivered") : file;
  if (!doc.open) doc.showModal();
  try {
    if (kind === "calls" || kind === "webhooks") {
      const files = kind === "calls" ? callFiles() : webhookFiles();
      const all = [];
      for (const f of files) {
        const arr = await (await fetch(api.file(state.runId, f))).json();
        for (const x of Array.isArray(arr) ? arr : []) all.push({ ...x, _file: f });
      }
      all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      body.innerHTML = kind === "calls" ? renderCalls(all, match) : renderWebhooks(all, match);
      body.querySelector(".hit summary")?.scrollIntoView({ block: "start" });
      return;
    }
    const text = await (await fetch(api.file(state.runId, file))).text();
    if (kind === "md") body.innerHTML = markdown(text);
    else if (kind === "patch") body.innerHTML = text.trim() ? `<pre class="patch">${patch(text)}</pre>` : "<p>No changes after the last round: the fix was already in place.</p>";
    else body.innerHTML = `<pre>${esc(text)}</pre>`;
  } catch (err) {
    body.innerHTML = `<p>Could not load ${esc(file)}: ${esc(err.message)}</p>`;
  }
}

function renderCalls(calls, match) {
  const real = calls.filter((c) => !String(c.path).includes("/oauth2/"));
  const hits = (c) => match && JSON.stringify(c).includes(match);
  const items = real.map((c) => {
    const bad = c.status >= 400;
    const name = c.responseBody?.name ?? c.responseBody?.status ?? "";
    return `<li class="${hits(c) ? "hit" : ""}"><details${hits(c) ? " open" : ""}><summary><span class="m">${esc(c.method)} ${esc(c.path)}</span><span class="s ${bad ? "bad" : "ok"}">${esc(c.status)}${name ? ` ${esc(name)}` : ""}</span>${c.injected ? `<span>negative testing: ${esc(c.injected.mock_application_codes ?? JSON.stringify(c.injected))}</span>` : ""}<span class="t">${c.debugId ? `debug id ${esc(c.debugId)} · ` : ""}${esc(String(c.at).replace("T", " ").slice(0, 19))}</span></summary><pre>${esc(JSON.stringify({ requestBody: c.requestBody, responseBody: c.responseBody }, null, 2))}</pre></details></li>`;
  });
  const tokens = calls.length - real.length;
  return `<p>${real.length} calls to ${offline() ? STANDIN : "PayPal's sandbox API"}, recorded by Heistproof's proxy with ${offline() ? "the stand-in's" : "PayPal's own"} debug ids${tokens ? `; ${tokens} token calls left out` : ""}. ${match ? `Highlighted: the calls that mention <code>${esc(match)}</code>.` : ""}</p><ul class="calls">${items.join("")}</ul>`;
}

function renderWebhooks(hooks, match) {
  const hits = (h) => match && JSON.stringify(h).includes(match);
  const items = hooks.map((h) => {
    let body = h.body;
    try {
      body = JSON.stringify(JSON.parse(h.body), null, 2);
    } catch {}
    const bad = h.shopStatus >= 400;
    return `<li class="${hits(h) ? "hit" : ""}"><details${hits(h) ? " open" : ""}><summary><span class="m">${esc(h.source === "attacker" ? "thief" : offline() ? "stand-in" : "PayPal")} → shop</span><span>${esc(h.eventType ?? "(no event type)")}</span><span class="s ${bad ? "ok" : h.source === "attacker" ? "bad" : "ok"}">shop answered HTTP ${esc(h.shopStatus)}</span><span class="t">${esc(h.eventId ?? "")} · ${esc(String(h.at).replace("T", " ").slice(0, 19))}</span></summary><pre>${esc(body || "(empty body)")}</pre></details></li>`;
  });
  return `<p>${hooks.length} deliveries to the shop's webhook route: ${offline() ? "the stand-in's own" : "PayPal's own"}, and the thief's forged and replayed copies. A row from the thief that the shop answered with HTTP 200 is a robbery.</p><ul class="calls">${items.join("")}</ul>`;
}

/** Enough Markdown for the evidence report: headings, paragraphs, lists, tables, bold and code. Rounds are shown counted from 1. */
function markdown(src) {
  const shift = /\bRound 0\b/.test(src);
  const fix = (s) => s.replace(/\bRound (\d+)\b/g, (m, n) => `Round ${shift ? Number(n) + 1 : n}`).replace(/verified and accepted/g, "accepted").replace(/Signed webhook: verified/g, "Signed webhook: accepted");
  const inline = (s) => esc(plurals(fix(s))).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const lines = src.split("\n");
  let out = "";
  let i = 0;
  // The report's result cells in the console's words: Blocked, Robbed, Could not run, Repeat.
  const cell = (c) => (/^(HELD|Blocked|BLOCKED)$/.test(c) ? `<td class="held">Blocked</td>` : /^(ROBBED|Robbed)$/.test(c) ? `<td class="robbed">Robbed</td>` : /^(SKIPPED|Skipped|NOT RUN|Not run)$/.test(c) ? `<td>Could not run</td>` : /^(REPEAT|Repeat)$/.test(c) ? `<td>Repeat</td>` : `<td>${inline(c)}</td>`);
  while (i < lines.length) {
    const l = lines[i];
    if (/^#{1,3} /.test(l)) {
      const n = /^#+/.exec(l)[0].length;
      out += `<h${n}>${inline(l.slice(n + 1))}</h${n}>`;
      i++;
    } else if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out += `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("")}</tbody></table>`;
    } else if (/^\s*- /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*- /.test(lines[i])) items.push(lines[i++]);
      out += `<ul>${items.map((x) => `<li>${inline(x.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`;
    } else if (!l.trim()) i++;
    else {
      const p = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||\s*- )/.test(lines[i])) p.push(lines[i++]);
      out += `<p>${inline(p.join(" "))}</p>`;
    }
  }
  return `${out}${shift ? `<p class="fine">Rounds in this report are shown counted from 1 (the file counts from 0).</p>` : ""}`;
}

function patch(text) {
  return text
    .split("\n")
    .map((l) => {
      const s = esc(l);
      if (l.startsWith("diff --git")) return `<span class="f">${esc(l.replace(/^diff --git a\/(\S+) b\/.*/, "$1"))}</span>`;
      if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("index ")) return "";
      if (l.startsWith("@@")) return `<span class="h">${s}</span>`;
      if (l.startsWith("+")) return `<span class="a">${s}</span>`;
      if (l.startsWith("-")) return `<span class="d">${s}</span>`;
      return `<span class="c">${s}</span>`;
    })
    .filter(Boolean)
    .join("");
}

/* ======================================================================================
   Loading runs, replaying them
   ====================================================================================== */

async function open(runId) {
  source?.close();
  clearTimeout(replayTimer);
  replaying = false;
  reset(runId);
  renderChips();
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get("replay"));
  const run = await (await fetch(api.run(runId))).json();
  if (state?.runId !== runId) return; // the viewer moved on while this loaded
  takeFiles(run);
  state.replayHint = replayLength(run.events ?? []);
  if (speed > 0) return replay(run, speed, Number(params.get("maxgap") ?? 300));
  if (STATIC || RUNS.find((r) => r.id === runId)?.verdict) {
    // A recorded run: show it as it ended.
    for (const e of run.events) onEvent(e);
    return;
  }
  source = new EventSource(`/api/runs/${runId}/stream`);
  source.onmessage = (m) => {
    const e = JSON.parse(m.data);
    onEvent(e);
    if (e.type === "run.done") fetch(api.run(runId)).then((x) => x.json()).then((x) => {
      if (state?.runId === runId) {
        takeFiles(x);
        renderEvidenceLinks();
        renderProofLinks();
      }
    });
  };
}

/** The run's files and what the server or the static build found in its screenshots (see shotInfo). */
function takeFiles(run) {
  state.files = run.files ?? [];
  state.broken = new Set(run.brokenShots ?? []);
  state.same = run.sameShots ?? {};
  state.focus = run.focus ?? {};
}

/** "about 30 s, real timing compressed": how long the replay takes at the button's speed (40x, gaps capped at 0.3 s). */
function replayLength(events, speed = 40, maxGap = 300) {
  const list = events.filter((e) => e.type !== "agent.tool_result");
  let ms = 600;
  for (let i = 1; i < list.length; i++) ms += Math.max(Math.min((new Date(list[i].t) - new Date(list[i - 1].t)) / speed, maxGap), 40) || 40;
  const s = Math.round(ms / 1000);
  return `about ${s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(5, Math.round(s / 5) * 5)} s`}, real timing compressed`;
}

/** Plays a recorded run back in order, with its real timing compressed (long waits are capped). */
function replay(run, speed, maxGap) {
  const events = run.events.filter((e) => e.type !== "agent.tool_result");
  replaying = true;
  setReplayButton(true);
  let i = 0;
  const tick = () => {
    if (i >= events.length) {
      replaying = false;
      setReplayButton(false);
      render();
      return;
    }
    onEvent(events[i]);
    const next = events[i + 1];
    i++;
    if (!next) {
      replaying = false;
      setReplayButton(false);
      render();
      return;
    }
    const gap = Math.min((new Date(next.t) - new Date(events[i - 1].t)) / speed, maxGap);
    replayTimer = setTimeout(tick, Math.max(gap, 40));
  };
  replayTimer = setTimeout(tick, 600);
}

function setReplayButton(on) {
  const btn = $("#replay-btn");
  btn.classList.toggle("stop", on);
  $("#replay-label").textContent = on ? "Stop, show the end" : "Replay this run";
  btn.hidden = false;
  $("#replay-hint").hidden = on;
}

async function startReplay() {
  const id = state.runId;
  source?.close();
  clearTimeout(replayTimer);
  const run = await (await fetch(api.run(id))).json();
  reset(id);
  renderChips();
  takeFiles(run);
  state.replayHint = replayLength(run.events ?? []);
  window.scrollTo({ top: 0 });
  replay(run, 40, 300);
}

function stopReplay(reload = true) {
  clearTimeout(replayTimer);
  if (!replaying) return;
  replaying = false;
  setReplayButton(false);
  if (reload && state) {
    const id = state.runId;
    state = null;
    open(id);
  }
}

/* ======================================================================================
   Wiring
   ====================================================================================== */

/** A screenshot, large. A back-office page opens at a size its text can be read at (on a phone it scrolls sideways),
    scrolled to the order it proves. */
function openViewer(img) {
  const viewer = $("#viewer");
  const z = state?.focus?.[img.dataset.focus ?? ""];
  $("#viewer-img").src = img.src;
  $("#viewer-img").alt = img.alt || img.dataset.caption || "";
  $("#viewer-caption").textContent = img.dataset.caption ?? img.alt;
  viewer.classList.toggle("wide", Boolean(z));
  viewer.showModal();
  const fig = viewer.querySelector("figure");
  fig.scrollTo(0, 0);
  if (z) {
    const fit = () => {
      const shown = $("#viewer-img");
      const scale = shown.clientWidth / z.w;
      const [y0] = z.windows[z.windows.length - 1];
      fig.scrollTo({ left: Math.max(0, z.x[0] * scale - 8), top: Math.max(0, y0 * scale - fig.clientHeight / 3) });
    };
    if ($("#viewer-img").complete) requestAnimationFrame(fit);
    else $("#viewer-img").addEventListener("load", fit, { once: true });
  }
}

function bind() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-run], a[data-home], a[data-how]");
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      if (a.dataset.run) go(a.dataset.run);
      else if (a.dataset.how !== undefined) go("", "how");
      else go("");
      return;
    }
    const img = e.target.closest("img[data-view]");
    if (img) return openViewer(img);
    const raw = e.target.closest("[data-raw]");
    if (raw) return openDoc("calls", "", raw.dataset.raw);
    const doc = e.target.closest("[data-doc]");
    if (doc) return openDoc(doc.dataset.doc, doc.dataset.file ?? "", "");
    if (e.target.closest("#replay-btn")) return replaying ? stopReplay(true) : startReplay();
    const info = e.target.closest(".info-btn");
    if (info) return toggleTip(info);
    if (e.target.closest(".tip")) return;
    closeTips();
    const head = e.target.closest(".row-head");
    if (head) return head.disabled ? undefined : toggleRow(head);
    const btn = e.target.closest("[data-fold]");
    if (btn) return fold(btn, btn.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTips();
  });
  window.addEventListener("resize", closeTips);
  document.addEventListener("scroll", closeTips, true);
  $("#viewer-close").addEventListener("click", () => $("#viewer").close());
  $("#viewer").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  $("#doc-close").addEventListener("click", () => $("#doc").close());
  $("#doc").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
}

async function main() {
  try {
    RUNS = await (await fetch(api.list())).json();
  } catch {
    RUNS = [];
  }
  bind();
  route();
}

main();
