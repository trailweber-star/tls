// Password hashing and session tokens.
//
// Both are built on node:crypto rather than bcrypt + jsonwebtoken, so the
// project gains an auth layer without new dependencies to install or keep
// patched. The algorithms are the standard ones:
//
//   - scrypt for passwords (memory-hard, the modern recommendation),
//     with a per-password random salt and constant-time comparison.
//   - HMAC-SHA256 signed tokens in the JWT shape (header.payload.signature),
//     so swapping in the jsonwebtoken library later is a drop-in change.
//
// AUTH_SECRET must be set in production. Without it the server generates a
// throwaway secret at boot, which is fine for local development but means
// every restart invalidates existing sessions — deliberately noisy, so it
// can't quietly ship that way.

import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.AUTH_SECRET) {
  console.warn(
    "[auth] AUTH_SECRET is not set — using a random secret for this process. " +
      "Sessions will not survive a restart. Set AUTH_SECRET before deploying."
  );
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // one week

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/* ------------------------------------------------------------------ *
 * Accounts that exist but cannot be signed in to
 *
 * An imported listing has a shell account behind it so an administrator
 * can open it and fill the profile in, but nobody has ever chosen a
 * password for it. That account carries UNUSABLE_PASSWORD rather than a
 * hash, and because verifyPassword below only accepts a scrypt string,
 * every password in the world fails against it — including an empty one.
 *
 * The check has to be "is there a usable hash", not "is the sentinel
 * present": a row with a corrupted or half-written hash should be
 * unusable too, and would be. `usablePassword` is what the forgot-
 * password route asks before it will email a reset link, which is what
 * stops somebody resetting their way into an unclaimed listing and
 * around the claim review.
 * ------------------------------------------------------------------ */

export const UNUSABLE_PASSWORD = "unclaimed";

/** Has somebody actually set a password on this account? */
export const usablePassword = (stored) => typeof stored === "string" && stored.startsWith("scrypt$");

export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  // Constant-time compare: a plain === leaks how much of the hash matched.
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Session tokens
 * ------------------------------------------------------------------ */

const base64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

/** Issue a signed token. `claims` should stay small — it travels on every request. */
export function createToken(claims, ttlSeconds = TOKEN_TTL_SECONDS) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      ...claims,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    })
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Returns the claims, or null for anything invalid, tampered or expired. */
export function verifyToken(token) {
  if (typeof token !== "string") return null;
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
