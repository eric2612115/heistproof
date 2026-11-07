// Heistproof console: renders one run's event log (live or recorded) for someone who has never seen Heistproof.
// The first screen is the verdict, one sentence on the run, the five steps and the ten robberies as a checklist.
// Everything else folds: a robbery row opens to its result, PayPal's ids and screenshots; "All evidence" opens the rest of
// PayPal's answers; "Show timeline" opens the story round by round, with the raw agent log folded inside it.
// Attack purchases (labels starting "attack-") stay on their robbery's row.
// In the static build (data-static="1" on <html>) it reads recorded runs from plain files, so it can be hosted anywhere.
const STATIC = document.documentElement.dataset.static === "1";
const api = {
  list: () => (STATIC ? "runs/index.json" : "/api/runs"),
  run: (id) => (STATIC ? `runs/${id}/run.json` : `/api/runs/${id}`),
  file: (id, f) => (STATIC ? `runs/${id}/${encodeURIComponent(f)}` : `/api/runs/${id}/file/${encodeURIComponent(f)}`),
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const robberies = (n) => (n === 1 ? "1 robbery" : `${n} robberies`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const times = (n) => (n === 2 ? "twice" : `${n} times`);

/* The ten attacks: the short name used in the film, and what the thief tries, in plain words. */
const ATTACKS = [
  ["price-tamper", "Price tampering", "Pay $0.01 for the $49 hoodie"],
  ["bad-bag", "Negative quantity", "Buy -1, 0.5 or 1,000 hoodies, or a product that doesn't exist"],
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
const STAMP = { waiting: "Waiting", running: "Trying…", held: "Blocked", robbed: "Robbed", skipped: "Skipped", error: "Error", notrun: "Not run" };
const BUTTONS = { paypal: "PayPal", venmo: "Venmo", paylater: "Pay Later" };
/* The three facts a viewer needs first; everything else PayPal said sits behind "All evidence". */
const KEY_FACTS = ["PayPal order", "Capture", "Signed webhook"];

/* Recorded runs that tell the story, in the order a judge should open them. */
const FEATURED = {
  "2026-11-07-full-run": "AI adds PayPal, then 10 robberies (full run)",
  "2026-11-07-afternoon-robbed": "A hand-written checkout, robbed 8 times",
  "2026-11-07-naive-hardened": "The AI fixes a hand-written checkout",
  "2026-11-07-naive-penny-heist": "A $4,900 mistake caught, then the one-cent hoodie",
};
const SHOPS = {
  "fogline-express": "Fogline, a card-only shop",
  "fogline-naive": "Fogline's hand-written PayPal checkout",
  "fogline-afternoon": "Fogline's hand-written PayPal checkout",
  "fogline-after": "Fogline, with the checkout Heistproof's agent wrote",
};
const MODES = { heistproof: "AI adds PayPal", check: "check only", existing: "AI fixes a checkout", baseline: "baseline" };
const RAIL_DEFAULT = { migrate: "AI coding agent", prove: "real sandbox purchase", attack: "10 robberies", fix: "agent fixes, check again", ship: "branch + evidence report" };

let state;
let source;

function reset(runId) {
  state = {
    runId,
    mode: null,
    template: null,
    plugin: null,
    phase: null,
    done: new Set(),
    bad: new Set(),
    round: 0,
    lastRound: 0,
    rounds: 1,
    skills: new Map(),
    files: new Map(),
    results: new Map(),
    tried: new Map(),
    refusals: [],
    paid: null,
    mismatch: null,
    sentBack: 0,
    finished: false,
    safe: null,
    branchReady: false,
    pr: null,
    shots: [],
    facts: new Map(),
    logCount: 0,
    t0: null,
    now: null,
    activity: "",
    latest: "",
    duration: "",
    buy: {},
    attack: null,
  };
  $("#timeline").innerHTML = "";
  $("#agent-log").innerHTML = "";
  $("#log-box").hidden = true;
  $("#log-box").open = false;
  $("#rows").innerHTML = ATTACKS.map(
    ([id, name, what]) =>
      `<li class="row waiting" id="row-${id}"><button type="button" class="row-head" aria-expanded="false" aria-controls="row-${id}-body" disabled><span class="stamp">${STAMP.waiting}</span><span class="row-text"><span class="name">${esc(name)}</span><span class="what">${esc(what)}</span></span><span class="chev" aria-hidden="true"></span></button><div class="row-body" id="row-${id}-body" hidden><p class="said"></p><div class="ids"></div><div class="row-shots"></div></div></li>`,
  ).join("");
  $("#proof-facts").innerHTML = "";
  $("#proof-more-facts").innerHTML = "";
  $("#shots").innerHTML = "";
  $("#amount").hidden = true;
  $("#refusal").hidden = true;
  fold($("#proof-btn"), false);
  fold($("#tl-btn"), false);
  fold($("#story-btn"), false);
  $("#engine").innerHTML = "";
  for (const el of document.querySelectorAll("#rail > div")) el.className = "";
  for (const [phase, text] of Object.entries(RAIL_DEFAULT)) note(phase, text);
  render();
}

/* ---------- Folding: the "Read more", "All evidence" and "Show timeline" buttons, the robbery rows, the "i" tips ---------- */

/** Opens or closes the block a fold button controls, and relabels the button. */
function fold(btn, open) {
  const target = document.getElementById(btn.getAttribute("aria-controls"));
  btn.setAttribute("aria-expanded", String(open));
  target.hidden = !open;
  if (btn.dataset.open) btn.firstChild.textContent = open ? btn.dataset.open : btn.dataset.closed;
  btn.closest(".panel")?.classList.toggle("open", open);
}

/** Opens or closes one robbery row; an open row scrolls into view inside the list. */
function toggleRow(head, open = head.getAttribute("aria-expanded") !== "true") {
  head.setAttribute("aria-expanded", String(open));
  document.getElementById(head.getAttribute("aria-controls")).hidden = !open;
  if (open) head.parentElement.scrollIntoView({ block: "nearest" });
}

/** Clears a robbery row's folded part and closes it; the row has nothing to show until its result arrives. */
function clearRow(row, what) {
  const head = row.querySelector(".row-head");
  head.disabled = true;
  toggleRow(head, false);
  row.querySelector(".what").textContent = what;
  row.querySelector(".said").textContent = "";
  row.querySelector(".ids").textContent = "";
  row.querySelector(".row-shots").innerHTML = "";
}

function closeTips() {
  for (const b of document.querySelectorAll('.info-btn[aria-expanded="true"]')) {
    b.setAttribute("aria-expanded", "false");
    document.getElementById(b.getAttribute("aria-controls")).hidden = true;
  }
}

/** Shows the explanation under an "i" button, kept inside the window. */
function toggleTip(btn) {
  const wasOpen = btn.getAttribute("aria-expanded") === "true";
  closeTips();
  if (wasOpen) return;
  const tip = document.getElementById(btn.getAttribute("aria-controls"));
  const r = btn.getBoundingClientRect();
  tip.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  const w = tip.offsetWidth;
  tip.style.top = `${Math.round(r.bottom + 8)}px`;
  tip.style.left = `${Math.round(Math.max(16, Math.min(r.left - 8, window.innerWidth - w - 16)))}px`;
}

/* ---------- Rail ---------- */

function setPhase(phase) {
  if (state.phase && state.phase !== phase) state.done.add(state.phase);
  state.phase = phase;
  paintRail();
}

function paintRail() {
  const unused = state.mode === "check" ? ["migrate", "fix"] : state.mode === "existing" ? ["migrate"] : [];
  const c = counts();
  const v = verdictOf(c);
  for (const el of document.querySelectorAll("#rail > div")) {
    const p = el.dataset.phase;
    let cls = unused.includes(p) ? "unused" : state.bad.has(p) ? "bad" : p === state.phase && !state.finished ? "active" : state.done.has(p) || (state.finished && p === "ship") ? "done" : "";
    // A finished run never shows a green tick it has not earned: the last step follows the verdict, and "Rob it" needs at least one blocked robbery.
    if (state.finished && p === "ship") cls = v === "safe" ? "done" : v === "unsafe" ? "bad" : "";
    if (state.finished && p === "attack" && cls === "done" && c.tried === 0) cls = "";
    el.className = cls;
  }
}

function note(phase, text) {
  $(`#note-${phase}`).textContent = text;
}

/* ---------- What happened ---------- */

/** Time since the run started, as m:ss, for the line being written now. */
function elapsed() {
  if (!state.t0 || !state.now) return "";
  const s = Math.max(0, Math.round((new Date(state.now) - new Date(state.t0)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The list for one round; the round header only shows once there is more than one round. */
function roundGroup(r) {
  let li = document.getElementById(`round-${r}`);
  if (!li) {
    li = document.createElement("li");
    li.className = "round";
    li.id = `round-${r}`;
    li.innerHTML = `<header><b>Round ${r + 1}</b><span>· ${r === 0 ? "first check" : `after fix ${r}`}</span></header><ol></ol>`;
    $("#timeline").append(li);
  }
  return li.querySelector("ol");
}

/** One line of the story; the same key updates the line in place and keeps the time it first appeared. kind: ok | bad | run | info */
function step(key, kind, title, detail = "", r = state.round) {
  let li = document.getElementById(`t-${key}`);
  if (!li) {
    li = document.createElement("li");
    li.id = `t-${key}`;
    li.dataset.at = elapsed();
    roundGroup(r).append(li);
  }
  state.lastRound = r;
  li.className = kind;
  li.innerHTML = `<span class="dot"></span><div><b>${title}</b>${detail ? `<small>${detail}</small>` : ""}</div><time>${li.dataset.at}</time>`;
  state.latest = li.querySelector("b").textContent; // shown on the folded panel while the run goes on
}

/** The purchase of this round is one line that changes as the purchase goes on. */
const buyStep = (r, kind, title, detail) => step(`buy-${r}`, kind, title, detail, r);

function log(kind, key, html) {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="k">${esc(key)}</span><span class="v">${html}</span>`;
  $("#agent-log").append(li);
  state.logCount++;
  $("#log-box").hidden = false;
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

/* ---------- Summary ---------- */

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
  return { blocked, robbed, skipped, ran, tried: blocked + robbed, notRun: ATTACKS.length - ran };
}

function verdictOf(c) {
  if (!state.finished) return "running";
  if (c.robbed || state.safe === false) return "unsafe";
  if (c.tried === ATTACKS.length) return "safe";
  return "partial";
}

/** What this run was, in one sentence (the lede), and the rest of the story behind "Read more". */
function story(c, shop) {
  const running = !state.finished;
  const robbing = state.tried.size > 0; // the robberies have begun
  const refusal = state.refusals[0];
  const tried = state.finished && c.ran < ATTACKS.length ? `ran ${c.ran} of the ${ATTACKS.length} robberies` : `${running ? "is trying" : "tried"} ${robberies(ATTACKS.length)}`;
  let lede = "";
  const more = [];
  if (state.mode === "heistproof") {
    if (running && state.phase === "migrate") lede = `An AI coding agent is adding PayPal, Venmo and Pay Later to ${shop}. Heistproof will then buy a hoodie for real in PayPal's sandbox and try ${robberies(ATTACKS.length)} on the shop.`;
    else if (running && !robbing) lede = `An AI coding agent added PayPal, Venmo and Pay Later to ${shop}. Heistproof is now buying a hoodie for real in PayPal's sandbox, before trying ${robberies(ATTACKS.length)} on the shop.`;
    else lede = `An AI coding agent added PayPal, Venmo and Pay Later to ${shop}. Heistproof then bought a hoodie for real in PayPal's sandbox and ${tried} on the shop.`;
    if (state.plugin) more.push("The agent worked from APIMatic's PayPal Context Plugin: its skills and the SDK's own map of PayPal's API.");
    if (refusal && state.paid) more.push(`The first purchase failed (PayPal answered ${refusal.status} ${refusal.name ?? ""}); the error went back to the agent, which fixed it, and everything ran again.`);
    else if (refusal) more.push(`The first purchase failed (PayPal answered ${refusal.status} ${refusal.name ?? ""}); the error went back to the agent${state.phase === "fix" ? ", which is fixing it now" : state.round > 0 ? ", which made a fix; the purchase runs again" : ""}.`);
  } else if (state.mode === "check") {
    if (running && !robbing) lede = `Heistproof is buying a hoodie for real in PayPal's sandbox on ${shop}, as it is, before trying ${robberies(ATTACKS.length)} on it. No AI changes any code in this run.`;
    else lede = `Heistproof bought a hoodie for real in PayPal's sandbox on ${shop}, as it is, and ${tried} on it. No AI changed any code in this run.`;
  } else if (state.mode === "existing") {
    if (running) lede = `Heistproof is checking ${shop} with a real sandbox purchase and ${robberies(ATTACKS.length)}; an AI coding agent fixes every problem it finds, and it checks again.`;
    else lede = `Heistproof checked ${shop} with a real sandbox purchase and ${robberies(ATTACKS.length)}; an AI coding agent fixed every problem it found, and it checked again.`;
    if (state.plugin) more.push("The agent worked from APIMatic's PayPal Context Plugin: its skills and the SDK's own map of PayPal's API.");
  }
  if (state.mismatch) more.push(`It stopped one purchase before any money moved: PayPal would have charged ${money(state.mismatch.paypal)} for a ${money(state.mismatch.bag)} bag.`);
  if (state.finished) {
    if (c.robbed) more.push(c.robbed < c.ran ? `${c.robbed} of the ${c.ran} robberies worked.` : c.ran === 1 ? "The one robbery that ran worked." : `All ${c.ran} robberies that ran worked.`);
    else if (c.tried === ATTACKS.length) more.push(`All ${ATTACKS.length} were blocked.`);
    else if (c.ran === ATTACKS.length) more.push(`${c.blocked} were blocked and ${c.skipped} could not run, so this is only a partial check.`);
    else if (c.ran) more.push(`Only ${c.ran} of the ${ATTACKS.length} ran (${c.blocked} blocked${c.skipped ? `, ${c.skipped} skipped` : ""}); the other ${c.notRun} did not, so this is only a partial check.`);
    else more.push("No robbery ran.");
    if (!c.robbed && state.safe === false && state.bad.has("prove")) more.push("The real purchase did not complete, so it is not safe to ship.");
  }
  return { lede, more: more.join(" ") };
}

function render() {
  const c = counts();
  const shop = SHOPS[state.template] ?? (state.template ? state.template : "the shop");
  $("#eyebrow").textContent = state.mode ? `${shop} · ${MODES[state.mode] ?? state.mode}${state.rounds > 1 ? ` · ${state.rounds} rounds` : ""}${state.plugin ? " · APIMatic plugin" : ""}` : "";
  $("#headline").textContent = state.mode === "check" ? "Try to rob a PayPal checkout." : state.mode === "existing" ? "Fix a PayPal checkout. Then try to rob it." : "Add PayPal. Then try to rob it.";

  const { lede, more } = story(c, shop);
  $("#story").textContent = lede || "Loading the run…";
  $("#story-more").textContent = more;
  $("#story-btn").hidden = !more;
  if (!more) fold($("#story-btn"), false);

  $("#proof-empty").hidden = state.facts.size > 0 || !$("#amount").hidden || !$("#refusal").hidden;
  $("#proof-btn").hidden = !($("#proof-more-facts").children.length || $("#shots").children.length || !$("#refusal").hidden);

  const v = verdictOf(c);
  $("#verdict-card").className = `verdict-card ${v === "running" ? "pending" : v}`;
  $("#verdict-text").textContent = { running: state.mode ? "Running" : "Loading", safe: "Safe to ship", unsafe: "Do not ship", partial: "Partial check" }[v];
  let vnote = "";
  if (v === "running") vnote = state.activity;
  else if (v === "safe") vnote = [`all ${ATTACKS.length} blocked`, state.paid ? `paid ${state.paid.amount} once` : "", state.pr ? "pull request opened" : state.branchReady ? "branch ready" : ""].filter(Boolean).join(" · ");
  else if (v === "unsafe") vnote = c.robbed ? `${c.robbed} of ${robberies(c.ran)} worked` : state.mismatch ? "the purchase was stopped: wrong amount" : "the real purchase did not complete";
  else vnote = [c.notRun ? `only ${c.ran} of ${ATTACKS.length} robberies ran` : "", c.skipped ? `${c.skipped} skipped` : ""].filter(Boolean).join(" · ");
  $("#verdict-note").textContent = vnote;

  const cells = [];
  if (state.mode) {
    cells.push(`<div class="blocked"><b>${c.blocked}</b><span>blocked</span></div>`);
    cells.push(`<div class="robbed"><b>${c.robbed}</b><span>robbed</span></div>`);
    if (c.skipped) cells.push(`<div class="other"><b>${c.skipped}</b><span>skipped</span></div>`);
    if (state.finished && c.notRun) cells.push(`<div class="other"><b>${c.notRun}</b><span>not run</span></div>`);
  }
  $("#tally").innerHTML = cells.join("");

  // The folded timeline shows the latest line while the run goes on, then how long the whole run took.
  $("#tl-chip").textContent = state.finished ? [state.rounds > 1 ? `${state.rounds} rounds` : "", state.duration].filter(Boolean).join(" · ") : state.latest;
}

/* ---------- Events ---------- */

function onEvent(e) {
  if (e.t) {
    state.t0 ??= e.t;
    state.now = e.t;
  }
  if (e.phase && !["prepare", "build"].includes(e.phase) && e.type !== "agent.tool_result") setPhase(e.phase === "fix" && e.type.startsWith("prove") ? "prove" : e.phase);
  const attackPurchase = e.type.startsWith("prove.") && String(e.label ?? "").startsWith("attack-");
  if (attackPurchase) attackProgress(e);
  else {
    handle(e);
    if (Array.isArray(e.screenshots)) addShots(e.screenshots);
  }
  render();
}

/** A purchase made by a robbery: a short live note on that robbery's row, nothing in the shopper's proof. */
function attackProgress(e) {
  const row = state.attack && $(`#row-${state.attack}`);
  if (!row || !row.classList.contains("running")) return;
  const what = row.querySelector(".what");
  if (e.type === "prove.buttons") what.textContent = "Starting a real purchase in the sandbox…";
  else if (e.type === "prove.tampered") what.textContent = `The thief's browser sends ${e.body?.total ? money(e.body.total) : "a tampered amount"} for the bag…`;
  else if (e.type === "prove.amount_check" && e.paypalAmount) what.textContent = e.ok ? `PayPal order created for ${money(e.paypalAmount.value)}…` : `PayPal order created for ${money(e.paypalAmount.value)} on a ${money(e.bagTotal)} bag…`;
  else if (e.type === "prove.approved") what.textContent = "Buyer approved; now the capture…";
  else if (e.type === "prove.sandbox_retry") what.textContent = "PayPal's sandbox page failed, trying again…";
  else if (e.type === "prove.result" && e.verdict) what.textContent = e.verdict;
}

function handle(e) {
  const r = state.round;
  switch (e.type) {
    case "run.start": {
      state.mode = e.mode ?? "heistproof";
      state.template = e.template ?? String(e.shop ?? "").split("/").pop();
      const shop = SHOPS[state.template] ?? state.template;
      $("#engine").innerHTML = e.model ? `Model <b>${esc(e.model)}</b>${e.provider === "meta" ? " · Meta Model API" : e.provider ? ` · ${esc(e.provider)}` : ""}` : "No AI model in this run: checking only";
      $("#engine").title = "The coding agent runs in a Claude Code harness; the model is the one named here.";
      if (state.mode === "check") {
        note("migrate", "not used: PayPal already added");
        note("fix", "not used: checking only");
      }
      if (state.mode === "existing") note("migrate", "PayPal already in the shop");
      step("start", "info", state.mode === "check" ? "Check an existing PayPal checkout" : state.mode === "existing" ? "Harden an existing PayPal checkout" : "A customer asks: “Do you take Venmo?”", esc(shop));
      state.activity = "Starting…";
      paintRail();
      break;
    }
    case "agent.start": {
      const fixing = !(r === 0 && state.mode === "heistproof");
      step(`agent-${r}`, "run", fixing ? "The AI coding agent fixes what failed" : "The AI coding agent adds PayPal", `model ${esc(e.model)}${e.providerLabel ? ` via ${esc(e.providerLabel)}` : ""}`);
      note(fixing ? "fix" : "migrate", "AI coding agent at work…");
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
        step(`skills-${r}`, "info", r === 0 ? `Read ${plural(ap.length, "skill")} from APIMatic's PayPal plugin first` : `Read ${plural(now.length, "skill")} again before fixing`, `${ap.map((s) => esc(s.replace(/^paypal:typescript-/, ""))).join(", ")}${ours.length ? ` · plus Heistproof's ${ours.map((s) => esc(s.replace(/^heistproof:/, ""))).join(", ")}` : ""}`);
        log("skill", "skill", `<span class="tag ${skill.startsWith("heistproof:") ? "ours" : "apimatic"}">${skill.startsWith("heistproof:") ? "Heistproof" : "APIMatic"}</span>${esc(skill)}`);
      } else if (["Edit", "Write", "MultiEdit"].includes(e.name)) {
        let file = "";
        let lines = 0;
        try {
          const o = JSON.parse(e.input);
          file = String(o.file_path ?? "").split("/shop/").pop();
          lines = o.lines ?? 0;
        } catch {}
        if (file === "paypal-plan.md" && e.name === "Write") step(`plan-${r}`, "info", r === 0 ? "Wrote the plan before the PayPal code: paypal-plan.md" : "Rewrote the plan: paypal-plan.md", `${lines ? `${lines} lines, ` : ""}grounded in the SDK's own map`);
        if (file) inRound(state.files).add(file);
        const files = [...(state.files.get(r) ?? [])];
        if (files.length) step(`files-${r}`, "info", `Changed ${plural(files.length, "file")}`, files.map((f) => `<code>${esc(f)}</code>`).join(" "));
        log("edit", e.name.toLowerCase(), shortInput(e.input));
      } else if (e.name === "Bash") log("cmd", "run", shortInput(e.input));
      else if (["Read", "Grep", "Glob"].includes(e.name)) log("sys", e.name.toLowerCase(), shortInput(e.input));
      break;
    }
    case "agent.done": {
      const files = state.files.get(r)?.size ?? 0;
      const fixing = !(r === 0 && state.mode === "heistproof");
      step(`agent-${r}`, "ok", fixing ? "The AI coding agent made its fix" : "The AI coding agent added PayPal, Venmo and Pay Later", `${esc(e.turns)} turns · ${Math.max(1, Math.round((e.durationMs ?? 0) / 60000))} min${files ? ` · ${plural(files, "file")} changed` : ""}`);
      note(fixing ? "fix" : "migrate", fixing ? "fix made, checking again" : `done · ${plural(files, "file")} changed`);
      state.activity = "Running the shop's own tests…";
      log("sys", "done", `${esc(e.turns)} turns, ${Math.round((e.durationMs ?? 0) / 60000)} min`);
      break;
    }
    case "build.tests": {
      const out = String(e.output ?? "");
      const pass = (out.match(/✔/g) ?? []).length;
      const fail = (out.match(/✖/g) ?? []).length;
      step(`tests-${r}`, e.ok ? "ok" : "bad", e.ok ? `${pass ? `${pass} unit tests` : "Unit tests"} pass` : `${fail || "Some"} unit tests fail`, "the shop's own tests, before any real PayPal call");
      log(e.ok ? "sys" : "say", "tests", e.ok ? "npm test passes" : "npm test FAILS");
      break;
    }
    case "sandbox.ready":
      fact("Webhook", e.webhookId);
      state.activity = "Opening PayPal's sandbox…";
      break;
    case "prove.buttons": {
      const shown = Object.entries(e.buttons ?? {}).map(([k, v]) => `${BUTTONS[k] ?? k} ${v ? "✓" : "✗"}`).join("  ");
      fact("Buttons", shown);
      if (e.payLaterMessage) fact("Pay Later", e.payLaterMessage);
      state.buy[r] = { bag: e.bagTotal, shown };
      if (e.buttons && !e.buttons.paypal) {
        state.bad.add("prove");
        buyStep(r, "bad", "The PayPal button never appeared", `${esc(shown)} · no purchase possible`);
        note("prove", "no PayPal button");
        state.activity = "The PayPal button never appeared";
      } else {
        state.bad.delete("prove");
        buyStep(r, "run", "Buying a hoodie in PayPal's sandbox", `${esc(shown)} · bag ${money(e.bagTotal)}`);
        note("prove", "buying in the sandbox…");
        state.activity = "Buying a hoodie for real in PayPal's sandbox…";
      }
      paintRail();
      break;
    }
    case "prove.order_created":
      if (e.paypalOrderId) {
        fact("PayPal order", e.paypalOrderId);
        const b = (state.buy[r] ??= {});
        b.order = e.paypalOrderId;
        buyStep(r, "run", "Buying a hoodie in PayPal's sandbox", `PayPal order <code>${esc(e.paypalOrderId)}</code> created · checking the amount…`);
      }
      break;
    case "prove.amount_check": {
      const b = (state.buy[r] ??= {});
      const pp = e.paypalAmount ? money(e.paypalAmount.value) : "?";
      b.bag = e.bagTotal;
      b.pp = pp;
      const box = $("#amount");
      box.hidden = false;
      box.className = `amount ${e.ok ? "good" : "bad"}`;
      box.innerHTML = `${r > 0 ? `<div class="amount-round">Round ${r + 1} purchase</div>` : ""}<div class="labels"><span>Bag total</span><span>PayPal will charge</span></div>
        <div class="big"><span>${money(e.bagTotal)}</span><span>${pp}</span></div>
        <div class="verdict-line">${e.ok ? "Amounts match: approve" : "Mismatch: purchase stopped before any money moved"}</div>`;
      if (e.ok) {
        buyStep(r, "run", "Buying a hoodie in PayPal's sandbox", `bag ${money(e.bagTotal)} = PayPal ${pp} · amounts match, approving…`);
        state.activity = "Amounts match: approving the purchase…";
      } else {
        if (e.paypalAmount) state.mismatch = { bag: e.bagTotal, paypal: e.paypalAmount.value };
        state.bad.add("prove");
        buyStep(r, "bad", "Purchase stopped before any money moved", `PayPal would have charged ${pp} for a ${money(e.bagTotal)} bag · order <code>${esc(b.order ?? "")}</code> · debug id <code>${esc(e.debugId ?? "")}</code>`);
        note("prove", `stopped: wrong amount (${pp})`);
        state.activity = "Purchase stopped: PayPal's amount is wrong";
        paintRail();
      }
      break;
    }
    case "prove.approved":
      if (!state.bad.has("prove")) {
        buyStep(r, "run", "Buying a hoodie in PayPal's sandbox", `buyer approved order <code>${esc(e.paypalOrderId ?? "")}</code> · capturing the payment…`);
        state.activity = "Buyer approved: capturing the payment…";
      }
      break;
    case "prove.sandbox_retry":
      if (!state.bad.has("prove")) buyStep(r, "run", "Buying a hoodie in PayPal's sandbox", "PayPal's sandbox page failed, trying again…");
      break;
    case "prove.paypal_errors": {
      const real = (e.errors ?? []).filter((x) => !String(x.call).includes("/oauth2/"));
      if (!real.length) break;
      const x = real[0];
      state.refusals.push(x);
      state.bad.add("prove");
      const b = state.buy[r] ?? {};
      const box = $("#refusal");
      box.hidden = false;
      box.innerHTML = `<b>Round ${r + 1} purchase refused by PayPal: HTTP ${esc(x.status)} ${esc(x.name ?? "")}</b><code>${esc(x.call)}</code><br>debug id <code>${esc(x.debugId)}</code>${x.message ? ` · ${esc(x.message)}` : ""}`;
      buyStep(r, "bad", "PayPal refused the payment", `${esc(x.status)} ${esc(x.name ?? "")} on <code>${esc(x.call)}</code> · debug id <code>${esc(x.debugId)}</code>${b.shopOrder ? ` · shop order <code>${esc(b.shopOrder)}</code> stayed unpaid` : ""} · the shop's tests passed, the real API said no`);
      note("prove", `PayPal refused (${x.status})`);
      state.activity = `PayPal refused the payment (${x.status} ${x.name ?? ""})`;
      log("say", "paypal", `PayPal refused ${esc(x.call)}: ${esc(x.status)} ${esc(x.name ?? "")}`);
      paintRail();
      break;
    }
    case "prove.result": {
      if (e.captureId) fact("Capture", e.captureId);
      if (e.shopOrder) fact("Shop order", e.shopOrder);
      const b = (state.buy[r] ??= {});
      b.shopOrder = e.shopOrder;
      const verdict = String(e.verdict ?? "");
      const amount = /Paid (\$[\d.,]+)/.exec(verdict)?.[1] ?? b.pp ?? "";
      if (e.ok && e.captureId) {
        state.paid = { ...e, amount };
        state.bad.delete("prove");
        buyStep(r, "ok", `Paid${amount ? ` ${amount}` : ""}, shipped once`, `capture <code>${esc(e.captureId)}</code> · shop order <code>${esc(e.shopOrder ?? "")}</code>`);
        note("prove", `paid${amount ? ` ${amount}` : ""}${state.refusals.length ? " on the second try" : ""}`);
        state.activity = `Paid${amount ? ` ${amount}` : ""} · now the robberies`;
      } else if (!e.ok && String(e.label).includes("purchase")) {
        state.bad.add("prove");
        if (state.mismatch && /would charge/i.test(verdict)) break; // already told at the amount check
        const labels = /with (\d+) labels?/.exec(verdict);
        if (e.captureId && labels && Number(labels[1]) !== 1) {
          const went = labels[1] === "0" ? "nothing shipped" : `shipped ${times(Number(labels[1]))}`;
          buyStep(r, "bad", `Paid${amount ? ` ${amount}` : ""}, but ${went}`, `${esc(verdict)} · capture <code>${esc(e.captureId)}</code>`);
          note("prove", `paid, but ${went}`);
          state.activity = `Paid, but ${went}`;
        } else {
          buyStep(r, "bad", "The purchase did not complete", esc(verdict)); // PayPal's own refusal, when it follows, replaces this line
          note("prove", "purchase failed");
          state.activity = "The purchase did not complete";
        }
      }
      paintRail();
      break;
    }
    case "prove.webhook":
      fact("Signed webhook", e.ok ? `verified (HTTP ${e.shopStatus}) · ${e.eventId}` : e.status === "not-delivered" ? "not delivered by the sandbox yet" : `refused (HTTP ${e.shopStatus})`);
      if (e.ok) step(`webhook-${r}`, "ok", "PayPal's signed webhook verified", `event <code>${esc(e.eventId)}</code>`);
      break;
    case "attack.start": {
      if (!state.tried.has(r)) state.bad.delete("attack");
      inRound(state.tried).add(e.id);
      state.attack = e.id;
      const row = $(`#row-${e.id}`);
      if (row) {
        row.className = "row running";
        row.querySelector(".stamp").textContent = STAMP.running;
        clearRow(row, ATTACK_WHAT[e.id] ?? e.title ?? "");
      }
      const n = state.tried.get(r).size;
      note("attack", `trying ${n} of ${ATTACKS.length}…`);
      state.activity = `Robbery ${n} of ${ATTACKS.length}: ${ATTACK_NAME[e.id] ?? e.title ?? e.id}…`;
      break;
    }
    case "attack.result": {
      state.results.set(e.id, e.verdict);
      const row = $(`#row-${e.id}`);
      if (row) {
        row.className = `row ${e.verdict}`;
        row.querySelector(".stamp").textContent = STAMP[e.verdict] ?? e.verdict;
        row.querySelector(".what").textContent = ATTACK_WHAT[e.id] ?? e.title ?? "";
        row.querySelector(".said").textContent = e.summary ?? "";
        row.querySelector(".ids").textContent = evidenceIds(e.evidence).join(" · ");
        const shots = e.evidence?.screenshots ?? [];
        row.querySelector(".row-shots").innerHTML = shots.map((f) => `<img src="${api.file(state.runId, f)}" alt="${esc(f)}" title="${esc(f)}" data-view loading="lazy" />`).join("");
        row.querySelector(".row-head").disabled = false;
      }
      if (e.verdict === "robbed") state.bad.add("attack");
      const inThis = [...(state.tried.get(r) ?? [])].map((id) => state.results.get(id));
      const held = inThis.filter((v) => v === "held").length;
      const robbed = inThis.filter((v) => v === "robbed").length;
      const skipped = inThis.filter((v) => v && v !== "held" && v !== "robbed").length;
      const title = robbed ? `${robberies(robbed)} worked` : held ? `${robberies(held + skipped)} tried, ${skipped ? `${held} blocked` : "all blocked"}` : `${robberies(skipped)} skipped`;
      step(`attacks-${r}`, robbed ? "bad" : held ? "ok" : "info", title, `${held} blocked · ${robbed} robbed${skipped ? ` · ${skipped} skipped` : ""}`);
      note("attack", robbed ? `${robbed} robbed · ${held} blocked` : `${held} blocked${skipped ? ` · ${skipped} skipped` : ""}`);
      state.activity = `${held + robbed + skipped} of ${ATTACKS.length} robberies tried · ${held} blocked · ${robbed} robbed`;
      break;
    }
    case "round.done":
      if (e.failures > 0) {
        state.sentBack += e.failures;
        step(`sent-${r}`, "info", `${plural(e.failures, "problem")} sent back to the coding agent`, "with PayPal's own evidence: status, issue name, debug id");
        note("fix", `${plural(e.failures, "problem")} sent to the agent`);
        state.activity = `${plural(e.failures, "problem")} sent back to the coding agent…`;
        log("say", "round", `Round ${e.round}: ${e.failures} problem(s) sent back to the coding agent`);
        state.rounds = Math.max(state.rounds, r + 2);
      } else if (state.sentBack) note("fix", "fixed");
      state.round++;
      break;
    case "run.done": {
      state.finished = true;
      state.safe = e.safe;
      // Older runs wrote branchReady; newer ones write the branch name and, when the shop is on GitHub, the pull request URL.
      state.branchReady = Boolean(e.branchReady || e.branch);
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
      if (state.mode !== "check" && !state.sentBack) note("fix", "nothing to fix");
      const c = counts();
      const v = verdictOf(c);
      const verdict = { unsafe: "Do not ship", safe: "Safe to ship", partial: "Partial check" }[v];
      step("verdict", v === "unsafe" ? "bad" : v === "safe" ? "ok" : "info", verdict, v === "safe" ? `every robbery blocked${state.pr ? " · pull request opened" : state.branchReady ? " · branch ready" : ""}` : v === "partial" ? `${c.ran} of ${ATTACKS.length} robberies ran` : c.robbed ? `${c.robbed} robbed` : "the real purchase did not complete", state.lastRound);
      note("ship", v === "safe" ? `safe${state.pr ? " · pull request opened" : state.branchReady ? " · branch ready" : ""}` : verdict.toLowerCase());
      state.activity = "";
      paintRail();
      break;
    }
  }
}

/** PayPal's own ids from an attack's evidence: enough to look the robbery up in the sandbox account. */
function evidenceIds(ev = {}) {
  const ids = [];
  const orders = [ev.paypalOrderId, ev.targetPayPalOrder, ev.followThrough?.paypalOrderId, ...(ev.tries ?? []).map((t) => t.paypalOrderId)].filter(Boolean);
  for (const id of new Set(orders)) ids.push(`order ${id}`);
  for (const c of ev.paypalCaptures ?? []) if (c.id) ids.push(`capture ${c.id}`);
  if (ev.eventId) ids.push(`event ${ev.eventId}`);
  if (ev.approvedWebhook) ids.push(`event ${ev.approvedWebhook}`);
  if (ev.injected?.debugId) ids.push(`debug ${ev.injected.debugId}`);
  return ids;
}

/** One thing PayPal said. The three key facts stay in sight, in a fixed order; the rest go behind "All evidence". */
function fact(label, value) {
  state.facts.set(label, value);
  const list = (keys) => keys.map((k) => `<dt>${esc(k)}</dt><dd>${esc(state.facts.get(k))}</dd>`).join("");
  $("#proof-facts").innerHTML = list(KEY_FACTS.filter((k) => state.facts.has(k)));
  $("#proof-more-facts").innerHTML = list([...state.facts.keys()].filter((k) => !KEY_FACTS.includes(k)));
}

/** The shopper's screenshots, grouped by purchase ("round0-purchase-3-review.png" -> Round 1 purchase · review). */
function addShots(files) {
  for (const f of files) {
    if (state.shots.includes(f)) continue;
    state.shots.push(f);
    const m = /^(.*?)-(\d+[a-z]?)-(.+)\.png$/.exec(f);
    const group = m ? m[1] : "shots";
    const caption = m ? m[3].replace(/-/g, " ") : f;
    let g = document.getElementById(`shots-${group}`);
    if (!g) {
      g = document.createElement("div");
      g.id = `shots-${group}`;
      const round = /^round(\d+)-purchase$/.exec(group);
      g.innerHTML = `<p class="shots-title">${esc(round ? `Round ${Number(round[1]) + 1} purchase` : group.replace(/-/g, " "))}</p><div class="shots-grid"></div>`;
      $("#shots").append(g);
    }
    g.querySelector(".shots-grid").insertAdjacentHTML("beforeend", `<figure><img src="${api.file(state.runId, f)}" alt="${esc(f)}" title="${esc(f)}" data-view loading="lazy" /><figcaption>${esc(caption)}</figcaption></figure>`);
  }
}

/* ---------- Loading runs ---------- */

let replayTimer = null;

async function open(runId) {
  source?.close();
  clearTimeout(replayTimer);
  reset(runId);
  const params = new URLSearchParams(location.search);
  if (!STATIC) history.replaceState(null, "", `/run/${runId}${location.search}`);
  else history.replaceState(null, "", `#${runId}`);
  const speed = Number(params.get("replay"));
  if (speed > 0) return replay(runId, speed, Number(params.get("maxgap") ?? 1500));
  if (STATIC) {
    // No live stream in the static build: show the recorded run as it ended.
    const run = await (await fetch(api.run(runId))).json();
    for (const e of run.events) onEvent(e);
    return;
  }
  source = new EventSource(`/api/runs/${runId}/stream`);
  source.onmessage = (m) => onEvent(JSON.parse(m.data));
}

/** Plays a recorded run back in order, with its real timing compressed (long waits are capped). */
async function replay(runId, speed, maxGap) {
  const run = await (await fetch(api.run(runId))).json();
  const events = run.events.filter((e) => e.type !== "agent.tool_result");
  let i = 0;
  const tick = () => {
    if (i >= events.length) return;
    onEvent(events[i]);
    const next = events[i + 1];
    i++;
    if (!next) return;
    const gap = Math.min((new Date(next.t) - new Date(events[i - 1].t)) / speed, maxGap);
    replayTimer = setTimeout(tick, Math.max(gap, 40));
  };
  replayTimer = setTimeout(tick, 600);
}

function runLabel(r) {
  if (FEATURED[r.id]) return FEATURED[r.id];
  const when = r.started ? new Date(r.started).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : r.id;
  return `${when} · ${MODES[r.mode] ?? (r.mode || "run")}${r.safe === true ? " · safe" : r.safe === false ? " · not safe" : ""}`;
}

async function main() {
  const runs = await (await fetch(api.list())).json();
  const featured = Object.keys(FEATURED).map((id) => runs.find((r) => r.id === id)).filter(Boolean);
  const rest = runs.filter((r) => !FEATURED[r.id]);
  const option = (r) => `<option value="${esc(r.id)}">${esc(runLabel(r))}</option>`;
  $("#run-select").innerHTML = `${featured.length ? `<optgroup label="Recorded runs">${featured.map(option).join("")}</optgroup>` : ""}${rest.length ? `<optgroup label="${featured.length ? "More runs" : "Runs"}">${rest.map(option).join("")}</optgroup>` : ""}`;
  const fromUrl = STATIC ? location.hash.slice(1) || null : location.pathname.startsWith("/run/") ? location.pathname.slice(5) : null;
  const first = fromUrl ?? featured[0]?.id ?? runs[0]?.id;
  if (first) {
    $("#run-select").value = first;
    open(first);
  }
  $("#run-select").addEventListener("change", (e) => open(e.target.value));
  document.addEventListener("click", (e) => {
    const img = e.target.closest("img[data-view]");
    if (img) {
      $("#viewer-img").src = img.src;
      $("#viewer-caption").textContent = img.alt;
      $("#viewer").showModal();
      return;
    }
    const info = e.target.closest(".info-btn");
    if (info) return toggleTip(info);
    if (e.target.closest(".tip")) return;
    closeTips();
    const head = e.target.closest(".row-head");
    if (head) return head.disabled ? undefined : toggleRow(head);
    const btn = e.target.closest("[data-fold]");
    if (btn) return fold(btn, btn.getAttribute("aria-expanded") !== "true");
    if (e.target.closest(".happened > header")) fold($("#tl-btn"), $("#tl-btn").getAttribute("aria-expanded") !== "true"); // the whole header opens the timeline
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
}

main();
