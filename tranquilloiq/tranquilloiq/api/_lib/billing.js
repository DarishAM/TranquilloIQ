import crypto from "node:crypto";
import { incr, decr, addCredits, getCredits, spendCredit, isPersistent } from "./store.js";

// Sold as one-off credit packs rather than subscriptions: each report costs
// real Opus tokens, so credits map onto the underlying cost, and there is no
// renewal/cancellation lifecycle to get wrong.
export const FREE_REPORTS_PER_DAY = Number(process.env.FREE_REPORTS_PER_DAY || 3);
export const CREDITS_PER_PACK = Number(process.env.CREDITS_PER_PACK || 100);

const DAY_SECONDS = 24 * 60 * 60;

export function mintLicenseKey() {
  // 32 bytes of CSPRNG output — not guessable, and never derived from the
  // Stripe session id or the buyer's email.
  return `tqiq_${crypto.randomBytes(32).toString("hex")}`;
}

/** Constant-time compare, for any place we check a secret against user input. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

export function readLicenseKey(req) {
  const header = req.headers["x-license-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  // Shape check before it ever reaches the store, so junk never becomes a lookup.
  return /^tqiq_[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Decide whether this request may generate a report, and consume the quota it
 * uses. Returns { ok, reason, remaining, paid }.
 *
 * Always call this BEFORE hitting Anthropic — a request that gets past this
 * function costs real money.
 */
export async function authorizeReport(req) {
  const license = readLicenseKey(req);

  if (license) {
    const remaining = await spendCredit(license);
    if (remaining === null) {
      const balance = await getCredits(license);
      return {
        ok: false,
        status: 402,
        reason:
          balance === 0
            ? "This licence has no report credits left. Buy another pack to continue."
            : "Licence key not recognised.",
        remaining: 0,
        paid: true,
      };
    }
    return { ok: true, remaining, paid: true };
  }

  // Anonymous free tier, per IP per UTC day.
  const day = new Date().toISOString().slice(0, 10);
  const used = await incr(`free:${day}:${clientIp(req)}`, DAY_SECONDS);
  if (used > FREE_REPORTS_PER_DAY) {
    return {
      ok: false,
      status: 402,
      reason: `Free limit reached (${FREE_REPORTS_PER_DAY} reports per day). Buy a credit pack to keep going.`,
      remaining: 0,
      paid: false,
    };
  }
  return { ok: true, remaining: FREE_REPORTS_PER_DAY - used, paid: false };
}

/**
 * Refund the quota a request consumed. Call this when the report failed for a
 * reason that is not the user's fault — never charge for an error.
 */
export async function refundReport(req) {
  const license = readLicenseKey(req);
  if (license) {
    await addCredits(license, 1);
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  await decr(`free:${day}:${clientIp(req)}`);
}

/** True when metering can actually be enforced across serverless instances. */
export function meteringIsReliable() {
  return isPersistent;
}
