# PayPal integration plan — Fogline Supply Co.

Goal: add PayPal checkout (PayPal, Venmo, Pay Later buttons + Pay Later messaging in the
browser) next to the existing card form, and fulfil an order only after PayPal has really
captured the right amount. Card checkout stays working.

## Repo survey (read-only, before any edit)

- Runtime/format: Node >=22.5 (v24 locally), plain JavaScript **ESM** (`"type": "module"`),
  Express 5. Exemplar for server wiring: `server.js` (`createApp({ db, cards, adminKey })`
  factory, JSON body parser, `/api/...` routes). Exemplar for a provider client module:
  `lib/card-processor.js` (factory function returning an object). Exemplar for server-side
  pricing (never trust browser amounts): `lib/cart.js` `priceCart(items)` — integer cents,
  `currency: "usd"`. Exemplar for persistence: `lib/db.js` (node:sqlite `DatabaseSync`,
  orders table). Exemplar for fulfilment (must run exactly once per order):
  `lib/fulfilment.js` `fulfilOrder(db, orderId)`.
- No TypeScript, no tsconfig, no linter. Tests: `npm test` =
  `node --test --test-reporter=spec "test/**/*.test.js"` (node:test + assert/strict,
  in-memory DB, app on ephemeral port). Baseline on untouched tree: 5/5 pass.
- Package manager: npm. `paypal` was not a dependency; installed per SDK instructions
  (see below), which updated `package.json`/`package-lock.json` (permitted pre-gate writes).
- Because the project is JS ESM (single dialect, `import` only), `instanceof` on SDK error
  classes is reliable within this process; still narrow primarily on `err.kind`.
- No PayPal credentials exist while building: no live calls. The harness runs the shop
  against the PayPal sandbox afterwards.

## SDK identity (from `typescript-getting-started` + installed package)

- Package/import: `paypal` v2.29.0, **not on npm**; installed with
  `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`.
  `node -e "console.log(require.resolve('paypal/package.json'))"` resolves and
  `node_modules/paypal/sdk-map.md` + `map/operations/` are present (map read).
- Client: `new PaypalClient(options: ClientOptions = {})`, import `{ PaypalClient }` from
  `"paypal"` (root only; no deep imports). Build **once**, app-scoped, hold it (resource
  getters memoized, OAuth token cache lives on it; no `close()`).
- This SDK declares exactly one environment and emits **no `ServerEnvironment`**: host is
  `serverOptions.baseUrl` (flat — `src/servers.ts`/`src/client-options.ts` confirm
  `serverOptions?: { baseUrl?: string }`), default `https://api-m.sandbox.paypal.com`.
  We pass `PAYPAL_API_BASE` (default `https://api-m.sandbox.paypal.com`) there explicitly.
  The OAuth token endpoint is `default + /v1/oauth2/token` on the same group, so the token
  call follows the same override. Nothing else records which deployment this is, so the
  factory names the env vars it consumed and fails fast when credentials are missing.
- Auth: `oauth2: { clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_CLIENT_SECRET }`
  (client credentials; SDK fetches/caches token, sends `Authorization: Bearer`, Basic on
  the token request). Every credential field is optional at type level — omit one and the
  request silently goes out unauthenticated, so the factory throws at startup when
  `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` are unset/empty (message names the key, never
  echoes a value). No fallback/placeholder client.
- Logging: off. Set `logging: { level: "off" }` explicitly so `PAYPAL_CLIENT_LOG` cannot
  switch logging on from outside; never `logRequestBody`, no per-call logging levels.
- Retry: keep POST writes out of the retry gate (default `httpMethodsToRetry` is
  GET/HEAD/PUT/OPTIONS). Set an explicit per-attempt `retry.timeout` (e.g. 15_000) and rely
  on claim + re-read (below) instead of resending writes. GET `getOrder` may retry by default.
- `Error` is an SDK model type (`src/models/error.ts`); if ever imported, alias it
  (`Error as SdkError`). We import `PaypalError` (family base) for narrowing.
- No pagination/streaming in scope. `ClientOptions.fetch` is the only transport seam and
  the test seam (fake fetch, wire-shaped stub bodies, `retry: { maxRetries: 0 }` in tests).
- 11 operations resolve to `undefined`; none of our in-scope operations is among them
  (all return `Order`), so plain `await` is the deliberate response mode; status/headers
  of successes are not needed.

## Operations in scope (contract sheet — from `map/operations/orders.md`, one pass)

All on `client.orders`, auth `oauth2`, server group `default`. Call shape
`op(request, options?)`, flat channel-blind request object, returns `ApiPromise<Order, E>`.
SDK mints a per-call `Idempotency-Key` header on every non-GET (not caller-settable);
`prefer` header defaults to `"return=minimal"` when omitted — we set
`prefer: "return=representation"` on create/capture so the returned Order carries
purchase_units/payments we must assert on (a minimal response would omit them — see
"missing field is undefined" rule).

### createOrder — `createOrder(request: Orders.CreateOrderRequest, options?): ApiPromise<Order, Orders.CreateOrderError>`
- Wire: `POST /v2/checkout/orders`. Body required: `body: OrderRequest`.
- Fields: `payPalRequestId?` header `PayPal-Request-Id`; `prefer?` header default
  `"return=minimal"`; `payPalMockResponse?`, `payPalPartnerAttributionId?`,
  `payPalClientMetadataId?`, `payPalAuthAssertion?` headers (all optional, none set — see
  OPTIONAL FIELDS); `body` required.
- `OrderRequest` (`src/models/order-request.ts`): `intent: CheckoutPaymentIntent` required
  (`CheckoutPaymentIntent.Capture === "CAPTURE"`); `purchaseUnits: PurchaseUnitRequest[]`
  required; `processingInstruction?`, `payer?`, `paymentSource?`, `applicationContext?`
  optional (omitted — nothing requires them).
- `PurchaseUnitRequest`: `amount: AmountWithBreakdown` required
  (`{ currencyCode: string, value: string }` required; `breakdown.itemTotal` set — the
  checkout-hardening rules require an item breakdown whose sum equals the total, with
  `items[]` (`ItemRequest`: `name`, `unitAmount: Money`, `quantity: string` required;
  `sku` set) so the breakdown sums to the total);
  `customId?` set to our shop order id — REQUIRED by checkout-hardening rule 3 (binding)
  and by the capture gate in rule 4 (a capture only counts when its purchase unit's /
  capture's `custom_id` is that shop order); `invoiceId?` and `referenceId?` also carry
  the shop order id (reconciliation reference for UNKNOWN OUTCOMES); others omitted.
- Returns `Order`: all members optional (`id?`, `status?`, `purchaseUnits?`, …) — assert
  `id !== undefined` right after the call; absent id = outcome unknown (see below).
- Error arms (`Orders.CreateOrderError`, tags schema-derived, NOT statuses; read
  `err.status` for the status): `"error"` [400] `Error` · `"error2"` [401] `Error` ·
  `"error3"` [422] `Error` · `"error4"` [default] `Error` · `"undeclared"` raw bytes.
  `Error` model: `name`, `message`, `debugId` required; `details?`, `links?`.

### captureOrder — `captureOrder(request: Orders.CaptureOrderRequest, options?): ApiPromise<Order, Orders.CaptureOrderError>`
- Wire: `POST /v2/checkout/orders/{id}/capture`. `id` path, required string.
  `body?: OrderCaptureRequest` optional — omit entirely (its only member
  `paymentSource?` is not required by anything). `prefer` set to `return=representation`.
  `payPalRequestId?` set from the DUPLICATE CLAIMS claim (see below).
- Returns `Order`; fulfilment gate reads
  `purchaseUnits[].payments.captures[]` (`OrdersCapture`: `status?: CaptureStatus`
  (`COMPLETED`/`DECLINED`/`PENDING`/`REFUNDED`/`PARTIALLY_REFUNDED`/`FAILED`),
  `id?`, `amount?: Money { currencyCode, value }`) — every member optional, so assert
  presence before trusting. Order `status?`: `OrderStatus.Completed === "COMPLETED"`.
- Error arms: `"error"` [400] · `"error2"` [401] · `"error3"` [403] · `"error4"` [404] ·
  `"error5"` [422] · `"error6"` [500] · `"error7"` [default] · `"undeclared"`.

### getOrder — `getOrder(request: Orders.GetOrderRequest, options?): ApiPromise<Order, Orders.GetOrderError>`
- Wire: `GET /v2/checkout/orders/{id}`. `id` required; `fields?` query omitted;
  mock/auth-assertion headers omitted.
- Used to settle unknown create/capture outcomes and to re-read an order server-side
  before fulfilling on a webhook (never trust webhook/browser bodies).
- Error arms: `"error"` [401] · `"error2"` [404] · `"error3"` [default] · `"undeclared"`.

### Webhook verification — NOT an SDK operation (verified)
- `grep` of the SDK map/`src` confirms the SDK has **no** webhook/verify operation and no
  webhook surface at all. PayPal's REST verification endpoint
  `POST /v1/notifications/verify-webhook-signature` therefore cannot go through the SDK.
  Per checkout-hardening rule 6 it will be called against `PAYPAL_API_BASE` (same base
  the SDK is configured with), with an OAuth access token obtained from
  `PAYPAL_API_BASE + /v1/oauth2/token` (client credentials) — every PayPal REST call
  still targets `PAYPAL_API_BASE`, and all Orders calls go through the SDK. Body:
  `{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time }` from
  the `PAYPAL-*` headers + `webhook_id: PAYPAL_WEBHOOK_ID` + `webhook_event` (parsed
  body). Only `verification_status: "SUCCESS"` lets the event act; otherwise 400 and
  nothing changes. Even a verified event is never trusted for amounts: a
  `PAYMENT.CAPTURE.COMPLETED` event only triggers an SDK `getOrder` re-read, and the
  fulfilment gate (COMPLETED capture, amount/currency == shop total, `custom_id` ==
  shop order) is applied to that re-read. `CHECKOUT.ORDER.APPROVED` never fulfils.

## 1b.1 DURABLE WRITES

DUPLICATE CLAIMS — claim → SDK call → record result. Claim is its own row/store committed
before the call, keyed on a value every caller computes the same (the shop order id),
never a per-attempt value. Store driver error recognised by code, not message.

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| createOrder | `paypal_claims` row keyed by shop order id (PRIMARY KEY) in shop DB, inserted before the call (`db.claimPaypal`, `lib/db.js`) | SQLite PRIMARY KEY via `INSERT OR IGNORE` reporting 0 changes | `server.js` POST /api/paypal/orders checks the boolean from `claimPaypal` before calling; the claim is settled by `db.settleClaim` after success | `server.js` create route + `lib/paypal.js` `createOrder` |
| captureOrder | `paypal_claims` row keyed by `capture:<shop order id>` + `PayPal-Request-Id` = shop order id stored on the claim | SQLite PRIMARY KEY via `INSERT OR IGNORE` reporting 0 changes | `server.js` capture route: a non-fresh claim skips capture and settles via `getOrder` instead | `server.js` capture route + `lib/paypal.js` `captureOrder` |

Release the claim when the provider *refuses* the call (4xx — request never accepted), so
a later legitimate attempt is not blocked; never release on unknown outcomes.

UNKNOWN OUTCOMES — connection/timeout on a write is unknown, not failed; settle in that
write's own catch by re-reading. AuthError/EncodeError = never sent = no re-read.

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| createOrder | no re-read exists when no PayPal id was learned (no search-by-reference operation): outcome stays unknown, claim kept, order left pending for late settlement via a verified webhook's getOrder | `referenceId`/`invoiceId`/`customId` = shop order id on the purchase unit; PayPal order id when known | `lib/paypal.js` `createOrder` unknown-outcome branch; `server.js` keeps claim + pending order | `test/paypal.test.js`: "a dropped create connection is unknown: order stays pending and the claim is kept" |
| captureOrder | getOrder | PayPal order id (path) + captures' status/amount in the re-read Order | `lib/paypal.js` `captureOrder` catch (unknown outcomes + ORDER_ALREADY_CAPTURED re-read; auth/encode never re-read) | `test/paypal.test.js`: "a dropped capture connection is settled by re-reading the order, never reported failed" (+ "bad credentials … trigger no re-read") |

Tests: one fake-fetch connection failure on the write asserting the re-read request was
made; one never-sent failure (AuthError via bad token response / EncodeError) asserting
no re-read happened.

## 1b.2 CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| A PayPal order id may only be captured/fulfilled for the shop order we created it for, at the server-priced total/currency | Our DB: shop order row created from `priceCart` (catalog pricing) before createOrder; PayPal order id recorded on it | Before capture and before fulfilment: compare re-read PayPal order (status COMPLETED, capture COMPLETED, amount value/currency equals shop total) | Fake a capture/getOrder with a mismatched amount or another order's id; assert rejection and no fulfilment, capture never called for foreign id |

## 1b.3 OPTIONAL FIELDS

createOrder (`Orders.CreateOrderRequest` + `OrderRequest`/`PurchaseUnitRequest`):

| Field | What requires it | Set it? |
| --- | --- | --- |
| `body.intent` (required) | task: capture immediately | ✅ `CheckoutPaymentIntent.Capture` |
| `body.purchaseUnits[].amount` (required) | task: charge the server-priced total | ✅ `{ currencyCode: "USD", value, breakdown: { itemTotal } }` from `priceCart` cents |
| `body.purchaseUnits[].customId` | checkout-hardening rule 3/4 (binding + capture gate) | ✅ shop order id |
| `body.purchaseUnits[].referenceId` | UNKNOWN OUTCOMES row (search reference) | ✅ shop order id |
| `body.purchaseUnits[].invoiceId` | reconciliation reference (same row) | ✅ shop order id |
| `body.purchaseUnits[].items[]` + `amount.breakdown.itemTotal` | checkout-hardening rule 2 (breakdown sums to total) | ✅ per-line name/sku/quantity/unitAmount |
| `body.purchaseUnits[].payee/paymentInstruction/description/softDescriptor/shipping/supplementaryData` | nothing | ❌ leave it out |
| `prefer` | need full representation to assert on returned Order members | ✅ `"return=representation"` |
| `payPalRequestId` | DUPLICATE CLAIMS row for createOrder | ✅ claim reference (stable per shop order) |
| `payPalMockResponse` | nothing | ❌ leave it out |
| `payPalPartnerAttributionId` | nothing | ❌ leave it out |
| `payPalClientMetadataId` | nothing | ❌ leave it out |
| `payPalAuthAssertion` | nothing | ❌ leave it out |
| `body.processingInstruction`, `body.payer`, `body.paymentSource`, `body.applicationContext` | nothing (browser SDK drives approval) | ❌ leave it out |
| `purchaseUnits[].payee/paymentInstruction/description/softDescriptor/shipping/supplementaryData` | nothing | ❌ leave it out |

captureOrder: `id` ✅ (path); `prefer` ✅ representation; `payPalRequestId` ✅ claim
reference; `body` ❌ omit (optional, nothing requires `paymentSource`);
`payPalMockResponse/payPalClientMetadataId/payPalAuthAssertion` ❌.
getOrder: `id` ✅; `fields`, mock, auth-assertion ❌.

Proof test: capture the request the SDK sent (fake fetch) and assert no header/query/body
key is present that no row above requires (SDK's own headers/Idempotency-Key excluded).

## 1b.4 WHEN THE API SAYS NO (per operation; same ladder, applied at one boundary)

For createOrder and captureOrder (getOrder uses the read row):

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason text from `err.payload` (`Error.message`/`details`) | fake it with a reason; assert the reason is in your response |
| 401 / 403 | 502 | a fixed message — our credentials | fake a 401; assert 502 and the fixed message |
| 429 | 503 | a fixed message — our quota | — |
| 5xx | 502 | a fixed message | — |
| no response, on a write | per UNKNOWN OUTCOMES | unknown — never "failed" | — |
| no response, on a read | 502 | a fixed message | — |

Never put SDK `err.message` (method+URL) on the wire; log it + `err.payload`/`cause`
server-side, return our fixed text or the API reason per the table. DecodeError on a 2xx =
unknown (5xx at boundary, outcome unknown internally); on an error status, keep that
status. Outside-family throwables (ConfigurationError, SchemaError, TypeError, abort
reason) are rethrown, not swallowed. In JS, narrow on `err.kind` / `err.payload.kind`
(and `err.status`), only meaningful beside that operation's arm table — no shared
handler switching on arm tags across operations.

## Configuration / host decision

- Factory `createPayPalClient({ clientId, clientSecret, baseUrl, fetch? })` in a new
  `lib/paypal.js`-style module following `lib/card-processor.js` conventions; built once
  in `server.js` startup from `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
  `PAYPAL_API_BASE` (default `https://api-m.sandbox.paypal.com`) and injected into
  `createApp` like `cards`. Missing credentials = throw at startup naming the key.
- Browser config endpoint exposes only the public client id (+ optional
  `PAYPAL_TEST_BUYER_COUNTRY` as `testBuyerCountry` in sandbox; unset = omit the key).
  Secrets/webhook id never reach the browser.

## Assumptions & Blockers

- Minor: shop currency is USD (`priceCart` returns `"usd"`); PayPal amount value is the
  decimal string formatted from integer cents (keep money as string end-to-end).
- Minor: webhook verification endpoint is not in the SDK (verified above); handled as
  the single non-SDK REST call against `PAYPAL_API_BASE`, and events are never trusted
  without an SDK `getOrder` re-read.
- No credentials while building → no live smoke possible or permitted by the task; the
  plan-, entitlement-gating risk is accepted and the harness sandbox run is the smoke.
- No blocker requiring a user answer: proceed.

## REQUIRED READING

- MUST load `paypal:typescript-error-handling` (done — error family, arm tags, unknown
  outcomes ladder) before writing any try/catch.
- MUST load `paypal:typescript-client-initialization` (done) before constructing
  `PaypalClient`.
- MUST load `paypal:typescript-authentication` (done) before wiring OAuth credentials.
- MUST load `paypal:typescript-calling-endpoints` (done) before the first orders call.
- MUST load `paypal:typescript-models` (done) before building OrderRequest/reading Order.
- MUST load `paypal:typescript-configuration-resilience` (done) before setting
  baseUrl/retry/logging/fetch.
- MUST load `paypal:typescript-testing` (done) before writing tests (fake `ClientOptions.fetch`,
  token request first, wire-shaped bodies).
- Next, in task order: MUST load `heistproof:paypal-web-sdk-v6`, then
  `heistproof:checkout-hardening`, and revise this plan in place if they change a row.
