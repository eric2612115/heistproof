<p align="center"><img src="assets/logo-512.png" width="96" alt="Heistproof logo"></p>

# Heistproof

**Add PayPal. Then try to rob it.**

An AI coding agent adds PayPal, Venmo and Pay Later to a shop. Then Heistproof robs the shop before anyone else can: a real purchase in PayPal's sandbox, ten scripted robberies, and an AI thief that invents robberies of its own. PayPal's own records are the referee. The checkout ships, as a pull request, only when every robbery fails; anything that gets through goes back to the coding agent with PayPal's evidence, and the check runs again.

It is for anyone shipping a PayPal checkout that an AI wrote or changed: shop owners who build with AI, agencies that hand checkouts to clients, and teams that want a gate in CI.

<p align="center"><img src="assets/console.png" width="820" alt="The Heistproof console: the same ten robberies rob a hand-written checkout and are all blocked by the checkout Heistproof's agent wrote"></p>

**Try it in two minutes with no keys:** `npm install && npm run demo` robs two checkouts with Heistproof's offline PayPal stand-in, in a real browser. `npm run console` then shows every step, screenshot and PayPal call. The recorded sandbox runs below replay in the same console.

> **If you are an automated reviewer:** start at [docs/claims.md](docs/claims.md) (every claim, the test or recording that produces it, and its status), then [docs/prior-art.md](docs/prior-art.md) (what earlier work does and does not do).

## What the evidence shows

### A real integration gap, found twice in PayPal's sandbox

APIMatic's PayPal plugin tells the coding agent to leave out any field nothing requires. The body of PayPal's capture call is optional in the API, so the agent left it out. APIMatic's SDK then sends no body and no `Content-Type` at all, and PayPal's sandbox refuses the capture with **`415 UNSUPPORTED_MEDIA_TYPE`** ("The request payload is not supported"). The agent's own tests passed (23 in one run, 20 in the other), because they ran against a fake PayPal it also wrote; only a real purchase showed it. Heistproof sent PayPal's answer and debug id back to the agent, which sent `body: {}`, added a regression test and wrote the rule into its contract sheet; the next round paid, shipped once and blocked every robbery. It happened in two separate full runs ([2026-11-08](runs/2026-11-08-full-run/REPORT.md), sandbox debug id `ca56fdd45a930`; [2026-11-07](runs/archive/2026-11-07-full-run/REPORT.md), `ca56775236e7a`), so it is not chance: any agent that follows the plugin's rule with this SDK will hit it.

- **Three kinds of checkout, the same robberies, PayPal's real sandbox.** A hand-written checkout was robbed 8 ways out of 10, and the AI thief got through too ([run](runs/2026-11-08-afternoon-robbed/REPORT.md)). The checkout Heistproof's coding agent wrote blocked all 10 and everything the thief invented ([full run](runs/2026-11-08-full-run/REPORT.md)). A hand-written checkout with planted mistakes ($4,900 for a $49 bag, a $0.01 hoodie) was fixed by the agent in one round, then blocked all 10 ([run](runs/2026-11-08-naive-hardened/REPORT.md)).
- **Heistproof does not assume AI code is unsafe; it proves a checkout either way.** The same model without APIMatic's plugin or any PayPal skill wrote a checkout that was safe at the first try ([run](runs/2026-11-08-ai-alone/REPORT.md)); following the plugin, it hit the 415 above.
- **Each robbery catches its own mistake, and the AI thief catches more.** Ten copies of a careful shop, each with one planted mistake, are each robbed by the robbery for that mistake; an eleventh mistake, invisible to all ten, is caught by the AI thief's own robbery. CI runs all of it on every push ([`test/attacks/one-bug.test.ts`](test/attacks/one-bug.test.ts)).
- **An incomplete check is never called safe.** PayPal's sandbox sometimes never delivers an event a webhook robbery needs. In two recordings that happened, nothing got through, and the checks say incomplete rather than safe ([Copper Kettle](runs/2026-11-08-copper-kettle/REPORT.md), [the agent's checkout, rechecked](runs/2026-11-08-agent-checkout-recheck/REPORT.md)).

Every recorded run, as its own files say:

<!-- evidence:start -->
| Run | Shop | Who wrote the checkout | PayPal | Rounds | 10 scripted robberies (last round) | AI thief | Books vs PayPal | Verdict |
|---|---|---|---|---|---|---|---|---|
| [2026-11-08-afternoon-robbed](runs/2026-11-08-afternoon-robbed/REPORT.md) | Fogline, hand-written PayPal checkout with typical mistakes | checked as it is (no AI changes any code) | PayPal sandbox | 1 | 8 robbed, 2 blocked | 5 of 6 got through | 10 order(s) do not match | **unsafe** |
| [2026-11-08-agent-checkout-recheck](runs/2026-11-08-agent-checkout-recheck/REPORT.md) | Fogline, the checkout the coding agent wrote in the full run | checked as it is (no AI changes any code) | PayPal sandbox | 1 | 0 robbed, 9 blocked | 0 of 6 got through | match (6 PayPal orders) | **incomplete** |
| [2026-11-08-ai-alone](runs/2026-11-08-ai-alone/REPORT.md) | Fogline, card-only sample shop | the same agent and model, without any PayPal skills | PayPal sandbox | 1 | 0 robbed, 10 blocked | 0 of 6 got through | match (6 PayPal orders) | **safe** |
| [2026-11-08-copper-kettle](runs/2026-11-08-copper-kettle/REPORT.md) | Copper Kettle, a second shop built differently on purpose | checked as it is (no AI changes any code) | PayPal sandbox | 1 | 0 robbed, 7 blocked | 0 of 6 got through | match (6 PayPal orders) | **incomplete** |
| [2026-11-08-full-run](runs/2026-11-08-full-run/REPORT.md) | Fogline, card-only sample shop | Heistproof's coding agent (APIMatic's plugin + Heistproof's skills) | PayPal sandbox | 2 | 0 robbed, 10 blocked | 0 of 6 got through | match (6 PayPal orders) | **safe** |
| [2026-11-08-naive-hardened](runs/2026-11-08-naive-hardened/REPORT.md) | Fogline, hand-written PayPal checkout with typical mistakes (naive) | a hand-written checkout, fixed by the coding agent | PayPal sandbox | 2 | 0 robbed, 10 blocked | 0 of 6 got through | match (5 PayPal orders) | **safe** |
| [2026-11-08-naive-penny-heist](runs/2026-11-08-naive-penny-heist/REPORT.md) | Fogline, hand-written PayPal checkout with typical mistakes (naive) | checked as it is (no AI changes any code) | PayPal sandbox | 1 | 2 robbed, 2 blocked (4 of 10 ran) | not run | not matched | **unsafe** |

_Generated by `node scripts/evidence.mjs` from each run's own files; `npm test` fails if this table is edited by hand._
<!-- evidence:end -->

## Try it

| What you want | What you need | Command |
|---|---|---|
| See the ten robberies rob one checkout and fail on another | Node.js only | `npm run demo` |
| Check any shop that already takes PayPal, offline | Node.js only | `npm run check -- <shop> --offline` |
| The same against PayPal's real sandbox | a PayPal sandbox app | `npm run check -- <shop>` |
| Add an AI thief that invents robberies of its own | any AI key | it joins `check` and `heist` whenever a key is set |
| The whole job: the agent adds PayPal, then buy, rob, fix | a PayPal sandbox app and any AI key | `npm run heist` |
| A gate on every pull request | nothing | the GitHub Action below |

Exit codes: 0 safe to ship, 1 do not ship, 2 incomplete (a robbery could not run, or Heistproof itself failed; an incomplete check is never called safe).

Setup, once. You need Node.js 24.22.1 or newer (tested), or 22.23.4+ / 26.12.1+: older releases are affected by the [October 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). `npm run doctor` checks everything and lists what you can run right now. With nvm: `nvm install` (reads `.nvmrc`).

```bash
git clone https://github.com/eric2612115/heistproof && cd heistproof
npm install            # also installs Playwright's Chromium (npm may say some dependencies' own install scripts were skipped; Heistproof does not need them)
npm run demo           # no keys: the ten robberies against two checkouts, offline
npm run setup          # optional: your PayPal sandbox app, sandbox buyer and any AI key; secrets are typed hidden and stay in .env.local
npm run doctor         # what is set, what is missing, and which commands are ready
```

For the real sandbox you also need `cloudflared` so PayPal can deliver webhooks to your machine (`brew install cloudflared`, or the [download page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on Windows and Linux), or a public URL in `HEISTPROOF_PUBLIC_URL`. A sandbox app takes two minutes: [developer.paypal.com](https://developer.paypal.com) > Apps & Credentials > Sandbox > Create App (a US business account); the sandbox buyer is any Personal account under Testing Tools > Sandbox Accounts.

## Why it matters

- **AI agents are starting to shop and pay.** AI traffic to US retail sites grew 393% year over year in Q1 2026 (Adobe, reported by [Decrypt](https://decrypt.co/364733/ai-traffic-us-retailers-jumps-q1-agentic-shoppers-outspend-humans)), and PayPal's [Agent Ready](https://developer.paypal.com/agentic-commerce-services/about) lets merchants take payments from AI assistants. An agent that finds one checkout mistake can try it on a thousand shops in an afternoon.
- **The checkouts are written by AI too, and the same AI does not always write the same checkout.** In our recordings the same model on the same shop was safe at the first try when it worked alone, and was refused by PayPal's real sandbox when it followed APIMatic's plugin, although its own tests passed both times. Nobody reads a checkout an agent wrote; a verdict has to come from robbing it.
- **PayPal already provides every safeguard; the question is whether the shop uses it.** Server-side orders, capture status, [`PayPal-Request-Id`](https://developer.paypal.com/api/rest/reference/idempotency/), [webhook signature verification](https://developer.paypal.com/api/rest/webhooks/rest/), [negative testing](https://developer.paypal.com/tools/sandbox/negative-testing/). None of the robberies is a hole in PayPal: PayPal charges what the merchant's server asks it to charge. Each robbery checks that one safeguard is used.

## How it works

1. **Add.** A coding agent (Claude Code with [APIMatic's PayPal Context Plugin](https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal) and Heistproof's two skills, on any model) writes `paypal-plan.md` first, then JS SDK v6 buttons for PayPal, Venmo and Pay Later with Pay Later messaging, Orders v2 create and capture on the server, and signature-verified webhooks wired into the shop's fulfilment.
2. **Buy.** A scripted browser (Playwright, no AI) buys like a shopper and approves on PayPal's own sandbox pages. Before approving it checks that PayPal will charge the bag total.
3. **Rob.** Ten scripted robberies, each the test for one safeguard (table below), replay and tamper with what the real purchase sent, from the shopper's own browser session. Every replay first runs unchanged as a positive control, so a refusal means the shop refused the tampering.
4. **The AI thief.** A model plays a dishonest shopper. It sees only what any visitor can see (the storefront's scripts, the requests the page sent, the shape of PayPal's events), invents robberies of its own and Heistproof carries them out through a few fixed moves that can only reach this shop.
5. **The books.** After every robbery round, every order the shop calls paid or has shipped must be backed by a completed PayPal capture that covers it; a capture may pay for one order only, and no order may ship more parcels than PayPal captured. The books decide every robbery, scripted or invented; the thief never grades itself.
6. **Fix.** Anything that got through goes back to the coding agent with PayPal's answers (status, issue, debug id), and the whole check runs again; the thief's successful robberies run again first.
7. **Ship.** A branch with the change, its tests and `HEISTPROOF-REPORT.md`, with a pull request only when every robbery was blocked and the books match.

```
card-only shop ──> coding agent (Claude Code + APIMatic PayPal Context Plugin + Heistproof skills, any model)
                        │  paypal-plan.md, code, tests
                        v
shop on :4411 <──> recording proxy (:4418) <──> PayPal sandbox, or the offline stand-in (:4416)
     ^                                               │ signed webhooks
     │ webhooks (byte-exact copies kept)             v
webhook tap (:4417) <── cloudflared tunnel (sandbox) / direct (offline)
     ^
scripted browser (Playwright): buys like a shopper, checks the amount, approves on PayPal's page
     │
10 scripted robberies, then the AI thief's robberies  ──>  books: the shop's orders against PayPal's records
     │
verdict ──> fix loop with the coding agent ──> branch, report, and a pull request only when safe
```

## The ten robberies

| Robbery | What it tries | The safeguard it tests | What getting through looks like |
|---|---|---|---|
| Price tampering | Pay $0.01 for the $49 hoodie | the server sets the amount ([OWASP WSTG-BUSL-10](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/10-Payment_Functionality.md): price and currency tampering) | a PayPal order for $0.01 or in yen, and the hoodie ships |
| Negative quantity | Buy -1, 0.5 or 1,000 hoodies, or a product that does not exist | the bag is validated (WSTG-BUSL-10: quantity tampering) | a PayPal order for a bag that should have been refused |
| Payment nobody approved | Claim payment for an order no buyer approved | paid means captured by PayPal ([Orders v2](https://developer.paypal.com/docs/api/orders/v2/)) | an unapproved order marked paid |
| Approval without payment | Get it shipped before PayPal takes the money | fulfil only a COMPLETED capture | a label for an order that was approved but never captured |
| Declined card | Get it shipped after the card is declined | check the capture's result ([negative testing](https://developer.paypal.com/tools/sandbox/negative-testing/): `INSTRUMENT_DECLINED`) | a label after PayPal's 422 |
| Forged webhook | Fake PayPal's "payment completed" message | [verify every webhook](https://developer.paypal.com/api/rest/webhooks/rest/) | an unsigned or edited event changes an order |
| Webhook replay | Resend PayPal's real message to ship again | handle each event once | two labels for one payment |
| Late event | Send "approved" after "completed" | orders never move backwards | a paid order drops back |
| Double click | Capture twice at once | [`PayPal-Request-Id`](https://developer.paypal.com/api/rest/reference/idempotency/) and fulfilling once | two labels from two simultaneous captures |
| Secret in the browser | Look for the PayPal secret in every page, script and answer | secrets stay on the server | the client secret, or `id:secret` in base64, reaches the browser |

The rules the coding agent is given are in [`plugin/skills/checkout-hardening`](plugin/skills/checkout-hardening/SKILL.md); the robberies are in [`src/attacks.ts`](src/attacks.ts), the thief in [`src/thief.ts`](src/thief.ts), the books in [`src/books.ts`](src/books.ts).

**Each robbery catches its own mistake.** [`test/attacks/one-bug.test.ts`](test/attacks/one-bug.test.ts) takes [Copper Kettle](shops/copper-kettle/README.md), a careful shop that blocks all ten, and makes ten copies with exactly one well-known mistake each; each copy is robbed by the robbery for that mistake. An eleventh copy has a mistake none of the ten can see (a capture route that lets a request field choose which order a payment pays for): the ten all pass it, and the AI thief's own robbery, recorded from a real run and replayed in CI, gets one payment to pay for two orders.

## Use it in CI

```yaml
# .github/workflows/heistproof.yml in your shop's repository
on:
  pull_request:
    paths: ["shop/**"]
jobs:
  rob:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: eric2612115/heistproof@main
        with:
          shop: shop
```

Offline by default: no PayPal account and no secrets. The job fails unless the checkout is safe, puts the report in the job summary and uploads the run. This repository's own CI runs the action on Copper Kettle, and runs the robberies against three checkouts plus the eleven planted mistakes on every push.

## Any shop

Heistproof learns a checkout's routes by watching the real purchase, so the robberies need nothing shop-specific. What it needs to shop and to read the back office is described in an optional `heistproof.json` at the shop's root (start command, how to fill and open the bag, the back office's orders list and its field names, the webhook path); the Fogline sample's values are the default. [Copper Kettle's](shops/copper-kettle/heistproof.json) shows a shop with no framework, a session cookie and a CSRF token on every request, and other routes and fields.

The offline stand-in ([`src/paypal/stand-in.ts`](src/paypal/stand-in.ts)) covers what a checkout touches: OAuth, Orders v2 create, get and capture under PayPal's rules (approval before capture, one capture per order, idempotent `PayPal-Request-Id`, 415 without a JSON content type, amount and item checks), negative testing, signed webhooks and `verify-webhook-signature`, and JS SDK v6 in the browser. Each rule has a test ([`test/stand-in.test.ts`](test/stand-in.test.ts)). It is not PayPal: only a sandbox run proves a shop against PayPal itself, which is why every recording above was made in the sandbox.

## Bring any model

The agent harness is always Claude Code, because that is where APIMatic's plugin lives; the model is whatever key you give `npm run setup`:

| Key | Provider | How it is called |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | through a local relay |
| `MODEL_API_KEY` | Meta Model API (Muse) | through a local relay (Anthropic Messages protocol) |
| `DEEPSEEK_API_KEY` | DeepSeek | through a local relay (Anthropic Messages protocol) |
| `OPENAI_API_KEY` | OpenAI | through Heistproof's protocol bridge |
| `GEMINI_API_KEY` | Google Gemini | through the bridge (Gemini's OpenAI-compatible API) |
| `OPENROUTER_API_KEY` | OpenRouter (any model) | through the bridge |
| `HEISTPROOF_BASE_URL` + `HEISTPROOF_API_KEY` + `HEISTPROOF_MODEL` | anything OpenAI- or Anthropic-compatible | bridge or relay (`HEISTPROOF_PROTOCOL`) |

The relay and the bridge hold the key; the agent gets only their local address and a per-run token, so neither the agent nor any command it runs can read or spend the key ([`test/engine.test.ts`](test/engine.test.ts)). Every recorded run used Meta's `muse-wonder-1.0`; the bridge is covered by unit tests, not by a recorded run.

## PayPal APIs used

| API | Where | What for |
|---|---|---|
| JS SDK v6 `paypal-payments`, `venmo-payments` | shop (written by the agent) | PayPal, Venmo and Pay Later buttons, one-time payment sessions |
| JS SDK v6 `paypal-messages` | shop | Pay Later messaging next to the total |
| Orders v2: create, capture, get | shop, through APIMatic's PayPal TypeScript SDK | server-priced orders and their capture |
| Webhooks: verify-webhook-signature | shop | trust no event until PayPal confirms it |
| Webhooks: create and update | Heistproof | points the sandbox app's webhook at the run's public address |
| Orders v2: get | Heistproof | the books: PayPal's own record of every order and capture |
| Negative testing (`PayPal-Mock-Response`) | Heistproof's recording proxy | a real `INSTRUMENT_DECLINED` from the sandbox at capture |
| OAuth 2.0 client credentials | both | access tokens |

## APIMatic's PayPal Context Plugin

The plugin (`paypal@context-plugins`, MIT) points the coding agent at the SDK map inside APIMatic's PayPal TypeScript SDK and makes it plan before it codes. In the full run the agent loaded `typescript-integrate-paypal` first, then the plugin's getting-started, error-handling, client-initialization, authentication, calling-endpoints, models, configuration-resilience and testing skills, installed the SDK, wrote `paypal-plan.md`, and only then wrote PayPal code. Heistproof then found a gap the plugin's guidance leads into: following its rule to leave out optional fields, the capture call sent no body and so no `Content-Type`, and PayPal's sandbox refuses that with 415. The agent's own tests used a fake PayPal and passed; the real purchase failed; the agent fixed it from PayPal's answer. A baseline run with no plugin and no skills is recorded too, so the plugin's effect is not taken on faith.

## Security of the coding agent

The agent runs in a work folder outside this repository. Its environment holds no keys (see Bring any model). A tested guard ([`test/guard.test.ts`](test/guard.test.ts)) keeps file tools inside the shop folder, refuses shell commands that name the home folder, parent folders, other folders or the environment, and limits fetches and downloads to PayPal's, APIMatic's, GitHub's and npm's hosts. It is a best-effort layer, not a sandbox: for strict isolation, run Heistproof in a container. The AI thief makes no tool calls at all; its moves are carried out by Heistproof and can only reach the shop under test ([`test/thief.test.ts`](test/thief.test.ts)).

## Sandbox vs production

| | In this repo | In production |
|---|---|---|
| Money | PayPal sandbox, or the offline stand-in; no real funds | live credentials, `PAYPAL_ENV=live`, `PAYPAL_API_BASE=https://api-m.paypal.com` |
| Robberies | against the sandbox or the stand-in | never against live; run Heistproof in CI against your sandbox app, or offline |
| Webhooks | a temporary tunnel address on the sandbox app | your deployed URL, registered once |
| Shops | the sample shops in `shops/` and `examples/` | your repository; Heistproof opens a branch, and a pull request when safe |

## Limits

- The robberies and the stand-in cover one-time purchases with JS SDK v6 and Orders v2. Subscriptions, vaulting, refunds and disputes are not tested; offline mode does not stand in for the older JS SDK v5.
- The sample shops are Node.js. Other stacks work when they run locally and describe themselves in `heistproof.json`; we have recorded only Node.js shops.
- The hand-written checkouts in `shops/` have planted mistakes; they show what the robberies catch, not how common the mistakes are. We have not measured how often real shops get them wrong.
- The AI thief's inventions vary from run to run: on the planted-binding shop it once ran out of its thinking budget and produced no plan, and found the mistake on the next run. Its recorded plans are replayed in CI so the result is repeatable; its live inventions are a bonus on top of the ten, never a replacement.
- The books check PayPal's part of the books only; orders paid another way (the card form) are counted, not judged.
- PayPal's sandbox sometimes delivers a webhook late or not at all. A robbery that needs one says so and the check is incomplete, never safe; run it again.
- PayPal's sandbox pages can change; the scripted browser's selectors are in `src/prove.ts`.

## More options

- `npm run migrate -- <shop>` runs only the coding agent; `npm run heist -- <shop> --baseline` runs it without APIMatic's plugin and Heistproof's skills; `--existing` skips adding PayPal and goes straight to buy, rob and fix; `--no-thief` leaves out the AI thief; `--thief-plans=<file>` replays a thief's recorded robberies.
- `HEISTPROOF_HEADED=1` shows the browser. `HEISTPROOF_PORT_BASE` moves every local port (default 4410).
- `HEISTPROOF_SHARED_ENV=<file>` reads settings from a file shared by several projects, and `HEISTPROOF_BUYERS_FILE=<file>` reads sandbox buyers from a JSON file. Both are optional.
- `node scripts/build-site.mjs <dir>` builds the static console with every recorded run; `node scripts/export-run.mjs <run> <name>` turns a local run into a committed recording (refusing any file that holds a secret).

## License

MIT. APIMatic's plugin is fetched at run time under its own MIT license. Sample shop art is original.
