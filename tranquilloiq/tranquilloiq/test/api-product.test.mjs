import http from "node:http";
import Stripe from "stripe";

const API = new URL("../api", import.meta.url).pathname;
const { default: reportsV1 } = await import(`${API}/v1/reports.js`);
const { default: webhook } = await import(`${API}/stripe-webhook.js`);
const { default: account } = await import(`${API}/account.js`);
const { default: subscribe } = await import(`${API}/subscribe.js`);
const { setMode, handler: mockAnthropic } = await import("./mock-anthropic.js");

setMode("ok");
http.createServer(mockAnthropic).listen(4041);

// Mock Stripe's subscription retrieval — the webhook fetches the live
// subscription to read its price, which we must not hit the network for.
const stripeLive = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUBSCRIPTIONS = new Map();
Stripe.prototype.constructor;
const realRetrieve = stripeLive.subscriptions.retrieve;
Object.getPrototypeOf(stripeLive.subscriptions).retrieve = async function (id) {
  if (SUBSCRIPTIONS.has(id)) return SUBSCRIPTIONS.get(id);
  return realRetrieve.call(this, id);
};

const routes = {
  "/api/v1/reports": reportsV1,
  "/api/stripe-webhook": webhook,
  "/api/account": account,
  "/api/subscribe": subscribe,
};
const app = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const handler = routes[url.pathname];
  if (!handler) { res.statusCode = 404; return res.end("no route"); }
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/stripe-webhook") return handler(req, res);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; } handler(req, res); });
}).listen(4040);

const call = async (path, { method = "GET", body, headers = {} } = {}) => {
  const r = await fetch(`http://127.0.0.1:4040${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json, headers: r.headers };
};

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));

const PAYLOAD = {
  reportType: "exec",
  revenue: [{ month: "Jan", revenue: 412000, target: 380000, profit: 89000 }],
  departments: [{ dept: "Sales", efficiency: 87, headcount: 42, cost: 2.1 }],
};
const post = (body, headers) => call("/api/v1/reports", { method: "POST", body, headers });

console.log("\n[plan catalogue]");
const plans = await call("/api/subscribe");
check("lists only plans with a configured Price", plans.json?.plans?.length === 2, JSON.stringify(plans.json));
check("  does not leak Stripe price ids", !plans.text.includes("price_"), plans.text.slice(0, 120));

console.log("\n[auth]");
check("no key -> 401", (await post(PAYLOAD)).status === 401);
check("garbage key -> 401", (await post(PAYLOAD, { Authorization: "Bearer nope" })).status === 401);
const wellFormed = "tqiq_sk_" + "a".repeat(64);
check("well-formed but unknown key -> 401", (await post(PAYLOAD, { Authorization: `Bearer ${wellFormed}` })).status === 401);

console.log("\n[validation runs before auth, so bad input never burns quota]");
const badType = await post({ ...PAYLOAD, reportType: "nonsense" });
check("unknown reportType -> 400 even with no key", badType.status === 400, `${badType.status}`);
const badShape = await post({ reportType: "exec", revenue: "not-an-array", departments: [] });
check("non-array payload -> 400", badShape.status === 400);
const tooBig = await post({ ...PAYLOAD, revenue: new Array(501).fill({ revenue: 1 }) });
check("501 rows -> 413", tooBig.status === 413, `${tooBig.status}`);

console.log("\n[provision via subscription webhook]");
const stripe = new Stripe("sk_test_dummy");
SUBSCRIPTIONS.set("sub_test_1", {
  id: "sub_test_1", status: "active", customer: "cus_1",
  current_period_end: Math.floor(Date.now() / 1000) + 2592000,
  items: { data: [{ price: { id: process.env.STRIPE_PRICE_STARTER } }] },
});
const evt = JSON.stringify({
  id: "evt_sub_1", type: "checkout.session.completed",
  data: { object: { id: "cs_sub_abc", mode: "subscription", subscription: "sub_test_1", payment_status: "paid", customer_details: { email: "dev@example.com" } } },
});
const sig = (p) => stripe.webhooks.generateTestHeaderString({ payload: p, secret: process.env.STRIPE_WEBHOOK_SECRET });
const hook = await call("/api/stripe-webhook", { method: "POST", body: evt, headers: { "stripe-signature": sig(evt) } });
check("subscription provisioned", hook.json?.plan === "starter", hook.text);
const replay = await call("/api/stripe-webhook", { method: "POST", body: evt, headers: { "stripe-signature": sig(evt) } });
check("replay does not mint a second key", replay.json?.duplicate === true, replay.text);

const handoff = await call("/api/account?session_id=cs_sub_abc");
check("key handed over once", /^tqiq_sk_[0-9a-f]{64}$/.test(handoff.json?.apiKey || ""), handoff.text);
const apiKey = handoff.json.apiKey;
const auth = { Authorization: `Bearer ${apiKey}` };

console.log("\n[the actual product]");
const r1 = await post(PAYLOAD, auth);
check("authenticated report returns JSON", r1.status === 200 && r1.json?.report === "OK.", `${r1.status} ${r1.text.slice(0,120)}`);
check("  reports plan + usage", r1.json?.usage?.plan === "starter" && r1.json?.usage?.monthlyUsed === 1, JSON.stringify(r1.json?.usage));
check("  sets X-Monthly-Remaining", r1.headers.get("X-Monthly-Remaining") === "499", r1.headers.get("X-Monthly-Remaining"));
check("  sets X-RateLimit-Limit", r1.headers.get("X-RateLimit-Limit") === "10", r1.headers.get("X-RateLimit-Limit"));

console.log("\n[rate limit: starter = 10/min]");
let limited = null;
for (let i = 0; i < 12 && !limited; i++) {
  const r = await post(PAYLOAD, auth);
  if (r.status === 429) limited = r;
}
check("11th request in the minute -> 429", limited !== null, "never rate-limited");
check("  sends Retry-After", limited && limited.headers.get("Retry-After") !== null);
check("  error code is rate_limited", limited?.json?.error?.code === "rate_limited", JSON.stringify(limited?.json));

console.log("\n[account endpoint]");
const acct = await call("/api/account", { headers: auth });
check("reports status and usage", acct.json?.plan === "starter" && acct.json?.status === "active", acct.text);
check("  usage is server-side truth", acct.json?.usage?.monthlyUsed === 10, JSON.stringify(acct.json?.usage));

console.log("\n[subscription lifecycle]");
const cancelEvt = JSON.stringify({
  id: "evt_cancel", type: "customer.subscription.deleted",
  data: { object: { id: "sub_test_1", status: "canceled", customer: "cus_1", current_period_end: 0, items: { data: [{ price: { id: process.env.STRIPE_PRICE_STARTER } }] } } },
});
const cancelled = await call("/api/stripe-webhook", { method: "POST", body: cancelEvt, headers: { "stripe-signature": sig(cancelEvt) } });
check("cancellation recorded", cancelled.json?.status === "canceled", cancelled.text);
const afterCancel = await post(PAYLOAD, auth);
check("cancelled key is refused", afterCancel.status === 402 && afterCancel.json?.error?.code === "subscription_inactive", `${afterCancel.status} ${afterCancel.text.slice(0,120)}`);

const unknownSub = JSON.stringify({
  id: "evt_x", type: "customer.subscription.updated",
  data: { object: { id: "sub_never_seen", status: "active", customer: "c", items: { data: [{ price: { id: "price_x" } }] } } },
});
const unk = await call("/api/stripe-webhook", { method: "POST", body: unknownSub, headers: { "stripe-signature": sig(unknownSub) } });
check("unknown subscription is ignored, not provisioned", unk.json?.unknown === true, unk.text);

console.log("\n[key storage]");
const { getJSON } = await import(`${API}/_lib/store.js`);
const { hashKey } = await import(`${API}/_lib/keys.js`);
check("entitlement is stored under the HASH, not the key",
  (await getJSON(`sub:${hashKey(apiKey)}`)) !== null && (await getJSON(`sub:${apiKey}`)) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
