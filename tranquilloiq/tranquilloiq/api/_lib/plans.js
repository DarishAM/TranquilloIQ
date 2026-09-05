// Subscription tiers for the public API. Each maps a Stripe Price to an
// allowance. Prices live in Stripe; only the entitlements live here, so
// changing what you charge never needs a deploy — changing what they GET does.
//
// Set STRIPE_PRICE_STARTER / STRIPE_PRICE_GROWTH / STRIPE_PRICE_SCALE to the
// recurring Price ids from your Stripe dashboard.
const CATALOG = [
  { id: "starter", name: "Starter", env: "STRIPE_PRICE_STARTER", monthlyReports: 500, ratePerMinute: 10 },
  { id: "growth", name: "Growth", env: "STRIPE_PRICE_GROWTH", monthlyReports: 5000, ratePerMinute: 60 },
  { id: "scale", name: "Scale", env: "STRIPE_PRICE_SCALE", monthlyReports: 50000, ratePerMinute: 300 },
];

/** Resolve a Stripe Price id to its plan, or null if it is not one of ours. */
export function planForPrice(priceId) {
  if (!priceId) return null;
  for (const plan of CATALOG) {
    if (process.env[plan.env] && process.env[plan.env] === priceId) {
      const { env, ...rest } = plan;
      return rest;
    }
  }
  return null;
}

export function planById(id) {
  const found = CATALOG.find((p) => p.id === id);
  if (!found) return null;
  const { env, ...rest } = found;
  return rest;
}

/** The plans that are actually purchasable — i.e. have a Price configured. */
export function availablePlans() {
  return CATALOG.filter((p) => process.env[p.env]).map((p) => ({
    id: p.id,
    name: p.name,
    priceId: process.env[p.env],
    monthlyReports: p.monthlyReports,
    ratePerMinute: p.ratePerMinute,
  }));
}
