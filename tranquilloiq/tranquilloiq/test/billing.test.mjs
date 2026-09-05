import http from "node:http";
import Stripe from "stripe";

const API = new URL("../api", import.meta.url).pathname;
const { default: generateReport } = await import(`${API}/generate-report.js`);
const { default: webhook } = await import(`${API}/stripe-webhook.js`);
const { default: license } = await import(`${API}/license.js`);

const SSE = [
  ["message_start", {type:"message_start",message:{id:"m",type:"message",role:"assistant",model:"claude-opus-5",content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}}],
  ["content_block_start", {type:"content_block_start",index:0,content_block:{type:"text",text:""}}],
  ["content_block_delta", {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK."}}],
  ["content_block_stop", {type:"content_block_stop",index:0}],
  ["message_delta", {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:2}}],
  ["message_stop", {type:"message_stop"}],
];
const upstream = http.createServer((_q, r) => {
  r.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [e, d] of SSE) r.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
  r.end();
}).listen(4021);

const routes = { "/api/generate-report": generateReport, "/api/stripe-webhook": webhook, "/api/license": license };
const app = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const handler = routes[url.pathname];
  if (!handler) { res.statusCode = 404; return res.end("no route"); }
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  // stripe-webhook opts out of body parsing and reads the raw stream itself.
  if (url.pathname === "/api/stripe-webhook") return handler(req, res);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; } handler(req, res); });
}).listen(4020);

const call = async (path, { method = "GET", body, headers = {} } = {}) => {
  const r = await fetch(`http://127.0.0.1:4020${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json, remaining: r.headers.get("X-Reports-Remaining") };
};

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const REPORT = { method: "POST", body: { prompt: "Summarise." } };

console.log("\n[free tier: 3/day]");
for (let i = 1; i <= 3; i++) {
  const r = await call("/api/generate-report", REPORT);
  check(`free report ${i} allowed`, r.status === 200 && r.text === "OK.", `${r.status} ${r.text}`);
  check(`  reports-remaining = ${3 - i}`, r.remaining === String(3 - i), `got ${r.remaining}`);
}
const over = await call("/api/generate-report", REPORT);
check("4th free report blocked with 402", over.status === 402, `${over.status} ${over.text}`);
check("  paywall message mentions the limit", /Free limit reached \(3/.test(over.json?.error || ""), over.json?.error);

console.log("\n[webhook signature]");
const stripe = new Stripe("sk_test_dummy");
const evt = JSON.stringify({
  id: "evt_1", type: "checkout.session.completed",
  data: { object: { id: "cs_test_abc123", payment_status: "paid", amount_total: 4900, currency: "gbp", customer_details: { email: "buyer@example.com" } } },
});
const forged = await call("/api/stripe-webhook", { method: "POST", body: evt, headers: { "stripe-signature": "t=1,v1=deadbeef" } });
check("forged signature rejected", forged.status === 400, `${forged.status} ${forged.text}`);

const noSig = await call("/api/stripe-webhook", { method: "POST", body: evt });
check("missing signature rejected", noSig.status === 400, `${noSig.status}`);

const sig = stripe.webhooks.generateTestHeaderString({ payload: evt, secret: process.env.STRIPE_WEBHOOK_SECRET });
const good = await call("/api/stripe-webhook", { method: "POST", body: evt, headers: { "stripe-signature": sig } });
check("valid signature accepted", good.status === 200 && good.json?.received === true, `${good.status} ${good.text}`);

console.log("\n[idempotency]");
const replay = await call("/api/stripe-webhook", { method: "POST", body: evt, headers: { "stripe-signature": sig } });
check("replayed delivery does not double-grant", replay.json?.duplicate === true, replay.text);

console.log("\n[licence handoff]");
const handoff = await call("/api/license?session_id=cs_test_abc123");
check("session id returns licence key", handoff.status === 200 && /^tqiq_[0-9a-f]{64}$/.test(handoff.json?.licenseKey || ""), handoff.text);
check("  granted CREDITS_PER_PACK (2)", handoff.json?.credits === 2, `got ${handoff.json?.credits}`);
const key = handoff.json.licenseKey;

const unknown = await call("/api/license?session_id=cs_test_nope");
check("unknown session is 404, not a free key", unknown.status === 404, `${unknown.status}`);
const malformed = await call("/api/license?session_id=../../etc/passwd");
check("malformed session id rejected", malformed.status === 400, `${malformed.status}`);

console.log("\n[paid credits]");
const p1 = await call("/api/generate-report", { ...REPORT, headers: { "X-License-Key": key } });
check("paid report works past the free limit", p1.status === 200 && p1.text === "OK.", `${p1.status} ${p1.text}`);
check("  1 credit left", p1.remaining === "1", `got ${p1.remaining}`);
const p2 = await call("/api/generate-report", { ...REPORT, headers: { "X-License-Key": key } });
check("  2nd paid report works", p2.status === 200 && p2.remaining === "0", `${p2.status} rem=${p2.remaining}`);
const p3 = await call("/api/generate-report", { ...REPORT, headers: { "X-License-Key": key } });
check("exhausted licence blocked with 402", p3.status === 402, `${p3.status} ${p3.text}`);

console.log("\n[bad keys]");
const junk = await call("/api/generate-report", { ...REPORT, headers: { "X-License-Key": "tqiq_" + "f".repeat(64) } });
check("unknown-but-well-formed key gets no credit", junk.status === 402, `${junk.status} ${junk.text}`);
const shaped = await call("/api/generate-report", { ...REPORT, headers: { "X-License-Key": "not-a-key" } });
check("malformed key falls back to free tier (already spent) -> 402", shaped.status === 402, `${shaped.status}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
upstream.close(); app.close();
process.exit(fail ? 1 : 0);
