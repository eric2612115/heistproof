// Heistproof console: renders recorded (or live) runs for someone who has never seen Heistproof.
// Home: the tagline, three findings read from real runs, and every run as a table (the visitor's own runs first).
// One run: a labelled run selector (a searchable command palette), the verdict, the six steps as one bar, the ten
// robberies (a row opens to its result, PayPal's ids and the screenshots), the AI thief's own robberies, the books,
// PayPal's answers, and the story round by round. Every number comes from the run's events, nothing is hard-coded.
// In the static build (data-static="1" on <html>) it reads recorded runs from plain files, so it can be hosted anywhere.
const STATIC = document.documentElement.dataset.static === "1";
const api = {
  list: () => (STATIC ? "runs/index.json" : "/api/runs"),
  run: (id) => (STATIC ? `runs/${id}/run.json` : `/api/runs/${id}`),
  file: (id, f) => (STATIC ? `runs/${id}/${encodeURIComponent(f)}` : `/api/runs/${id}/file/${encodeURIComponent(f)}`),
};
const LINKS = { github: "https://github.com/eric2612115/heistproof", video: "" };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (a) => (!a ? "" : !a.currency || a.currency === "USD" || a.currency_code === "USD" ? money(a.value) : `${a.value} ${a.currency ?? a.currency_code}`);
/** "$4,900" or "$0.01": cents only when there are some. */
const money0 = (v) => (Number(v) % 1 ? money(v) : `$${Number(v).toLocaleString("en-US")}`);
const robberies = (n) => (n === 1 ? "1 robbery" : `${n} robberies`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The engine's "3 parcel(s)" and "1 labels", in plain plurals. */
const plurals = (s) => String(s ?? "").replace(/\b(\d+) ([a-z]+)\(s\)/gi, (m, n, w) => `${n} ${w}${n === "1" ? "" : "s"}`).replace(/\b1 (label|parcel|order|capture|robbery|file|step|turn)s\b/g, "1 $1");
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const mins = (ms) => Math.max(1, Math.round((ms ?? 0) / 60000));
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numberWord = (n) => WORDS[n] ?? String(n);
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const icon = (name, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${name}" /></svg>`;

/* The ten robberies, in the order the console lists them: the short name, a one-line description, and (for older
   recordings) the engine's longer wording. New runs carry the name and the long wording in their attack.result events. */
const ATTACKS = [
  ["price-tamper", "Price tampering", "Pay $0.01 for a full-price bag"],
  ["bad-bag", "Negative quantity", "−1, 0.5 or 1,000 of an item"],
  ["capture-unapproved", "Payment nobody approved", "Capture without the buyer's approval"],
  ["approved-not-captured", "Approval without payment", "Approved, never captured, still paid?"],
  ["declined-capture", "Declined card", "PayPal declines; order still paid?"],
  ["double-capture", "Double click", "The same capture, twice at once"],
  ["forged-webhook", "Forged webhook", "A fake “payment completed”"],
  ["webhook-replay", "Webhook replay", "A real message, sent again"],
  ["out-of-order", "Late event", "An event after the order closed"],
  ["secret-leak", "Secret in the browser", "Is the client secret in the page?"],
];
const ATTACK_NAME = Object.fromEntries(ATTACKS.map(([id, name]) => [id, name]));
const ATTACK_WHAT = Object.fromEntries(ATTACKS.map(([id, , what]) => [id, what]));
const ATTACK_INDEX = Object.fromEntries(ATTACKS.map(([id], i) => [id, i + 1]));
// One word per outcome, everywhere: a robbery that could not run (skipped, failed to start, or never reached because the
// purchase it needs did not complete) is "Could not run", never Skipped, Error or Not run.
const STAMP = { waiting: "Waiting", running: "Trying…", held: "Blocked", robbed: "Robbed", skipped: "Could not run", error: "Could not run", notrun: "Could not run", repeat: "Repeat", "n/a": "Does not apply" };
const STAMP_CLASS = { held: "badge-safe", robbed: "badge-danger", repeat: "badge-gold", running: "badge-gold" };
const VERDICT = { running: "Running", safe: "Safe to ship", unsafe: "Do not ship", incomplete: "Incomplete", unfinished: "Unfinished" };
const BUTTONS = { paypal: "PayPal", venmo: "Venmo", paylater: "Pay Later" };
const KEY_FACTS = ["PayPal order", "Capture", "Signed webhook"];

/* ---------- Names: every run gets a short name and a sub-line of five words or fewer ---------- */
const SHOP_SHORT = {
  "fogline-express": "Fogline",
  "fogline-naive": "Hand-written checkout",
  "fogline-afternoon": "Hand-written checkout",
  "fogline-after": "Agent-written checkout",
  "copper-kettle": "Copper Kettle",
  "copper-kettle-binding": "Copper Kettle, one planted mistake",
  "copper-kettle-bug-binding": "Copper Kettle, one planted mistake",
  "proshop-v2-before": "Open-source shop, before its 2023 fix",
};
const shopShort = (t) => SHOP_SHORT[t] ?? (/^copper-kettle-/.test(t ?? "") ? `Copper Kettle · ${String(t).slice(14).replace(/-/g, " ")}` : t || "The shop");
/* Recorded runs that tell the story, in story order, with hand-written names; every number in them is read from the
   run's own summary, and a name that the run no longer bears out (null) falls back to one built from its events. */
const FEATURED = {
  "2026-11-08-proshop-before": { name: () => "Open-source shop · before its 2023 fix", sub: () => "A real shop, older version" },
  "2026-11-08-full-run": { name: () => "AI adds PayPal to Fogline", sub: (r) => (r.refusal ? "PayPal refused once, then fixed" : "A coding agent adds PayPal") },
  "2026-11-08-thief-binding": { name: (r) => (r.thief?.robbed ? "AI thief finds a planted mistake" : "AI thief vs a planted mistake"), sub: (r) => (r.booksDoublePaid ? "One payment, two orders" : "One planted mistake") },
  "2026-11-08-afternoon-robbed": { name: () => "Hand-written checkout", sub: () => "Planted mistakes, checked as is" },
  "2026-11-08-naive-penny-heist": { name: (r) => (r.mismatch ? `A ${money0(r.mismatch.paypal)} charge stopped` : null), sub: () => "Hand-written, planted mistakes" },
  "2026-11-08-naive-hardened": { name: () => "AI fixes a hand-written checkout", sub: (r) => (r.fixes ? `${r.fixes === 1 ? "1 fix" : `${r.fixes} fixes`}, ${plural(r.rounds, "round")}` : null) },
  "2026-11-08-agent-checkout-recheck": { name: () => "Agent-written checkout, rechecked", sub: () => "Checked again, as it is" },
  "2026-11-08-copper-kettle": { name: () => "Copper Kettle", sub: () => "A second shop, built differently" },
  "2026-11-08-ai-alone": { name: () => "AI alone, no PayPal skills", sub: () => "The control: no plugin" },
};
const featured = (r, key) => FEATURED[r?.id]?.[key]?.(r) ?? null;
const MODE_SUB = { check: "Checked as it is", heistproof: "AI adds PayPal", existing: "AI fixes the checkout", baseline: "AI alone, no plugin" };
const runName = (r) => featured(r, "name") ?? shopShort(r.template);
const runSub = (r) => featured(r, "sub") ?? [MODE_SUB[r.mode] ?? r.mode ?? "", r.rounds > 1 ? plural(r.rounds, "round") : "", r.offline ? "offline" : ""].filter(Boolean).join(" · ");
/** safe, unsafe, incomplete, running (started in the last two hours, no verdict yet) or unfinished. */
const statusOf = (r) => (r.verdict && VERDICT[r.verdict] ? r.verdict : r.started && Date.now() - new Date(r.started) < 2 * 3600e3 ? "running" : "unfinished");
const filterKey = (r) => ({ safe: "safe", unsafe: "unsafe" })[statusOf(r)] ?? "incomplete";

const HANDWRITTEN = new Set(["fogline-naive", "fogline-afternoon"]);
const SHOPS = {
  "fogline-express": "Fogline, a card-only shop",
  "fogline-naive": "a hand-written PayPal checkout",
  "fogline-afternoon": "a hand-written PayPal checkout",
  "fogline-after": "Fogline, with the checkout Heistproof's agent wrote",
  "copper-kettle": "Copper Kettle, a second shop built differently on purpose",
  "copper-kettle-binding": "Copper Kettle with one planted mistake, a test shop",
  "copper-kettle-bug-binding": "Copper Kettle with one planted mistake, a test shop",
  "proshop-v2-before": "an open-source shop, as it was before its maintainer's 2023 fix",
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
const RAIL_DEFAULT = { migrate: "AI coding agent", prove: "One real sandbox purchase", attack: "Ten scripted robberies", thief: "A model invents more", books: "Shop vs PayPal's records", ship: "The verdict" };
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
let autoplay = false; // "Watch a run" opens a run and replays it at once

/* ======================================================================================
   Theme, the (i) tips, the phone menu
   ====================================================================================== */

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
/** The theme on screen: the visitor's pick, else the system setting. */
const themeNow = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
function paintTheme() {
  for (const b of $$("[data-set-theme]")) b.setAttribute("aria-pressed", String(b.dataset.setTheme === themeNow()));
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("theme", t);
  paintTheme();
}

const tipEl = () => $("#tip");
let tipFor = null;
/** Sets an (i)'s explanation: shown on hover and keyboard focus, read out as its label. */
function setTip(el, text) {
  if (!el) return;
  el.dataset.tip = text ?? "";
  if (el.classList.contains("i")) el.setAttribute("aria-label", text ? `About: ${text}` : "More");
}
/** One floating tip, placed next to the element and kept inside the screen (it never makes the page scroll sideways). */
function showTip(el) {
  const text = el?.dataset.tip;
  if (!text) return;
  const tip = tipEl();
  tipFor = el;
  tip.textContent = text;
  tip.hidden = false;
  el.setAttribute("aria-expanded", "true");
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.max(12, Math.min(r.left - 4, innerWidth - w - 12));
  const top = r.bottom + 8 + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}
function hideTip() {
  const tip = tipEl();
  if (tip) tip.hidden = true;
  tipFor?.removeAttribute("aria-expanded");
  tipFor = null;
}

function toggleMenu(open = !$("#hp-nav").classList.contains("open")) {
  $("#hp-nav").classList.toggle("open", open);
  $("#menu-btn").setAttribute("aria-expanded", String(open));
}

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
  const run = id && id !== "how" && id !== "runs" && RUNS.find((r) => r.id === id) ? id : "";
  closeSelector(false);
  toggleMenu(false);
  if (run) showRun(run);
  else showHome();
  // "#how" opens the home page at "How a run goes", whether it was clicked or loaded (static site or server). The jump
  // waits for the layout (and the web fonts) to settle, and is instant, so nothing scrolls it back to the top.
  const anchor = id === "how" || id === "runs" ? id : !run && ["#how", "#runs"].includes(location.hash) ? location.hash.slice(1) : "";
  if (anchor) {
    const jump = () => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "instant" });
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
  setEngine(null);
  $("#nav-runs").setAttribute("aria-current", "page");
  document.title = "Heistproof: recorded PayPal sandbox robberies";
  renderHome();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeViewers() {
  for (const d of $$("dialog[open]")) d.close();
  hideTip();
}

function showRun(id) {
  closeViewers();
  $("#home").hidden = true;
  $("#run").hidden = false;
  $("#nav-runs").removeAttribute("aria-current");
  if (state?.runId !== id) {
    window.scrollTo(0, 0);
    open(id);
  } else if (autoplay) {
    autoplay = false;
    startReplay();
  }
  renderRunButton();
}

/** The header's "sandbox" mark; on a run, its tip names the model, Node and Heistproof's commit. */
function setEngine(e) {
  const off = Boolean(e?.offline);
  $("#engine-text").textContent = off ? "offline stand-in" : "sandbox";
  const meta = e ? [e.model ? `Model ${e.model}${e.provider === "meta" ? " · Meta Model API" : e.provider ? ` · ${e.provider}` : ""}` : "No coding agent in this run: checking only", e.thiefModel ? `AI thief ${e.thiefModel}` : "", e.node ? `Node ${e.node}` : "", e.heistproofCommit ? `Heistproof ${String(e.heistproofCommit).slice(0, 7)}` : ""].filter(Boolean).join(" · ") : "";
  const where = off ? `${STANDIN}: answers like PayPal's sandbox, no network, no money.` : "PayPal's sandbox: real PayPal answers, no real money.";
  setTip($("#engine"), meta ? `${where} ${meta}.` : where);
}

/* ======================================================================================
   Home
   ====================================================================================== */

/** "Nov 8", "Today 14:02" or "Nov 8, 14:02" (the visitor's own runs, several a day). */
function whenShort(r, withTime = false) {
  if (!r.started) return "";
  const d = new Date(r.started);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (today && withTime) return `Today ${time}`;
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return withTime ? `${day}, ${time}` : day;
}
/** "11 min": how long a run took. */
const duration = (r) => (r.started && r.finished ? `${mins(new Date(r.finished) - new Date(r.started))} min` : "");
const dateTime = (iso) => (iso ? `${new Date(iso).toLocaleDateString("en-CA")} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "");

const searchCache = new WeakMap();
/** Everything a search can match: name, shop, verdict, date, the run's id and every PayPal id it saw. */
function searchText(r) {
  if (!searchCache.has(r)) searchCache.set(r, [runName(r), runSub(r), shopShort(r.template), r.template, VERDICT[statusOf(r)], whenShort(r, true), dateTime(r.started), r.id, r.model, r.mode, ...(r.paypalIds ?? [])].filter(Boolean).join(" ").toLowerCase());
  return searchCache.get(r);
}
const matches = (r, q) => !q || q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => searchText(r).includes(w));

/** Featured runs in their story order, then any other recorded run, newest first. */
const featuredOrder = (recorded) => [...Object.keys(FEATURED).map((id) => recorded.find((r) => r.id === id)).filter(Boolean), ...recorded.filter((r) => !FEATURED[r.id])];
const byNewest = (a, b) => String(b.started).localeCompare(String(a.started));

const homeView = { filter: "all", query: "", allLocal: false };
const LOCAL_ROWS = 8;

function renderHome() {
  const recorded = RUNS.filter((r) => r.recorded !== false);
  const demo = recorded.find((r) => r.id === "2026-11-08-full-run" && r.verdict) ?? featuredOrder(recorded).find((r) => r.verdict);
  $("#hero-actions").innerHTML = demo ? `<a class="btn btn-primary" href="${runHref(demo.id)}" data-run="${esc(demo.id)}" data-autoplay>${icon("i-play")}Watch a run</a>` : "";
  renderFindings();
  renderRunList();
  $("#nav-video").hidden = !LINKS.video;
  if (LINKS.video) $("#nav-video").href = LINKS.video;
}

/* ---------- Caught in the sandbox: three findings, each a real number from a recorded run ---------- */
function findCard(r, where, num, of, bad, caption) {
  return `<a class="find" href="${runHref(r.id)}" data-run="${esc(r.id)}"><span class="where">${esc(where)}</span><b class="num">${num}${of != null ? `<small>of ${of}</small>` : ""}</b><span class="cap"><i class="dot ${bad ? "dot-danger" : "dot-safe"}"></i>${esc(caption)}</span></a>`;
}

function renderFindings() {
  const rec = (id) => RUNS.find((r) => r.id === id && r.recorded !== false && r.verdict);
  const cards = [];
  const before = rec("2026-11-08-proshop-before");
  if (before?.ran) cards.push(findCard(before, "Open-source shop · before its maintainer's 2023 fix", before.robbed, before.total, before.robbed > 0, before.robbed === 1 ? "robbery got through" : "robberies got through"));
  const agent = rec("2026-11-08-full-run");
  if (agent?.thief?.tried) cards.push(findCard(agent, "AI thief · on the agent-written checkout", agent.thief.robbed, agent.thief.tried, agent.thief.robbed > 0, agent.thief.robbed === 1 ? "invented robbery worked" : "invented robberies worked"));
  const live = rec("2026-11-08-thief-binding");
  if (live?.thief?.robbed && !live.robbed) cards.push(findCard(live, "AI thief, live · a mistake none of the ten see", live.thief.robbed, null, true, live.booksDoublePaid ? "one payment, two orders" : `of its ${robberies(live.thief.tried)} got through`));
  $("#find-grid").innerHTML = cards.join("");
  $("#findings").hidden = cards.length === 0;
}

/* ---------- Every run, as a table: the visitor's own runs, then the recorded ones ---------- */
function runRow(r) {
  const s = statusOf(r);
  const notRun = r.verdict ? Math.max(0, (r.total ?? 10) - (r.ran ?? 0)) + (r.skipped ?? 0) : 0;
  const extra = [notRun ? `${notRun} could not run` : "", r.notApplicable ? `${r.notApplicable} do not apply` : ""].filter(Boolean).join(" · ");
  const rob = r.ran ? `<span class="stat"><b>${r.held}</b> blocked · <b class="${r.robbed ? "bad" : ""}">${r.robbed}</b> robbed${extra ? `<small>${extra}</small>` : ""}</span>` : `<span class="stat dim">—</span>`;
  const ai = r.thief?.tried ? `<span class="stat"><b>${r.thief.tried}</b> invented · <b class="${r.thief.robbed ? "bad" : ""}">${r.thief.robbed}</b> worked</span>` : `<span class="stat dim">—</span>`;
  const books = r.booksError ? ["dim", "not matched"] : r.booksMismatches ? ["bad", plural(r.booksMismatches, "mismatch").replace(/mismatchs$/, "mismatches")] : r.booksMismatches === 0 ? ["ok", "match"] : ["dim", "—"];
  return `<a class="run-row" href="${runHref(r.id)}" data-run="${esc(r.id)}">
    <span class="verdict-cell ${s}"><i class="dot ${s}"></i>${esc(VERDICT[s])}</span>
    <span class="rtitle"><span class="name">${esc(runName(r))}</span><span class="shop">${esc(runSub(r))}</span></span>
    <span class="stats">${rob}${ai}<span class="stat ${books[0]}">${esc(books[1])}</span></span>
    <span class="when">${esc(whenShort(r, r.recorded === false))}<small>${esc(duration(r))}</small></span>
    ${icon("i-chev", "ic chev")}</a>`;
}

function renderRunList() {
  const q = homeView.query.trim();
  const found = RUNS.filter((r) => matches(r, q));
  const counts = { all: found.length, safe: 0, unsafe: 0, incomplete: 0 };
  for (const r of found) counts[filterKey(r)]++;
  const labels = [["all", "All"], ["safe", "Safe"], ["unsafe", "Do not ship"], ["incomplete", "Incomplete"]];
  $("#run-filter").innerHTML = labels.map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${homeView.filter === k}">${l} <b>${counts[k]}</b></button>`).join("");
  const shown = found.filter((r) => homeView.filter === "all" || filterKey(r) === homeView.filter);
  const local = shown.filter((r) => r.recorded === false).sort(byNewest);
  const recorded = featuredOrder(shown.filter((r) => r.recorded !== false));
  const head = `<div class="run-head" aria-hidden="true"><span>Verdict</span><span>Run</span><span>Robberies</span><span>AI thief</span><span>Books</span><span class="r">When</span><span></span></div>`;
  const groups = [];
  let first = true;
  if (local.length) {
    const cut = !q && !homeView.allLocal && local.length > LOCAL_ROWS;
    const rows = cut ? local.slice(0, LOCAL_ROWS) : local;
    groups.push(`<div class="run-group"><h3>Your runs <span>${local.length}</span></h3><div class="run-list">${head}${rows.map(runRow).join("")}${cut ? `<button type="button" class="run-more" data-more-local>Show all ${local.length} runs</button>` : ""}</div></div>`);
    first = false;
  }
  if (recorded.length) groups.push(`<div class="run-group"><h3>Recorded runs <span>${recorded.length}</span></h3><div class="run-list">${first ? head : ""}${recorded.map(runRow).join("")}</div></div>`);
  $("#run-groups").innerHTML = groups.join("") || `<div class="run-group"><div class="run-list"><p class="run-empty">${RUNS.length ? "No run matches." : "No runs yet."}</p></div></div>`;
}

/* ======================================================================================
   The run selector: a command palette over every run, grouped by shop, by verdict or by day
   ====================================================================================== */

const sel = { open: false, group: store.get("rs.group") || "shop", query: store.get("rs.query") || "", active: 0, ids: [] };

function selectorGroups() {
  const found = RUNS.filter((r) => matches(r, sel.query.trim()));
  const ordered = [...featuredOrder(found.filter((r) => r.recorded !== false)), ...found.filter((r) => r.recorded === false).sort(byNewest)];
  const groups = new Map();
  const add = (key, r) => (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
  if (sel.group === "verdict") {
    for (const k of ["safe", "unsafe", "incomplete"]) for (const r of ordered) if (filterKey(r) === k) add(VERDICT[k], r);
  } else if (sel.group === "newest") {
    for (const r of [...found].sort(byNewest)) add(r.started ? new Date(r.started).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Undated", r);
  } else for (const r of ordered) add(shopShort(r.template), r);
  return { groups: [...groups], total: found.length };
}

function selItem(r, i) {
  const s = statusOf(r);
  const score = r.ran ? `${r.held}/${r.total}${r.thief?.tried ? ` · AI ${r.thief.robbed}/${r.thief.tried}` : ""}` : "";
  const current = r.id === state?.runId;
  return `<a class="rs-item${i === sel.active ? " active" : ""}" id="rs-opt-${i}" role="option" aria-selected="${i === sel.active}"${current ? ' aria-current="true"' : ""} href="${runHref(r.id)}" data-run="${esc(r.id)}" tabindex="-1">
    <i class="dot ${s}"></i>
    <span class="rs-main"><span class="rs-name">${esc(runName(r))}</span><span class="rs-sub">${esc(runSub(r))}${r.recorded === false ? " · yours" : ""}</span></span>
    <span class="rs-verdict ${s}">${esc(VERDICT[s])}</span>
    <span class="rs-score">${esc(score)}</span>
    <span class="rs-when">${esc(whenShort(r, r.recorded === false))}</span>
    ${icon("i-check", "ic tick")}</a>`;
}

/** active: "current" (the open run), "first" (the best match, while typing) or "keep". */
function renderSelectorList(active = "current") {
  const pop = $("#rs-pop");
  if (!pop) return;
  const { groups, total } = selectorGroups();
  sel.ids = groups.flatMap(([, rs]) => rs.map((r) => r.id));
  if (active === "current") sel.active = Math.max(0, sel.ids.indexOf(state?.runId));
  else if (active === "first") sel.active = 0;
  sel.active = Math.min(sel.active, Math.max(0, sel.ids.length - 1));
  let i = 0;
  $("#rs-list").innerHTML = groups.length ? groups.map(([t, rs]) => `<div class="rs-group" role="presentation">${esc(t)} <span>${rs.length}</span></div>${rs.map((r) => selItem(r, i++)).join("")}`).join("") : `<p class="rs-empty">No run matches “${esc(sel.query)}”.</p>`;
  $("#rs-count").textContent = plural(total, "run");
  for (const b of $$("#rs-pop [data-group]")) b.setAttribute("aria-pressed", String(b.dataset.group === sel.group));
  moveActive(0);
}

function moveActive(delta) {
  if (!sel.ids.length) {
    $("#rs-input")?.removeAttribute("aria-activedescendant");
    return;
  }
  sel.active = (sel.active + delta + sel.ids.length) % sel.ids.length;
  for (const el of $$("#rs-list .rs-item")) {
    const on = el.id === `rs-opt-${sel.active}`;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  }
  $("#rs-input").setAttribute("aria-activedescendant", `rs-opt-${sel.active}`);
  scrollToActive(false);
}

/** Keeps the active run in view inside the list (centred when the palette opens); the page itself never scrolls. */
function scrollToActive(center) {
  const list = $("#rs-list");
  const el = $(`#rs-opt-${sel.active}`);
  if (!list || !el) return;
  const lr = list.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (center) list.scrollTop += er.top - lr.top - (lr.height - er.height) / 2;
  else if (er.top < lr.top) list.scrollTop += er.top - lr.top - 4;
  else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 4;
}

function openSelector() {
  if (sel.open || $("#run").hidden) return;
  sel.open = true;
  hideTip();
  const backdrop = document.createElement("div");
  backdrop.className = "rs-backdrop";
  backdrop.id = "rs-backdrop";
  document.body.append(backdrop);
  $("#run-select").insertAdjacentHTML(
    "beforeend",
    `<div class="rs-pop" id="rs-pop" role="dialog" aria-label="Choose a run">
      <div class="rs-handle"></div>
      <div class="rs-search">${icon("i-search")}<input type="search" id="rs-input" role="combobox" aria-expanded="true" aria-controls="rs-list" aria-autocomplete="list" placeholder="Search runs: shop, verdict, date or a PayPal id" aria-label="Search runs" autocomplete="off" spellcheck="false" /><kbd>esc</kbd></div>
      <div class="rs-tabs" role="group" aria-label="Group runs by"><span class="rs-tabs-label">Group by</span><button type="button" data-group="shop">Shop</button><button type="button" data-group="verdict">Verdict</button><button type="button" data-group="newest">Newest</button><span class="count" id="rs-count"></span></div>
      <div class="rs-list" id="rs-list" role="listbox" aria-label="Runs"></div>
      <footer class="rs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><a href="${STATIC ? "#runs" : "/#runs"}" data-all-runs>All runs →</a></footer>
    </div>`,
  );
  $("#rs-btn").setAttribute("aria-expanded", "true");
  const input = $("#rs-input");
  input.value = sel.query;
  renderSelectorList();
  scrollToActive(true);
  input.focus({ preventScroll: true });
  input.select();
}

function closeSelector(focusButton = true) {
  if (!sel.open) return;
  sel.open = false;
  $("#rs-pop")?.remove();
  $("#rs-backdrop")?.remove();
  $("#rs-btn").setAttribute("aria-expanded", "false");
  if (focusButton) $("#rs-btn").focus();
}

/** The selector's button: the open run's dot, name, and one line of what it is. */
function renderRunButton() {
  if (!state) return;
  const known = RUNS.find((x) => x.id === state.runId);
  const c = counts();
  const v = state.mode ? verdictOf(c) : known ? statusOf(known) : "running";
  const r = known ?? { id: state.runId, template: state.template, mode: state.mode, rounds: state.rounds, offline: state.offline, started: state.t0, finished: state.finished ? state.now : null };
  const meta = [runSub(r), whenShort(r, r.recorded === false), duration(r), VERDICT[v]].filter(Boolean).join(" · ");
  $("#rs-dot").className = `dot ${v}`;
  $("#rs-title").textContent = state.mode || known ? runName(r) : "Loading";
  $("#rs-meta").textContent = meta;
  document.title = `${runName(r)} · Heistproof`;
}

/* ======================================================================================
   One run: state
   ====================================================================================== */

/** The AI thief's robberies: what it invented, and what the books said. */
function renderThief() {
  const t = state.thief;
  if (!t) return;
  const plans = [...t.plans.entries()];
  const robbed = plans.filter(([, p]) => p.verdict === "robbed").length;
  const held = plans.filter(([, p]) => p.verdict === "held").length;
  const repeat = plans.filter(([, p]) => p.verdict === "repeat").length; // only repeated a problem the books already showed
  const failed = plans.filter(([, p]) => p.verdict === "error").length;
  const done = held + robbed + repeat + failed;
  $("#thief").hidden = false;
  const chip = $("#thief-chip");
  chip.textContent = t.skipped ? "did not run" : `${plans.length} invented · ${robbed} worked`;
  chip.className = `badge ${t.skipped ? "badge-muted" : robbed ? "badge-danger" : done && done === plans.length ? "badge-safe" : "badge-gold"}`;
  setTip(
    $("#thief-tip"),
    t.source === "replay"
      ? "Robberies an AI thief invented in an earlier run, replayed here. The books against PayPal's records decide each one, not the model."
      : `An AI model${t.model ? ` (${t.model})` : ""} played a dishonest shopper: it saw only what any visitor can see (the storefront's code, the page's own requests) and invented these robberies; Heistproof carried each one out against this shop. The shop's books against ${offline() ? "the stand-in's" : "PayPal's own"} records decide each one, not the model.${repeat ? " Repeat: it only repeated a problem the books already showed." : ""}`,
  );
  const note_ = $("#thief-note");
  note_.hidden = !t.skipped;
  if (t.skipped) note_.innerHTML = `${esc(thiefWhy(t.skipped))}<details class="thief-why"><summary>Details</summary><code>${esc(t.skipped)}</code></details>`;
  const opened = new Set($$("#thief-rows .row-head[aria-expanded='true']").map((h) => h.closest(".row").id));
  $("#thief-rows").innerHTML = plans
    .map(([i, p]) => {
      const v = p.verdict ?? "waiting";
      const id = `thief-row-${i}`;
      const outcome = thiefOutcome(p);
      const open = opened.has(id);
      return `<li class="row ${esc(v)}" id="${id}"><button type="button" class="row-head" aria-expanded="${open}" aria-controls="${id}-body"${p.idea ? "" : " disabled"}><span class="badge stamp ${STAMP_CLASS[v] ?? "badge-muted"}">${esc(STAMP[v] ?? "Waiting")}</span><span class="row-text"><span class="name"><span class="nm">${esc(p.name ?? "A robbery")}</span></span><span class="what">${esc(outcome)}</span></span>${icon("i-chev", "ic chev")}</button><div class="row-body" id="${id}-body"${open ? "" : " hidden"}>${p.idea ? `<p class="thief-idea"><b>The model's idea:</b> ${esc(p.idea)}</p>` : ""}${p.expect ? `<p class="thief-idea"><b>What it hoped for:</b> ${esc(p.expect)}</p>` : ""}</div></li>`;
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
/** The same, for the step bar: "Did not run: no model key". */
const thiefWhyShort = (reason) => (/no model key/i.test(String(reason)) ? "Did not run: no model key" : /no plan/i.test(String(reason)) ? "Did not run: no usable plan" : /could not be asked/i.test(String(reason)) ? "Did not run: model unreachable" : "Did not run");

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
    notes: { ...RAIL_DEFAULT }, // the six steps' live lines while the run goes
    refusals: [],
    paid: null,
    mismatch: null,
    hook: null, // the round's signed webhook: { eventId, accepted, verified, status, shopStatus }
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
    calls: null, // PayPal's raw answers (no token calls), once loaded
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
  $("#timeline").innerHTML = "";
  $("#agent-log").innerHTML = "";
  $("#log-box").hidden = true;
  $("#log-box").open = false;
  $("#rows").innerHTML = "";
  for (const [id, name] of ATTACKS) ensureRow(id, name, rowWhat(id));
  $("#notrun-note").hidden = true;
  $("#thief").hidden = true;
  $("#thief-rows").innerHTML = "";
  $("#books-line").hidden = true;
  $("#proof-facts").innerHTML = "";
  $("#proof-more-facts").innerHTML = "";
  $("#proof-links").innerHTML = "";
  $("#shots").innerHTML = "";
  $("#shots-main").innerHTML = "";
  $("#raw-box").hidden = true;
  $("#raw-box").innerHTML = "";
  // A replay starts from an empty proof panel: no amount, no refusal, no robbery box left over from the run's end.
  for (const id of ["#amount", "#heist-box", "#refusal"]) {
    const box = $(id);
    box.hidden = true;
    box.innerHTML = "";
    delete box.dataset.show;
    delete box.dataset.kind;
  }
  $("#evidence-links").innerHTML = "";
  $("#files").hidden = true;
  $("#files").open = false;
  $("#report-top").hidden = true;
  $("#raw-btn").hidden = true;
  $("#shop-note").hidden = true;
  $("#vfacts").hidden = true;
  fold($("#proof-btn"), false);
  fold($("#tl-btn"), false);
  setEngine(null);
  for (const el of $$("#rail > li")) el.className = "";
  setTips();
  render();
}

const R = (r = state.round) => (state.R[r] ??= { tests: null, buy: null, attacks: new Map(), agent: null, webhook: null });

/* ---------- Folding: the fold buttons, the robbery rows ---------- */

function fold(btn, open) {
  const target = document.getElementById(btn.getAttribute("aria-controls"));
  btn.setAttribute("aria-expanded", String(open));
  target.hidden = !open;
  if (btn.dataset.open) btn.firstChild.textContent = open ? btn.dataset.open : btn.dataset.closed;
}

function toggleRow(head, open = head.getAttribute("aria-expanded") !== "true") {
  head.setAttribute("aria-expanded", String(open));
  document.getElementById(head.getAttribute("aria-controls")).hidden = !open;
}

/** The explanations behind the (i) buttons, for the sandbox or for the offline stand-in. */
function setTips() {
  const off = offline();
  $("#verdict-by").textContent = off ? "Verdict · by the stand-in's records" : "Verdict · by PayPal's records";
  setTip($("#tip-verdict"), `Safe to ship: ${off ? "the purchase with Heistproof's offline PayPal stand-in" : "the real sandbox purchase"} went through once, all 10 scripted robberies were blocked, nothing the AI thief tried got through and the shop's books match ${off ? "the stand-in's" : "PayPal's"} records. Do not ship: at least one robbery worked, or the purchase itself failed. Incomplete: not every robbery could run, or the books could not be matched, so it is never called safe.`);
  setTip($("#tip-rows"), `Each robbery is a real attempt on the running shop ${off ? `with ${STANDIN} (no network, no PayPal account)` : "through PayPal's sandbox, not a simulation"}. Blocked: the shop refused it. Robbed: it worked, and the shop would have lost money or goods. Could not run: it needs something this run did not have. Does not apply: the shop has no such route. Open a row for the result, ${off ? "the stand-in's" : "PayPal's own"} ids and the screenshots.`);
  setTip(
    $("#tip-proof"),
    off
      ? `Everything here comes from ${STANDIN}, which answers like PayPal's sandbox without a network or an account; no money moves. Order: the stand-in's id for the purchase. Capture: when the stand-in took the money. Webhook: the stand-in's "payment completed" message. The raw answers are the recorded calls, byte for byte.`
      : `Everything here comes from PayPal's sandbox, so no real money moves. PayPal order: PayPal's id for the purchase. Capture: when PayPal actually took the money. Signed webhook: PayPal's own "payment completed" message, its signature checked with PayPal. The raw answers are the recorded calls, byte for byte.`,
  );
}

/* ---------- The six steps ---------- */

function setPhase(phase) {
  // "Ship" is never done before the run ends: after a fix the checkout is checked again first.
  if (state.phase && state.phase !== phase && state.phase !== "ship") state.done.add(state.phase);
  state.phase = phase;
  paintRail();
}

/** Each step's short mono result and one plain line, read from the run's own events. */
function stepFacts(c, v) {
  const f = {};
  const who = offline() ? "the stand-in" : "PayPal";
  const whose = offline() ? "the stand-in's" : "PayPal's";
  const n = state.notes;
  // 1. Add: only a run where the coding agent added PayPal says how.
  const a0 = state.R[0]?.agent;
  if (state.mode === "check") f.migrate = ["—", "Agent not used: check only"];
  else if (state.mode === "existing") f.migrate = ["—", "PayPal was already in the shop"];
  else if (a0?.done && !a0.fixing) f.migrate = [a0.files ? plural(a0.files, "file") : "done", state.mode === "baseline" ? "Added by the agent alone, no plugin" : state.plugin != null ? "PayPal added with APIMatic's plugin" : "PayPal added by the coding agent"];
  else f.migrate = ["", n.migrate];
  // 2. Buy: how the last purchase ended, and what went wrong before a fix.
  const buys = state.R.map((x) => x.buy).filter((b) => b?.status && b.status !== "buying");
  const last = buys[buys.length - 1];
  if (!last) f.prove = ["", n.prove];
  else {
    const earlier = buys.slice(0, -1).find((b) => b.status !== "paid");
    const fixed = state.fixes ? ` → fixed in ${plural(state.fixes, "round")}` : "";
    const before = !earlier ? "" : earlier.status === "refused" ? `First ${refusedWhat(earlier.refusal)} refused (${earlier.refusal?.status ?? "?"})` : earlier.status === "mismatch" ? `A ${money0(earlier.pp)} charge stopped` : earlier.status === "nobutton" ? "No PayPal button at first" : earlier.status === "overshipped" ? `Shipped ${times(earlier.labels ?? 2)} at first` : "The first purchase failed";
    if (last.status === "paid") f.prove = [last.amount || "paid", before ? `${before}${fixed}` : /\b1 label\b/.test(String(last.verdict ?? "")) ? "Paid once, shipped once" : "Paid once"];
    else if (last.status === "overshipped") f.prove = [last.amount || "paid", `Paid once, shipped ${last.labels ? times(last.labels) : "wrongly"}`];
    else if (last.status === "refused") f.prove = [String(last.refusal?.status ?? "refused"), `${cap(who)} refused the ${refusedWhat(last.refusal)}`];
    else if (last.status === "mismatch") f.prove = ["stopped", `${cap(who)} would charge ${money0(last.pp)} for ${money0(last.bag)}`];
    else if (last.status === "nobutton") f.prove = ["no button", "The PayPal button never appeared"];
    else f.prove = ["failed", "The purchase did not complete"];
  }
  // 3. Rob: the ten, counted apart (blocked, robbed, could not run, does not apply).
  if (!c.ran) f.attack = ["", n.attack];
  else {
    const couldNot = c.skipped + (state.finished ? c.notRun : 0);
    const before = robbedBefore();
    const parts = [];
    if (c.robbed) parts.push(`${c.robbed} robbed`);
    else if (!couldNot && !c.na) parts.push(before ? `${before} robbed before the fix, then all blocked` : `${numberWord(c.total)} robberies, all blocked`);
    else parts.push(`${c.blocked} blocked`);
    if (couldNot) parts.push(`${couldNot} could not run`);
    if (c.na) parts.push(`${c.na} do not apply`);
    f.attack = [`${c.blocked} / ${c.total}`, cap(parts.join(" · "))];
  }
  // 4. AI thief
  const t = state.thief;
  if (!t) f.thief = ["—", state.finished ? "Did not run in this recording" : n.thief];
  else if (t.skipped) f.thief = ["—", thiefWhyShort(t.skipped)];
  else {
    const plans = [...t.plans.values()];
    const robbed = plans.filter((p) => p.verdict === "robbed").length;
    const repeat = plans.filter((p) => p.verdict === "repeat").length;
    const failed = plans.filter((p) => p.verdict === "error").length;
    const line = robbed ? `Invented ${plans.length}, ${robbed} worked` : repeat ? `Invented ${plans.length}: ${repeat === 1 ? "1 repeated a known one" : `${repeat} repeated known ones`}` : `Invented ${plans.length}, none worked`;
    f.thief = [`${robbed} / ${plans.length}`, `${line}${failed ? ` · ${failed} could not run` : ""}`];
  }
  // 5. Books
  const b = state.books;
  if (!b) f.books = ["—", state.finished ? "Not matched in this run" : n.books];
  else if (!b.matched) f.books = ["—", "Could not be matched"];
  else if (b.mismatches?.length) f.books = [`${b.mismatches.length} off`, booksShort(b.mismatches, whose)];
  else f.books = ["match", `Shop matches ${whose} records`];
  // 6. Ship: the verdict itself; never a pull request the run did not open.
  f.ship = v === "running" ? ["", n.ship] : [{ safe: "safe", unsafe: "unsafe", incomplete: "—" }[v] ?? "", `${VERDICT[v]}${v === "safe" && state.pr ? " · pull request opened" : ""}`];
  return f;
}

/** Robberies that worked in an earlier round and are blocked now. */
const robbedBefore = () => [...state.history.entries()].filter(([id, h]) => h.slice(0, -1).some((x) => x.verdict === "robbed") && state.results.get(id) !== "robbed").length;

/** The books' mismatches in a few words: "One payment, two orders", or how many orders. */
const BOOK_KINDS = [
  [/already pays for order/i, "one payment, two orders"],
  [/no completed capture/i, "paid with no completed capture"],
  [/parcels? for \d+ completed capture/i, "shipped more than was paid for"],
  [/^PayPal captured \$[\d.,]+ for an order of/i, "paid less than the order costs"],
  [/same goods as the real purchase/i, "the same goods, for less"],
];
const bookKind = (m) => BOOK_KINDS.find(([re]) => re.test(String(m.problem)))?.[1] ?? "do not match for another reason";
function booksShort(list, whose) {
  const kinds = new Set(list.map(bookKind));
  if (kinds.size === 1) return list.length === 1 ? cap([...kinds][0]) : `${list.length} orders: ${[...kinds][0]}`;
  return `${list.length} orders do not match ${whose}`;
}

function paintRail() {
  if (!state) return;
  const unused = state.mode === "check" || state.mode === "existing" ? ["migrate"] : [];
  const c = counts();
  const v = verdictOf(c);
  const thiefRan = state.thief && !state.thief.skipped && state.thief.plans.size > 0;
  const facts = state.mode ? stepFacts(c, v) : {};
  $$("#rail > li").forEach((el, i) => {
    const p = el.dataset.phase;
    let cls = unused.includes(p) ? "unused" : state.bad.has(p) ? "bad" : p === state.phase && !state.finished ? "active" : state.done.has(p) || (state.finished && p === "ship") ? "done" : "";
    // A finished run never shows a green tick it has not earned: the last step follows the verdict, "Rob" needs at
    // least one blocked robbery, the AI thief must have run, and the books must have been matched against PayPal's.
    if (state.finished && p === "ship") cls = v === "safe" ? "done" : v === "unsafe" ? "bad" : "";
    if (state.finished && p === "attack" && cls === "done" && c.tried === 0) cls = "";
    if (p === "thief" && cls === "done" && !thiefRan) cls = "";
    if (p === "books" && cls === "done" && !state.books?.matched) cls = "";
    if (state.finished && ((p === "thief" && !thiefRan) || (p === "books" && !state.books))) cls = "unused";
    const look = { active: "live", unused: "skip" }[cls] ?? cls;
    el.className = look;
    const mark = look === "done" ? icon("i-check") : look === "bad" ? icon("i-x") : String(i + 1);
    const n = el.querySelector(".n");
    if (n.dataset.mark !== mark) {
      n.innerHTML = mark;
      n.dataset.mark = mark;
    }
    const [res, line] = facts[p] ?? ["", state.notes[p]];
    document.getElementById(`res-${p}`).textContent = res ?? "";
    // While the run goes, a step says what is happening; once it is over, what came of it.
    document.getElementById(`note-${p}`).textContent = state.finished ? (line ?? "") : look === "skip" ? (line ?? state.notes[p]) : state.notes[p] ?? "";
  });
}

function note(phase, text) {
  if (state) state.notes[phase] = text;
}

/** Step 6 tells both halves while the run goes: what the fixing did, and what shipped. */
function setFix(text) {
  state.fixText = text;
  note("ship", cap([state.fixText, state.shipText].filter(Boolean).join(" · ")) || RAIL_DEFAULT.ship);
}
function setShip(text) {
  state.shipText = text;
  note("ship", cap([state.fixText, state.shipText].filter(Boolean).join(" · ")) || RAIL_DEFAULT.ship);
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
  let na = 0;
  for (const v of state?.results.values() ?? []) {
    if (v === "held") blocked++;
    else if (v === "robbed") robbed++;
    else if (v === "n/a") na++;
    else skipped++;
  }
  const ran = blocked + robbed + skipped + na;
  const total = state ? totalAttacks() : 10;
  return { blocked, robbed, skipped, na, ran, total, tried: blocked + robbed, notRun: total - ran };
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

/* ---------- The story in a few sentences (in "What happened") ---------- */

/** "capture", "order" or "payment": what a refused PayPal call was, from its path. */
const refusedWhat = (x) => (/\/capture$/.test(String(x?.call ?? "")) ? "capture" : /\/orders$/.test(String(x?.call ?? "")) ? "order" : "payment");

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

/** The verdict's one mono line: blocked, robbed, the AI thief, the books, the purchase. */
function verdictStats(c) {
  if (!state.mode || !state.R.length) return "";
  const p = [];
  if (c.ran) p.push(`<b>${c.blocked} / ${c.total}</b> blocked`);
  if (c.robbed) p.push(`<b class="bad">${c.robbed}</b> robbed`);
  const couldNot = c.skipped + (state.finished ? c.notRun : 0);
  if (couldNot && c.ran) p.push(`${couldNot} could not run`);
  if (c.na) p.push(`${c.na} do not apply`);
  const t = state.thief;
  if (t && !t.skipped && t.plans.size) {
    const robbed = [...t.plans.values()].filter((x) => x.verdict === "robbed").length;
    p.push(`AI thief <b class="${robbed ? "bad" : ""}">${robbed} / ${t.plans.size}</b>`);
  } else if (state.finished) p.push("AI thief did not run");
  const b = state.books;
  if (b?.matched) p.push(b.mismatches?.length ? `books <b class="bad">${b.mismatches.length} off</b>` : "books <b>match</b>");
  else if (b) p.push("books not matched");
  const buy = [...state.R].reverse().find((x) => x.buy?.status && x.buy.status !== "buying")?.buy;
  if (buy?.status === "paid") p.push(`<b>${esc(buy.amount || "")}</b> paid once`);
  else if (buy?.status === "overshipped") p.push(`paid, <b class="bad">shipped ${times(buy.labels ?? 2)}</b>`);
  else if (buy?.status === "refused") p.push(`purchase <b class="bad">refused (${esc(buy.refusal?.status ?? "")})</b>`);
  else if (buy?.status === "mismatch") p.push(`purchase <b class="bad">stopped</b>`);
  else if (buy?.status === "nobutton") p.push(`<b class="bad">no PayPal button</b>`);
  else if (buy?.status === "failed") p.push(`purchase <b class="bad">failed</b>`);
  return p.join(" · ");
}

/** The facts beside the verdict: PayPal's order, the capture, the signed webhook, what was charged, when. */
function renderVerdictFacts() {
  const box = $("#vfacts");
  const items = [];
  const pp = offline() ? "Stand-in" : "PayPal";
  const order = state.facts.get("PayPal order");
  if (order) items.push([`${pp} order`, esc(order)]);
  const paid = state.paid?.captureId ? state.paid : null;
  if (paid) items.push(["Capture", `${esc(paid.captureId)} <span class="ok">${esc(paid.paypalStatus || "COMPLETED")}</span>`]);
  const h = state.hook;
  if (h?.eventId) items.push([offline() ? "Stand-in webhook" : "Signed webhook", `${esc(h.eventId)} ${h.accepted ? `<span class="ok">${h.verified ? "VERIFIED" : "ACCEPTED"}</span>` : `<span class="dim">shop answered ${esc(h.shopStatus ?? "nothing")}</span>`}`, true]);
  else if (h && state.finished) items.push([offline() ? "Stand-in webhook" : "Signed webhook", `<span class="dim">${paid ? "not delivered during this run" : "none: nothing was captured"}</span>`, true]);
  const buy = [...state.R].reverse().find((x) => x.buy?.status === "paid" || x.buy?.status === "overshipped")?.buy;
  if (buy?.amount) items.push(["Charged", `${esc(buy.amount)} <span class="dim">${buy.pp != null && Number(buy.pp) === Number(buy.bag) ? "= bag total" : buy.bag ? `bag ${esc(money(buy.bag))}` : ""}</span>`]);
  if (state.t0) items.push(["Run", `${esc(dateTime(state.t0))} <span class="dim">${esc([state.finished ? `${mins(new Date(state.now) - new Date(state.t0))} min` : "", state.rounds > 1 ? plural(state.rounds, "round") : ""].filter(Boolean).join(" · "))}</span>`]);
  box.innerHTML = items.map(([k, v, wide]) => `<div${wide ? ' class="span2"' : ""}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
  box.hidden = items.length < 2;
  $("#verdict-card").classList.toggle("no-facts", box.hidden);
}

function render() {
  const c = counts();
  const shop = SHOPS[state.template] ?? (state.template ? state.template : "the shop");
  $("#proof-title").textContent = offline() ? "Proof from the stand-in" : "Proof from PayPal";
  $("#proof-chip").textContent = offline() ? "offline" : "sandbox";
  $("#proof-empty").textContent = offline() ? "The stand-in's answers appear here once the purchase starts." : "PayPal's answers appear here once the purchase starts.";
  $("#story").textContent = state.mode ? story(c, shop) : "";
  const about = SHOP_NOTE[state.template];
  $("#shop-note").hidden = !about;
  if (about) $("#shop-note").textContent = about;

  const v = verdictOf(c);
  $("#verdict-card").className = `verdict ${v}${$("#vfacts").hidden ? " no-facts" : ""}`;
  $("#verdict-dot").className = `dot ${v}`;
  $("#verdict-text").textContent = v === "running" && !state.mode ? "Loading" : VERDICT[v];
  $("#vstats").innerHTML = verdictStats(c);
  const vnote = $("#verdict-note");
  vnote.textContent = v === "running" ? state.activity : "";
  vnote.hidden = !vnote.textContent;
  renderVerdictFacts();

  // The replay buttons: "~1 min" before, the replay's clock (how far into the real run) while it plays.
  const canReplay = state.finished || replaying;
  for (const b of $$("[data-replay]")) {
    b.hidden = !canReplay;
    b.querySelector(".replay-hint").textContent = replaying ? elapsed() || "0:00" : (state.replayHint?.short ?? "");
    if (state.replayHint) b.title = replaying ? "Stop the replay and show how the run ended" : `Replay this run: ${state.replayHint.long}`;
  }

  $("#board-title").textContent = `${c.total} robberies`;
  const chip = $("#board-chip");
  const couldNot = c.skipped + (state.finished ? c.notRun : 0);
  chip.hidden = !c.ran && !(state.phase === "attack" && !state.finished);
  chip.textContent = !state.finished && state.phase === "attack" ? `${c.ran} of ${c.total} tried` : [`${c.blocked} blocked`, `${c.robbed} robbed`, couldNot ? `${couldNot} could not run` : "", c.na ? `${c.na} do not apply` : ""].filter(Boolean).join(" · ");
  chip.className = `badge ${!state.finished ? "badge-gold" : c.robbed ? "badge-danger" : couldNot ? "badge-muted" : "badge-safe"}`;
  $("#proof-empty").hidden = state.facts.size > 0 || !$("#amount").hidden || !$("#refusal").hidden || !$("#heist-box").hidden;
  $("#tl-chip").textContent = state.finished ? [state.rounds > 1 ? plural(state.rounds, "round") : "", state.duration].filter(Boolean).join(" · ") : state.latest;
  renderNotRun(c);
  renderHeistBox(c, v);
  placeShots();
  for (const g of $$("#shots > div, #shots-main > div")) g.querySelector(".shots-title").textContent = shotGroupTitle(g.id.slice(6));
  $("#proof-btn").hidden = !($("#proof-more-facts").children.length || $("#shots").children.length);
  paintRail();
  renderRunButton();
  if (state.finished && !state.autoOpened) {
    state.autoOpened = true;
    const worst = worstRobbery();
    const head = worst && document.querySelector(`#row-${CSS.escape(worst.id)} .row-head`);
    if (head && !head.disabled) toggleRow(head, true);
  }
}

/** Rows that never ran fold into one sentence that says why, instead of nine "Could not run" rows. */
function renderNotRun(c) {
  const note_ = $("#notrun-note");
  if (!state.finished || !c.notRun) {
    note_.hidden = true;
    for (const row of $$("#rows .row.notrun")) row.hidden = false;
    return;
  }
  for (const row of $$("#rows .row.notrun")) row.hidden = true;
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
  const bag = state.labels[`round${state.lastRound}-purchase`]?.bag ?? state.labels["round0-purchase"]?.bag;
  const captured = worst.evidence?.followThrough?.captured;
  box.hidden = false;
  box.innerHTML = `<div class="amount-round">Robbed · ${esc(attackName(worst.id))}</div>
    ${bag ? `<div class="row2"><span>Bag total in the shop</span><b>${money(bag)}</b></div>` : ""}
    <div class="row2"><span>${captured ? (offline() ? "What the stand-in captured" : "What PayPal captured") : "Result"}</span><b class="bad">${captured ? esc(amt(captured)) : "robbed"}</b></div>
    <div class="shop-line">${esc(shopLine(worst))}</div>`;
  // The legit purchase's green "amounts match" box is not the point on a robbed run.
  $("#amount").hidden = v === "unsafe" && $("#amount").dataset.kind !== "bad";
}

/** The round's purchase: the bag in the shop against what PayPal will charge (or charged), and how it ended. */
function renderAmount(r) {
  const b = state.R[r]?.buy;
  if (!b || b.bag == null) return;
  const box = $("#amount");
  const who = offline() ? "the stand-in" : "PayPal";
  const charged = b.status === "paid" || b.status === "overshipped";
  box.dataset.show = "1";
  box.dataset.kind = b.amountOk === false ? "bad" : "good";
  const extras = b.extras?.length ? `<div class="amount-extra">bag ${money(b.goods ?? b.bag)} + ${b.extras.map((x) => `${money(x.value)} ${esc(x.kind ?? "extra")}`).join(" + ")}</div>` : "";
  const eq =
    b.amountOk === false ? ["bad", "Mismatch · stopped before any money moved"]
    : b.status === "paid" ? ["", "Equal · one capture · COMPLETED"]
    : b.status === "overshipped" ? ["bad", `Equal · paid once, shipped ${times(b.labels ?? 2)}`]
    : b.status === "refused" ? ["bad", `Equal · but ${who} refused the ${refusedWhat(b.refusal)} (${b.refusal?.status ?? "?"})`]
    : b.status === "failed" || b.status === "nobutton" ? ["bad", "Equal · the purchase did not complete"]
    : ["", "Equal · approve"];
  box.innerHTML = `${state.rounds > 1 || r > 0 ? `<div class="amount-round">Round ${r + 1} purchase</div>` : ""}
    <div class="row2"><span>Bag total in the shop</span><b>${money(b.bag)}</b></div>
    <div class="row2"><span>${charged ? `What ${who} charged` : `${cap(who)} will charge`}</span><b class="${b.amountOk === false ? "bad" : ""}">${esc(b.ppText ?? "?")}</b></div>${extras}
    <div class="eq ${eq[0]}"><i class="dot ${eq[0] ? "dot-danger" : "dot-safe"}"></i>${esc(eq[1])}</div>`;
  box.hidden = false;
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
  // Only the round's own purchase speaks for "Buy" and the proof panel. A robbery's purchase is that robbery's row;
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
    phase; the agent's fixing and the verdict share the last step, "Ship". */
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
  for (const row of $$("#rows .row")) {
    const id = row.id.slice(4);
    row.hidden = false;
    row.className = "row waiting";
    setStamp(row, "waiting");
    clearRow(row, rowWhat(id));
    const hist = state.history.get(id) ?? [];
    row.querySelector(".history").textContent = hist.map((h) => `Round ${h.round + 1}: ${STAMP[h.verdict]?.toLowerCase() ?? h.verdict}`).join(" · ");
  }
  for (const p of ["prove", "attack", "thief", "books"]) {
    state.done.delete(p);
    state.bad.delete(p);
  }
  state.phase = null;
  for (const p of ["attack", "thief", "books"]) note(p, `Round ${state.round + 1}: ${low(RAIL_DEFAULT[p])}`);
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
    const a = R().attacks.get(state.attack) ?? R().attacks.set(state.attack, { id: state.attack, pending: true, shots: [] }).get(state.attack);
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
  const named = typeof e.item === "string" ? e.item : (e.item?.name ?? e.itemName ?? e.product?.name);
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

/** While the coding agent works, the verdict and the step bar say what it has done so far (skills read, the plan,
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
  const said = `At work: step ${a.steps}${did.length ? ` · ${did.join(", ")}` : ""}`;
  if (a.fixing) setFix(said);
  else note("migrate", said);
}

/** The robbery's one line: its short description; the price tampering one names this shop's bag when it is known. */
function rowWhat(id) {
  const bag = state?.labels["round0-purchase"]?.bag ?? state?.R[0]?.buy?.bag;
  if (id === "price-tamper" && bag && Number(bag) > 0.01) return `$0.01 for a ${money0(bag)} bag`;
  return ATTACK_WHAT[id] ?? state?.names.get(id)?.what ?? "";
}

/** The engine's own longer wording, with a price that no longer fits this shop's bag replaced by the bag itself. */
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
  // changes the round's purchase, the step bar's "Buy", or the proof panel.
  if (e.type.startsWith("prove.") && !isRoundPurchase(e)) return;
  if (e.type.startsWith("prove.")) learnItem(e);
  switch (e.type) {
    case "run.start": {
      state.mode = e.mode ?? "heistproof";
      state.template = e.template ?? String(e.shop ?? "").split("/").pop();
      state.offline = Boolean(e.offline);
      state.engine = e;
      setTips();
      setEngine(e);
      note("prove", state.offline ? "Purchase, offline stand-in" : RAIL_DEFAULT.prove);
      if (Array.isArray(e.attacks) && e.attacks.length) {
        state.planned = e.attacks.map(String);
        for (const row of $$("#rows .row")) if (!state.planned.includes(row.id.slice(4))) row.remove();
      }
      const shop = SHOPS[state.template] ?? state.template;
      if (state.mode === "check") {
        note("migrate", "Agent not used: check only");
        setFix("no fixing: check only");
      }
      if (state.mode === "existing") note("migrate", "PayPal was already in the shop");
      step("start", "info", state.mode === "check" ? "Check an existing PayPal checkout" : state.mode === "existing" ? "Harden an existing PayPal checkout" : "A customer asks: “Do you take Venmo?”", esc(cap(shop)) + (state.offline ? ` · offline: ${STANDIN}, not the sandbox` : ""));
      state.activity = "Starting…";
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
      else note("migrate", `Done · ${plural(files, "file")} changed`);
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
        note("prove", "No PayPal button");
        state.activity = "The PayPal button never appeared";
      } else {
        state.bad.delete("prove");
        buyStep(r, "run", buyTitle(), `${esc(shown)} · bag ${money(e.bagTotal)}`);
        note("prove", offline() ? "Buying from the stand-in…" : "Buying in the sandbox…");
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
      b.ppText = pp;
      b.amountOk = Boolean(e.ok);
      b.goods = e.goods;
      // Shipping, handling, insurance or tax on top of the goods: "bag $64.00 + $5.00 shipping = PayPal $69.00".
      b.extras = (Array.isArray(e.extras) ? e.extras : []).filter((x) => x && Number(x.value));
      const sum = b.extras.length ? `bag ${money(e.goods ?? e.bagTotal)} + ${b.extras.map((x) => `${money(x.value)} ${esc(x.kind ?? "extra")}`).join(" + ")}` : `bag ${money(e.bagTotal)}`;
      if (e.ok) {
        buyStep(r, "run", buyTitle(), `${sum} = PayPal ${esc(pp)} · amounts match, approving…`);
        state.activity = "Amounts match: approving the purchase…";
      } else {
        if (e.paypalAmount) state.mismatch = { bag: e.bagTotal, paypal: e.paypalAmount.value };
        b.status = "mismatch";
        state.bad.add("prove");
        buyStep(r, "bad", "Purchase stopped before any money moved", `PayPal would have charged ${esc(pp)} for a ${money(e.bagTotal)} bag · order <code>${esc(b.order ?? "")}</code> · debug id <code>${esc(e.debugId ?? "")}</code>`);
        note("prove", `Stopped: wrong amount (${pp})`);
        state.activity = "Purchase stopped: PayPal's amount is wrong";
        paintRail();
      }
      renderAmount(r);
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
      box.innerHTML = `<b>Round ${r + 1} · ${esc(cap(who))} refused: ${esc(x.status)} ${esc(x.name ?? "")}</b><code>${esc(x.call)}</code><br>debug_id <button type="button" class="raw-link" data-raw="${esc(x.debugId)}">${esc(x.debugId)}</button>`;
      const tests = R().tests?.ok ? ` · the ${state.mode === "heistproof" || state.mode === "baseline" ? "agent's" : "shop's"} tests passed, ${offline() ? "the stand-in" : "PayPal's real API"} said no` : "";
      buyStep(r, "bad", `${cap(who)} refused the ${refusedWhat(x)}`, `${esc(x.status)} ${esc(x.name ?? "")} on <code>${esc(x.call)}</code> · debug id <code>${esc(x.debugId)}</code>${b.shopOrder ? ` · shop order <code>${esc(b.shopOrder)}</code> stayed unpaid` : ""}${tests}`);
      note("prove", `${cap(who)} refused (${x.status})`);
      state.activity = `${cap(who)} refused the ${refusedWhat(x)} (${x.status} ${x.name ?? ""})`;
      log("say", "paypal", `PayPal refused ${esc(x.call)}: ${esc(x.status)} ${esc(x.name ?? "")}`);
      renderAmount(e.round ?? r);
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
      const earlier = state.R.slice(0, r)
        .map((x) => x.buy)
        .filter(Boolean)
        .map((p) => (p.status === "refused" ? `refused ${p.refusal?.status ?? ""}`.trim() : p.status === "mismatch" ? `${money(p.pp)} stopped` : p.status === "nobutton" ? "no button" : p.status === "overshipped" ? `shipped ${times(p.labels ?? 2)}` : p.status === "failed" ? "failed" : ""))
        .filter(Boolean);
      if (e.ok && e.captureId) {
        b.status = "paid";
        state.paid = { ...e, amount };
        state.bad.delete("prove");
        buyStep(r, "ok", `Paid${amount ? ` ${amount}` : ""}, shipped once`, `capture <code>${esc(e.captureId)}</code> · shop order <code>${esc(e.shopOrder ?? "")}</code>`);
        note("prove", cap(`${earlier.length ? `${earlier.join(", ")}, then ` : ""}paid${amount ? ` ${amount}` : ""}`));
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
          note("prove", `Paid, but ${went}`);
          state.activity = `Paid, but ${went}`;
        } else {
          if (b.status !== "nobutton" && b.status !== "refused") b.status = "failed";
          buyStep(r, "bad", "The purchase did not complete", esc(plurals(verdict))); // PayPal's own refusal, when it follows, replaces this line
          note("prove", "Purchase failed");
          state.activity = "The purchase did not complete";
        }
      }
      renderAmount(r);
      paintRail();
      break;
    }
    case "prove.webhook": {
      const accepted = e.ok || e.status === "accepted" || e.status === "verified";
      R(e.round ?? r).webhook = { accepted, status: accepted ? "accepted" : e.status, eventId: e.eventId, shopStatus: e.shopStatus };
      state.hook = { accepted, verified: Boolean(e.paypalVerified), status: e.status, eventId: e.eventId, shopStatus: e.shopStatus };
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
      const row = ensureRow(e.id, name, rowWhat(e.id));
      row.hidden = false;
      row.className = "row running";
      setStamp(row, "running");
      clearRow(row, rowWhat(e.id));
      const prior = R().attacks.get(e.id);
      R().attacks.set(e.id, { id: e.id, pending: true, shots: prior?.shots ?? [] });
      const n = R().attacks.size;
      note("attack", `Trying ${n} of ${totalAttacks()}…`);
      state.activity = `Robbery ${n} of ${totalAttacks()}: ${name}…`;
      break;
    }
    case "thief.start": {
      state.thief = { source: e.source, model: e.model, provider: e.provider, skipped: null, plans: new Map((Array.isArray(e.plans) ? e.plans : []).map((p, i) => [i, { ...p, verdict: "waiting", summary: "" }])) };
      R(e.round ?? r).thief = { tried: 0, robbed: 0, repeat: 0, skipped: null };
      state.bad.delete("thief");
      if (e.model && state.engine) setEngine({ ...state.engine, thiefModel: state.engine.model ? null : e.model });
      const planned = Array.isArray(e.plans) ? e.plans.length : (e.planned ?? 0);
      note("thief", planned ? `${robberies(planned)} invented…` : "Inventing robberies…");
      renderThief();
      break;
    }
    case "thief.skipped": {
      state.thief = { ...(state.thief ?? { plans: new Map() }), skipped: e.reason };
      R(e.round ?? r).thief = { tried: 0, robbed: 0, repeat: 0, skipped: e.reason };
      note("thief", thiefWhyShort(e.reason));
      renderThief();
      break;
    }
    case "thief.plan": {
      if (!state.thief) state.thief = { plans: new Map() };
      state.thief.plans.set(e.index, { name: e.name, idea: e.idea, expect: e.expect, verdict: "running", summary: "" });
      state.activity = `AI thief: trying "${e.name}"`;
      renderThief();
      break;
    }
    case "thief.result": {
      if (!state.thief) state.thief = { plans: new Map() };
      state.thief.plans.set(e.index, { name: e.name, idea: e.idea, expect: e.expect, verdict: e.verdict, summary: e.summary });
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
      note("books", !e.matched ? (e.error ? "Could not be read" : "Not matched") : e.mismatches?.length ? `${plural(e.mismatches.length, "order")} do${e.mismatches.length === 1 ? "es" : ""} not match` : `${plural(e.paid, "paid order")} match ${offline() ? "the stand-in" : "PayPal"}`);
      break;
    }
    case "attack.result": {
      learnItem(e);
      if (e.what) state.names.set(e.id, { name: e.title, what: whatFor(e.id, e.what) });
      const name = attackName(e.id);
      state.results.set(e.id, e.verdict);
      if (!state.history.has(e.id)) state.history.set(e.id, []);
      state.history.get(e.id).push({ round: r, verdict: e.verdict });
      const prior = R().attacks.get(e.id);
      const a = { ...e, pending: false, shots: [...new Set([...(prior?.shots ?? []), ...(e.evidence?.screenshots ?? [])])] };
      R().attacks.set(e.id, a);
      const row = ensureRow(e.id, name, rowWhat(e.id));
      row.hidden = false;
      row.className = `row ${e.verdict === "n/a" ? "na" : e.verdict}`;
      setStamp(row, e.verdict);
      row.querySelector(".what").textContent = rowWhat(e.id);
      fillRow(row, a, r);
      if (e.verdict === "robbed") state.bad.add("attack");
      const inThis = [...R().attacks.values()];
      const held = inThis.filter((x) => x.verdict === "held").length;
      const robbed = inThis.filter((x) => x.verdict === "robbed").length;
      const na = inThis.filter((x) => x.verdict === "n/a").length;
      const skipped = inThis.filter((x) => x.verdict && x.verdict !== "held" && x.verdict !== "robbed" && x.verdict !== "n/a").length;
      // Blocked, robbed, could-not-run and does-not-apply, each counted on its own: a robbery that could not run was never blocked.
      const title = robbed ? `${robberies(robbed)} worked` : held && skipped ? `${held} of ${robberies(held + skipped)} blocked; ${skipped} could not run` : held ? `${robberies(held)} tried, all blocked` : `${robberies(skipped)} could not run`;
      step(`attacks-${r}`, robbed ? "bad" : held ? "ok" : "info", title, `${held} blocked · ${robbed} robbed${skipped ? ` · ${skipped} could not run` : ""}${na ? ` · ${na} do not apply` : ""}`);
      note("attack", robbed ? `${robbed} robbed · ${held} blocked` : `${held} blocked${skipped ? ` · ${skipped} could not run` : ""}`);
      state.activity = `${held + robbed + skipped + na} of ${totalAttacks()} robberies tried · ${held} blocked · ${robbed} robbed`;
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
      for (const row of $$("#rows .row.waiting, #rows .row.running")) {
        row.className = "row notrun";
        setStamp(row, "notrun");
        clearRow(row, rowWhat(row.id.slice(4)));
      }
      if (state.mode !== "check") setFix(state.sentBack ? fixNote() : "nothing to fix");
      const c = counts();
      const v = verdictOf(c);
      step("verdict", v === "unsafe" ? "bad" : v === "safe" ? "ok" : "info", VERDICT[v], v === "safe" ? `${thiefRan() ? "every robbery blocked" : `all ${c.total} scripted robberies blocked; the AI thief did not run`}${state.pr ? " · pull request opened" : ""}` : v === "incomplete" ? `${c.blocked} of ${c.total} robberies blocked, ${c.skipped + c.notRun} could not run` : unsafeWhy(c), state.lastRound);
      setShip(`${VERDICT[v]}${v === "safe" && state.pr ? " · pull request opened" : ""}`);
      if (!state.thief) note("thief", "Did not run in this recording");
      if (!state.books) note("books", "Not matched in this run");
      state.activity = "";
      paintRail();
      renderEvidenceLinks();
      renderProofLinks();
      renderRaw();
      renderFacts(); // "not delivered yet" becomes what it was at the end
      break;
    }
  }
}

/** The books line: one mono line, with the orders that do not match folded underneath. */
function renderBooks(e) {
  const line = $("#books-line");
  const records = offline() ? "the stand-in's" : "PayPal's";
  const pp = offline() ? "the stand-in" : "PayPal";
  if (!e.matched) {
    // The books could not be read or matched: say why, since an unmatched check is never called safe.
    line.hidden = false;
    line.innerHTML = `<i class="dot dot-muted"></i><div><b>Books not matched</b> · ${esc(plurals(e.error ?? e.reason ?? "the back office shows no PayPal ids"))}</div>`;
    return;
  }
  line.hidden = false;
  const list = e.mismatches ?? [];
  if (!list.length) {
    line.innerHTML = `<i class="dot dot-safe"></i><div><b>Books match ${esc(pp)}</b> · ${esc(plural(e.paid ?? 0, "paid order"))}, each backed by one completed capture</div>`;
    return;
  }
  const kinds = new Map();
  for (const m of list) kinds.set(bookKind(m), (kinds.get(bookKind(m)) ?? 0) + 1);
  const parts = [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => (n === 1 ? k : `${k} (${n})`));
  line.innerHTML = `<i class="dot dot-danger"></i><div><b class="bad">${esc(plural(list.length, "order"))} ${list.length === 1 ? "does" : "do"} not match ${esc(records)} records</b> · ${esc(parts.join(" · "))}<details><summary>The ${list.length === 1 ? "order" : "orders"}</summary><ul>${list.map((m) => `<li><code>${esc(m.order)}</code> ${esc(byStandIn(plurals(m.problem)))}</li>`).join("")}</ul></details></div>`;
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

function setStamp(row, verdict) {
  const s = row.querySelector(".stamp");
  s.textContent = STAMP[verdict] ?? verdict;
  s.className = `badge stamp ${STAMP_CLASS[verdict] ?? "badge-muted"}`;
}

function ensureRow(id, name, what) {
  let row = document.getElementById(`row-${id}`);
  if (row) {
    row.querySelector(".nm").textContent = name;
    return row;
  }
  const idx = String(ATTACK_INDEX[id] ?? $$("#rows .row").length + 1).padStart(2, "0");
  row = document.createElement("li");
  row.className = "row waiting";
  row.id = `row-${id}`;
  row.innerHTML = `<button type="button" class="row-head" aria-expanded="false" aria-controls="row-${esc(id)}-body" disabled><span class="badge stamp badge-muted">${STAMP.waiting}</span><span class="row-text"><span class="name"><span class="idx">${idx}</span><span class="nm">${esc(name)}</span></span><span class="what">${esc(what)}</span><span class="history"></span></span>${icon("i-chev", "ic chev")}</button><div class="row-body" id="row-${esc(id)}-body" hidden><div class="said"><span class="k">Result</span><span class="v"></span></div><div class="money" hidden></div><p class="untested"></p><div class="ids"></div><div class="proofs"></div></div>`;
  // In the console's order, wherever the run's events put it.
  const next = $$("#rows .row").find((x) => (ATTACK_INDEX[x.id.slice(4)] ?? 99) > (ATTACK_INDEX[id] ?? 99));
  $("#rows").insertBefore(row, next ?? null);
  return row;
}

function clearRow(row, what) {
  const head = row.querySelector(".row-head");
  head.disabled = true;
  toggleRow(head, false);
  row.querySelector(".what").textContent = what;
  row.querySelector(".what").removeAttribute("title");
  row.querySelector(".history").textContent = "";
  row.querySelector(".said .v").textContent = "";
  row.querySelector(".money").innerHTML = "";
  row.querySelector(".money").hidden = true;
  row.querySelector(".untested").textContent = "";
  row.querySelector(".ids").innerHTML = "";
  row.querySelector(".proofs").innerHTML = "";
}

/** Fills an open row: the result, the money figures, what could not be tested, PayPal's ids, the captioned proofs. */
function fillRow(row, a, r) {
  row.querySelector(".said .v").textContent = byStandIn(plurals(a.summary ?? ""));
  const long = state.names.get(a.id)?.what;
  if (long) row.querySelector(".what").title = long;
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
  // screenshots with the same caption keep only the later one. At most three large; the rest as small thumbnails.
  const shots = onePerPicture((a.shots ?? []).filter((f) => showShot(f, a)));
  const big = shots.filter((f) => /-(review|backoffice|stuck|paypal-wrong-amount)\.png$/.test(f));
  const byCaption = new Map();
  for (const f of big.length ? big : shots.slice(0, 2)) byCaption.set(captionFor(f, a), f);
  const large = [...byCaption.values()].slice(0, 3);
  const shown = new Set(large.map((f) => state.same[f] ?? f));
  const small = shots.filter((f) => !large.includes(f) && !shown.has(state.same[f] ?? f));
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
    if (k === "Capture" && state.paid?.captureId === v) return `${esc(v)} <span class="ok">${esc(state.paid.paypalStatus || "COMPLETED")}</span>`;
    return esc(v);
  };
  // Offline, the ids are the stand-in's, and the labels say so.
  const name = (k) => (offline() ? ({ "PayPal order": "Stand-in order", Capture: "Stand-in capture", "Signed webhook": "Stand-in webhook" }[k] ?? k) : k);
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

/** The latest round purchase's screenshots stay in view in the proof panel; every other group is under "All evidence". */
function placeShots() {
  const groups = $$("#shots-main > div, #shots > div");
  const rank = (g) => {
    const m = /^shots-round(\d+)-purchase(?:-(?:paypal|venmo|paylater))?(?:-try(\d+))?$/.exec(g.id);
    return m ? Number(m[1]) * 100 + Number(m[2] ?? 1) : -1;
  };
  const main = groups.filter((g) => rank(g) >= 0).sort((a, b) => rank(b) - rank(a))[0];
  for (const g of groups) {
    if (g === main && g.parentElement.id !== "shots-main") $("#shots-main").append(g);
    else if (g !== main && g.parentElement.id === "shots-main") $("#shots").prepend(g);
  }
}

const callFiles = () => state.files.filter((f) => /paypal-calls\.json$/.test(f));
const webhookFiles = () => state.files.filter((f) => /webhooks\.json$/.test(f));

/** PayPal's raw answers, once per run: every recorded call but the token calls. */
async function loadCalls() {
  const id = state.runId;
  const all = [];
  for (const f of callFiles()) {
    try {
      const arr = await (await fetch(api.file(id, f))).json();
      for (const x of Array.isArray(arr) ? arr : []) if (!String(x.path).includes("/oauth2/")) all.push({ ...x, _file: f });
    } catch {}
  }
  if (state?.runId !== id) return;
  state.calls = all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  renderRaw();
}

/** The proof panel's raw answers: the calls about the round's own purchases, then a link to all of them. */
function renderRaw() {
  const box = $("#raw-box");
  const calls = state.calls;
  const n = calls?.length ?? 0;
  $("#raw-btn").hidden = !state.finished || !n; // some shops call PayPal from the browser only: nothing recorded, no button
  $("#raw-count").textContent = n ? String(n) : "";
  if (!state.finished || !n) {
    box.hidden = true;
    return;
  }
  // Each round purchase's order and capture, then PayPal's last check of a webhook signature.
  const orders = state.R.map((x) => x.buy?.order).filter(Boolean);
  const own = calls.filter((c) => c.method === "POST" && orders.some((o) => String(c.path).includes(o) || c.responseBody?.id === o));
  const verify = calls.filter((c) => /verify-webhook-signature/.test(String(c.path))).pop();
  const pick = [...own.slice(-(verify ? 4 : 5)), ...(verify ? [verify] : [])];
  const multi = state.rounds > 1;
  const short = (c) => {
    const o = orders.find((x) => String(c.path).includes(x));
    const path = o ? String(c.path).replace(/^.*?\/orders\//, "…/") : String(c.path);
    const round = /^round(\d+)-/.exec(c._file)?.[1];
    return `${esc(path)}${multi && round != null ? ` <span class="dim">round ${Number(round) + 1}</span>` : ""}`;
  };
  box.hidden = !pick.length;
  box.innerHTML = `<header>Raw answers <span class="dim">· ${plural(n, "call")}</span></header><ul>${pick
    .map((c) => {
      const name = c.responseBody?.name ?? c.responseBody?.status ?? c.responseBody?.verification_status ?? "";
      return `<li><span class="m">${esc(c.method)}</span><span class="p">${short(c)}</span><span class="s ${c.status >= 400 ? "bad" : ""}">${esc(c.status)}${name ? ` ${esc(name)}` : ""}</span></li>`;
    })
    .join("")}</ul><button type="button" class="raw-more" data-doc="calls">All ${plural(n, "call")} →</button>`;
}

function renderProofLinks() {
  const links = [];
  if (webhookFiles().length) links.push(`<button type="button" data-doc="webhooks">${offline() ? "The stand-in's webhooks" : "PayPal's webhooks"}</button>`);
  for (const f of state.files.filter((x) => /shop\.log$/.test(x))) links.push(`<button type="button" data-doc="text" data-file="${esc(f)}">Shop log${/round(\d+)/.test(f) ? ` (round ${Number(/round(\d+)/.exec(f)[1]) + 1})` : ""}</button>`);
  $("#proof-links").innerHTML = links.join("");
}

/** The run's files: the evidence report, the agent's changes, each fix, the event log, a pull request when there is one. */
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
  if (patches.includes("final.patch"))
    fetch(api.file(state.runId, "final.patch"))
      .then((x) => x.text())
      .then((t) => {
        if (!t.trim()) {
          document.getElementById("link-final-patch")?.remove();
          $("#files-count").textContent = String($("#evidence-links").children.length);
        }
      })
      .catch(() => {});
  if (state.files.includes("events.jsonl")) links.push(`<button type="button" data-doc="text" data-file="events.jsonl">Event log</button>`);
  if (state.pr) links.push(`<a href="${esc(state.pr)}" rel="noopener" target="_blank">Pull request</a>`);
  $("#evidence-links").innerHTML = links.join("");
  $("#files").hidden = links.length === 0;
  $("#files-count").textContent = String(links.length);
  $("#report-top").hidden = !state.files.includes("REPORT.md");
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
  renderRunButton();
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get("replay"));
  const run = await (await fetch(api.run(runId))).json();
  if (state?.runId !== runId) return; // the viewer moved on while this loaded
  takeFiles(run);
  state.replayHint = replayLength(run.events ?? []);
  loadCalls();
  if (autoplay) {
    autoplay = false;
    return replay(run, 40, 300);
  }
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
    if (e.type === "run.done")
      fetch(api.run(runId))
        .then((x) => x.json())
        .then((x) => {
          if (state?.runId === runId) {
            takeFiles(x);
            renderEvidenceLinks();
            renderProofLinks();
            loadCalls();
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

/** How long the replay takes at the button's speed (40x, gaps capped at 0.3 s): "~1 min", and in words for its tip. */
function replayLength(events, speed = 40, maxGap = 300) {
  const list = events.filter((e) => e.type !== "agent.tool_result");
  let ms = 600;
  for (let i = 1; i < list.length; i++) ms += Math.max(Math.min((new Date(list[i].t) - new Date(list[i - 1].t)) / speed, maxGap), 40) || 40;
  const s = Math.round(ms / 1000);
  const short = s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(5, Math.round(s / 5) * 5)} s`;
  return { short: `~${short}`, long: `about ${short}, real timing compressed` };
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
  for (const b of $$("[data-replay]")) {
    b.classList.toggle("stop", on);
    b.querySelector(".replay-label").textContent = on ? (b.id === "replay-top" ? "Stop" : "Stop, show the end") : b.id === "replay-top" ? "Replay" : "Replay this run";
    b.querySelector("use").setAttribute("href", on ? "#i-stop" : "#i-play");
    b.hidden = false;
  }
}

async function startReplay() {
  const id = state.runId;
  source?.close();
  clearTimeout(replayTimer);
  const run = await (await fetch(api.run(id))).json();
  reset(id);
  takeFiles(run);
  state.replayHint = replayLength(run.events ?? []);
  loadCalls();
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

function onSelectorKey(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    moveActive(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const id = sel.ids[sel.active];
    if (id) {
      closeSelector(false);
      go(id);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeSelector();
  }
}

function bind() {
  document.addEventListener("click", (e) => {
    const themeBtn = e.target.closest("[data-set-theme]");
    if (themeBtn) return setTheme(themeBtn.dataset.setTheme);
    if (e.target.closest("#menu-btn")) return toggleMenu();
    if (!e.target.closest("#hp-nav")) toggleMenu(false);
    if (!e.target.closest("#files")) $("#files").open = false;
    const tipped = e.target.closest("[data-tip]");
    if (tipped && !tipped.matches("a")) {
      e.preventDefault();
      // A mouse click keeps the tip its hover opened; a tap or a key press toggles it.
      return tipFor === tipped && e.pointerType !== "mouse" ? hideTip() : showTip(tipped);
    }
    hideTip();
    if (e.target.closest("#rs-btn")) return sel.open ? closeSelector() : openSelector();
    if (e.target.closest("#rs-backdrop")) return closeSelector();
    const grp = e.target.closest("[data-group]");
    if (grp) {
      sel.group = grp.dataset.group;
      store.set("rs.group", sel.group);
      renderSelectorList();
      return $("#rs-input")?.focus();
    }
    const all = e.target.closest("[data-all-runs]");
    if (all && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      closeSelector(false);
      return go("", "runs");
    }
    const a = e.target.closest("a[data-run], a[data-home], a[data-how]");
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      if (a.dataset.run) {
        autoplay = a.dataset.autoplay !== undefined;
        closeSelector(false);
        go(a.dataset.run);
      } else if (a.dataset.how !== undefined) go("", "how");
      else go("");
      return;
    }
    const filter = e.target.closest("[data-filter]");
    if (filter) {
      homeView.filter = filter.dataset.filter;
      return renderRunList();
    }
    if (e.target.closest("[data-more-local]")) {
      homeView.allLocal = true;
      return renderRunList();
    }
    const img = e.target.closest("img[data-view]");
    if (img) return openViewer(img);
    const raw = e.target.closest("[data-raw]");
    if (raw) return openDoc("calls", "", raw.dataset.raw);
    const doc = e.target.closest("[data-doc]");
    if (doc) {
      $("#files").open = false;
      return openDoc(doc.dataset.doc, doc.dataset.file ?? "", "");
    }
    if (e.target.closest("[data-replay]")) return replaying ? stopReplay(true) : startReplay();
    const head = e.target.closest(".row-head");
    if (head) return head.disabled ? undefined : toggleRow(head);
    const btn = e.target.closest("[data-fold]");
    if (btn) return fold(btn, btn.getAttribute("aria-expanded") !== "true");
  });
  // The (i) tips: on hover with a mouse, and on keyboard focus.
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t && e.pointerType === "mouse" && t !== tipFor) showTip(t);
  });
  document.addEventListener("pointerout", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t && e.pointerType === "mouse" && t === tipFor && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t && t.matches(":focus-visible")) showTip(t);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === tipFor) hideTip();
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "run-search") {
      homeView.query = e.target.value;
      renderRunList();
    } else if (e.target.id === "rs-input") {
      sel.query = e.target.value;
      store.set("rs.query", sel.query);
      renderSelectorList("first");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "rs-input") return onSelectorKey(e);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (!$("#run").hidden) return sel.open ? closeSelector() : openSelector();
      $("#run-search").focus();
      return;
    }
    if (e.key === "Escape") {
      hideTip();
      toggleMenu(false);
      $("#files").open = false;
      if (sel.open) closeSelector();
    }
  });
  window.addEventListener("resize", hideTip);
  document.addEventListener("scroll", hideTip, true);
  darkQuery.addEventListener?.("change", paintTheme);
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
  paintTheme();
  // The ⌘K hint says Ctrl+K where that is the key.
  if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) for (const k of $$(".kbd-k")) k.textContent = "Ctrl K";
  // The static site may live under any path: the home links stay on the page.
  if (STATIC) for (const a of $$("a[data-home]")) a.setAttribute("href", "#");
  for (const el of $$(".i[data-tip]")) setTip(el, el.dataset.tip);
  try {
    RUNS = await (await fetch(api.list())).json();
  } catch {
    RUNS = [];
  }
  bind();
  route();
}

main();
