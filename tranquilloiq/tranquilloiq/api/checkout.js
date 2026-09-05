import Stripe from "stripe";

// Creates a Stripe Checkout session for one credit pack. The price lives in
// Stripe (STRIPE_PRICE_ID), never in this repo, so changing what you charge
// never requires a deploy.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({
      error: "Billing is not configured (STRIPE_SECRET_KEY / STRIPE_PRICE_ID).",
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Build the return URLs from the request's own host so this works on
  // localhost, preview deployments and production without extra config.
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("checkout failed:", error);
    return res
      .status(error?.statusCode || 500)
      .json({ error: error?.message || "Could not start checkout." });
  }
}
