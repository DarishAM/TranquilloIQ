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
| `STRIPE_PRICE_ID` | to charge | `price_…` for your credit pack |
| `STRIPE_WEBHOOK_SECRET` | to charge | `whsec_…` from the webhook endpoint |
| `FREE_REPORTS_PER_DAY` | no | Free reports per IP per day (default 3) |
| `CREDITS_PER_PACK` | no | Reports granted per purchase (default 100) |

Without the two Upstash variables the app **refuses to generate reports on
Vercel**. That is deliberate: usage limits held in process memory do not survive
across serverless instances, so an un-metered deploy would let anyone spend your
Anthropic balance without limit.

The key stays server-side. It is read only by `api/generate-report.js`; nothing
in `src/` ever sees it, and the browser never talks to `api.anthropic.com`
directly.

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

1. Create a **one-time** Price in Stripe for your credit pack. Copy its
   `price_…` id into `STRIPE_PRICE_ID`.
2. Add a webhook endpoint pointing at `https://<your-domain>/api/stripe-webhook`,
   subscribed to **`checkout.session.completed`** only.
3. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

Credits are granted by the webhook, never by the browser's return from Checkout
— a client-side redirect can be forged, a signed webhook cannot. Stripe retries
deliveries, so grants are gated on a first-write-wins key per checkout session
and a replayed delivery cannot double-grant.

A report that fails before producing any text refunds its credit.

## Tests

```powershell
npm test
```

Runs the billing and metering suites against a mock Anthropic endpoint and a
locally signed Stripe payload. No network, no API keys, no real charges. Covers
the free-tier limit, credit spend and exhaustion, webhook signature rejection,
webhook replay idempotency, licence handoff, and refund-on-failure.

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
│   ├── generate-report.js     Metered Claude call — the only place the API key is used
│   ├── checkout.js            Creates a Stripe Checkout session
│   ├── stripe-webhook.js      Verifies signature, mints licence, grants credits
│   └── license.js             Redeem a checkout session / read a balance
├── src/App.jsx                Dashboard: KPIs, charts, CSV upload, paywall, PDF export
├── src/main.jsx               React entry point
├── test/                      Offline billing + metering suites
└── index.html
```

Files under `api/_lib/` start with `_`, so Vercel treats them as shared modules
rather than routes.
