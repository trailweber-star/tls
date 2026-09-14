/* ------------------------------------------------------------------ *
 * Passwords: forgetting one, and changing one
 *
 * Until now this site had neither. Whatever password an account was
 * created with was the password it had for ever, and a member who forgot
 * theirs had to email somebody who could edit the database by hand. That
 * is the first support request any directory gets, and the one nobody
 * should ever have to answer.
 *
 * Three endpoints, and the interesting decisions are all about what they
 * refuse to reveal and what they take away.
 *
 *   POST /auth/forgot-password   always answers the same
 *   POST /auth/reset-password    single use, one hour, ends old sessions
 *   POST /auth/change-password   needs the current password, not just a
 *                                session
 *
 * ------------------------------------------------------------------ *
 * WHY THE FIRST ONE ALWAYS ANSWERS THE SAME
 *
 * "No account with that email" is a free account-enumeration oracle. Run
 * a list of addresses through it and you learn which doctors have
 * accounts here — useful on its own, and the first step of a credential
 * stuffing run. So the answer is identical whether or not the address
 * exists, down to not skipping the work that would make the "no account"
 * case measurably faster.
 *
 * WHY THE TOKEN IS NEVER STORED
 *
 * The database holds a SHA-256 of the token. The token itself lives in
 * the email and in the member's browser, nowhere else. A leaked backup
 * of password_reset_tokens is then worth nothing; storing raw tokens
 * would make that table a list of live passwords.
 *
 * WHY CHANGING A PASSWORD ENDS SESSIONS
 *
 * Sessions are signed tokens with no row behind them — there is nothing
 * on the server to delete. users.password_changed_at is the substitute:
 * the auth middleware refuses any token issued before it. Without that,
 * somebody who resets their password BECAUSE another person has it
 * leaves that person signed in for the rest of the week-long token life,
 * free to read the dashboard and set the password back. Changing the
 * lock has to put the intruder outside.
 * ------------------------------------------------------------------ */

import crypto from "node:crypto";
import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { passwordResets as resetRepo, users as userRepo, attachSpecialistId } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { createToken, hashPassword, verifyPassword } from "../lib/auth.js";
import { requestOrigin } from "../lib/requestIp.js";
import { hasMailer, sendMail } from "../lib/mailer.js";
import { publicUser } from "./auth.controller.js";

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

/* One hour. Long enough to fetch the email on another device and come
   back to it; short enough that a link still sitting in a shared inbox
   next week is already dead. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/* Three links an hour per account. Enough for somebody who deleted the
   first email by accident, few enough that this cannot be used to bury
   a person's inbox — or to walk their mailbox looking for one that
   arrives. */
const MAX_REQUESTS_PER_HOUR = 3;

/**
 * Did this request come from the machine the server is running on?
 *
 * Read off the socket, not off req.ip, and refused outright if any
 * forwarding header is present. The app runs behind a proxy with "trust
 * proxy" set, which means req.ip is whatever X-Forwarded-For said — a
 * claim, not a fact, and one any caller can write. Trusting it here
 * would let somebody turn the development convenience below into a
 * remote account-enumeration oracle by adding one header.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function fromThisMachine(req) {
  if (req.headers?.["x-forwarded-for"] || req.headers?.["forwarded"]) return false;
  return LOOPBACK.has(String(req.socket?.remoteAddress ?? "").trim());
}

/* ------------------------------------------------------------ tokens */

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/* 32 bytes from the CSPRNG. The only property that matters is that it
   cannot be guessed: a reset token IS a password for the minute it
   lives, so it gets more entropy than any password a person would
   choose. */
const mintToken = () => crypto.randomBytes(32).toString("base64url");

/* Demo mode has no database, so the same three operations live in a Map
   for the life of the process. Shape parity with the repo, deliberately:
   the handlers below branch on where rows come from, never on what they
   look like. */
const demoResets = new Map();
const demoStore = {
  async create({ userId, tokenHash, expiresAt, requestedIp }) {
    const row = {
      id: `prt-${demoResets.size + 1}`,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      requestedIp,
      createdAt: new Date(),
    };
    demoResets.set(tokenHash, row);
    return row;
  },
  async findByHash(tokenHash) {
    return demoResets.get(tokenHash) ?? null;
  },
  async markUsed(id) {
    for (const row of demoResets.values()) {
      if (row.id === id && !row.usedAt) {
        row.usedAt = new Date();
        return row;
      }
    }
    return null;
  },
  async burnAllFor(userId) {
    let n = 0;
    for (const row of demoResets.values()) {
      if (row.userId === userId && !row.usedAt) {
        row.usedAt = new Date();
        n += 1;
      }
    }
    return n;
  },
  async countSince(userId, since) {
    let n = 0;
    for (const row of demoResets.values()) {
      if (row.userId === userId && new Date(row.createdAt) >= since) n += 1;
    }
    return n;
  },
};

/* The demo store's operations are synchronous where the repo's return
   promises. These shims are `async` so that both branches are awaited
   the same way — without them a `.catch()` on the demo path is a call on
   a plain object, which is a 500 that only ever happens with no database
   attached and therefore only ever in front of somebody trying the
   build for the first time. */
const resets = () => (isDbConfigured() ? resetRepo : demoStore);
const accountByEmail = async (email) =>
  isDbConfigured() ? userRepo.findByEmail(email) : demoAccounts.findByEmail(email);
const accountById = async (id) => (isDbConfigured() ? userRepo.findById(id) : demoAccounts.findById(id));
const saveAccount = async (id, patch) =>
  isDbConfigured() ? userRepo.update(id, patch) : demoAccounts.update(id, patch);

/* ------------------------------------------------------- new passwords */

/* The bar is length, not punctuation. Composition rules ("one capital,
   one symbol") push people towards Password1! and away from anything
   long, which is the opposite of what helps. Eight is the floor the
   registration form already sets; the list below only catches the
   handful that would be broken on the first guess. */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "letmein1",
  "iloveyou",
  "welcome1",
  "abc12345",
  "demo1234",
]);

const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(200, "That is longer than we can store")
  .refine((value) => !OBVIOUS.has(value.toLowerCase()), {
    message: "That password is one of the first anybody would try. Pick another.",
  });

/** Does this password give away the account it protects? */
function tooCloseToTheAccount(password, user) {
  const lowered = password.toLowerCase();
  const local = String(user?.email ?? "").split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lowered.includes(local)) return true;
  const names = String(user?.fullName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 4);
  return names.some((part) => lowered.includes(part));
}

/* ------------------------------------------------------------- email */

function buildResetEmail({ user, url }) {
  return {
    to: user.email,
    subject: "Reset your Top Local Specialists password",
    text: [
      `Hello ${user.fullName?.split(" ")[0] ?? "there"},`,
      "",
      "Somebody asked to reset the password on your Top Local Specialists",
      "account. If that was you, open this link within the next hour:",
      "",
      url,
      "",
      "The link works once and then stops working.",
      "",
      "If it wasn't you, you don't need to do anything — your password has",
      "not changed and nobody can change it without this link. If you keep",
      "getting these, reply to this message and we'll look into it.",
      "",
      "Top Local Specialists",
    ].join("\n"),
  };
}

/* ------------------------------------------------- forgot a password */

const forgotSchema = z.object({ email: z.string().email() });

/**
 * POST /api/auth/forgot-password
 *
 * Answers `{ ok: true }` to everything — an unknown address, a suspended
 * account, one that has asked four times this hour. The caller learns
 * nothing about who banks here.
 */
export async function forgotPassword(req, res) {
  const parsed = forgotSchema.safeParse(req.body);

  /* Even a malformed address gets the same answer. A 400 on "not an
     email" is fine — it tells nobody anything — but a 400 on a valid
     address that happens to be unregistered would not be. */
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter the email address on your account" });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const ok = () => res.json({ ok: true });

  const user = await accountByEmail(email).catch(() => null);

  /* A deactivated account gets nothing. Letting somebody reset their way
     back into an account an administrator switched off would make
     deactivation advisory. */
  if (!user || user.active === false) return ok();

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await resets().countSince(user.id, since);
  if (recent >= MAX_REQUESTS_PER_HOUR) return ok();

  const token = mintToken();
  const origin = requestOrigin(req);
  await resets().create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestedIp: origin.ip ?? null,
  });

  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;

  /* Awaited, but its result is not the response. A mail provider having
     a bad afternoon must not turn into "that email doesn't exist" on the
     screen — the mailer logs every attempt, and the admin dashboard is
     where a failure to send is visible. */
  await sendMail(buildResetEmail({ user, url })).catch(() => null);

  /* Development convenience, and only that.
     With no mail provider configured the link exists nowhere a developer
     can reach, which makes the whole flow unwalkable on a laptop. But
     handing the link back in the response IS the account-enumeration
     answer this endpoint spends its whole design avoiding, so it is
     fenced three ways: no mail provider, not production, and the request
     came from the loopback address. The third is the one that holds:
     a browser on a deployed site — staging included, whatever NODE_ENV
     it was started with — never connects from 127.0.0.1. */
  if (fromThisMachine(req) && process.env.NODE_ENV !== "production" && !hasMailer()) {
    return res.json({ ok: true, devResetUrl: url });
  }

  return ok();
}

/* -------------------------------------------------- redeem the link */

const resetSchema = z.object({
  token: z.string().min(10).max(400),
  password: newPasswordSchema,
});

/**
 * POST /api/auth/reset-password
 *
 * Consumes the link and sets the new password. Every failure says the
 * same thing, because "that link expired" and "that link was already
 * used" are the same instruction to the person reading it: ask for
 * another one.
 */
export async function resetPassword(req, res) {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues.find((i) => i.path[0] === "password");
    return res.status(400).json({ error: issue?.message ?? "That reset link is not valid" });
  }

  const { token, password } = parsed.data;
  const dead = () =>
    res.status(400).json({
      error: "That reset link has expired or has already been used. Ask for a new one.",
      code: "reset_link_dead",
    });

  const row = await resets().findByHash(hashToken(token)).catch(() => null);
  if (!row) return dead();
  if (row.usedAt) return dead();
  if (new Date(row.expiresAt).getTime() <= Date.now()) return dead();

  const user = await accountById(row.userId).catch(() => null);
  if (!user || user.active === false) return dead();

  if (tooCloseToTheAccount(password, user)) {
    return res.status(400).json({ error: "Don't use your name or email address as your password" });
  }

  /* Claim the token before touching the password. Two tabs, or a mail
     scanner that follows links, must not both get through: markUsed only
     updates a row that is still unused, so the second caller gets null
     and is told the link is spent. */
  const claimed = await resets().markUsed(row.id);
  if (!claimed) return dead();

  const changedAt = new Date();
  await saveAccount(user.id, {
    passwordHash: hashPassword(password),
    passwordChangedAt: isDbConfigured() ? changedAt : changedAt.toISOString(),
  });

  /* Any other link already in flight — a second request, or one an
     attacker asked for — dies here too. */
  await resets().burnAllFor(user.id);

  /* Signed straight in, with a token minted after the change so it
     survives the middleware's own check. They have just proved they
     control the mailbox on the account; making them type the password
     they set four seconds ago proves nothing further. */
  const fresh = await accountById(user.id);
  if (isDbConfigured() && fresh) await attachSpecialistId(fresh);
  const account = fresh ?? user;

  return res.json({
    ok: true,
    token: createToken({ sub: account.id, role: account.role }),
    user: publicUser(account),
  });
}

/* ------------------------------------------- change a known password */

const changeSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: newPasswordSchema,
});

/**
 * POST /api/auth/change-password
 *
 * The signed-in route, on every dashboard. It asks for the current
 * password even though the caller already holds a session, because the
 * two are not the same claim: a session means a browser was left open,
 * and an unattended laptop should not be enough to lock its owner out of
 * their own account.
 */
export async function changePassword(req, res) {
  /* An administrator wearing somebody else's session must not be able to
     change that person's password. Support sessions exist to see what
     the member sees and fix their listing; taking their account is not
     support, and the audit trail would record the member doing it. */
  if (req.impersonatorId) {
    return res.status(403).json({
      error: "You're signed in as a member. A password can only be changed by its owner.",
      code: "impersonating",
    });
  }

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return res.status(400).json({ error: first?.message ?? "Check the form and try again" });
  }

  const { currentPassword, newPassword } = parsed.data;

  /* Loaded again rather than trusting req.user, because the hash is the
     thing being checked and it must be the one on disk right now. */
  const user = await accountById(req.user.id).catch(() => null);
  if (!user) return res.status(401).json({ error: "Sign in to continue" });

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(400).json({
      error: "That isn't your current password",
      code: "current_password_wrong",
    });
  }

  if (verifyPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "That's the password you already have" });
  }

  if (tooCloseToTheAccount(newPassword, user)) {
    return res.status(400).json({ error: "Don't use your name or email address as your password" });
  }

  const changedAt = new Date();
  await saveAccount(user.id, {
    passwordHash: hashPassword(newPassword),
    passwordChangedAt: isDbConfigured() ? changedAt : changedAt.toISOString(),
  });
  await resets().burnAllFor(user.id);

  /* Every other session on this account is now dead — that is the point
     of the exercise, and it is why the dashboard says so on screen. This
     one is not: the token below is minted after the change, so the
     person who just typed their password is not thrown out of the tab
     they typed it in. */
  return res.json({
    ok: true,
    token: createToken({ sub: user.id, role: user.role }),
    signedOutElsewhere: true,
  });
}
