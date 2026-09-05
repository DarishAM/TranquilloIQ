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

Set one environment variable in the Vercel dashboard:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |

The key stays server-side. It is read only by `api/generate-report.js`; nothing
in `src/` ever sees it, and the browser never talks to `api.anthropic.com`
directly.

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
├── api/generate-report.js   Vercel function — the only place the API key is used
├── src/App.jsx              Whole dashboard: KPIs, charts, CSV upload, PDF export
├── src/main.jsx             React entry point
└── index.html
```
