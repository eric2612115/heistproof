# PayPal integration plan — Fogline Supply Co.

Goal: add PayPal checkout (PayPal, Venmo, Pay Later buttons + Pay Later messaging)
next to the existing card form, and fulfil an order only after PayPal has really
captured the right amount. Card checkout stays working.

## Repo survey (read-only)

- Runtime/module format: Node >=22.5, plain JavaScript ESM (`"type": "module"`),
  Express 5. Exemplar for layering: `server.js` (routes + DI `createApp({ db, cards, adminKey })`),
  `lib/cart.js` (server-side pricing, integer cents), `lib/db.js` (node:sqlite sync DB),
  `lib/fulfilment.js` (one call = one shipping label; must run exactly once per order),
  `public/app.js` + `public/index.html` (storefront), `test/checkout.test.js`
  (`node:test` + `node:assert`, fake via injected processor, `:memory:` DB).
- No `tsconfig`, no TS/lint toolchain. Checks: `npm test`
  (`node --test "test/**/*.test.js"`). Baseline on untouched tree: 5/5 pass.
  No type checker exists in this JS project; per integrate workflow, if
  `tsc --noEmit` cannot be run over touched files this is stated in the final report,
  with `node --check` + tests used instead.
- Package manager: npm. `paypal` was NOT a dependency. Installed (install is a
  permitted pre-gate prerequisite) pinned over https to a commit:
  `git+https://github.com/context-plugins/paypal-typescript-sdk#5d0df8a8817e5fdf2e2cd48e68f790ea4730aab2`
  (v2.29.0). `node -e "require.resolve('paypal/package.json')"` resolves and
  `node_modules/paypal/sdk-map.md` exists, so all lookups below are from the
  installed package: `sdk-map.md` once, then `map/operations/orders.md`, then the
  model files its Type sources named.
- Credentials/host (no secrets read or printed): server reads
  `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` from env;
  PayPal REST base from `PAYPAL_API_BASE` (default `https://api-m.sandbox.paypal.com`);
  browser `testBuyerCountry` from `PAYPAL_TEST_BUYER_COUNTRY` (unset = omit).
  No credentials exist while building: **no live PayPal calls made**; read-only
  smoke against a real credential is therefore SKIPPED (documented blocker below).

## SDK identity / client contract (from sdk-map.md)

- Package/import: `paypal` (root only, no deep imports). Client `PaypalClient`,
  `new PaypalClient(options: ClientOptions = {})`, resources are memoized lazy
  getters (`client.orders`). Build ONE client at startup and hold it (OAuth token
  cache + getters live on it). No `close()`. Project is ESM-only, so `instanceof`
  on SDK errors is reliable within this single dialect; still narrow on `err.kind`.
- This SDK declares exactly one environment and NO `ServerEnvironment`; any other
  host is `serverOptions: { baseUrl }` (flat — verified in `src/servers.ts`:
  `options.serverOptions?.baseUrl`, default `https://api-m.sandbox.paypal.com`).
  We pass `serverOptions: { baseUrl: PAYPAL_API_BASE }` explicitly. Token endpoint
  is `default + /v1/oauth2/token` on the SAME base URL, so it tracks the override.
- Auth: `oauth2: { clientId, clientSecret }` (OAuth2 client credentials, Bearer).
  Credential fields are optional at type level and fail silently as 401 if unset,
  so the factory validates presence before constructing and PayPal routes fail
  with a fixed 502 if not configured; card routes are unaffected. Token is fetched
  lazily/cached by the SDK; a refused token endpoint is `AuthError` (kind `"auth"`),
  NOT an `ApiError`, and bypasses `.asApiResult()`.
- Logging: OFF and pinned off in code: `logging: { level: "off" }`,
  `logRequestBody` never on, no per-call `logging` level anywhere, so
  `PAYPAL_CLIENT_LOG` cannot enable it from outside. Request bodies carry payer
  data; our own logs never echo bodies or SDK `err.message` URLs to the browser.
- Retry: defaults retry only GET/HEAD/PUT/OPTIONS. Our writes are POST and stay
  OUTSIDE `httpMethodsToRetry`; we also pass `{ retry: { maxRetries: 0 } }` is NOT
  needed for POST (never retried by default) — policy left default, explicitly
  noted: POST create/capture are sent once by the SDK. `retry.timeout` default
  60_000 ms per attempt is kept.
- `Error` is a model type exported by this package (aliased `SdkError` if ever
  imported; we do not import it unaliased). Error family is `PaypalError`,
  narrowed on closed `err.kind`: api/decode/encode/connection/timeout/auth.
  Outside the family: `ConfigurationError`, `SchemaError`, bugs, caller abort
  reason — a family-testing catch must rethrow the rest. Project is JS, so
  narrowing is by `err.kind`/`err.status`/`err.payload` duck-typing consistent
  with the same shapes.
- No pagination/streaming in scope. No operation in scope resolves to
  `undefined`, so plain `await` is the chosen response mode for all three ops
  (status/headers of success are not needed).
- SDK-sent per non-GET op: a fresh `Idempotency-Key` minted per call (plus the
  `prefer` default below). A second call of ours mints a new one, so provider
  dedup across OUR calls comes only from `PayPal-Request-Id` fields we set.

## Operations in scope (all from map/operations/orders.md, one pass)

### createOrder — `client.orders.createOrder(request: Orders.CreateOrderRequest): ApiPromise<Order, Orders.CreateOrderError>`
- Wire: POST `/v2/checkout/orders`, Auth oauth2. Body `OrderRequest` (required):
  `intent: CheckoutPaymentIntent` (required) = `CheckoutPaymentIntent.Capture` ("CAPTURE");
  `purchaseUnits: PurchaseUnitRequest[]` (required, one unit):
  `amount: AmountWithBreakdown` (required) = `{ currencyCode: "USD", value: <dollars string>, breakdown: { itemTotal: Money } }`;
  `customId` (optional) = shop order id; `invoiceId` (optional) = shop order id;
  `referenceId` optional = shop order id; `items: ItemRequest[]` =
  `{ name (req), unitAmount: Money (req), quantity: string (req), sku }`.
  Money = `{ currencyCode: string, value: string }` (both required).
  Amount conversion is ONE function: integer cents -> decimal dollars string
  (4900 -> "49.00", 5 -> "0.05"); breakdown item_total sum == total == amount.
- Request fields (CreateOrderRequest): `payPalRequestId` header `PayPal-Request-Id`
  optional; `prefer` header default `"return=minimal"`; `payPalMockResponse`,
  `payPalPartnerAttributionId`, `payPalClientMetadataId`, `payPalAuthAssertion` optional.
- Error arms (body `Error` = {name,message,debugId required; details?,links?}):
  `"error"`[400], `"error2"`[401], `"error3"`[422], `"error4"`[default], `"undeclared"`.
  Tags are schema-derived per operation; we read `err.status`, never switch on tag.
- Members asserted on the result (missing optional = undefined, no error):
  `id` MUST be present, else outcome unknown (treated like decode-on-2xx).

### captureOrder — `client.orders.captureOrder(request: Orders.CaptureOrderRequest): ApiPromise<Order, Orders.CaptureOrderError>`
- Wire: POST `/v2/checkout/orders/{id}/capture`, Auth oauth2. `id` path required.
  Body `OrderCaptureRequest` (`paymentSource?` only) is optional per the SDK
  map, but the real sandbox rejects a body-less capture (no `Content-Type`)
  with `415 UNSUPPORTED_MEDIA_TYPE` ("The request payload is not supported",
  debug id ca56775236e7a) — PayPal's answer wins over the map, so we send an
  empty JSON body `body: {}` (`"{}"` as `application/json`, no
  `paymentSource`). `prefer` header default `"return=minimal"`; we set `"return=representation"`
  because rule "paid means captured" requires reading
  `purchaseUnits[].payments.captures[]` (OrdersCapture: `status?: CaptureStatus`
  COMPLETED/DECLINED/PARTIALLY_REFUNDED/PENDING/REFUNDED/FAILED, `id?`,
  `amount?: Money`, `customId?`) off the capture response.
- Error arms: `"error"`[400], `"error2"`[401], `"error3"`[403], `"error4"`[404],
  `"error5"`[422], `"error6"`[500], `"error7"`[default], `"undeclared"`.
  PayPal reason = `payload.body.message` + `details[].issue`/`description`
  (ErrorDetails.issue required). Issues we branch on BY VALUE from details:
  `INSTRUMENT_DECLINED`, `ORDER_ALREADY_CAPTURED`, `TRANSACTION_REFUSED`.
- Members asserted: result `id` == requested id and `purchaseUnits` present;
  otherwise outcome unknown -> settle via getOrder.

### getOrder — `client.orders.getOrder(request: Orders.GetOrderRequest): ApiPromise<Order, Orders.GetOrderError>`
- Wire: GET `/v2/checkout/orders/{id}`, Auth oauth2, no body.
  Fields: `id` required; `fields` query optional; mock/auth-assertion headers optional.
- Error arms: `"error"`[401], `"error2"`[404], `"error3"`[default], `"undeclared"`.
- Used ONLY to settle unknown/already-captured outcomes and webhook-free reads.
  Members asserted: `id`, `purchaseUnits[].payments.captures[]`,
  purchase-unit `amount`/`customId` (PurchaseUnit: all optional).

### Webhook verification — NOT an SDK operation
The SDK has no webhook surface at all (40 ops: orders/payments/vault/
transactionSearch/subscriptions; client-initialization skill: verification is
ours to write). Therefore, per checkout-hardening rule 6, verification is a raw
`fetch` POST to `{PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`
(same base URL passed to the SDK; never hard-coded), with a client-credentials
access token obtained from `{PAYPAL_API_BASE}/v1/oauth2/token` (Basic auth,
form `grant_type=client_credentials`, same fetch seam), body =
`{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time }`
from the `PAYPAL-*` headers + `webhook_id: PAYPAL_WEBHOOK_ID` + `webhook_event`
(parsed body). Act only on `verification_status: "SUCCESS"`, else 400/no change.
Every SDK-covered call (create/capture/get + its internal OAuth token) goes
through `PaypalClient`; this one endpoint the SDK does not cover goes to the
same configured base. In tests the SAME injected `fetch` fake serves token,
orders and verify routes (routing on pathname).

## 1b.1 DURABLE WRITES

DUPLICATE CLAIMS — claim -> SDK call -> record result.

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| createOrder | Shop order row inserted BEFORE the call (`db.createOrder`, status `pending`, method `paypal`) PLUS a `paypal_claims` row with `claim_key = "create:" + shopOrderId` (PRIMARY KEY), inserted before the SDK call; `PayPal-Request-Id` sent = shopOrderId (stored on the claim) | PRIMARY KEY constraint on `paypal_claims.claim_key` — every caller for the same shop order computes the same key | `catch` around the claim insert in the create route, recognised by the SQLite constraint error; loser is answered 409 without calling PayPal | `lib/db.js: claimPayPal`; `server.js: POST /api/paypal/orders` |
| captureOrder | `paypal_claims` row `claim_key = "capture:" + paypalOrderId` (PRIMARY KEY) inserted BEFORE the SDK capture call, after the bound-order check; `PayPal-Request-Id` sent = that claim key | PRIMARY KEY constraint on `paypal_claims.claim_key` | `catch` around the claim insert in the capture route; loser does NOT call capture — it settles via getOrder from what PayPal holds, or answers 202 still-pending | `lib/db.js: claimPayPal`; `server.js: POST /api/paypal/orders/:paypalOrderId/capture` (claim asserted inside the fake capture handler in the COMPLETED-capture test) |
| Bind PayPal order to shop order | `orders.paypal_order_id` with UNIQUE index, written when create returns | UNIQUE constraint on `orders.paypal_order_id` | `catch` in create route; conflicting binding is refused, order left unpaid | `lib/db.js: bindPayPalOrder` + unique index `idx_orders_paypal_order_id` |
| Fulfilment transition | `orders.status` itself: atomic `UPDATE orders SET status='paid', payment_method='paypal', payment_reference=?, paid_cents=?, paid_at=? WHERE id=? AND status='pending'` | The conditional UPDATE changes 0 rows for the second settler | Checked row-change count in the settle helper; `fulfilOrder` runs only when it returns true (test "two captures fired at once fulfil exactly once") | `lib/db.js: claimPaidTransition`; `server.js: settlePaid` |
| Webhook event processing | `webhook_events.event_id` PRIMARY KEY row inserted after successful verification, before acting | PRIMARY KEY constraint on `webhook_events.event_id` | `catch` in webhook route; repeat delivery answers 200 and changes nothing | `lib/db.js: recordWebhookEvent`; `server.js: POST /api/paypal/webhooks` |

Claim release: a claim is DELETED when PayPal definitively refuses the write
(4xx `ApiError` for that op, `AuthError`, `EncodeError` — nothing captured/sent),
so a buyer can click again (e.g. after INSTRUMENT_DECLINED). It is KEPT on
unknown outcomes until getOrder settles it; the settle path deletes it.
Fulfilment/webhook claims are transitions/records and are never released.

UNKNOWN OUTCOMES — a ConnectionError/TimeoutError on a write is unknown, never failed.

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| createOrder | createOrder re-issued with the SAME `PayPal-Request-Id` (provider dedupes on it), falling back to reporting outcome unknown if that also fails | `PayPal-Request-Id` = shop order id, stored on the claim before the first call | `lib/paypal.js: createOrder` unknown-outcome branch | test "a connection failure on create re-issues with the same PayPal-Request-Id" |
| captureOrder | getOrder | PayPal order id bound to the shop order | `lib/paypal.js: captureOrder` already-captured/unknown branch calling `getOrder` | test "a connection failure on capture re-reads the order and settles from PayPal"; test "a never-sent auth failure on capture makes no re-read" |

Never-sent failures (`AuthError`, `EncodeError`) get NO re-read: claim released,
fixed 502 (credentials) / 500-class integration message. `DecodeError` on a 2xx
is unknown (same re-read as above); `DecodeError` on a declared error status
keeps that status for the 1b.4 mapping. Tests: connection-failure test asserts
the re-read request was made; a never-sent (`auth`) test on capture asserts
getOrder was NOT called.

## 1b.2 CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| A PayPal order id presented to capture must be bound to exactly one shop order in OUR db | Shop orders table (`orders.paypal_order_id` values we stored at create) | Capture route, BEFORE the duplicate-claim insert and BEFORE any capture call; unknown id -> 404 | Capture with an unbound PayPal id is rejected and the fake fetch sees no capture request |
| A capture settles a shop order only if capture status COMPLETED, captured amount == shop total, currency == shop currency (USD), and capture/purchase-unit `custom_id` == that shop order id | Shop order row (server-priced total/currency) + the shop-order id we put in `custom_id` at create | Shared settle helper used by capture route AND webhook handler, before the atomic paid transition | Capture whose amount/custom_id differs leaves order pending and unshipped |
| A webhook capture event settles only the shop order whose stored PayPal order id matches the event's related order id and whose id matches `custom_id`, for the exact server total | Same shop-order records | Webhook handler after verification + event-id claim | Verified CAPTURE.COMPLETED for a different order/amount changes nothing |
| Bag SKUs/quantities: known SKUs only, integer qty 1..10 (`priceCart`, lib/cart.js) | Server catalog `lib/catalog.js` | Create-order route (and card route, existing) before any claim/SDK call | Bad qty/SKU -> 400 and no PayPal request is sent |

## 1b.3 OPTIONAL REQUEST FIELDS

createOrder `Orders.CreateOrderRequest`:

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` | DUPLICATE CLAIMS + UNKNOWN OUTCOMES rows for createOrder (reference = shop order id) | ✅ set it from those rows |
| `payPalMockResponse` | nothing — forwarding a browser-supplied mock header is the attack in rule 5 | ❌ leave it out |
| `payPalPartnerAttributionId` | nothing | ❌ leave it out |
| `payPalClientMetadataId` | nothing | ❌ leave it out |
| `prefer` | nothing (id+status suffice at create; SDK default `return=minimal` still sent) | ❌ leave it out |
| `payPalAuthAssertion` | nothing | ❌ leave it out |
| `body` | the task (create the PayPal order) | ✅ set it |

`OrderRequest` body members: `intent` ✅ CAPTURE (task: capture after approval);
`purchaseUnits` ✅; inside the unit: `amount` ✅, `customId` ✅ (rule 3 binding),
`invoiceId` ✅ shop order id (rule 3), `referenceId` ✅ shop order id,
`items`+`breakdown.itemTotal` ✅ (rule 2 sum == total);
`payee`, `paymentInstruction`, `description`, `softDescriptor`, `shipping`,
`supplementaryData` ❌ nothing requires them; top-level `payer`, `paymentSource`,
`applicationContext`, `processingInstruction` ❌ (buyer picks PayPal/Venmo/Pay Later
in the v6 session; no return-url flow is used). ItemRequest: `name`, `unitAmount`,
`quantity`, `sku` ✅ (catalog data); `tax`, `description`, `url`, `category`,
`imageUrl`, `upc`, `billingPlan` ❌.

captureOrder `Orders.CaptureOrderRequest`:

| Field | What requires it | Set it? |
| --- | --- | --- |
| `id` | the operation (path) | ✅ PayPal order id from our binding |
| `payPalRequestId` | DUPLICATE CLAIMS row for captureOrder (claim key) | ✅ set it from that row |
| `prefer` | Rule 4: capture response must carry captures to verify COMPLETED/amount/custom_id | ✅ `"return=representation"` |
| `payPalMockResponse` | nothing — never forward browser headers | ❌ leave it out |
| `payPalClientMetadataId` | nothing | ❌ leave it out |
| `payPalAuthAssertion` | nothing | ❌ leave it out |
| `body` | the real sandbox capture contract: a body-less POST (no `Content-Type`) is rejected `415 UNSUPPORTED_MEDIA_TYPE` (debug id ca56775236e7a) | ✅ set it to `{}` (empty JSON object; `paymentSource` still ❌ — nothing requires it) |

getOrder: `id` ✅; `fields`, `payPalMockResponse`, `payPalAuthAssertion` ❌.

Test that proves it: with the fake fetch, assert each outgoing request's parsed
body has EXACTLY the keys above (create body keys = intent/purchase_units with
only the fields listed), and headers carry no `PayPal-Mock-Response` even when
the browser sent one to our routes.

## 1b.4 WHEN THE API SAYS NO (one table per op using caller data)

Reason text rule (all ops): for a caller-caused 4xx, our response carries the
API's reason extracted from `err.payload` (`body.message`, joined with
`details[].description`/`issue`; `"undeclared"` arm -> no reason, fixed text).
`err.payload.kind` tags are per-operation (listed above) and are never switched
on across operations; `err.status` is the discriminator. SDK `err.message` is
never sent to the browser (it names our URL). Logging: log status + PayPal
`debug_id`/issue server-side only.

createOrder (data: buyer's bag, priced by us):

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason text from `err.payload` | fake it with a reason; assert the reason is in your response |
| 401 / 403 | 502 | a fixed message — our credentials | fake a 401; assert 502 and the fixed message |
| 429 | 503 | a fixed message — our quota | — |
| 5xx | 502 | a fixed message | — |
| no response, on a write | per UNKNOWN OUTCOMES | unknown — never "failed" | — |
| no response, on a read | 502 | a fixed message | — |

captureOrder (data: PayPal order id the browser presents):

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason text from `err.payload` | fake it with a reason; assert the reason is in your response |
| 401 / 403 | 502 | a fixed message — our credentials | fake a 401; assert 502 and the fixed message |
| 429 | 503 | a fixed message — our quota | — |
| 5xx | 502 | a fixed message | — |
| no response, on a write | per UNKNOWN OUTCOMES | unknown — never "failed" | — |
| no response, on a read | 502 | a fixed message | — |

Capture-specific arms within the 4xx row: `INSTRUMENT_DECLINED` (422) -> 422 with
PayPal's reason (browser tells buyer to choose another way to pay; order unpaid;
claim released). `ORDER_ALREADY_CAPTURED` -> settle via getOrder (UNKNOWN OUTCOMES
path), never an error to the buyer if PayPal holds a matching COMPLETED capture.
`TRANSACTION_REFUSED`/other issues -> same-status with reason, unpaid.
Capture body with status PENDING -> 202 pending, unpaid, wait for
`PAYMENT.CAPTURE.COMPLETED` webhook. COMPLETED but amount/currency/custom_id
mismatch -> 422, unpaid, never fulfilled.

getOrder (read; data: our own bound PayPal order id):

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason text from `err.payload` | fake it with a reason; assert the reason is in your response |
| 401 / 403 | 502 | a fixed message — our credentials | fake a 401; assert 502 and the fixed message |
| 429 | 503 | a fixed message — our quota | — |
| 5xx | 502 | a fixed message | — |
| no response, on a write | per UNKNOWN OUTCOMES | unknown — never "failed" | — |
| no response, on a read | 502 | a fixed message | — |

(404 from getOrder during settlement = PayPal holds no such order -> the write
did not settle; outcome reported unknown, order left pending, never "failed".)

## Server design

- `lib/paypal.js`: `formatPayPalAmount(cents)` (only conversion), and
  `createPayPalService({ clientId, clientSecret, webhookId, baseUrl, fetchImpl })`
  building ONE `PaypalClient` (`serverOptions.baseUrl`, `oauth2`, logging pinned
  off, fetch seam injectable) exposing `createOrder`, `captureOrder`,
  `getOrder`, `verifyWebhook(headers, event)` plus a typed-ish error translator
  implementing 1b.4 in ONE place. Returns plain result objects; routes map them.
- `lib/db.js`: add `orders.paypal_order_id` (+UNIQUE index), `paypal_claims`,
  `webhook_events` tables/columns (migration-safe for existing DB files);
  helpers: claim insert/delete, bind PayPal order, find order by PayPal id,
  record webhook event, atomic `claimPaidTransition` (conditional UPDATE),
  parse helpers. Existing card behaviour untouched.
- `server.js`: `createApp({ db, cards, adminKey, paypal })` (`paypal` optional;
  built lazily from env in the real startup so card-only tests/boot still work).
  Routes: `GET /api/paypal/config` -> `{ clientId, sdkUrl, currencyCode: "USD" }`
  (+ `testBuyerCountry` ONLY when sandbox and env set; sdkUrl derived from
  PAYPAL_API_BASE: sandbox host -> `https://www.sandbox.paypal.com/web-sdk/v6/core`,
  live host -> `https://www.paypal.com/web-sdk/v6/core`; never the secret);
  `POST /api/paypal/orders` {items,email} -> priceCart (ignores any
  price/amount/total/currency from browser) -> shop order -> claim -> SDK create
  -> bind -> `{ id: paypalOrderId, orderId: shopOrderId }`;
  `POST /api/paypal/orders/:paypalOrderId/capture` (browser body/headers
  ignored) -> binding check -> claim -> capture -> shared settle -> fulfil once;
  `POST /api/paypal/webhooks` -> verify -> event claim -> act only on
  `PAYMENT.CAPTURE.COMPLETED` (settle), `CHECKOUT.ORDER.APPROVED` and PENDING
  never pay, never move an order backwards.
  Shared settle helper: extract COMPLETED capture matching amount/currency/
  custom_id -> atomic paid transition -> `fulfilOrder` only if 1 row changed.

## Browser design (paypal-web-sdk-v6)

- Load core script once from `sdkUrl` in `/api/paypal/config`; one
  `paypal.createInstance({ clientId, components: ["paypal-payments","venmo-payments","paypal-messages"], pageType: "checkout", ...(testBuyerCountry ? { testBuyerCountry } : {}) })`.
- `sdk.findEligibleMethods({ currencyCode: "USD" })`; show only eligible
  `<paypal-button>`, `<venmo-button>`, `<paypal-pay-later-button>` (hidden until
  eligible; Pay Later gets `productCode`/`countryCode` from
  `methods.getDetails("paylater")` before unhiding).
- One session per method (`createPayPalOneTimePaymentSession`,
  `createVenmoOneTimePaymentSession`, `createPayLaterOneTimePaymentSession`)
  with shared onApprove/onCancel/onError. On click: start the create-order POST
  WITHOUT awaiting it, then `session.start({ presentationMode: "auto" }, promise)`
  (keeps transient activation). Browser sends only SKUs+quantities.
  onApprove POSTs capture; server decides paid; DECLINED -> tell buyer to pick
  another way and let them click again. onCancel/onError never mark paid.
- Pay Later messaging: `<paypal-message amount currency-code="USD" auto-bootstrap>`
  + `sdk.createPayPalMessages()`; update `amount` (decimal dollars string) on
  every `bag:change`.

## Tests (node:test, fake fetch through ClientOptions.fetch — no network)

Fake routes on pathname: `/v1/oauth2/token`, `/v2/checkout/orders`,
`/v2/checkout/orders/:id/capture`, `/v2/checkout/orders/:id`,
`/v1/notifications/verify-webhook-signature`; `retry` left default for POST-once
behaviour but clients in tests use fresh instances; token response queued/routed
first. Assert wire shapes (snake_case), headers, exact body keys.
Coverage per the cells above (each naming the real function/test), plus: money conversion, create ignores 1-cent prices,
capture fulfils exactly once under duplicate/concurrent calls, APPROVED webhook
never pays, verified CAPTURE.COMPLETED pays, forged/edited webhook 400,
replayed webhook 200-once, ORDER_ALREADY_CAPTURED settles via getOrder,
connection-failure capture re-reads (and AuthError does not), mock header never
forwarded, config never contains the secret.

## Assumptions & Blockers

- MINOR: harness route names beyond `POST /api/paypal/webhooks` are not fixed by
  the task; we use the conventional names above and the browser uses only ours.
- MINOR: no PayPal credentials exist while building, so the plan-first live
  smoke is skipped by instruction ("make no live PayPal calls"); harness runs
  against sandbox afterwards. No entitlement (403) surprises can be detected now.
- NOTED (not a blocker): SDK has no webhook-verify operation — verification uses
  raw fetch to the same `PAYPAL_API_BASE` as the hardening rule specifies.
- MINOR: project is JS with no type checker; `tsc --noEmit` gate will be
  attempted and, if unavailable, reported rather than silently substituted.

## REQUIRED READING

- MUST load `paypal:typescript-error-handling` before writing any try/catch (loaded).
- MUST load `paypal:typescript-client-initialization` before constructing `PaypalClient` (loaded).
- MUST load `paypal:typescript-authentication` before wiring `oauth2` credentials (loaded).
- MUST load `paypal:typescript-calling-endpoints` before the first orders call (loaded).
- MUST load `paypal:typescript-models` before building OrderRequest/capture bodies (loaded).
- MUST load `paypal:typescript-configuration-resilience` before setting baseUrl/retry/logging (loaded).
- MUST load `paypal:typescript-testing` before creating/editing any test file, including throwaway fake-fetch scripts (loaded).
