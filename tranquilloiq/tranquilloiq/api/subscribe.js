import Stripe from "stripe";
import { availablePlans, planForPrice } from "./_lib/plans.js";

// Starts a RECURRING Stripe Checkout for API access. This is the second
// revenue stream: monthly subscriptions from developers, separate from the
// one-off report credits the dashboard sells.
export default async function handler(req, res) {
  if (req.method === "GET") {
    // Public price list, so a pricing page needs no hardcoded plan data.
    return res.status(200).json({
      plans: availablePlans().map(({ priceId, ...plan }) => plan),
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Billing is not configured (STRIPE_SECRET_KEY)." });
  }

  const plans = availablePlans();
  if (!plans.length) {
    return res.status(500).json({
      error: "No API plans are configured (STRIPE_PRICE_STARTER / _GROWTH / _SCALE).",
    });
  }

  const requested = req.body?.plan;
  const chosen = requested ? plans.find((p) => p.id === requested) : plans[0];
  if (!chosen) {
    return res.status(400).json({
      error: `Unknown plan '${requested}'. Available: ${plans.map((p) => p.id).join(", ")}.`,
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: chosen.priceId, quantity: 1 }],
      success_url: `${origin}/api-keys?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    return res.status(200).json({ url: session.url, plan: chosen.id });
  } catch (error) {
    console.error("subscribe failed:", error);
    return res
      .status(error?.statusCode || 500)
      .json({ error: error?.message || "Could not start subscription checkout." });
  }
}
