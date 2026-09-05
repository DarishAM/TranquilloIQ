import Anthropic from "@anthropic-ai/sdk";
import { authorizeApiRequest, refundApiUsage } from "../_lib/apikeys.js";
import { meteringIsReliable } from "../_lib/billing.js";
import { buildPrompt, REPORT_TYPES, REPORT_SYSTEM } from "../../shared/report-prompts.js";

export const config = { maxDuration: 60 };

const MAX_ROWS = 500;

const client = new Anthropic();

const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message }, ...extra });

export default async function handler(req, res) {
  // CORS: this is a public API meant to be called from servers, but allowing
  // browsers costs nothing and the API key is the only thing that grants access.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return fail(res, 405, "method_not_allowed", "Use POST.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(res, 500, "server_misconfigured", "Report engine is not configured.");
  }
  if (!meteringIsReliable() && process.env.VERCEL) {
    return fail(res, 503, "metering_unavailable",
      "Usage metering is not configured; refusing to run un-metered billable requests.");
  }

  // ---- validate before authenticating, so a malformed request never burns quota
  const { reportType, revenue, departments } = req.body ?? {};
  if (!REPORT_TYPES.includes(reportType)) {
    return fail(res, 400, "invalid_report_type",
      `reportType must be one of: ${REPORT_TYPES.join(", ")}.`);
  }
  if (!Array.isArray(revenue) || !Array.isArray(departments)) {
    return fail(res, 400, "invalid_payload",
      "Both 'revenue' and 'departments' must be arrays.");
  }
  if (!revenue.length && !departments.length) {
    return fail(res, 400, "empty_payload", "Supply at least one revenue or department row.");
  }
  if (revenue.length > MAX_ROWS || departments.length > MAX_ROWS) {
    return fail(res, 413, "payload_too_large", `Maximum ${MAX_ROWS} rows per array.`);
  }

  const auth = await authorizeApiRequest(req);
  if (!auth.ok) {
    if (auth.retryAfter) res.setHeader("Retry-After", String(auth.retryAfter));
    return fail(res, auth.status, auth.code, auth.message);
  }

  res.setHeader("X-RateLimit-Limit", String(auth.plan.ratePerMinute));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, auth.rateRemaining)));
  res.setHeader("X-Monthly-Limit", String(auth.plan.monthlyReports));
  res.setHeader("X-Monthly-Remaining", String(Math.max(0, auth.remaining)));

  const prompt = buildPrompt(reportType, revenue, departments);

  try {
    // Streamed internally and assembled here: API consumers get one JSON body,
    // but a long generation never trips the SDK's non-streaming timeout.
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: REPORT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      await refundApiUsage(auth.keyHash);
      return fail(res, 422, "refused",
        message.stop_details?.explanation || "The model declined this request.");
    }

    const report = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!report) {
      await refundApiUsage(auth.keyHash);
      return fail(res, 502, "empty_response", "The model returned no text.");
    }

    return res.status(200).json({
      reportType,
      report,
      model: message.model,
      usage: {
        monthlyUsed: auth.usage,
        monthlyRemaining: Math.max(0, auth.remaining),
        monthlyLimit: auth.plan.monthlyReports,
        plan: auth.plan.id,
      },
    });
  } catch (error) {
    console.error("v1/reports failed:", error);
    // Never bill for our own failure.
    await refundApiUsage(auth.keyHash).catch((e) => console.error("refund failed:", e));
    const status = error?.status;
    if (status === 429) {
      return fail(res, 503, "upstream_rate_limited", "Report engine is busy — retry shortly.");
    }
    return fail(res, 502, "upstream_error", "Report generation failed.");
  }
}
