import Stripe from "stripe";
import { mintLicenseKey, CREDITS_PER_PACK } from "./_lib/billing.js";
import { addCredits, setIfAbsent } from "./_lib/store.js";

// Stripe signs the RAW request body. Vercel parses JSON bodies by default,
// and a parsed-then-restringified body will NOT match the signature — this is
// the single most common way webhook verification silently breaks.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
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
    // An unverified body is not a customer — never grant credits from it.
    console.error("webhook signature verification failed:", error.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") {
    return res.status(200).json({ received: true, unpaid: true });
  }

  try {
    const licenseKey = mintLicenseKey();

    // Stripe retries webhooks, and can deliver the same event more than once.
    // setIfAbsent is the idempotency gate: only the first delivery for this
    // checkout session mints a key and grants credits.
    const isFirstDelivery = await setIfAbsent(`session:${session.id}`, {
      licenseKey,
      email: session.customer_details?.email || null,
      amountTotal: session.amount_total,
      currency: session.currency,
      createdAt: new Date().toISOString(),
    });

    if (!isFirstDelivery) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await addCredits(licenseKey, CREDITS_PER_PACK);
    console.log(`granted ${CREDITS_PER_PACK} credits for session ${session.id}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    // A 500 tells Stripe to retry, which is what we want if the store was
    // briefly unavailable — the idempotency gate makes the retry safe.
    console.error("failed to grant credits:", error);
    return res.status(500).json({ error: "Could not grant credits." });
  }
}
