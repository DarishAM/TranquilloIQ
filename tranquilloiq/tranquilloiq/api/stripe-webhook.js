import Stripe from "stripe";
import { mintLicenseKey, CREDITS_PER_PACK } from "./_lib/billing.js";
import { addCredits, setIfAbsent, setJSON, getJSON } from "./_lib/store.js";
import { mintKey, hashKey } from "./_lib/keys.js";
import {
  API_KEY_PREFIX,
  writeSubscription,
  readSubscription,
  subIndexKey,
} from "./_lib/apikeys.js";
import { planForPrice } from "./_lib/plans.js";

// Stripe signs the RAW request body. Vercel parses JSON bodies by default,
// and a parsed-then-restringified body will NOT match the signature — this is
// the single most common way webhook verification silently breaks.
export const config = { api: { bodyParser: false } };

// The raw key is returned to its buyer once, via the checkout session, then
// expires. After that only the hash remains in the store.
const HANDOFF_TTL_SECONDS = 7 * 24 * 60 * 60;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Idempotency gate. Returns true exactly once per id, even across Stripe's
 * retries and concurrent deliveries — SET NX is atomic.
 *
 * The gate is claimed BEFORE the grant, so the failure direction is
 * "granted nothing" rather than "granted twice". If the work after the gate
 * throws, the log line below is the manual-recovery record.
 */
const claim = (id, meta) => setIfAbsent(`claim:${id}`, { at: Date.now(), ...meta });

const criticalLog = (what, session) =>
  console.error(
    `MANUAL ACTION REQUIRED: ${what} failed after claiming checkout session ` +
      `${session.id}. The customer paid and was not provisioned.`,
  );

/** One-off credit pack (machine 1: dashboard reports). */
async function handleCreditPack(session) {
  const licenseKey = mintLicenseKey();
  if (!(await claim(session.id, { kind: "credits" }))) {
    return { duplicate: true };
  }
  try {
    // The raw key is handed to its buyer once via the checkout session, then
    // this record expires; the credit balance is keyed by hash and persists.
    await setJSON(
      `session:${session.id}`,
      {
        kind: "credits",
        licenseKey,
        email: session.customer_details?.email || null,
        amountTotal: session.amount_total,
        currency: session.currency,
        createdAt: new Date().toISOString(),
      },
      HANDOFF_TTL_SECONDS,
    );
    await addCredits(hashKey(licenseKey), CREDITS_PER_PACK);
  } catch (error) {
    criticalLog("credit grant", session);
    throw error;
  }
  console.log(`granted ${CREDITS_PER_PACK} credits for session ${session.id}`);
  return { granted: CREDITS_PER_PACK };
}

/** Recurring API subscription (machine 2: public API). */
async function handleSubscription(stripe, session) {
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = planForPrice(priceId);
  if (!plan) {
    // Paid for something we do not recognise. Do not mint a key against an
    // unknown entitlement — surface it instead of guessing.
    console.error(
      `MANUAL ACTION REQUIRED: subscription ${subscription.id} uses price ` +
        `${priceId}, which maps to no configured plan. Customer paid, no key issued.`,
    );
    return { error: "unconfigured_price" };
  }

  if (!(await claim(session.id, { kind: "subscription" }))) {
    return { duplicate: true };
  }

  const apiKey = mintKey(API_KEY_PREFIX);
  const keyHash = hashKey(apiKey);

  try {
    await writeSubscription(keyHash, {
      planId: plan.id,
      status: subscription.status,
      stripeCustomerId: subscription.customer,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: subscription.current_period_end || null,
      createdAt: new Date().toISOString(),
    });
    await setJSON(
      `session:${session.id}`,
      {
        kind: "subscription",
        apiKey, // handed over once, then this record expires
        keyHash,
        planId: plan.id,
        email: session.customer_details?.email || null,
        createdAt: new Date().toISOString(),
      },
      HANDOFF_TTL_SECONDS,
    );
  } catch (error) {
    criticalLog("API key provisioning", session);
    throw error;
  }

  console.log(`provisioned ${plan.id} API key for subscription ${subscription.id}`);
  return { plan: plan.id };
}

/** Keep an existing key's entitlement in step with Stripe. */
async function syncSubscription(subscription) {
  const index = await getJSON(subIndexKey(subscription.id));
  if (!index?.keyHash) {
    // Never provisioned by us — nothing to update.
    return { unknown: true };
  }
  const existing = (await readSubscription(index.keyHash)) || {};
  const plan = planForPrice(subscription.items?.data?.[0]?.price?.id);

  await writeSubscription(index.keyHash, {
    ...existing,
    // A plan change mid-subscription moves the allowance with it.
    planId: plan?.id || existing.planId,
    status: subscription.status,
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end || null,
    updatedAt: new Date().toISOString(),
  });
  return { status: subscription.status };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: "Webhook is not configured." });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await readRawBody(req),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    // An unverified body is not a customer — never grant anything from it.
    console.error("webhook signature verification failed:", error.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.payment_status !== "paid" && session.mode !== "subscription") {
          return res.status(200).json({ received: true, unpaid: true });
        }
        const result =
          session.mode === "subscription"
            ? await handleSubscription(stripe, session)
            : await handleCreditPack(session);
        return res.status(200).json({ received: true, ...result });
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const result = await syncSubscription(event.data.object);
        return res.status(200).json({ received: true, ...result });
      }

      default:
        return res.status(200).json({ received: true, ignored: event.type });
    }
  } catch (error) {
    // A 500 tells Stripe to retry, which is what we want if the store was
    // briefly unavailable — the idempotency gate makes the retry safe.
    console.error(`failed handling ${event.type}:`, error);
    return res.status(500).json({ error: "Handler failed." });
  }
}
