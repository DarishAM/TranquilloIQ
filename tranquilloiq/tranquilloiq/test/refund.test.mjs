import http from "node:http";
const API = new URL("../api", import.meta.url).pathname;
const { default: generateReport } = await import(`${API}/generate-report.js`);
const { addCredits, getCredits } = await import(`${API}/_lib/store.js`);
const { mintLicenseKey } = await import(`${API}/_lib/billing.js`);
const { hashKey } = await import(`${API}/_lib/keys.js`);

// Upstream that always fails, to simulate an Anthropic outage / 500.
const { setMode, handler: mockHandler } = await import("./mock-anthropic.js");
http.createServer(mockHandler).listen(4031);

const app = http.createServer((req, res) => {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(o)); };
  let raw = ""; req.on("data", c => raw += c);
  req.on("end", () => { req.body = JSON.parse(raw); generateReport(req, res); });
}).listen(4030);

const key = mintLicenseKey();
const keyHash = hashKey(key); // credits are indexed by hash, not the raw key
await addCredits(keyHash, 5);

let pass = 0, fail = 0;
const check = (n, c, d="") => c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));

const post = () => fetch("http://127.0.0.1:4030/api/generate-report", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-License-Key": key },
  body: JSON.stringify({ prompt: "Summarise." }),
}).then(async r => ({ status: r.status, text: await r.text() }));

console.log("\n[refund on upstream failure]");
check("starts with 5 credits", await getCredits(keyHash) === 5);
const r1 = await post();
check("failed report returns an error status", r1.status >= 400, `${r1.status} ${r1.text}`);
const after = await getCredits(keyHash);
check("credit refunded — user not charged for the failure", after === 5, `balance is ${after}, expected 5`);

console.log("\n[successful report still charges]");
setMode("ok");
await post();
const afterOk = await getCredits(keyHash);
check("successful report consumes exactly 1 credit", afterOk === 4, `balance is ${afterOk}, expected 4`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
