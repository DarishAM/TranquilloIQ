import { getJSON } from "./_lib/store.js";
import { hashKey, bearerToken, keyPattern } from "./_lib/keys.js";
import { API_KEY_PREFIX, readSubscription, currentUsage } from "./_lib/apikeys.js";
import { planById } from "./_lib/plans.js";

// GET /api/account?session_id=cs_...   -> hand over the API key after checkout
// GET /api/account  (Bearer key)       -> plan, status and usage this month
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionId = req.query?.session_id;
  if (typeof sessionId === "string" && sessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return res.status(400).json({ error: "Malformed session id." });
    }
    const record = await getJSON(`session:${sessionId}`);
    if (!record || record.kind !== "subscription") {
      // Either the webhook has not landed yet, or the handoff window expired.
      return res.status(404).json({ error: "Subscription not confirmed yet." });
    }
    return res.status(200).json({
      apiKey: record.apiKey,
      plan: record.planId,
      // Shown once. After the handoff record expires only the hash remains,
      // so the key cannot be recovered — it can only be rotated.
      note: "Store this key now. It cannot be retrieved again.",
    });
  }

  const token = bearerToken(req);
  if (!token || !keyPattern(API_KEY_PREFIX).test(token)) {
    return res.status(401).json({ error: "Provide your API key as a Bearer token." });
  }
  const keyHash = hashKey(token);
  const sub = await readSubscription(keyHash);
  if (!sub) return res.status(401).json({ error: "API key is not valid." });

  const plan = planById(sub.planId);
  return res.status(200).json({
    plan: sub.planId,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    usage: {
      monthlyUsed: await currentUsage(keyHash),
      monthlyLimit: plan?.monthlyReports ?? null,
      ratePerMinute: plan?.ratePerMinute ?? null,
    },
  });
}
