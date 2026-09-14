/* ------------------------------------------------------------------ *
 * Time-based one-time passwords (RFC 6238), and the things around them
 *
 * The six digits an authenticator app shows are HMAC-SHA1 over the
 * number of thirty-second steps since 1970, truncated. That is the
 * whole algorithm, and it has not changed since 2011 — which is why it
 * is here in forty lines rather than as a dependency in the process
 * that issues sessions.
 *
 * SHA1 looks alarming and is not. It is used as an HMAC over a counter,
 * not as a collision-resistant hash, and every authenticator app in
 * existence implements exactly this. Choosing SHA256 here would be a
 * codes-do-not-match support ticket from every person who set it up.
 *
 * ------------------------------------------------------------------ *
 * THREE THINGS THAT ARE NOT IN THE RFC BUT MATTER MORE THAN IT
 *
 * The secret is ENCRYPTED at rest. It is a password equivalent — anyone
 * holding it can generate valid codes for ever — so a table of them in
 * the clear turns one leaked backup into every account at once. The key
 * is derived from AUTH_SECRET, which already has to be set and kept
 * safe for sessions to work at all.
 *
 * A code cannot be used twice. It is valid for a thirty-second window,
 * which is long enough to be read over a shoulder, or typed into a
 * phishing page and relayed within seconds. The step it came from is
 * recorded, and a code from that step or an earlier one is refused.
 *
 * There are recovery codes. The most common way two-factor goes wrong
 * is not an attack, it is a lost phone — and an account nobody can get
 * back into is a support burden and a customer lost. Ten codes, shown
 * once, stored as hashes, single use.
 * ------------------------------------------------------------------ */

import crypto from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;

/* One step either side. Phone clocks drift, and people start typing at
   :29. Wider than this starts to matter: each extra step is another
   code an attacker who saw one a minute ago could still use. */
const WINDOW_STEPS = 1;

/* ------------------------------------------------------------ base32 */

/* RFC 4648, no padding — what every authenticator app expects. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  /* Forgiving on the way in: people paste secrets with spaces in them,
     and a lowercase letter is the same letter. */
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("That isn't a valid secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* --------------------------------------------------- the algorithm */

/** The step number a moment falls in. */
export const stepAt = (whenMs = Date.now()) => Math.floor(whenMs / 1000 / STEP_SECONDS);

/** The six digits for one step. */
export function codeForStep(secretBase32, step) {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  /* An eight-byte big-endian counter. writeBigUInt64BE rather than two
     32-bit writes because the step number is past 2^31 in about 2038
     and a silent wrap then would be a wonderful bug to debug. */
  counter.writeBigUInt64BE(BigInt(step));

  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  /* Dynamic truncation: the last nibble picks where to read from. */
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code for right now. Used by tests and by nothing on the server. */
export const currentCode = (secret, whenMs = Date.now()) => codeForStep(secret, stepAt(whenMs));

/**
 * Check a code, and say which step it came from.
 *
 * Returns `{ ok, step }`. The step matters as much as the verdict: the
 * caller records it, and refuses anything not strictly newer next time,
 * which is what stops a code being used twice inside its window.
 *
 * `afterStep` lets the caller pass in what was last consumed, so the
 * refusal happens here rather than being an easy thing to forget at
 * the call site.
 */
export function verifyCode(secretBase32, code, { whenMs = Date.now(), afterStep = null } = {}) {
  const given = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return { ok: false, step: null, reason: "format" };

  const now = stepAt(whenMs);
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const step = now + offset;
    if (afterStep !== null && step <= afterStep) continue;
    const expected = codeForStep(secretBase32, step);
    /* Constant-time: a plain === leaks how many leading digits were
       right, and six digits is a small enough space to care. */
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, step };
  }

  /* Distinguished from a wrong code so the screen can say "that code
     has already been used" rather than "that code is wrong", which
     would send somebody hunting for a problem that is not there. */
  if (afterStep !== null) {
    for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
      const step = now + offset;
      if (step > afterStep) continue;
      const expected = codeForStep(secretBase32, step);
      const a = Buffer.from(expected);
      const b = Buffer.from(given);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: false, step, reason: "replayed" };
      }
    }
  }

  return { ok: false, step: null, reason: "wrong" };
}

/* ------------------------------------------------------- enrolment */

/** Twenty bytes from the CSPRNG — the RFC's recommended length. */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

/**
 * The otpauth:// URI an authenticator app reads from the QR code.
 *
 * The label carries the issuer as well as the account, and `issuer` is
 * repeated as a parameter, because apps disagree about which they read
 * — and an entry that just says "j.whitfield@example.com" is useless in
 * a list of fifteen of them.
 */
export function otpauthUri({ secret, account, issuer = "Top Local Specialists" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------ secrets at rest */

/**
 * AES-256-GCM, keyed from AUTH_SECRET by HKDF.
 *
 * HKDF rather than using AUTH_SECRET directly: it is also the HMAC key
 * for session tokens, and one secret doing two jobs with the same bytes
 * is how a weakness in one becomes a weakness in both. The `info`
 * string is what separates them.
 */
function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    /* In development AUTH_SECRET is generated per process, so this
       derives from the same per-process value and two-factor simply
       does not survive a restart — which is already true of every
       session. Deployments must set it; the server warns loudly at boot
       if they have not. */
    return crypto.hkdfSync("sha256", Buffer.from("development-only"), Buffer.alloc(0), "tls:totp", 32);
  }
  return crypto.hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), "tls:totp", 32);
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key()), iv);
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  /* Versioned, so a future key rotation can tell old rows from new ones
     rather than having to guess. */
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(stored) {
  const [version, iv, tag, body] = String(stored ?? "").split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key()), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    /* Wrong key, or a tampered row. Null rather than a throw: the
       caller's job is to say "two-factor needs setting up again", not
       to crash a sign-in. */
    return null;
  }
}

/* ------------------------------------------------- recovery codes */

/* No 0/O/1/I/L. These get written on paper and typed back weeks later
   by somebody who is already locked out and already annoyed. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(10);
    let code = "";
    for (let j = 0; j < 10; j += 1) code += CODE_ALPHABET[raw[j] % CODE_ALPHABET.length];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/** Normalised before hashing, so case and dashes do not matter on entry. */
export const hashRecoveryCode = (code) =>
  crypto
    .createHash("sha256")
    .update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .digest("hex");
