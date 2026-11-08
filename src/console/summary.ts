// One run's summary for the console's index: what the home page and the run cards need, read from the run's events.
// Shared by the console server (src/console/server.ts) and the static site build (scripts/build-site.mjs), so the
// hosted site and the local console always say the same thing. Plain, erasable TypeScript: Node runs it as it is.
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
};
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
  const thief = new Map<number, { tried: number; robbed: number; repeat: number }>(); // repeat: only repeated a problem the books already showed
  const books = new Map<number, number>();
  for (const e of events) {
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
    } else if (e.type === "books.reconciled") books.set(e.round ?? round, (e.mismatches ?? []).length);
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
    thief: thief.get(last) ?? null,
    booksMismatches: books.has(last) ? books.get(last)! : null,
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

const seen = new Map<string, boolean>(); // file + size + mtime -> error page or not
/** The back-office screenshots of a run that are error pages, not proof. */
export function brokenShots(dir: string, files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!/-backoffice\.png$/.test(f)) continue;
    try {
      const file = path.join(dir, f);
      const st = fs.statSync(file);
      const key = `${file}:${st.size}:${st.mtimeMs}`;
      if (!seen.has(key)) seen.set(key, isErrorPage(fs.readFileSync(file)));
      if (seen.get(key)) out.push(f);
    } catch {}
  }
  return out;
}
