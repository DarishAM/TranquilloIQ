// Runs the billing suites against a mock Anthropic endpoint and a mock Stripe
// signature — no network, no API keys, no real charges.
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  ANTHROPIC_API_KEY: "sk-ant-test",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_testsecret123",
  FREE_REPORTS_PER_DAY: "3",
  CREDITS_PER_PACK: "2",
  STRIPE_PRICE_STARTER: "price_starter123",
  STRIPE_PRICE_GROWTH: "price_growth123",
};

const suites = [
  ["test/billing.test.mjs", "http://127.0.0.1:4021"],
  ["test/refund.test.mjs", "http://127.0.0.1:4031"],
  ["test/api-product.test.mjs", "http://127.0.0.1:4041"],
];

let failed = 0;
for (const [file, baseUrl] of suites) {
  const r = spawnSync(process.execPath, [file], {
    env: { ...env, ANTHROPIC_BASE_URL: baseUrl },
    stdio: ["ignore", "inherit", "ignore"],
  });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
