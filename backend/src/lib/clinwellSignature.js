/* ------------------------------------------------------------------ *
 * ClinWell request signing — contract v1.0.1, Appendix A
 *
 * Header:        t=<unix seconds>,v1=<lowercase hex>
 * Signed string: <unix seconds> + "." + <raw request body, byte for byte>
 * v1:            HMAC-SHA256 of that, using the shared secret
 *
 * Two names for one scheme. Outbound (TLS → ClinWell) the header is
 * `tls-signature`; inbound (ClinWell → TLS) it is `clinwell-signature`.
 * Same algorithm, same 300-second window, different secret in each
 * direction — so neither side can replay the other's traffic back at
 * it.
 *
 * "Byte for byte" is the part that breaks implementations. The
 * signature covers the exact bytes on the wire, so a body that is
 * parsed and re-serialised anywhere between signing and verifying will
 * fail even though the JSON is equivalent. Hence:
 *
 *   - outbound, the serialised string is stored and sent, never rebuilt
 *   - inbound, the route needs express.raw() and must verify BEFORE
 *     anything parses the body
 *
 * The worked example in Appendix A is asserted in
 * scripts/clinwell-test.mjs. If that test passes, this file produces
 * signatures ClinWell accepts.
 * ------------------------------------------------------------------ */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Both sides reject anything further out than this (§3, Appendix A). */
export const WINDOW_SECONDS = 300;

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * The signed string. Exported because the test needs to assert the
 * exact concatenation, and because getting it wrong is the single most
 * likely cause of a 401 nobody can explain.
 */
export function signedString(timestamp, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  return `${timestamp}.${body}`;
}

/**
 * Sign a body we are about to send.
 *
 * @param rawBody the exact string that will be written to the socket
 * @returns {{ timestamp: number, value: string, header: string }}
 */
export function sign(rawBody, secret, { now = Date.now() } = {}) {
  if (!secret) throw new Error("clinwell: cannot sign without a secret");
  const timestamp = Math.floor(now / 1000);
  const value = createHmac("sha256", secret).update(signedString(timestamp, rawBody)).digest("hex");
  return { timestamp, value, header: `t=${timestamp},v1=${value}` };
}

/**
 * Parse `t=…,v1=…`. Order is not guaranteed by the contract, so this
 * reads by name rather than by position.
 */
export function parseHeader(header) {
  const parts = String(header ?? "").split(",");
  let t = null;
  let v1 = null;
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key === "t") t = value;
    if (key === "v1") v1 = value.toLowerCase();
  }
  if (!t || !v1) return null;
  if (!/^\d+$/.test(t)) return null;
  if (!HEX_64.test(v1)) return null;
  return { timestamp: Number(t), v1 };
}

function matches(expected, given) {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  /* Both are validated as 64 hex characters before we get here, so the
     lengths agree and timingSafeEqual will not throw. The check stays
     anyway: a future caller might not validate first. */
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify an inbound signature.
 *
 * `secrets` takes an array because §3 requires both sides to accept a
 * current AND a previous value, which is what makes rotation
 * zero-downtime: ClinWell can start signing with the new secret while
 * we still accept the old one, in either order, with no coordinated
 * restart. Passing a single string is allowed and treated as a
 * one-element array.
 *
 * Returns a reason rather than throwing, because the caller answers
 * every failure with the same 401 and must not leak which part was
 * wrong.
 */
export function verify(rawBody, header, secrets, { now = Date.now() } = {}) {
  const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (candidates.length === 0) return { ok: false, reason: "no-secret-configured" };

  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: "malformed-header" };

  const skew = Math.abs(Math.floor(now / 1000) - parsed.timestamp);
  if (skew > WINDOW_SECONDS) return { ok: false, reason: "timestamp-outside-window", skew };

  const message = signedString(parsed.timestamp, rawBody);
  for (const [index, secret] of candidates.entries()) {
    const expected = createHmac("sha256", secret).update(message).digest("hex");
    if (matches(expected, parsed.v1)) {
      /* Which secret matched is worth knowing during a rotation: if
         nothing has matched the current one for a day, the cutover
         finished and the previous value can be dropped. */
      return { ok: true, secret: index === 0 ? "current" : "previous", timestamp: parsed.timestamp };
    }
  }
  return { ok: false, reason: "signature-mismatch" };
}

/**
 * The two secrets for a direction, current first, read from the
 * environment. Missing values are dropped rather than passed through as
 * empty strings, which would otherwise make an unconfigured server
 * accept HMACs of the empty secret.
 */
export function secretsFrom(currentVar, previousVar) {
  return [process.env[currentVar], process.env[previousVar]].map((v) => String(v ?? "").trim()).filter(Boolean);
}
