/* ------------------------------------------------------------------ *
 * Two-factor sign-in
 *
 * A password is one secret, and the two ways it is lost — reused
 * somewhere that was breached, or typed into a page that looked right —
 * are both invisible to us. A six-digit code from a device the person
 * is holding closes both: the breach dump does not contain it, and the
 * phishing page can only use it for thirty seconds and only once.
 *
 * ------------------------------------------------------------------ *
 * THE SHAPE OF THE FLOW, AND WHY IT HAS THE STEPS IT HAS
 *
 * Setting it up is two calls, not one. The first hands back a secret
 * and a QR code and stores the secret WITHOUT switching anything on;
 * the second only switches it on once a code generated from that secret
 * has been checked. Doing it in one step would let somebody scan a
 * blurred QR code, lose it, and be locked out of their own account by a
 * feature they were trying to add.
 *
 * Signing in becomes two calls for the same reason of shape: the
 * password call returns a challenge rather than a session. The
 * challenge deliberately has no `sub` claim, so it cannot be presented
 * as a session token — the auth middleware refuses anything without
 * one. That is a fail-safe rather than a check: a new endpoint added
 * later cannot forget to reject it.
 *
 * Turning it on or off ends every other session. Somebody adding a
 * second factor is usually doing it because they are worried, and
 * leaving the sessions that worried them signed in would answer the
 * wrong question.
 * ------------------------------------------------------------------ */

import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { recoveryCodes as recoveryRepo, users as userRepo, attachSpecialistId } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { createToken, verifyPassword, verifyToken } from "../lib/auth.js";
import { issueSession, revokeAllSessions, revokeOtherSessions } from "../lib/sessions.js";
import { requestOrigin } from "../lib/requestIp.js";
import { toDataUri } from "../lib/qr.js";
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  verifyCode,
} from "../lib/totp.js";
import { publicUser } from "./auth.controller.js";

/* Five minutes between the password and the code. Long enough to find
   the phone, unlock it and open the app; short enough that a challenge
   left in a closed tab is not a way in tomorrow. */
const CHALLENGE_TTL_SECONDS = 300;

/* Five wrong codes and the account stops accepting them for a quarter
   of an hour. A six-digit code is a million possibilities, and a
   million requests is an afternoon's work for a script — the lockout,
   not the length, is what makes guessing impractical. Held in memory:
   it resets on restart, which is a real gap, and a great deal better
   than the unbounded guessing it replaces. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map();

function tooManyAttempts(userId) {
  const record = attempts.get(userId);
  if (!record) return false;
  if (Date.now() - record.first > LOCKOUT_MS) {
    attempts.delete(userId);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(userId) {
  const record = attempts.get(userId);
  if (!record || Date.now() - record.first > LOCKOUT_MS) {
    attempts.set(userId, { count: 1, first: Date.now() });
    return;
  }
  record.count += 1;
}

const clearFailures = (userId) => attempts.delete(userId);

/* ---------------------------------------------------------- stores */

const accountById = async (id) => (isDbConfigured() ? userRepo.findById(id) : demoAccounts.findById(id));
const saveAccount = async (id, patch) =>
  isDbConfigured() ? userRepo.update(id, patch) : demoAccounts.update(id, patch);

/* Demo mode again: the same four operations, in memory. */
const demoCodes = new Map();
const demoRecovery = {
  async replaceAll(userId, hashes) {
    demoCodes.set(userId, hashes.map((codeHash) => ({ codeHash, usedAt: null })));
    return demoCodes.get(userId);
  },
  async consume(userId, codeHash) {
    const list = demoCodes.get(userId) ?? [];
    const row = list.find((r) => r.codeHash === codeHash && !r.usedAt);
    if (!row) return null;
    row.usedAt = new Date();
    return row;
  },
  async remaining(userId) {
    return (demoCodes.get(userId) ?? []).filter((r) => !r.usedAt).length;
  },
  async clear(userId) {
    demoCodes.delete(userId);
  },
};

const recovery = () => (isDbConfigured() ? recoveryRepo : demoRecovery);

/* --------------------------------------------------------- helpers */

const isOn = (user) => Boolean(user?.totpEnabledAt);

function secretOf(user) {
  const stored = user?.totpSecret;
  if (!stored) return null;
  return decryptSecret(stored);
}

function refuseBorrowed(req, res) {
  if (!req.impersonatorId) return false;
  res.status(403).json({
    error: "You're signed in as a member. Two-factor can only be changed by the account's owner.",
    code: "impersonating",
  });
  return true;
}

/* ============================================== the signed-in side */

// GET /api/auth/2fa
export async function getTwoFactor(req, res) {
  const user = await accountById(String(req.user.id));
  res.json({
    enabled: isOn(user),
    enabledAt: user?.totpEnabledAt ?? null,
    /* Shown as a number rather than a list. The codes themselves exist
       in readable form exactly once, on the screen that issues them. */
    recoveryCodesRemaining: isOn(user) ? await recovery().remaining(String(user.id)) : 0,
    /* A secret stored but never confirmed: somebody started setting
       this up and stopped. The screen offers to pick it up again. */
    setupStarted: Boolean(user?.totpSecret) && !isOn(user),
  });
}

const passwordSchema = z.object({ currentPassword: z.string().min(1, "Enter your current password") });

/**
 * POST /api/auth/2fa/setup
 *
 * Hands back a secret and a QR code, and stores the secret without
 * switching anything on. Nothing about sign-in changes until /enable.
 */
export async function startTwoFactor(req, res) {
  if (refuseBorrowed(req, res)) return;

  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form" });
  }

  const user = await accountById(String(req.user.id));
  if (!user) return res.status(401).json({ error: "Sign in to continue" });
  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: "That isn't your current password", code: "current_password_wrong" });
  }
  if (isOn(user)) {
    return res.status(409).json({ error: "Two-factor is already on for this account." });
  }

  /* A fresh secret every time this is called. Reusing an abandoned one
     would mean a QR code photographed weeks ago and forgotten is still
     live. */
  const secret = newSecret();
  await saveAccount(user.id, { totpSecret: encryptSecret(secret), totpLastStep: null });

  const uri = otpauthUri({ secret, account: user.email });
  res.json({
    /* Both, always. The QR is the fast path; the typed secret is the
       one that works when the phone is the thing displaying this page,
       or the camera will not focus, or the app does not scan. */
    secret,
    otpauthUri: uri,
    qr: toDataUri(uri, { scale: 6 }),
  });
}

const codeSchema = z.object({ code: z.string().min(6).max(14) });

/**
 * POST /api/auth/2fa/enable
 *
 * Switches it on, but only after a code from the app proves the secret
 * actually arrived there.
 */
export async function enableTwoFactor(req, res) {
  if (refuseBorrowed(req, res)) return;

  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the six-digit code from your app" });

  const user = await accountById(String(req.user.id));
  if (!user) return res.status(401).json({ error: "Sign in to continue" });
  if (isOn(user)) return res.status(409).json({ error: "Two-factor is already on for this account." });

  const secret = secretOf(user);
  if (!secret) return res.status(409).json({ error: "Start again — there's no setup in progress.", code: "no_setup" });

  if (tooManyAttempts(String(user.id))) {
    return res.status(429).json({ error: "Too many incorrect codes. Try again in fifteen minutes." });
  }

  const result = verifyCode(secret, parsed.data.code, { afterStep: user.totpLastStep ?? null });
  if (!result.ok) {
    recordFailure(String(user.id));
    return res.status(400).json({
      error: "That code isn't right. Check your app is showing the current one.",
      code: "bad_code",
    });
  }
  clearFailures(String(user.id));

  const codes = newRecoveryCodes();
  await recovery().replaceAll(String(user.id), codes.map(hashRecoveryCode));
  await saveAccount(user.id, { totpEnabledAt: new Date(), totpLastStep: result.step });

  /* Every other session goes. Turning this on is usually a response to
     worry about somebody else being in the account, and leaving those
     sessions standing would answer the wrong question. */
  const ended = await revokeOtherSessions(String(user.id), req.session?.id ?? null, "two-factor switched on");

  res.json({
    ok: true,
    /* The only time these are readable. They are hashes from here on,
       so there is no "show them again" — only "issue new ones". */
    recoveryCodes: codes,
    signedOutElsewhere: ended,
  });
}

/**
 * POST /api/auth/2fa/disable
 *
 * The current password AND a current code. Switching the second factor
 * off is the move somebody who has stolen a session would want most,
 * and it should be at least as hard as switching it on.
 */
export async function disableTwoFactor(req, res) {
  if (refuseBorrowed(req, res)) return;

  const schema = passwordSchema.extend({ code: z.string().min(6).max(14) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Enter your password and a code" });
  }

  const user = await accountById(String(req.user.id));
  if (!user) return res.status(401).json({ error: "Sign in to continue" });
  if (!isOn(user)) return res.status(409).json({ error: "Two-factor isn't on for this account." });

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: "That isn't your current password", code: "current_password_wrong" });
  }

  if (tooManyAttempts(String(user.id))) {
    return res.status(429).json({ error: "Too many incorrect codes. Try again in fifteen minutes." });
  }

  const outcome = await checkSecondFactor(user, parsed.data.code);
  if (!outcome.ok) {
    recordFailure(String(user.id));
    return res.status(400).json({ error: outcome.error, code: outcome.code });
  }
  clearFailures(String(user.id));

  await recovery().clear(String(user.id));
  await saveAccount(user.id, { totpSecret: null, totpEnabledAt: null, totpLastStep: null });
  const ended = await revokeOtherSessions(String(user.id), req.session?.id ?? null, "two-factor switched off");

  res.json({ ok: true, signedOutElsewhere: ended });
}

/**
 * POST /api/auth/2fa/recovery-codes
 *
 * A new set, which invalidates the old set. Behind the password,
 * because a printed sheet of these is a password on paper.
 */
export async function regenerateRecoveryCodes(req, res) {
  if (refuseBorrowed(req, res)) return;

  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Enter your current password" });
  }

  const user = await accountById(String(req.user.id));
  if (!user) return res.status(401).json({ error: "Sign in to continue" });
  if (!isOn(user)) return res.status(409).json({ error: "Two-factor isn't on for this account." });
  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: "That isn't your current password", code: "current_password_wrong" });
  }

  const codes = newRecoveryCodes();
  await recovery().replaceAll(String(user.id), codes.map(hashRecoveryCode));
  res.json({ ok: true, recoveryCodes: codes });
}

/* ================================================= the sign-in side */

/**
 * Called by the login handler. A challenge rather than a session.
 *
 * `mfa` rather than `sub` is the important detail: the auth middleware
 * refuses any token without a `sub`, so this cannot be presented to an
 * ordinary endpoint however it is passed around. The refusal is
 * structural rather than a check somebody has to remember to write.
 */
export function challengeFor(user) {
  return createToken({ mfa: String(user.id) }, CHALLENGE_TTL_SECONDS);
}

export const needsSecondFactor = (user) => isOn(user);

/** A TOTP code, or one of the recovery codes. */
async function checkSecondFactor(user, code) {
  const given = String(code ?? "").trim();

  /* Recovery codes are longer and contain letters, so there is no
     ambiguity about which kind of thing was typed. */
  if (!/^\d{6}$/.test(given.replace(/\s/g, ""))) {
    const spent = await recovery().consume(String(user.id), hashRecoveryCode(given));
    if (spent) return { ok: true, usedRecoveryCode: true };
    return { ok: false, error: "That recovery code isn't right, or it has already been used.", code: "bad_recovery" };
  }

  const secret = secretOf(user);
  if (!secret) {
    /* The stored secret will not decrypt — almost always AUTH_SECRET
       having changed. Said plainly, because the person typing a correct
       code deserves better than "wrong code". */
    return {
      ok: false,
      error: "We can't read the two-factor setup on this account. Use a recovery code and set it up again.",
      code: "secret_unreadable",
    };
  }

  const result = verifyCode(secret, given, { afterStep: user.totpLastStep ?? null });
  if (result.ok) {
    await saveAccount(user.id, { totpLastStep: result.step });
    return { ok: true, usedRecoveryCode: false };
  }
  if (result.reason === "replayed") {
    return { ok: false, error: "That code has already been used. Wait for the next one.", code: "code_replayed" };
  }
  return { ok: false, error: "That code isn't right. Check your app is showing the current one.", code: "bad_code" };
}

const finishSchema = z.object({
  challenge: z.string().min(10),
  code: z.string().min(6).max(14),
});

/**
 * POST /api/auth/login/2fa
 *
 * The second half of signing in. Every failure below says as little as
 * an expired challenge does, because by this point the password is
 * already known to be right and the only thing left to learn from the
 * responses is timing.
 */
export async function finishLogin(req, res) {
  const parsed = finishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the six-digit code from your app" });

  const claims = verifyToken(parsed.data.challenge);
  if (!claims?.mfa) {
    return res.status(401).json({ error: "That took too long. Sign in again.", code: "challenge_expired" });
  }

  const user = await accountById(String(claims.mfa));
  if (!user || user.active === false) {
    return res.status(401).json({ error: "That took too long. Sign in again.", code: "challenge_expired" });
  }
  if (!isOn(user)) {
    /* Two-factor was switched off between the two halves of this
       sign-in. Rather than issuing a session from a half-finished flow,
       send them back to a plain sign-in that will now work. */
    return res.status(409).json({ error: "Two-factor is no longer on for this account. Sign in again." });
  }

  if (tooManyAttempts(String(user.id))) {
    return res.status(429).json({ error: "Too many incorrect codes. Try again in fifteen minutes." });
  }

  const outcome = await checkSecondFactor(user, parsed.data.code);
  if (!outcome.ok) {
    recordFailure(String(user.id));
    return res.status(400).json({ error: outcome.error, code: outcome.code });
  }
  clearFailures(String(user.id));

  const origin = requestOrigin(req);
  await saveAccount(user.id, {
    lastLoginAt: new Date(),
    lastLoginIp: origin.ip,
    lastLoginCountry: origin.country,
  });

  if (isDbConfigured()) await attachSpecialistId(user);
  const opened = await issueSession(req, user);

  const remaining = await recovery().remaining(String(user.id));
  res.json({
    token: opened.token,
    user: publicUser(user),
    /* Said at the moment it is true rather than filed away on a
       settings screen nobody opens: somebody who has just spent a
       recovery code is somebody whose phone may well be gone. */
    usedRecoveryCode: outcome.usedRecoveryCode,
    recoveryCodesRemaining: remaining,
  });
}

/** Exported for the password path: changing a password ends everything. */
export { revokeAllSessions };
