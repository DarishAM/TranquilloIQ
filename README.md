# TranquilloIQ

AI business-intelligence dashboard. Upload revenue and department CSVs, get
computed KPIs, charts, and Claude-written analyst reports you can print to PDF.

The app lives in `tranquilloiq/tranquilloiq/`.

## Run it locally

```powershell
cd tranquilloiq\tranquilloiq
npm install
npm run dev
```

`npm run dev` serves the frontend only — Vite does not run the `api/` function,
so **AI reports will 404 under `npm run dev`**. To exercise them locally:

```powershell
npm i -g vercel
$env:ANTHROPIC_API_KEY = "sk-ant-..."
vercel dev
```

## Deploying

Vercel project settings must have **Root Directory = `tranquilloiq/tranquilloiq`**,
otherwise the build finds no `package.json` and `api/generate-report.js` is
never mounted.

Environment variables (Vercel dashboard → Settings → Environment Variables):

| Name | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Key from console.anthropic.com |
| `UPSTASH_REDIS_REST_URL` | yes | Upstash Redis database, REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | yes | Same database, REST token |
| `STRIPE_SECRET_KEY` | to charge | `sk_live_…` (or `sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | to charge | `whsec_…` from the webhook endpoint |
| `STRIPE_PRICE_ID` | dashboard | One-time `price_…` for a report credit pack |
| `STRIPE_PRICE_STARTER` | API | Recurring `price_…` — 500 reports/mo, 10 req/min |
| `STRIPE_PRICE_GROWTH` | API | Recurring `price_…` — 5,000 reports/mo, 60 req/min |
| `STRIPE_PRICE_SCALE` | API | Recurring `price_…` — 50,000 reports/mo, 300 req/min |
| `FREE_REPORTS_PER_DAY` | no | Free reports per IP per day (default 3) |
| `CREDITS_PER_PACK` | no | Reports granted per purchase (default 100) |

Without the two Upstash variables the app **refuses to generate reports on
Vercel**. That is deliberate: usage limits held in process memory do not survive
across serverless instances, so an un-metered deploy would let anyone spend your
Anthropic balance without limit.

The key stays server-side. It is read only by `api/generate-report.js`; nothing
in `src/` ever sees it, and the browser never talks to `api.anthropic.com`
directly.

## Where the money goes

Payments land in **whichever Stripe account owns the `STRIPE_SECRET_KEY` set in
this deployment's environment**, and payouts go to the bank account attached to
that Stripe account. Nothing in this repository names an account, a key, or a
price — set the variables above and the money is yours. With them unset, the
checkout endpoints return `500 Billing is not configured`.

## Two revenue streams

| | Dashboard credits | Public API |
|---|---|---|
| Customer | People using the web app | Developers integrating the engine |
| Billing | One-off credit packs | Monthly subscription |
| Entry point | `/api/checkout` | `/api/subscribe` |
| Credential | Licence key (`tqiq_…`) | API key (`tqiq_sk_…`) |
| Endpoint | `/api/generate-report` | `POST /api/v1/reports` |
| Free tier | 3 reports/IP/day | none — key required |

Both bill through the same Stripe account and the same webhook, and both meter
against the same Redis store. Prompt construction is shared
(`shared/report-prompts.js`) so the two products cannot drift into producing
different analysis from the same numbers.

## Billing

Reports are sold as one-off credit packs, not subscriptions — each report costs
real Opus tokens, so credits map onto the underlying cost, and there is no
renewal or cancellation lifecycle to get wrong.

```
visitor ──3 free reports/day (per IP)──▶ paywall
                                          │
                              Stripe Checkout (one-time)
                                          │
                        webhook ──▶ mint licence key + grant credits
                                          │
                    browser redeems ?session_id= ──▶ key in localStorage
                                          │
                    each report ──▶ X-License-Key header ──▶ 1 credit
```

The licence key is a bearer credential: whoever holds it can spend its credits.
It is 32 bytes of CSPRNG output, never derived from the Stripe session or the
buyer's email, and is sent as a header rather than in a URL.

### Stripe setup

1. Create a **one-time** Price for the dashboard credit pack → `STRIPE_PRICE_ID`.
2. Create **recurring monthly** Prices for the API tiers you want to sell →
   `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE`. Only tiers with a Price set
   are purchasable; `GET /api/subscribe` lists them.
3. Add a webhook endpoint at `https://<your-domain>/api/stripe-webhook`,
   subscribed to `checkout.session.completed`,
   `customer.subscription.updated` and `customer.subscription.deleted`.
4. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

Credits are granted by the webhook, never by the browser's return from Checkout
— a client-side redirect can be forged, a signed webhook cannot. Stripe retries
deliveries, so grants are gated on a first-write-wins key per checkout session
and a replayed delivery cannot double-grant.

A report that fails before producing any text refunds its credit.

## The public API (second revenue stream)

Sold on a monthly subscription. After checkout the key is shown **once** at
`/api/account?session_id=…`; from then on the store holds only its SHA-256
hash, so a database dump yields nothing spendable and a lost key can only be
rotated, not recovered.

```bash
curl -X POST https://<your-domain>/api/v1/reports \
  -H "Authorization: Bearer tqiq_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
        "reportType": "exec",
        "revenue":     [{"month":"Jan","revenue":412000,"target":380000,"profit":89000}],
        "departments": [{"dept":"Sales","efficiency":87,"headcount":42,"cost":2.1}]
      }'
```

```json
{
  "reportType": "exec",
  "report": "…",
  "model": "claude-opus-5",
  "usage": { "monthlyUsed": 12, "monthlyRemaining": 488, "monthlyLimit": 500, "plan": "starter" }
}
```

`reportType` is one of `exec`, `risk`, `growth`, `ops`. Responses carry
`X-RateLimit-Limit` / `-Remaining` and `X-Monthly-Limit` / `-Remaining`.

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_report_type`, `invalid_payload`, `empty_payload` | Rejected before any quota is spent |
| 401 | `missing_api_key`, `invalid_api_key` | No key, or not one of ours |
| 402 | `quota_exceeded`, `subscription_inactive` | Out of monthly reports, or subscription lapsed |
| 413 | `payload_too_large` | More than 500 rows in either array |
| 429 | `rate_limited` | Over the plan's per-minute limit; see `Retry-After` |
| 502 | `upstream_error`, `empty_response` | Our failure — the report is refunded, not billed |

`GET /api/account` with the key returns plan, status and month-to-date usage.
Request validation runs **before** authentication, so a malformed request can
never consume a customer's quota.

## Tests

```powershell
npm test
```

Runs all three suites (50 checks) against a mock Anthropic endpoint and a
locally signed Stripe payload. No network, no API keys, no real charges.

Covers, for the dashboard: free-tier limit, credit spend and exhaustion,
webhook signature rejection, replay idempotency, licence handoff,
refund-on-failure. For the API: auth rejection, validation-before-auth,
subscription provisioning, replay safety, per-minute rate limiting, monthly
quota accounting, cancellation revoking access, and that entitlements are
stored under the key hash rather than the key.

## How reports work

1. The browser POSTs `{ prompt }` to `/api/generate-report`.
2. That function calls Claude (`claude-opus-5`) with the official
   `@anthropic-ai/sdk` and **streams** the answer back as plain text.
3. `src/App.jsx` reads the stream and paints the report as it arrives.

Streaming matters for more than feel: a non-streamed Opus call can outlast a
serverless function's timeout, and the report gets truncated with no error.

## Data and KPIs

Demo data ships in `src/App.jsx` (`DEFAULT_REVENUE`, `DEFAULT_DEPT`). Upload CSVs
to replace it — the modal has a "Download Template" button for the exact columns:

- **Revenue:** `month,revenue,target,profit`
- **Departments:** `dept,efficiency,headcount,cost` (cost in £M)

Every KPI is derived from the loaded rows. Percentage deltas compare the two
most recent revenue periods and are **omitted entirely** when the data has no
prior period to compare against, rather than showing a placeholder.

## Layout

```
tranquilloiq/tranquilloiq/
├── api/
│   ├── _lib/store.js          KV over Upstash REST (counters, credits)
│   ├── _lib/billing.js        Free-tier + licence entitlement rules
│   ├── _lib/keys.js           Key minting + SHA-256 hashing (nothing raw at rest)
│   ├── _lib/plans.js          API subscription tiers → allowances
│   ├── _lib/apikeys.js        API-key auth, rate limit, monthly quota
│   ├── generate-report.js     Dashboard: metered Claude call
│   ├── v1/reports.js          Public API: metered Claude call
│   ├── checkout.js            One-off credit pack Checkout
│   ├── subscribe.js           Recurring API-plan Checkout + price list
│   ├── stripe-webhook.js      Signature check, provisioning, subscription sync
│   ├── license.js             Redeem a credit pack / read a balance
│   └── account.js             Redeem an API key / read plan + usage
├── shared/report-prompts.js   Prompt construction, shared by both products
├── src/App.jsx                Dashboard: KPIs, charts, CSV upload, paywall, PDF export
├── src/main.jsx               React entry point
├── test/                      Offline billing + metering suites
└── index.html
```

Files under `api/_lib/` start with `_`, so Vercel treats them as shared modules
rather than routes.
