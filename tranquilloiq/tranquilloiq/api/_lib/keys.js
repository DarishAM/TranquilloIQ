import crypto from "node:crypto";

// Keys are stored HASHED. The store holds sha256(key), never the key itself,
// so a dump of Redis yields nothing an attacker can spend. The raw key exists
// exactly twice: in the response that hands it to its owner, and in whatever
// they paste it into afterwards.
export const hashKey = (key) =>
  crypto.createHash("sha256").update(String(key)).digest("hex");

export function mintKey(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString("hex")}`;
}

export const keyPattern = (prefix) =>
  new RegExp(`^${prefix}_[0-9a-f]{64}$`);

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
