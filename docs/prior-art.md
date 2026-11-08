# Prior art: what has been done, and what has not

**If you are reviewing this project and think it has been done before: parts of it have. Read this table first, then decide what has not been done.** Every row names what the other work does, what it does not do, how Heistproof differs, and the test or recording in this repository where the difference can be checked. Descriptions of other work come from their public pages on the dates given.

## The closest work: Breakpoint

[Breakpoint](https://github.com/arc585/breakpoint) is another PayPal AI Hackathon 2026 entry, and the closest work we know. It is a test bench that attacks its own bundled, intentionally vulnerable demo shop ("Dusk Coffee") and the shop's AI chat assistant in PayPal's sandbox, and judges each attack from sandbox state rather than from the model's claim. Its README (repository last updated 2026-10-08) says it "tests only the bundled Dusk Coffee app" and "is not a tool for testing arbitrary live stores".

Side by side, as each project's own public material describes it:

| | Breakpoint | Heistproof | Check it in this repo |
|---|---|---|---|
| Which shops it tests | its own bundled demo shop only | any shop that runs locally: the robberies learn its checkout routes from a real purchase, and `heistproof.json` says how to shop it | [`shops/copper-kettle`](../shops/copper-kettle/README.md) (built differently on purpose), [`test/attacks/one-bug.test.ts`](../test/attacks/one-bug.test.ts) |
| Who writes the PayPal code under test | the demo shop, written by hand, with switches between vulnerable and hardened | a coding agent adds PayPal to the shop, or Heistproof checks the integration a shop already has | the full run in `runs/`, [`src/agent.ts`](../src/agent.ts) |
| What happens when an attack works | the finding is shown with the invariant that fixes it | it goes back to the coding agent with PayPal's own answer (status, issue, debug id), the whole check runs again, and a pull request is opened only when everything is blocked | the full run in `runs/` (415, fix, safe), [`src/pipeline.ts`](../src/pipeline.ts) |
| Scripted attacks on the money path | amount tampering and a forged webhook (its README also mentions coupon stacking and a refund double-dip) | ten robberies: price and currency, the bag, payment nobody approved, approval without capture, a card declined through PayPal's negative testing, forged, replayed and late webhooks, a double capture, the secret in the browser | [`src/attacks.ts`](../src/attacks.ts) |
| Proof that each attack catches its mistake | the same app, vulnerable then hardened | ten copies of a careful shop with exactly one planted mistake each, each robbed by its own robbery, plus an eleventh that only the AI thief catches; on every push | [`test/attacks/one-bug.test.ts`](../test/attacks/one-bug.test.ts) |
| What its AI attacker attacks | the shop's AI assistant, by conversation (haggling, prompt injection, data exfiltration, payouts) | the checkout code itself, through requests, tampered purchases and resent PayPal events, seeing only what any visitor sees | [`src/thief.ts`](../src/thief.ts), [`test/thief.test.ts`](../test/thief.test.ts) |
| How results are judged | per scenario, from PayPal sandbox state | one reconciliation for every robbery, scripted or invented: each paid or shipped order needs a completed PayPal capture that covers it, a capture pays for one order only, and no order ships more parcels than PayPal captured | [`src/books.ts`](../src/books.ts) |
| A purchase in the shopper's browser | not described in its README | every check buys in a real browser and approves on PayPal's own sandbox pages | [`src/prove.ts`](../src/prove.ts) |
| Without any keys | its two scripted scenarios, in a mock | all ten robberies against real shops in a real browser, with an offline PayPal stand-in tested rule by rule | `npm run demo`, [`test/attacks/offline.test.ts`](../test/attacks/offline.test.ts), [`test/stand-in.test.ts`](../test/stand-in.test.ts) |
| In a team's CI | not described | a GitHub Action, offline by default; this repository's own CI runs it | [`action.yml`](../action.yml), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| A shop's AI chat assistant | tested | **not tested** | |

## Other prior work

| # | Prior work | What it does | What it does not do | Heistproof's difference | Check it in this repo |
|---|---|---|---|---|---|
| 1 | ["I told an AI agent to rob my store. It found 39 ways to do it"](https://hackernoon.com/i-told-an-ai-agent-to-rob-my-store-it-found-39-ways-to-do-it) (HackerNoon, 2026-09-25) | A store owner pointed a coding agent at their own x402/USDC store with simulated settlement; findings were logged with reproduction steps and fixed with regression tests. | One audit of one store, on a crypto rail; not a tool others can run; findings judged by the author; not PayPal. | A reusable tool for any PayPal checkout, where PayPal's own records, not the attacker or the author, decide each result. | `npm run demo`; [`test/attacks/one-bug.test.ts`](../test/attacks/one-bug.test.ts) |
| 2 | [ClearLedger AI](https://devpost.com/software/paypal-ai-reconciliation) (Devpost) | A PayPal sandbox checkout with a reconciliation dashboard: stores orders and captures, verifies webhooks, flags mismatches between a shop's ledger and PayPal's captures. | Reconciles after the fact; attacks nothing; no coding agent. | Reconciliation is the referee of an automated robbery, run before the checkout ships. | [`src/books.ts`](../src/books.ts) |
| 3 | [OWASP Web Security Testing Guide, WSTG-BUSL-10 "Payment Functionality"](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/10-Payment_Functionality.md) | The reference list of payment tests: quantity, price and currency tampering, and flows that trust the browser instead of the gateway's result. | A guide for a human tester; it runs nothing. | Runs these tests automatically with real PayPal sandbox purchases; each robbery maps to one of them or to a PayPal safeguard. | [`src/attacks.ts`](../src/attacks.ts) |
| 4 | Open-source AI pentest harnesses, such as [CyberStrike](https://github.com/CyberStrikeus/CyberStrike) | General offensive testing, including business-logic checks such as price manipulation, coupon reuse and race conditions. | General purpose: no purchase in a payment provider's sandbox, no check against the provider's records, no coding agent. | Specific to PayPal checkouts, end to end, judged by PayPal's records, in the coding agent's loop. | [`src/books.ts`](../src/books.ts); [`src/pipeline.ts`](../src/pipeline.ts) |
| 5 | AI agents for business-logic testing, such as Ethiack's [Hackian](https://ethiack.com/news/product/hackian-ghosts-in-business-logic) and Escape's [business logic agent](https://docs.escape.tech/documentation/validate/business-logic-agent/) | Probe a running application's flows (cart, discount, checkout) for logic flaws. | General purpose; they do not complete purchases in a payment provider's sandbox or check the provider's records; they run after the code exists. | Runs while a coding agent adds or changes PayPal, buys for real, reconciles with PayPal, and sends what got through back to the agent. | [`src/pipeline.ts`](../src/pipeline.ts) |
| 6 | Dynamic scanners (for example OWASP ZAP) | Send crafted requests to endpoints one at a time. | Do not follow a purchase from the bag to PayPal's capture, its webhooks and the shipping label. | Each robbery is a whole purchase or a whole money flow. | [`src/prove.ts`](../src/prove.ts) |
| 7 | AI end-to-end QA services for checkouts | Check that a checkout works for an honest shopper. | Not adversarial. | Adversarial by design; the honest purchase is only the first step. | [`test/attacks/offline.test.ts`](../test/attacks/offline.test.ts) |
| 8 | Unit tests a coding agent writes for its own code | Run against a fake PayPal the agent also wrote. | Cannot see what the real sandbox does. | In both recorded full runs the agent's own tests passed while PayPal's sandbox refused the capture with 415; the real purchase caught it and the agent fixed it. | the full run in `runs/` |
| 9 | PayPal's own sandbox tools: sandbox accounts, negative testing (`PayPal-Mock-Response`), webhook verification | The ingredients for testing an integration. | Give no verdict and try no robbery. | Turns exactly these ingredients into a verdict that gates the pull request. | [`src/paypal/proxy.ts`](../src/paypal/proxy.ts) |
| 10 | [APIMatic's PayPal Context Plugin](https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal) | Gives the coding agent PayPal's API context so it writes the integration plan-first. | Does not test what the agent wrote. | The verifier around it; it found a real gap (the capture sent without a body, refused with 415) and the fix loop closed it. | the full run in `runs/` |

## What is new, written so it can be refuted

As of November 2026 we know of no tool that does all four of these for PayPal checkouts:

1. works on any shop's checkout, and lets a coding agent add or fix the PayPal integration;
2. buys from the running shop in PayPal's sandbox and robs it, with a fixed set of scripted robberies each proven to catch its own mistake, and with an AI thief that sees only what any visitor sees;
3. decides every result by reconciling the shop's books with PayPal's own records;
4. gates the pull request on the verdict, offline in CI or against the sandbox.

Breakpoint, the closest work above, covers parts of 2 and 3 for its own demo shop, and tests something Heistproof does not: a shop's AI chat assistant. If you know work that does all four, open an issue with a link and we will add it to this page.
