import { getJSON, getCredits } from "./_lib/store.js";
import { readLicenseKey } from "./_lib/billing.js";
import { hashKey } from "./_lib/keys.js";

// Two jobs:
//   GET /api/license?session_id=cs_...  -> hand the buyer their key after checkout
//   GET /api/license  (X-License-Key)   -> report the remaining balance
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
    if (!record) {
      // The webhook may not have landed yet; the client polls briefly.
      return res.status(404).json({ error: "Payment not confirmed yet." });
    }
    return res.status(200).json({
      licenseKey: record.licenseKey,
      credits: await getCredits(hashKey(record.licenseKey)),
    });
  }

  const licenseKey = readLicenseKey(req);
  if (!licenseKey) return res.status(400).json({ error: "No licence key." });
  return res.status(200).json({ credits: await getCredits(hashKey(licenseKey)) });
}
