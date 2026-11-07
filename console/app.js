// Heistproof console: renders one run's event log (live or recorded).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ATTACKS = [
  ["price-tamper", "Pay $0.01 for the $49 hoodie"],
  ["bad-bag", "Negative, fractional and fake items"],
  ["capture-unapproved", "Claim payment for an order nobody approved"],
  ["approved-not-captured", "Get it shipped on approval alone"],
  ["double-capture", "Double-click: capture twice at once"],
  ["declined-capture", "Card declined at capture (PayPal negative testing)"],
  ["forged-webhook", "Forge PayPal's 'payment completed' webhook"],
  ["webhook-replay", "Replay a real webhook to ship twice"],
  ["out-of-order", "Send 'approved' after 'completed'"],
  ["secret-leak", "Find the PayPal secret in the browser"],
];

let state;
let source;

function reset(runId) {
  state = { runId, phase: null, done: new Set(), bad: new Set(), skills: new Set(), files: [] };
  $("#agent-log").innerHTML = "";
  $("#cards").innerHTML = ATTACKS.map(([id, title]) => `<article class="card waiting" id="card-${id}"><span class="stamp">waiting</span><h3>${esc(title)}</h3><p></p><div class="ids"></div></article>`).join("");
  $("#proof-facts").innerHTML = "";
  $("#shots").innerHTML = "";
  $("#amount").hidden = true;
  $("#verdict").className = "verdict pending";
  $("#verdict").textContent = "Running";
  $("#board-score").textContent = "";
  $("#skill-count").textContent = "";
  for (const el of document.querySelectorAll("#rail div")) el.className = "";
}

function setPhase(phase) {
  if (state.phase && state.phase !== phase) state.done.add(state.phase);
  state.phase = phase;
  for (const el of document.querySelectorAll("#rail div")) {
    const p = el.dataset.phase;
    el.className = state.bad.has(p) ? "bad" : p === phase ? "active" : state.done.has(p) ? "done" : "";
  }
}

function log(kind, key, html) {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="k">${esc(key)}</span><span class="v">${html}</span>`;
  $("#agent-log").append(li);
  li.scrollIntoView({ block: "end" });
}

function fact(label, value) {
  const existing = [...document.querySelectorAll("#proof-facts dt")].find((d) => d.textContent === label);
  if (existing) existing.nextElementSibling.textContent = value;
  else $("#proof-facts").insertAdjacentHTML("beforeend", `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`);
}

function shortInput(name, input) {
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

function onEvent(e) {
  if (e.phase && !["prepare", "build"].includes(e.phase) && e.type !== "agent.tool_result") setPhase(e.phase === "fix" && e.type.startsWith("prove") ? "prove" : e.phase);
  // Purchases made by attacks are shown on their cards; the Proof panel is about the shopper's own purchase.
  if (e.type.startsWith("prove.") && String(e.label ?? "").startsWith("attack-")) return;
  switch (e.type) {
    case "run.start": {
      const name = e.template ?? String(e.shop ?? "shop").split("/").pop();
      const modes = { baseline: "baseline: same agent, no PayPal context", check: "checking an existing PayPal checkout", existing: "hardening an existing PayPal checkout", heistproof: "card-only shop" };
      $("#eyebrow").textContent = `${name} · ${modes[e.mode] ?? "card-only shop"}`;
      $("#engine").innerHTML = e.model ? `Claude Code · <b>${esc(e.model)}</b>${e.provider === "meta" ? " via Meta Model API" : ""}` : "";
      break;
    }
    case "agent.start":
      log("sys", e.label ?? "agent", `Coding agent started (${esc(e.model)})`);
      $("#engine").innerHTML = `Claude Code · <b>${esc(e.model ?? "")}</b>${e.provider === "meta" ? " via Meta Model API" : ""}`;
      break;
    case "agent.init": {
      const apimatic = (e.plugins ?? []).find((p) => p.name === "paypal");
      if (apimatic) log("sys", "plugin", `<span class="tag apimatic">APIMatic</span>PayPal Context Plugin ${esc(apimatic.version)} loaded`);
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
        state.skills.add(skill);
        $("#skill-count").textContent = `${state.skills.size} skills used`;
        const ours = skill.startsWith("heistproof:");
        log("skill", "skill", `<span class="tag ${ours ? "ours" : "apimatic"}">${ours ? "Heistproof" : "APIMatic"}</span>${esc(skill)}`);
      } else if (["Edit", "Write", "MultiEdit"].includes(e.name)) log("edit", e.name.toLowerCase(), shortInput(e.name, e.input));
      else if (e.name === "Bash") log("cmd", "run", shortInput(e.name, e.input));
      else if (["Read", "Grep", "Glob"].includes(e.name)) log("sys", e.name.toLowerCase(), shortInput(e.name, e.input));
      break;
    }
    case "agent.done":
      log("sys", "done", `${esc(e.turns)} turns, ${Math.round((e.durationMs ?? 0) / 60000)} min`);
      break;
    case "build.tests":
      log(e.ok ? "sys" : "say", "tests", e.ok ? "npm test passes" : "npm test FAILS");
      break;
    case "sandbox.ready":
      fact("Webhook", e.webhookId);
      break;
    case "prove.buttons":
      fact("Buttons", Object.entries(e.buttons).map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join("  "));
      if (e.payLaterMessage) fact("Pay Later", e.payLaterMessage);
      break;
    case "prove.amount_check": {
      const box = $("#amount");
      box.hidden = false;
      box.className = `amount ${e.ok ? "good" : "bad"}`;
      box.innerHTML = `<div class="row"><span>Bag total</span><span>PayPal will charge</span></div>
        <div class="row big"><span>$${esc(e.bagTotal)}</span><span>${e.paypalAmount ? `$${esc(Number(e.paypalAmount.value).toLocaleString("en-US", { minimumFractionDigits: 2 }))}` : "?"}</span></div>
        <div class="verdict-line">${e.ok ? "Amounts match: approve" : "Mismatch: purchase stopped before any money moved"}</div>`;
      break;
    }
    case "prove.order_created":
      if (e.paypalOrderId) fact("PayPal order", e.paypalOrderId);
      break;
    case "prove.result":
      if (e.captureId) fact("Capture", e.captureId);
      if (e.shopOrder) fact("Shop order", e.shopOrder);
      if (!e.ok && String(e.label).includes("purchase")) state.bad.add("prove");
      break;
    case "prove.paypal_errors": {
      const real = (e.errors ?? []).filter((x) => !String(x.call).includes("/oauth2/"));
      if (!real.length) break;
      const box = $("#amount");
      box.hidden = false;
      box.className = "amount bad";
      box.innerHTML = real
        .map((x) => `<div class="row"><span>PayPal refused</span><span>HTTP ${esc(x.status)}</span></div><div class="big" style="font-size:20px">${esc(x.name ?? "")}</div><div class="row"><span>${esc(x.call)}</span></div><div class="verdict-line">debug id ${esc(x.debugId)}: the shop's tests passed, the real API said no</div>`)
        .join("");
      log("say", "paypal", `PayPal refused ${esc(real[0].call)}: ${esc(real[0].status)} ${esc(real[0].name ?? "")}`);
      break;
    }
    case "prove.webhook":
      fact("Signed webhook", e.ok ? `${e.eventId} verified (HTTP ${e.shopStatus})` : e.status === "not-delivered" ? "not delivered by the sandbox yet" : `refused (HTTP ${e.shopStatus})`);
      break;
    case "attack.start": {
      const card = $(`#card-${e.id}`);
      if (card) {
        card.className = "card running";
        card.querySelector(".stamp").textContent = "attacking";
      }
      break;
    }
    case "attack.result": {
      const card = $(`#card-${e.id}`);
      if (card) {
        card.className = `card ${e.verdict}`;
        card.querySelector(".stamp").textContent = e.verdict === "held" ? "held" : e.verdict === "robbed" ? "robbed" : e.verdict;
        card.querySelector("p").textContent = e.summary;
        const ids = [e.evidence?.paypalOrderId, e.evidence?.eventId, e.evidence?.injected?.debugId && `debug ${e.evidence.injected.debugId}`].filter(Boolean);
        card.querySelector(".ids").textContent = ids.join(" · ");
      }
      const all = [...document.querySelectorAll(".card")];
      $("#board-score").textContent = `${all.filter((c) => c.classList.contains("held")).length} held · ${all.filter((c) => c.classList.contains("robbed")).length} robbed`;
      if (e.verdict === "robbed") state.bad.add("attack");
      break;
    }
    case "round.done":
      if (e.failures > 0) log("say", "round", `Round ${e.round}: ${e.failures} problem(s) sent back to the coding agent`);
      break;
    case "run.done":
      setPhase("ship");
      state.done.add("ship");
      setPhase("ship");
      $("#verdict").className = `verdict ${e.safe ? "safe" : "unsafe"}`;
      $("#verdict").textContent = e.safe ? "Safe to ship" : "Do not ship";
      break;
  }
  const shots = e.screenshots ?? e.evidence?.screenshots;
  if (Array.isArray(shots)) addShots(shots);
}

function addShots(files) {
  for (const f of files) {
    if (state.files.includes(f)) continue;
    state.files.push(f);
    $("#shots").insertAdjacentHTML("beforeend", `<img src="/api/runs/${state.runId}/file/${encodeURIComponent(f)}" alt="${esc(f)}" title="${esc(f)}" />`);
  }
}

let replayTimer = null;

async function open(runId) {
  source?.close();
  clearTimeout(replayTimer);
  reset(runId);
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", `/run/${runId}${location.search}`);
  const speed = Number(params.get("replay"));
  if (speed > 0) return replay(runId, speed, Number(params.get("maxgap") ?? 1500));
  source = new EventSource(`/api/runs/${runId}/stream`);
  source.onmessage = (m) => onEvent(JSON.parse(m.data));
}

/** Plays a recorded run back in order, with its real timing compressed (long waits are capped). */
async function replay(runId, speed, maxGap) {
  const run = await (await fetch(`/api/runs/${runId}`)).json();
  const events = run.events.filter((e) => e.type !== "agent.tool_result");
  let i = 0;
  const step = () => {
    if (i >= events.length) return;
    onEvent(events[i]);
    const next = events[i + 1];
    i++;
    if (!next) return;
    const gap = Math.min((new Date(next.t) - new Date(events[i - 1].t)) / speed, maxGap);
    replayTimer = setTimeout(step, Math.max(gap, 40));
  };
  replayTimer = setTimeout(step, 600);
}

async function main() {
  const runs = await (await fetch("/api/runs")).json();
  $("#run-select").innerHTML = runs.map((r) => `<option value="${esc(r.id)}">${esc(r.id)}${r.mode ? ` · ${esc(r.mode)}` : ""}${r.safe === true ? " · safe" : r.safe === false ? " · unsafe" : ""}</option>`).join("");
  const fromUrl = location.pathname.startsWith("/run/") ? location.pathname.slice(5) : null;
  const first = fromUrl ?? runs[0]?.id;
  if (first) {
    $("#run-select").value = first;
    open(first);
  }
  $("#run-select").addEventListener("change", (e) => open(e.target.value));
  $("#shots").addEventListener("click", (e) => {
    if (e.target.tagName !== "IMG") return;
    $("#viewer-img").src = e.target.src;
    $("#viewer").showModal();
  });
  $("#viewer-close").addEventListener("click", () => $("#viewer").close());
}

main();
