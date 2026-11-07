<p align="center"><img src="assets/logo-512.png" width="96" alt="Heistproof logo"></p>

# Heistproof

**Ready for AI agents. Proven against thieves.**

Heistproof adds PayPal, Venmo and Pay Later to a shop with an AI coding agent, then robs it the way a rogue AI agent would, with real PayPal sandbox payments. Nothing ships until every robbery fails.

## Why now

- **AI agents are starting to shop and pay.** AI traffic to US retail sites grew 393% year over year in Q1 2026 (Adobe, reported by [Decrypt](https://decrypt.co/364733/ai-traffic-us-retailers-jumps-q1-agentic-shoppers-outspend-humans)), and PayPal's [Agent Ready](https://developer.paypal.com/agentic-commerce-services/about) lets merchants take payments from AI assistants.
- **Shops are built with AI too.** Owners build their own stores with AI tools, and agencies that have never built a checkout ship payment code an AI wrote in minutes. Veracode found security flaws in AI-generated code for 45% of its coding tasks ([SD Times](https://sdtimes.com/security/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/)).
- **So checkout mistakes get found faster.** A rogue agent can try every checkout trick on a thousand shops at once. A price taken from the browser, an order marked paid on approval, an unverified webhook: each one is a robbery waiting for the first agent that tries it.

Adding PayPal is not the end of it. Heistproof checks the whole money path, from the cart to the shipping label, before real money moves.

## What it does

A shopper asks a small shop "Do you take Venmo?". Heistproof answers with a pull request:

1. **Add.** A coding agent (Claude Code with [APIMatic's PayPal Context Plugin](https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal)) reads the shop and adds JS SDK v6 buttons for PayPal, Venmo and Pay Later with Pay Later messaging, server-side Orders v2 create and capture through APIMatic's PayPal TypeScript SDK, and signature-verified webhooks wired into the shop's own fulfilment. Before it writes any PayPal code it writes `paypal-plan.md`, a contract sheet grounded in the SDK's own map.
2. **Buy.** A browser agent makes a real purchase in the PayPal sandbox, like a shopper. Before it approves, it checks that the amount PayPal will charge equals the bag total (a $49 hoodie must not become a $4,900 PayPal order).
3. **Rob.** Ten scripted robberies, the tricks a rogue agent would try, hit the running shop in the sandbox: a $0.01 price, payment claimed for an order nobody approved, shipping on approval alone, forged and replayed webhooks, events out of order, a double-click capture, a card declined at capture (PayPal's own negative-testing header), bad bags and a hunt for the secret in the browser.
4. **Fix.** Anything that works for the attacker goes back to the coding agent with the evidence, and the whole check runs again.
5. **Ship.** The output is a branch with the change, its tests and `HEISTPROOF-REPORT.md`: the verdict and PayPal's own order, capture, webhook and debug ids for every check.

> All money is PayPal sandbox money. The shop is a sample shop. See [Sandbox vs production](#sandbox-vs-production).

## What happened in the recorded run

[`runs/2026-11-07-full-run`](runs/2026-11-07-full-run/REPORT.md), one command on the card-only Fogline shop, model `muse-wonder-1.0` on the Meta Model API, everything in the PayPal sandbox:

1. The agent loaded APIMatic's `typescript-integrate-paypal` skill first, then eight more of the plugin's skills and Heistproof's two, wrote `paypal-plan.md`, and added the buttons, the server routes and the webhook handler. 8 minutes, 76 turns, 23 tests passing.
2. The first real purchase failed: the buyer approved, then PayPal answered the shop's capture with **415 UNSUPPORTED_MEDIA_TYPE**. Capture's body is optional in the API, and the SDK's own map says that leaving it out sends no `Content-Type` at all; the sandbox refuses that. The agent had followed the plugin's rule to leave unrequired optional fields out, and its tests used a fake PayPal, so they could not see it.
3. Heistproof handed PayPal's answer and debug id back to the agent. It sent `body: {}`, added a regression test and updated the contract sheet, in about a minute and a half.
4. The second purchase was captured (`5UD433706B768933M`), shipped once, and PayPal's signed `PAYMENT.CAPTURE.COMPLETED` webhook was verified. All 10 attacks were blocked, including a real `422 INSTRUMENT_DECLINED` injected at capture. Verdict: safe to ship.

### A checkout written in an afternoon

[`shops/fogline-naive`](shops/fogline-naive/README.md) is the same shop with a quick PayPal checkout and planted mistakes. Heistproof on it, also recorded:

- [`runs/2026-11-07-naive-penny-heist`](runs/2026-11-07-naive-penny-heist/REPORT.md): before any money moved, PayPal's own review page showed **$4,900.00** for the $49.00 bag (cents sent as dollars), so the purchase was stopped. Then the attacker edited the page's create-order request in the shopper's browser, the sandbox buyer paid **USD 0.01**, and the shop's back office marked the $49 hoodie paid and printed a shipping label.
- [`runs/2026-11-07-naive-hardened`](runs/2026-11-07-naive-hardened/REPORT.md): `--existing` mode handed each failure to the coding agent. Round 0 found the $4,900 order, the one-cent order and payment claimed for an unapproved order; the agent's fix then broke the PayPal button, which the next real purchase caught; round 2 paid, shipped once and blocked all 10 attacks.

## Try it

| What you want | What you need | Command |
|---|---|---|
| Watch real recorded runs (agent steps, purchase, attacks, evidence) | nothing | `npm install && npm run console` then open http://127.0.0.1:4410 |
| Buy and attack the shop the agent already wrote | a PayPal sandbox app | `npm run check -- examples/fogline-after` |
| Let Heistproof harden a naive PayPal checkout | a PayPal sandbox app + any AI key | `npm run heist -- fogline-naive --existing` |
| The whole job on the card-only shop | a PayPal sandbox app + any AI key | `npm run heist -- fogline-express` |

Setup, once. You need Node.js 24.22.1 or newer (tested), or 22.23.4+ / 26.12.1+: older releases are affected by the [October 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), and 20.x, 23.x and 25.x no longer get security fixes. `npm run doctor` checks this. With nvm: `nvm install` (reads `.nvmrc`).

```bash
git clone https://github.com/eric2612115/heistproof && cd heistproof
npm install            # also installs Playwright's Chromium
npm run setup          # asks for your sandbox app, buyer and (optional) AI key; secrets are hidden and stay in .env.local
npm run doctor         # checks every setting and tells you what to fix
```

You also need `cloudflared` so PayPal's sandbox can deliver webhooks to your machine (`brew install cloudflared`, or the [download page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on Windows and Linux). Already have a public URL that forwards to port 4417? Set `HEISTPROOF_PUBLIC_URL` instead.

A PayPal sandbox app takes two minutes: [developer.paypal.com](https://developer.paypal.com) > Apps & Credentials > Sandbox > Create App (a US business account). The sandbox buyer is any Personal account under Testing Tools > Sandbox Accounts.

## Bring any model

The agent harness is always Claude Code, because that is where APIMatic's plugin lives. The model behind it is whatever key you paste into `npm run setup`:

| Key | Provider | How it is called |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | directly |
| `MODEL_API_KEY` | Meta Model API (Muse) | directly (Anthropic Messages protocol) |
| `DEEPSEEK_API_KEY` | DeepSeek | directly (Anthropic Messages protocol) |
| `OPENAI_API_KEY` | OpenAI | through Heistproof's built-in protocol bridge |
| `GEMINI_API_KEY` | Google Gemini | through the bridge (Gemini's OpenAI-compatible API) |
| `OPENROUTER_API_KEY` | OpenRouter (any model) | through the bridge |
| `HEISTPROOF_BASE_URL` + `HEISTPROOF_API_KEY` + `HEISTPROOF_MODEL` | anything OpenAI- or Anthropic-compatible | bridge or direct (`HEISTPROOF_PROTOCOL`) |

`src/bridge.ts` translates Claude Code's Anthropic Messages calls (tools and streaming included) into Chat Completions and back, so the same agent, plugin and prompts run on any of them. The recorded runs in this repo used Meta's `muse-wonder-1.0`.

## PayPal APIs used

| API | Where | What for |
|---|---|---|
| JS SDK v6 `paypal-payments`, `venmo-payments` | shop (written by the agent) | PayPal, Venmo and Pay Later buttons, one-time payment sessions |
| JS SDK v6 `paypal-messages` | shop | "Pay in 4 interest-free payments of $12.25" next to the total |
| Orders v2: create, capture, get | shop, via APIMatic's PayPal TypeScript SDK | server-priced orders, capture, re-reading unknown outcomes |
| Webhooks: verify-webhook-signature | shop | trust no event until PayPal confirms its signature |
| Webhooks: create / update webhook | Heistproof | points the sandbox app's webhook at the run's public address |
| Orders v2: get | Heistproof | checks PayPal's amount and capture against what the shop recorded |
| Negative testing (`PayPal-Mock-Response`) | Heistproof's recording proxy | real `INSTRUMENT_DECLINED` and `TRANSACTION_REFUSED` answers from the sandbox at capture |
| OAuth 2.0 client credentials | both | access tokens |

## Sandbox vs production

| | In this repo (sandbox) | In production |
|---|---|---|
| Money | PayPal sandbox only, no real funds | live app credentials, `PAYPAL_API_BASE=https://api-m.paypal.com`, live SDK URL |
| Attacks | run against the sandbox, including `PayPal-Mock-Response` | never run against live; run Heistproof in CI against your sandbox app before deploying |
| Webhooks | a temporary tunnel address registered on the sandbox app | your deployed URL, registered once |
| `testBuyerCountry` | `US`, so Venmo and Pay Later show when testing from outside the US | not sent |
| Shops | sample shops in `shops/` | your repository; Heistproof opens a branch and a pull request |

## The attacks

| Attack | Rule it tests | What a failure looks like |
|---|---|---|
| Pay $0.01 for the $49 hoodie | prices come only from the server; cents become dollars exactly | a PayPal order for USD 0.01, or JPY |
| Negative, fractional and fake items | the bag is validated | a PayPal order for a quantity of -1 |
| Claim payment for an order nobody approved | paid means captured | the shop marks an unapproved order paid |
| Forge PayPal's "payment completed" webhook | every webhook is verified with PayPal | an unsigned or edited event changes an order |
| Replay a real webhook to ship twice | events are idempotent | two shipping labels for one payment |
| Send "approved" after "completed" | orders never move backwards | a paid order drops back |
| Get it shipped on approval alone | approval is not payment | a label for an order that was approved but never captured |
| Double-click: capture twice at once | fulfil exactly once | two labels from two simultaneous captures |
| Card declined at capture | failed captures stay unpaid | a label after PayPal's `INSTRUMENT_DECLINED` |
| Find the PayPal secret in the browser | secrets stay on the server | the client secret in a page or script |

The rules the agent is asked to meet are in [`plugin/skills/checkout-hardening`](plugin/skills/checkout-hardening/SKILL.md); the attacks are in [`src/attacks.ts`](src/attacks.ts).

### Isn't this PayPal's job?

None of these attacks is a hole in PayPal. PayPal charges what the merchant's server asks it to charge, and it cannot know what a hoodie should cost. For every attack above PayPal already provides the safeguard: orders created and priced on the server (Orders v2), capture status, `PayPal-Request-Id`, `verify-webhook-signature`, and negative testing with `PayPal-Mock-Response`. Whether a shop uses them correctly lives in the shop's own code, and more and more of that code is written by AI agents. Classic scanners test endpoints one at a time and rarely follow a checkout from the cart to the shipping label; doing that by hand is a penetration test. Heistproof runs the attacks with real sandbox transactions on every change, and the report ties each result to the rule it tests and to PayPal's own ids.

### Hasn't someone built this already?

Not the attacks. Price tampering, unverified or replayed webhooks and double fulfilment are well-known checkout bugs, and bug bounty hunters still find price manipulation in e-commerce programs ([Intigriti](https://www.intigriti.com/blog/news/top-5-price-manipulation-vulnerabilities-ecommerce)). AI agents that probe business logic exist too: Ethiack's [Hackian](https://ethiack.com/news/product/hackian-ghosts-in-business-logic) maps flows such as add to cart, discount and checkout on a running application, and [Escape](https://docs.escape.tech/documentation/validate/business-logic-agent/) tests running applications for business logic flaws.

Heistproof differs in where and how it runs:

- **When PayPal is added, not after launch.** It runs at the moment a coding agent integrates PayPal, and its verdict gates the branch and the pull request.
- **Real PayPal sandbox transactions.** A buyer approves on PayPal's own pages, the capture is real, PayPal's signed webhooks are replayed byte for byte, and declines come from PayPal's negative-testing header. Results are read from the shop's back office and PayPal's own order records.
- **A fix loop with the coding agent.** Every attack that works goes back to the agent with PayPal's evidence (status, issue name, debug id), and the whole check runs again.
- **One PayPal rule per attack.** Each attack tests one safeguard PayPal already provides, so the report names the rule that broke.

We have not measured how often real shops get these wrong. The hand-written checkout in our recordings is a sample with planted mistakes, not a survey. AI-written code is a known risk in general: Veracode's 2025 study found security flaws in AI-generated code for 45% of its coding tasks ([SD Times](https://sdtimes.com/security/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/)).

## How it works

```
card-only shop ──> coding agent (Claude Code + APIMatic PayPal Context Plugin + Heistproof skills, any model)
                        │  paypal-plan.md, code, tests
                        v
shop on :4411 <──> recording proxy (:4418) <──> PayPal sandbox API   (negative-testing header injected here)
     ^                                              │
     │ webhooks (byte-exact copies kept)            │ webhooks
webhook tap (:4417) <── cloudflared tunnel <────────┘
     ^
browser agent (Playwright): buys like a shopper, checks the amount, approves as the sandbox buyer
     │
the heist (10 scripted robberies): replays and tampers what it watched, reads the shop's back office and PayPal's own records
     │
report + fix loop + branch with HEISTPROOF-REPORT.md
```

- `src/agent.ts` runs Claude Code headless through the Claude Agent SDK, with APIMatic's plugin pinned to a marketplace commit, an isolated config folder, a tool allow-list and a guard that keeps the agent out of secrets and inside the shop folder.
- `src/prove.ts` is the browser agent; it handles JS SDK v6 web components and v5 iframes.
- `src/attacks.ts` learns the shop's checkout routes by watching the real purchase, so it works on code it did not write.
- `src/console` is the live view shown in the video.

## Who it is for

- **Shop owners who build with AI.** One run before launch, and again whenever the checkout changes.
- **Agencies that build shops for clients.** Hand over each checkout with a report that says it was robbed ten ways and held, backed by PayPal's own ids.
- **Teams with their own checkout.** Run it in CI on every change; a robbery that works blocks the merge.
- **Payment platforms.** Check a merchant's integration before it opens checkout to AI agents.

Today it runs on the sample Express shops in this repo; see [Limits](#limits).

## APIMatic's PayPal Context Plugin

The plugin (`paypal@context-plugins`, MIT) is a set of skills that point a coding agent at the SDK map shipped inside APIMatic's PayPal TypeScript SDK and make it plan before it codes. In every recorded run the agent loads `typescript-integrate-paypal` first, then the getting-started, error-handling, client-initialization, testing, calling-endpoints, authentication, models and configuration-resilience skills, installs the SDK, writes `paypal-plan.md`, and only then writes the PayPal code. The project also enables the plugin for Claude Code in `.claude/settings.json`.

## Limits

- The sample shops are small Express apps. Other stacks need their own templates; the attacks only need the shop to run.
- `cloudflared` quick tunnels are for testing; they change address every run, and Heistproof re-points the sandbox webhook each time.
- PayPal delivers every event of a sandbox app to every webhook registered on it. If your app also serves other projects, their events reach Heistproof's tap too; the replay and late-event attacks only use events about the shop's own orders.
- The sandbox can take minutes to deliver a webhook, or skip one. An attack that needs an event that never arrived is reported as skipped, never as held.
- PayPal's sandbox login page can change; the browser agent's selectors are in `src/prove.ts`.
- A model that ignores the plugin still gets attacked; the attacks, not the model's summary, decide whether it ships.
- The robberies are deterministic scripts, not an AI: they do what a rogue agent would try, so every run is repeatable. The AI is the coding agent that writes and fixes the checkout.

## License

MIT. APIMatic's plugin is fetched at run time under its own MIT license. Sample shop art is original.
