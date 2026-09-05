import { incr, getJSON, setJSON } from "./store.js";
import { hashKey, keyPattern, bearerToken } from "./keys.js";
import { planById } from "./plans.js";

export const API_KEY_PREFIX = "tqiq_sk";
const API_KEY_SHAPE = keyPattern(API_KEY_PREFIX);

const MINUTE = 60;
const THIRTY_FIVE_DAYS = 35 * 24 * 60 * 60;

// Subscription records are keyed by the hash, never the key.
export const subKey = (keyHash) => `sub:${keyHash}`;
export const subIndexKey = (stripeSubId) => `subid:${stripeSubId}`;

export const readSubscription = (keyHash) => getJSON(subKey(keyHash));

export async function writeSubscription(keyHash, record) {
  await setJSON(subKey(keyHash), record);
  if (record.stripeSubscriptionId) {
    // Lets webhook events find the key hash from a Stripe subscription id.
    await setJSON(subIndexKey(record.stripeSubscriptionId), { keyHash });
  }
}

const billingMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

/**
 * Authenticate and meter a public-API request.
 *
 * Returns { ok: true, plan, usage, remaining } or
 * { ok: false, status, code, message, retryAfter? }.
 *
 * Every failure path returns BEFORE any billable work happens.
 */
export async function authorizeApiRequest(req) {
  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false, status: 401, code: "missing_api_key",
      message: "Provide your API key as: Authorization: Bearer tqiq_sk_...",
    };
  }
  if (!API_KEY_SHAPE.test(token)) {
    // Shape-check before touching the store, so junk never becomes a lookup.
    return { ok: false, status: 401, code: "invalid_api_key", message: "API key is not valid." };
  }

  const keyHash = hashKey(token);
  const sub = await readSubscription(keyHash);
  if (!sub) {
    return { ok: false, status: 401, code: "invalid_api_key", message: "API key is not valid." };
  }

  // Stripe keeps a subscription 'active' until it actually lapses; anything
  // else means we stop serving. 'past_due' still serves, so a failed card
  // retry does not instantly break a paying customer's integration.
  if (!["active", "trialing", "past_due"].includes(sub.status)) {
    return {
      ok: false, status: 402, code: "subscription_inactive",
      message: `Subscription is ${sub.status}. Reactivate it to keep using the API.`,
    };
  }

  const plan = planById(sub.planId);
  if (!plan) {
    return {
      ok: false, status: 500, code: "plan_unknown",
      message: "This key's plan is no longer configured on the server.",
    };
  }

  // Per-minute rate limit, fixed window.
  const minute = Math.floor(Date.now() / 60000);
  const hits = await incr(`rl:${keyHash}:${minute}`, MINUTE);
  if (hits > plan.ratePerMinute) {
    return {
      ok: false, status: 429, code: "rate_limited",
      message: `Rate limit is ${plan.ratePerMinute} requests/minute on ${plan.name}.`,
      retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60),
    };
  }

  // Monthly allowance. Counted per calendar month and expired automatically,
  // so a lapsed customer leaves nothing behind in the store.
  const used = await incr(`usage:${keyHash}:${billingMonth()}`, THIRTY_FIVE_DAYS);
  if (used > plan.monthlyReports) {
    return {
      ok: false, status: 402, code: "quota_exceeded",
      message: `Monthly limit of ${plan.monthlyReports} reports reached on ${plan.name}. Upgrade to continue.`,
    };
  }

  return {
    ok: true,
    keyHash,
    plan,
    usage: used,
    remaining: plan.monthlyReports - used,
    rateRemaining: plan.ratePerMinute - hits,
  };
}

/** Give back a monthly report that was counted but never delivered. */
export async function refundApiUsage(keyHash) {
  const { decr } = await import("./store.js");
  await decr(`usage:${keyHash}:${billingMonth()}`);
}

export async function currentUsage(keyHash) {
  const raw = await getJSON(`usage:${keyHash}:${billingMonth()}`);
  return Number(raw || 0);
}
