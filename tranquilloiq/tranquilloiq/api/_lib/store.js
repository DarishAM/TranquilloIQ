// Tiny KV over the Upstash Redis REST API, with an in-process fallback.
//
// Serverless functions are stateless and short-lived, so anything we need to
// remember between requests (usage counters, license credits) has to live
// outside the process. Upstash speaks plain HTTPS, which is the only thing a
// Vercel function can reliably do.
const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const isPersistent = Boolean(URL_ && TOKEN);

// Fallback for `vercel dev` / `npm run dev` with no Upstash configured.
// Per-process and therefore NOT a real store: on Vercel each instance would
// keep its own counters, so limits would not actually hold. Guarded below.
const mem = new Map();
const memGet = (k) => {
  const hit = mem.get(k);
  if (!hit) return null;
  if (hit.expires && hit.expires < Date.now()) {
    mem.delete(k);
    return null;
  }
  return hit.value;
};

async function pipeline(commands) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const out = await res.json();
  return out.map((entry) => {
    if (entry.error) throw new Error(`Upstash: ${entry.error}`);
    return entry.result;
  });
}

/** Atomic fixed-window counter. Returns the count after incrementing. */
export async function incr(key, ttlSeconds) {
  if (!isPersistent) {
    const existing = memGet(key);
    const current = Number(existing || 0) + 1;
    mem.set(key, {
      value: current,
      // Keep the original window's expiry; only start a new one on first hit.
      expires: existing === null ? Date.now() + ttlSeconds * 1000 : mem.get(key).expires,
    });
    return current;
  }
  // EXPIRE .. NX only sets the TTL on the first hit, so the window is fixed
  // from the first request rather than sliding forward on every one.
  const [count] = await pipeline([
    ["INCR", key],
    ["EXPIRE", key, ttlSeconds, "NX"],
  ]);
  return Number(count);
}

/** Decrement a counter, never below zero. Used to refund a failed request. */
export async function decr(key) {
  if (!isPersistent) {
    const current = Number(memGet(key) || 0);
    if (current <= 0) return 0;
    mem.set(key, { value: current - 1, expires: mem.get(key).expires });
    return current - 1;
  }
  const [left] = await pipeline([["DECR", key]]);
  if (Number(left) < 0) {
    await pipeline([["INCR", key]]);
    return 0;
  }
  return Number(left);
}

export async function getJSON(key) {
  if (!isPersistent) return memGet(key);
  const [raw] = await pipeline([["GET", key]]);
  if (raw == null) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function setJSON(key, value, ttlSeconds) {
  if (!isPersistent) {
    mem.set(key, {
      value,
      expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
    return;
  }
  const cmd = ["SET", key, JSON.stringify(value)];
  if (ttlSeconds) cmd.push("EX", ttlSeconds);
  await pipeline([cmd]);
}

/**
 * Set only if the key does not already exist. Returns true when this call
 * created it — the primitive that makes webhook handling idempotent.
 */
export async function setIfAbsent(key, value, ttlSeconds) {
  if (!isPersistent) {
    if (memGet(key) !== null) return false;
    mem.set(key, {
      value,
      expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
    return true;
  }
  const cmd = ["SET", key, JSON.stringify(value), "NX"];
  if (ttlSeconds) cmd.push("EX", ttlSeconds);
  const [res] = await pipeline([cmd]);
  return res === "OK";
}

/**
 * Spend one credit from a license. Returns the remaining balance, or null if
 * the license does not exist / has none left. DECRBY is atomic, so two
 * concurrent requests can never both spend the same last credit.
 */
export async function spendCredit(licenseKeyHash) {
  const balanceKey = `credits:${licenseKeyHash}`;
  if (!isPersistent) {
    const left = Number(memGet(balanceKey) || 0);
    if (left <= 0) return null;
    mem.set(balanceKey, { value: left - 1, expires: 0 });
    return left - 1;
  }
  const [left] = await pipeline([["DECR", balanceKey]]);
  if (Number(left) < 0) {
    // Nothing was there to spend. Give back exactly what this call took, so a
    // concurrent DECR's accounting stays correct.
    await pipeline([["INCR", balanceKey]]);
    return null;
  }
  return Number(left);
}

export async function addCredits(licenseKeyHash, amount) {
  const balanceKey = `credits:${licenseKeyHash}`;
  if (!isPersistent) {
    const left = Number(memGet(balanceKey) || 0);
    mem.set(balanceKey, { value: left + amount, expires: 0 });
    return left + amount;
  }
  const [left] = await pipeline([["INCRBY", balanceKey, amount]]);
  return Number(left);
}

export async function getCredits(licenseKeyHash) {
  const [raw] = isPersistent
    ? await pipeline([["GET", `credits:${licenseKeyHash}`]])
    : [memGet(`credits:${licenseKeyHash}`)];
  return Number(raw || 0);
}
