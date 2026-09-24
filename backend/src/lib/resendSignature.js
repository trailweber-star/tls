/* ------------------------------------------------------------------ *
 * Resend webhook signing — Svix scheme
 *
 * Every event Resend sends us (an inbound email arriving, a sent email
 * bouncing, a complaint) is one POST to one endpoint, signed the same
 * way: three headers, base64 HMAC-SHA256 over "id.timestamp.body".
 *
 *   svix-id:        a unique id for this delivery
 *   svix-timestamp: unix seconds the event was sent
 *   svix-signature: one or more "v1,<base64>" values, space-separated —
 *                   Resend rotates signing keys, so more than one may be
 *                   valid at once; any match is accepted
 *
 * Signed content:  `${svix-id}.${svix-timestamp}.${raw body}`
 * Secret:          "whsec_<base64>" from the Resend dashboard — the
 *                   whsec_ prefix is stripped and the rest base64-decoded
 *                   to get the actual HMAC key
 *
 * This mirrors lib/clinwellSignature.js on purpose: same shape (verify a
 * raw body against a header, over a bounded time window, against one or
 * more candidate secrets so rotation is zero-downtime), different
 * concrete scheme because Resend's is Svix's rather than our own. The
 * route that calls this reads the exact bytes from req.rawBody, which
 * app.js already captures on every request for exactly this reason —
 * see the comment above express.json() there.
 * ------------------------------------------------------------------ */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Reject anything further out than this — Resend's own tolerance. */
export const WINDOW_SECONDS = 300;

/**
 * The signed string. Exported for the same reason clinwellSignature does:
 * a wrong concatenation here is the single most likely cause of a 401
 * nobody can explain.
 */
export function signedContent(id, timestamp, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  return `${id}.${timestamp}.${body}`;
}

/** "whsec_<base64>" -> the raw HMAC key. */
function keyFromSecret(secret) {
  const trimmed = String(secret ?? "").trim();
  const withoutPrefix = trimmed.startsWith("whsec_") ? trimmed.slice("whsec_".length) : trimmed;
  return Buffer.from(withoutPrefix, "base64");
}

function matches(expectedB64, givenB64) {
  let a, b;
  try {
    a = Buffer.from(expectedB64, "base64");
    b = Buffer.from(givenB64, "base64");
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify one webhook delivery.
 *
 * `secrets` takes an array for the same reason as clinwellSignature: a
 * secret can be rotated in the Resend dashboard without a coordinated
 * restart if the server briefly accepts both the new and the previous
 * one. A single string is fine too.
 *
 * Returns a reason rather than throwing — the caller answers every
 * failure with the same 401 and does not leak which part was wrong.
 */
export function verify(rawBody, headers, secrets, { now = Date.now() } = {}) {
  const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (candidates.length === 0) return { ok: false, reason: "no-secret-configured" };

  const id = headers?.["svix-id"];
  const timestamp = headers?.["svix-timestamp"];
  const signatureHeader = headers?.["svix-signature"];
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing-headers" };
  if (!/^\d+$/.test(String(timestamp))) return { ok: false, reason: "malformed-timestamp" };

  const skew = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (skew > WINDOW_SECONDS) return { ok: false, reason: "timestamp-outside-window", skew };

  const given = String(signatureHeader)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("v1,") ? part.slice("v1,".length) : part));

  const message = signedContent(id, timestamp, rawBody);

  for (const [index, secret] of candidates.entries()) {
    const expected = createHmac("sha256", keyFromSecret(secret)).update(message).digest("base64");
    if (given.some((sig) => matches(expected, sig))) {
      return { ok: true, secret: index === 0 ? "current" : "previous" };
    }
  }
  return { ok: false, reason: "signature-mismatch" };
}

/** Same helper as clinwellSignature's secretsFrom — current then previous, missing values dropped. */
export function secretsFrom(currentVar, previousVar) {
  return [process.env[currentVar], process.env[previousVar]].map((v) => String(v ?? "").trim()).filter(Boolean);
}
