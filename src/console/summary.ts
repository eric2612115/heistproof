// One run's summary for the console's index: what the home page and the run cards need, read from the run's events.
// Shared by the console server (src/console/server.ts) and the static site build (scripts/build-site.mjs), so the
// hosted site and the local console always say the same thing. Plain, erasable TypeScript: Node runs it as it is.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const EXPECTED_ATTACKS = 10;
const SHOP_NAMES: Record<string, string> = {
  "fogline-express": "the Fogline shop",
  "fogline-naive": "a hand-written checkout",
  "fogline-afternoon": "a hand-written checkout",
  "fogline-after": "the checkout the agent wrote",
  "copper-kettle": "Copper Kettle",
  "copper-kettle-binding": "a test shop with one planted mistake",
  "copper-kettle-bug-binding": "a test shop with one planted mistake",
};
/** How the round's own purchase ended: paid once, paid but shipped a wrong number of times, refused by PayPal,
    stopped at the amount check, no PayPal button, or did not complete for another reason. */
type Purchase = { status: "paid" | "overshipped" | "refused" | "mismatch" | "nobutton" | "failed"; labels: number | null; amount: string | null; http: number | null };
/** The round's own purchase ("round1-purchase", "round0-purchase-try2", "round0-purchase-venmo"); never a robbery's or the AI thief's. */
export const ROUND_PURCHASE = /^round\d+-purchase(-(?:paypal|venmo|paylater))?(-try\d+)?$/;

type Ev = Record<string, any>;

export function summarize(id: string, events: Ev[]) {
  const start: Ev = events.find((e) => e.type === "run.start") ?? {};
  const done: Ev | undefined = events.find((e) => e.type === "run.done");
  let round = 0;
  const results = new Map<string, { verdict: string; round: number }>(); // attack id -> its latest result and the round it ran in
  const robbedEver = new Set<string>();
  let fixes = 0;
  let purchases = 0;
  let testsPassed: number | null = null; // the coding agent's own tests, as they stood when PayPal first refused
  let refusal: { status: number; name: string | null; call: string | null; debugId: string | null; round: number; testsPassed: number | null } | null = null;
  let mismatch: { bag: string; paypal: string | null; round: number } | null = null;
  let cheap: { captured: string; summary: string } | null = null;
  let thiefModel: string | null = null;
  const paid = new Map<number, boolean>(); // round -> did the round's own purchase pay (its last try)
  const buys = new Map<number, Purchase>(); // round -> how the round's own purchase ended
  const thief = new Map<number, { tried: number; robbed: number; repeat: number }>(); // repeat: only repeated a problem the books already showed
  const books = new Map<number, number>();
  const doublePaid = new Map<number, number>(); // round -> orders paid by a capture that already pays for another order
  const booksError = new Map<number, string | null>(); // round -> why the books could not be read, when they could not
  const paypalIds = new Set<string>(); // every PayPal order, capture and webhook event id the run's purchases saw (for search)
  for (const e of events) {
    if (e.type?.startsWith("prove.")) for (const k of ["paypalOrderId", "captureId", "eventId"]) if (typeof e[k] === "string" && e[k]) paypalIds.add(e[k]);
    const own = e.type?.startsWith("prove.") && ROUND_PURCHASE.test(String(e.label ?? ""));
    if (own && e.type === "prove.buttons") buys.set(round, { status: e.buttons && !e.buttons.paypal ? "nobutton" : "failed", labels: null, amount: null, http: null });
    else if (own && e.type === "prove.amount_check" && e.ok === false) buys.set(round, { status: "mismatch", labels: null, amount: e.paypalAmount?.value ?? null, http: null });
    else if (own && e.type === "prove.result") {
      const verdict = String(e.verdict ?? "");
      const prior = buys.get(round);
      const amount = /Paid \$([\d.,]+)/.exec(verdict)?.[1] ?? null;
      const labels = Number(/with (\d+) labels?/.exec(verdict)?.[1] ?? NaN);
      if (e.ok && e.captureId) buys.set(round, { status: "paid", labels: 1, amount, http: null });
      else if (e.captureId && Number.isFinite(labels) && labels !== 1) buys.set(round, { status: "overshipped", labels, amount, http: null });
      else if (!prior || !["mismatch", "refused", "nobutton"].includes(prior.status)) buys.set(round, { status: "failed", labels: Number.isFinite(labels) ? labels : null, amount, http: null });
    } else if (e.type === "prove.paypal_errors") {
      const x = (e.errors ?? []).find((y: Ev) => !String(y.call).includes("/oauth2/"));
      if (x) buys.set(e.round ?? round, { status: "refused", labels: null, amount: null, http: Number(x.status) || null });
    }
    if (e.type === "attack.result") {
      results.set(String(e.id), { verdict: String(e.verdict), round });
      if (e.verdict === "robbed") robbedEver.add(String(e.id));
      if (e.id === "price-tamper" && e.verdict === "robbed" && !cheap) {
        const c = e.evidence?.followThrough?.captured;
        cheap = { captured: c ? `${c.value} ${c.currency_code ?? c.currency ?? ""}`.trim() : "", summary: String(e.summary ?? "") };
      }
    } else if (e.type === "round.done") round++;
    else if (e.type === "agent.start" && String(e.label ?? "").startsWith("fix")) fixes++;
    else if (e.type === "prove.buttons" && ROUND_PURCHASE.test(String(e.label ?? "")) && !/-try\d+$/.test(String(e.label))) purchases++;
    else if (e.type === "build.tests" && !refusal) testsPassed = Number(/ℹ pass (\d+)/.exec(String(e.output ?? ""))?.[1] ?? NaN) || testsPassed;
    else if (e.type === "prove.paypal_errors" && !refusal) {
      const x = (e.errors ?? []).find((y: Ev) => !String(y.call).includes("/oauth2/"));
      if (x) refusal = { status: x.status, name: x.name ?? null, call: x.call ?? null, debugId: x.debugId ?? null, round: e.round ?? round, testsPassed };
    } else if (e.type === "prove.amount_check" && e.ok === false && ROUND_PURCHASE.test(String(e.label ?? "")) && !mismatch) {
      mismatch = { bag: String(e.bagTotal), paypal: e.paypalAmount?.value ?? null, round };
    } else if (e.type === "prove.result" && ROUND_PURCHASE.test(String(e.label ?? ""))) paid.set(round, Boolean(e.ok && e.captureId));
    else if (e.type === "thief.start") thiefModel = e.model ?? thiefModel;
    else if (e.type === "thief.result") {
      const t = thief.get(e.round ?? round) ?? { tried: 0, robbed: 0, repeat: 0 };
      t.tried++;
      if (e.verdict === "robbed") t.robbed++;
      else if (e.verdict === "repeat") t.repeat++;
      thief.set(e.round ?? round, t);
    } else if (e.type === "books.reconciled") {
      books.set(e.round ?? round, (e.mismatches ?? []).length);
      doublePaid.set(e.round ?? round, (e.mismatches ?? []).filter((m: Ev) => /already pays for order/i.test(String(m.problem))).length);
      booksError.set(e.round ?? round, e.matched === false ? String(e.error ?? e.reason ?? "the back office shows no PayPal ids") : null);
    }
  }
  const last = Math.max(0, ...[...results.values()].map((r) => r.round));
  const final = [...results.values()].filter((r) => r.round === last);
  const count = (v: string) => final.filter((r) => r.verdict === v).length;
  const mode = String(start.mode ?? "heistproof");
  const template = String(start.template ?? String(start.shop ?? "").split("/").pop() ?? "");
  const shop = SHOP_NAMES[template] ?? (template || "the shop");
  const title = mode === "check" ? `${shop[0].toUpperCase()}${shop.slice(1)}, checked as it is` : mode === "existing" ? `AI fixes ${shop}` : mode === "baseline" ? "AI alone, with no PayPal skills" : `AI adds PayPal to ${shop}`;
  return {
    id,
    mode,
    template,
    offline: Boolean(start.offline),
    model: start.model ?? "",
    provider: start.provider ?? "",
    thiefModel,
    heistproofCommit: start.heistproofCommit ?? null,
    node: start.node ?? null,
    started: events[0]?.t ?? null,
    finished: done?.t ?? null,
    verdict: done ? (done.verdict ?? (done.safe ? "safe" : "unsafe")) : null,
    safe: done?.safe ?? null,
    held: count("held"),
    robbed: count("robbed"),
    skipped: count("skipped") + count("error"),
    notApplicable: count("n/a"),
    ran: final.length,
    total: Math.max(EXPECTED_ATTACKS, results.size),
    robbedEver: robbedEver.size,
    rounds: done?.rounds ?? round + (results.size ? 1 : 0),
    fixes,
    purchases,
    refusal,
    mismatch,
    cheap,
    paid: paid.size ? (paid.get(Math.max(...paid.keys())) ?? null) : null,
    purchase: buys.size ? (buys.get(Math.max(...buys.keys())) ?? null) : null,
    thief: thief.get(last) ?? null,
    booksMismatches: books.has(last) ? books.get(last)! : null,
    booksError: booksError.get(last) ?? null,
    booksDoublePaid: doublePaid.get(last) ?? 0,
    paypalIds: [...paypalIds],
    branch: done?.branch ?? (done?.branchReady ? "local" : null),
    pr: typeof done?.pr === "string" && done.pr ? done.pr : null,
    title,
  };
}

/* ---------- Screenshots that are not proof ----------
   A back-office screenshot taken while the shop answered an error shows a server error page (a white page with a
   monospace stack trace), not the back office. The console must never caption such a page as proof, so the server and
   the static build list them and the console leaves them out. Detection reads the PNG itself: a white page, only grey
   pixels, text starting at the very left edge (a bare <pre>), and nothing at all in its lower half. */

/** Reads an 8-bit, non-interlaced PNG row by row; visit() gets each unfiltered row and may stop early by returning false.
    Returns false for any other kind of PNG. */
function eachPngRow(buf: Buffer, visit: (row: Uint8Array, y: number, width: number, height: number, channels: number) => boolean): boolean {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false;
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      if (depth !== 8 || data[12] !== 0) return false;
      channels = colour === 2 ? 3 : colour === 6 ? 4 : colour === 0 ? 1 : colour === 4 ? 2 : 0;
      if (!channels) return false;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || !idat.length) return false;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return false;
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1) + 1;
    const filter = raw[at - 1];
    if (filter === 0) for (let i = 0; i < stride; i++) line[i] = raw[at + i];
    else if (filter === 1) for (let i = 0; i < stride; i++) line[i] = (raw[at + i] + (i >= bpp ? line[i - bpp] : 0)) & 0xff;
    else if (filter === 2) for (let i = 0; i < stride; i++) line[i] = (raw[at + i] + prev[i]) & 0xff;
    else if (filter === 3) for (let i = 0; i < stride; i++) line[i] = (raw[at + i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 0xff;
    else if (filter === 4)
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = p > a ? p - a : a - p;
        const pb = p > b ? p - b : b - p;
        const pc = p > c ? p - c : c - p;
        line[i] = (raw[at + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    else return false;
    if (!visit(line, y, width, height, channels)) return true;
    const t = prev;
    prev = line;
    line = t;
  }
  return true;
}

/** True when a screenshot is a bare server error page (white, grey monospace text from the left edge, empty lower half). */
export function isErrorPage(png: Buffer): boolean {
  let real = false;
  let ink = 0;
  let left = Infinity;
  const read = eachPngRow(png, (row, y, width, height, channels) => {
    if (channels < 3) return !(real = true);
    for (let i = 0, x = 0; x < width; x++, i += channels) {
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
      const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
      if (hi - lo > 12) return !(real = true); // any colour: a real page
      if (r < 245) {
        if (y > height / 2) return !(real = true); // something in the lower half: a real page
        ink++;
        if (x < left) left = x;
      }
    }
    return true;
  });
  return read && !real && ink > 200 && left < 24;
}

/* ---------- Where a back-office screenshot's proof is ----------
   The shop's back office outlines the order a robbery touched (a thick orange frame around its row). At card size the
   whole page is unreadable, so the console shows a crop: the table's column headings and the outlined row, each as a
   strip of the original pixels. Found from the PNG itself; null when there is no outline. */

/** Pixel crop of a back-office screenshot: the image size, the columns kept, and one or two strips of rows. */
export type ShotFocus = { w: number; h: number; x: [number, number]; windows: Array<[number, number]> };

export function backOfficeFocus(png: Buffer): ShotFocus | null {
  const rows: Uint8Array[] = [];
  let W = 0;
  let H = 0;
  let C = 0;
  const read = eachPngRow(png, (row, _y, width, height, channels) => {
    rows.push(row.slice());
    W = width;
    H = height;
    C = channels;
    return true;
  });
  if (!read || C < 3 || rows.length !== H) return null;
  // The outline's top and bottom edges: rows where orange covers at least a third of the width.
  const edges: Array<{ y: number; x0: number; x1: number }> = [];
  for (let y = 0; y < H; y++) {
    const row = rows[y];
    let n = 0;
    let a = W;
    let b = -1;
    for (let x = 0, i = 0; x < W; x++, i += C) {
      if (row[i] > 215 && row[i + 1] > 120 && row[i + 1] < 205 && row[i + 2] < 110) {
        n++;
        if (x < a) a = x;
        b = x;
      }
    }
    if (n > W / 3) edges.push({ y, x0: a, x1: b });
  }
  const groups: Array<typeof edges> = [];
  for (const e of edges) {
    const g = groups[groups.length - 1];
    if (g && e.y - g[g.length - 1].y <= 1) g.push(e);
    else groups.push([e]);
  }
  if (groups.length < 2) return null;
  const y0 = groups[0][0].y;
  const y1 = groups[1][groups[1].length - 1].y;
  const x0 = Math.min(...groups[0].map((e) => e.x0));
  const x1 = Math.max(...groups[0].map((e) => e.x1));
  const rowH = y1 - y0;
  if (rowH < 16 || rowH > 220 || x1 - x0 < W / 3) return null;
  // The column headings: the topmost line of text above the outline that spans most of the table's width.
  const L = x0 + 6;
  const R = x1 - 6;
  const bands: Array<{ top: number; bottom: number; a: number; b: number }> = [];
  let cur: (typeof bands)[number] | null = null;
  for (let y = 0; y < y0; y++) {
    const row = rows[y];
    const tally = new Map<number, number>();
    for (let x = L, i = L * C; x < R; x += 2, i += 2 * C) {
      const k = ((row[i] >> 4) << 8) | ((row[i + 1] >> 4) << 4) | (row[i + 2] >> 4);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    let mode = 0;
    let best = -1;
    for (const [k, n] of tally) if (n > best) [mode, best] = [k, n];
    const br = ((mode >> 8) << 4) + 8;
    const bg = (((mode >> 4) & 15) << 4) + 8;
    const bb = ((mode & 15) << 4) + 8;
    let ink = 0;
    let a = R;
    let b = -1;
    for (let x = L, i = L * C; x < R; x++, i += C) {
      if (Math.abs(row[i] - br) + Math.abs(row[i + 1] - bg) + Math.abs(row[i + 2] - bb) > 120) {
        ink++;
        if (x < a) a = x;
        b = x;
      }
    }
    if (ink >= 2) {
      if (cur) {
        cur.bottom = y;
        cur.a = Math.min(cur.a, a);
        cur.b = Math.max(cur.b, b);
      } else cur = { top: y, bottom: y, a, b };
    } else if (cur) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  const head = bands.find((band) => band.b - band.a >= 0.6 * (R - L) && band.bottom - band.top < rowH);
  const pad = 8;
  const windows: Array<[number, number]> = [];
  const low = Math.min(H, y1 + pad);
  if (head) {
    const extra = Math.round(Math.max(pad, (rowH - (head.bottom - head.top)) / 2));
    const ht = Math.max(0, head.top - extra);
    const hb = head.bottom + extra;
    if (y0 - hb <= rowH * 2.2) windows.push([ht, low]);
    else windows.push([ht, hb], [Math.max(0, y0 - pad), low]);
  } else windows.push([Math.max(0, y0 - rowH), low]);
  return { w: W, h: H, x: [Math.max(0, x0 - pad), Math.min(W, x1 + pad + 1)], windows };
}

type ShotFacts = { broken: boolean; hash: string; focus: ShotFocus | null };
const seen = new Map<string, ShotFacts>(); // file + size + mtime -> what the screenshot is

function factsOf(file: string): ShotFacts | null {
  try {
    const st = fs.statSync(file);
    const key = `${file}:${st.size}:${st.mtimeMs}`;
    if (!seen.has(key)) {
      const png = fs.readFileSync(file);
      const backOffice = /-backoffice\.png$/.test(file);
      const broken = backOffice && isErrorPage(png);
      seen.set(key, { broken, hash: crypto.createHash("sha1").update(png).digest("hex"), focus: backOffice && !broken ? backOfficeFocus(png) : null });
    }
    return seen.get(key)!;
  } catch {
    return null;
  }
}

/** The back-office screenshots of a run that are error pages, not proof. */
export function brokenShots(dir: string, files: string[]): string[] {
  return files.filter((f) => /-backoffice\.png$/.test(f) && factsOf(path.join(dir, f))?.broken);
}

/**
 * What the console needs to know about a run's screenshots: the error pages it must leave out, the byte-for-byte copies
 * (each mapped to the first file with the same pixels, so no group shows one picture twice), and where the outlined
 * order is on each back-office page.
 */
export function shotInfo(dir: string, files: string[]): { brokenShots: string[]; sameShots: Record<string, string>; focus: Record<string, ShotFocus> } {
  const broken: string[] = [];
  const sameShots: Record<string, string> = {};
  const focus: Record<string, ShotFocus> = {};
  const first = new Map<string, string>();
  for (const f of files.filter((x) => x.endsWith(".png")).sort()) {
    const facts = factsOf(path.join(dir, f));
    if (!facts) continue;
    if (facts.broken) {
      broken.push(f);
      continue;
    }
    if (first.has(facts.hash)) sameShots[f] = first.get(facts.hash)!;
    else first.set(facts.hash, f);
    if (facts.focus) focus[f] = facts.focus;
  }
  return { brokenShots: broken, sameShots, focus };
}
