/* ------------------------------------------------------------------ *
 * The account itself: where you are signed in, and what address you
 * sign in with.
 *
 * ------------------------------------------------------------------ *
 * DEVICES
 *
 * A list is only worth having if it is complete and if the button next
 * to each row does something. Both come from sessions being real rows
 * now (see lib/sessions.js): every token has one, the middleware reads
 * it on every request, and revoking it ends that session on the next
 * request rather than whenever its token would have expired.
 *
 * Two things are deliberately shown that a tidier list would hide. A
 * support session is labelled as one, with the administrator's name on
 * it — somebody whose account was entered should be able to see that it
 * was. And the row the request came from is marked "this device", so
 * "sign out the others" is a button nobody has to think twice about.
 *
 * ------------------------------------------------------------------ *
 * EMAIL CHANGES
 *
 * Three gates, and each one closes a door the others leave open.
 *
 * The current password starts it, so a minute at an unlocked laptop is
 * not enough. The NEW address must confirm, so the account cannot be
 * pointed at an address nobody reads. And the OLD address must approve,
 * which is the one the usual design leaves out — without it, taking
 * over an account is: open the laptop, change the email, confirm from
 * your own mailbox, and the owner finds out when they cannot sign in.
 * The message to the old address carries the cancel link too, so the
 * answer to "this wasn't me" is one click rather than a support ticket.
 * ------------------------------------------------------------------ */

import crypto from "node:crypto";
import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { emailChanges as emailChangeRepo, users as userRepo } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { verifyPassword } from "../lib/auth.js";
import {
  describeDevice,
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "../lib/sessions.js";
import { requestOrigin } from "../lib/requestIp.js";
import { sendMail } from "../lib/mailer.js";

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

/* A day. Long enough to reach an address somebody only checks in the
   evening; short enough that a half-finished change is not still open
   next week. */
const CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

const hashToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const mintToken = () => crypto.randomBytes(32).toString("base64url");

const accountById = async (id) => (isDbConfigured() ? userRepo.findById(id) : demoAccounts.findById(id));
const accountByEmail = async (email) =>
  isDbConfigured() ? userRepo.findByEmail(email) : demoAccounts.findByEmail(email);
const saveAccount = async (id, patch) =>
  isDbConfigured() ? userRepo.update(id, patch) : demoAccounts.update(id, patch);

/* ================================================= signed-in devices */

/** The shape the account screen renders. Never the raw row. */
function publicSession(row, currentId) {
  const device = describeDevice(row.userAgent);
  return {
    id: row.id,
    current: row.id === currentId,
    label: device.label,
    browser: device.browser,
    platform: device.platform,
    /* Shown as given. A city would be a guess, and a wrong city on this
       screen is worse than no city — it is the line somebody would act
       on. */
    ip: row.ip ?? null,
    country: row.country ?? null,
    /* Set when an administrator opened this while wearing the account. */
    support: Boolean(row.actorUserId),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

// GET /api/auth/sessions
export async function getSessions(req, res) {
  const rows = await listSessions(String(req.user.id));
  const currentId = req.session?.id ?? null;

  res.json({
    results: rows.map((row) => publicSession(row, currentId)),
    /* A session opened before sessions had rows. It works, and it is
       real, but there is nothing to list — so the screen says so rather
       than showing an empty list to somebody who is plainly signed in. */
    currentIsListed: Boolean(currentId),
  });
}

// DELETE /api/auth/sessions/:id
export async function endSession(req, res) {
  const { id } = req.params;

  /* Only your own. The id is checked against the account's live
     sessions rather than revoked by id directly — otherwise anybody
     holding a session could end a stranger's by guessing an id. */
  const mine = await listSessions(String(req.user.id));
  const target = mine.find((row) => row.id === id);
  if (!target) return res.status(404).json({ error: "That session has already ended." });

  await revokeSession(id, "signed out from another device");

  res.json({
    ok: true,
    /* Ending the session you are asking from is allowed — it is just
       signing out — but the browser needs to know to drop its token
       rather than carry on and be refused on the next call. */
    endedCurrent: req.session?.id === id,
  });
}

// POST /api/auth/sessions/revoke-others
export async function endOtherSessions(req, res) {
  const count = await revokeOtherSessions(
    String(req.user.id),
    req.session?.id ?? null,
    "signed out from another device"
  );
  res.json({ ok: true, ended: count });
}

// POST /api/auth/logout
export async function logout(req, res) {
  /* The browser dropping its token is not the same as the session
     ending: without this the row stays live for a week and shows up in
     the member's own device list as a phantom they cannot place. */
  if (req.session?.id) await revokeSession(req.session.id, "signed out");
  res.json({ ok: true });
}

/* ==================================================== email changes */

const startSchema = z.object({
  newEmail: z.string().email("That doesn't look like an email address"),
  currentPassword: z.string().min(1, "Enter your current password"),
});

/** What the account screen shows about a change in flight. */
function publicChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    newEmail: row.newEmail,
    oldEmail: row.oldEmail,
    newConfirmed: Boolean(row.newConfirmedAt),
    oldConfirmed: Boolean(row.oldConfirmedAt),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/* Demo mode keeps requests in memory. Same shape as the repo so nothing
   below branches on which it is. */
const demoChanges = new Map();
let demoSeq = 0;
const demoChangeStore = {
  async create(input) {
    const row = {
      id: `ecr-${++demoSeq}`,
      newConfirmedAt: null,
      oldConfirmedAt: null,
      appliedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: new Date(),
      ...input,
    };
    demoChanges.set(row.id, row);
    return row;
  },
  async openFor(userId) {
    return (
      [...demoChanges.values()].find((r) => r.userId === userId && !r.appliedAt && !r.cancelledAt) ?? null
    );
  },
  async findByAnyToken(hash) {
    return (
      [...demoChanges.values()].find(
        (r) => r.newTokenHash === hash || r.oldTokenHash === hash || r.cancelTokenHash === hash
      ) ?? null
    );
  },
  async update(id, patch) {
    const row = demoChanges.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  },
};

const changes = () => (isDbConfigured() ? emailChangeRepo : demoChangeStore);

/* ------------------------------------------------------------- mail */

function buildConfirmNewEmail({ user, newEmail, url }) {
  return {
    to: newEmail,
    subject: "Confirm your new Top Local Specialists email address",
    text: [
      `Hello ${user.fullName?.split(" ")[0] ?? "there"},`,
      "",
      `Somebody asked to move the Top Local Specialists account currently`,
      `registered to ${user.email} over to this address.`,
      "",
      "If that was you, confirm it here:",
      "",
      url,
      "",
      "We've also asked the old address to approve the change. Nothing",
      "moves until both have confirmed, and the link expires in 24 hours.",
      "",
      "If you weren't expecting this, ignore this message — without the",
      "old address approving it as well, the change cannot go ahead.",
      "",
      "Top Local Specialists",
    ].join("\n"),
  };
}

function buildApproveOldEmail({ user, newEmail, approveUrl, cancelUrl }) {
  return {
    to: user.email,
    subject: "Approve the email change on your Top Local Specialists account",
    text: [
      `Hello ${user.fullName?.split(" ")[0] ?? "there"},`,
      "",
      `Somebody signed in to your account and asked to change its email`,
      `address to ${newEmail}.`,
      "",
      "If that was you, approve it here:",
      "",
      approveUrl,
      "",
      "IF IT WAS NOT YOU, cancel it here — and change your password,",
      "because whoever did this could sign in to your account:",
      "",
      cancelUrl,
      "",
      "Nothing changes until both this address and the new one confirm.",
      "The links expire in 24 hours.",
      "",
      "Top Local Specialists",
    ].join("\n"),
  };
}

function buildChangedEmail({ to, oldEmail, newEmail }) {
  return {
    to,
    subject: "Your Top Local Specialists email address has changed",
    text: [
      `The email address on your Top Local Specialists account has been`,
      `changed from ${oldEmail} to ${newEmail}.`,
      "",
      "You now sign in with the new address. Your password has not changed.",
      "",
      "If this is a surprise, reply to this message immediately.",
      "",
      "Top Local Specialists",
    ].join("\n"),
  };
}

/* ----------------------------------------------------------- start */

// POST /api/auth/email-change
export async function startEmailChange(req, res) {
  /* A borrowed session must not be able to move somebody's address —
     that is account takeover with an audit trail pointing at the
     member. */
  if (req.impersonatorId) {
    return res.status(403).json({
      error: "You're signed in as a member. Only the account's owner can change its email address.",
      code: "impersonating",
    });
  }

  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again" });
  }

  const newEmail = parsed.data.newEmail.toLowerCase().trim();
  const user = await accountById(String(req.user.id));
  if (!user) return res.status(401).json({ error: "Sign in to continue" });

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: "That isn't your current password", code: "current_password_wrong" });
  }

  if (newEmail === String(user.email).toLowerCase()) {
    return res.status(400).json({ error: "That's the address you already use" });
  }

  /* This does tell a signed-in member whether an address is registered
     here. It is an enumeration answer, and a smaller one than it looks:
     it costs an account and a password to ask, one address at a time.
     The alternative — accepting the request and letting it silently
     never complete — would leave a legitimate member staring at a
     change that never arrives with no way to find out why. */
  const taken = await accountByEmail(newEmail);
  if (taken) return res.status(409).json({ error: "That address is already on another account" });

  /* One request open at a time. Starting a new one supersedes the old,
     so a mistyped address is corrected by asking again rather than by
     waiting a day for it to expire. */
  const open = await changes().openFor(String(user.id));
  if (open) await changes().update(open.id, { cancelledAt: new Date(), cancelledBy: "superseded" });

  const newToken = mintToken();
  const oldToken = mintToken();
  const cancelToken = mintToken();
  const origin = requestOrigin(req);

  const row = await changes().create({
    userId: String(user.id),
    newEmail,
    oldEmail: String(user.email),
    newTokenHash: hashToken(newToken),
    oldTokenHash: hashToken(oldToken),
    cancelTokenHash: hashToken(cancelToken),
    expiresAt: new Date(Date.now() + CHANGE_TTL_MS),
    requestedIp: origin.ip,
  });

  const link = (token) => `${SITE_URL}/confirm-email?token=${encodeURIComponent(token)}`;

  await sendMail(buildConfirmNewEmail({ user, newEmail, url: link(newToken) })).catch(() => null);
  await sendMail(
    buildApproveOldEmail({ user, newEmail, approveUrl: link(oldToken), cancelUrl: link(cancelToken) })
  ).catch(() => null);

  res.status(201).json({
    ok: true,
    request: publicChange(row),
    ...devLinks(req, { confirm: link(newToken), approve: link(oldToken), cancel: link(cancelToken) }),
  });
}

/* The same development-only fence as the password reset: no mail
   provider, not production, and the request came from the machine the
   server is running on. Without it the flow cannot be walked on a
   laptop at all, since it needs two mailboxes. */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function devLinks(req, links) {
  if (req.headers?.["x-forwarded-for"] || req.headers?.["forwarded"]) return {};
  if (!LOOPBACK.has(String(req.socket?.remoteAddress ?? "").trim())) return {};
  if (process.env.NODE_ENV === "production") return {};
  if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) return {};
  return { devLinks: links };
}

// GET /api/auth/email-change
export async function getEmailChange(req, res) {
  const row = await changes().openFor(String(req.user.id));
  /* An expired request is reported as no request. It cannot be
     completed, and showing it as pending would leave somebody waiting
     for an email that will never work. */
  if (row && new Date(row.expiresAt).getTime() <= Date.now()) return res.json({ request: null });
  res.json({ request: publicChange(row) });
}

// DELETE /api/auth/email-change
export async function cancelEmailChange(req, res) {
  const row = await changes().openFor(String(req.user.id));
  if (!row) return res.status(404).json({ error: "There's no email change waiting." });
  await changes().update(row.id, { cancelledAt: new Date(), cancelledBy: "owner" });
  res.json({ ok: true });
}

/* -------------------------------------------------- redeem a link */

const tokenSchema = z.object({ token: z.string().min(10).max(400) });

/**
 * POST /api/auth/email-change/confirm
 *
 * One endpoint for all three links. Which one was clicked is worked out
 * by comparing the hash against the row — the browser is not asked
 * which kind of link it holds, because it would be free to lie.
 */
export async function confirmEmailChange(req, res) {
  const parsed = tokenSchema.safeParse(req.body);
  const dead = () =>
    res.status(400).json({
      error: "That link has expired or has already been used.",
      code: "link_dead",
    });
  if (!parsed.success) return dead();

  const hash = hashToken(parsed.data.token);
  const row = await changes().findByAnyToken(hash);
  if (!row) return dead();
  if (row.appliedAt || row.cancelledAt) return dead();
  if (new Date(row.expiresAt).getTime() <= Date.now()) return dead();

  /* --------------------------------------------------------- cancel */
  if (hash === row.cancelTokenHash) {
    await changes().update(row.id, { cancelledAt: new Date(), cancelledBy: "old address" });
    return res.json({ ok: true, outcome: "cancelled" });
  }

  const patch =
    hash === row.newTokenHash
      ? { newConfirmedAt: row.newConfirmedAt ?? new Date() }
      : { oldConfirmedAt: row.oldConfirmedAt ?? new Date() };
  const side = hash === row.newTokenHash ? "new" : "old";

  const updated = await changes().update(row.id, patch);
  if (!updated) return dead();

  /* Both, or nothing. Either half on its own is a confirmation that
     somebody controls one mailbox, which is exactly what was already
     assumed about them. */
  if (!updated.newConfirmedAt || !updated.oldConfirmedAt) {
    return res.json({
      ok: true,
      outcome: "waiting",
      side,
      waitingOn: updated.newConfirmedAt ? "the old address" : "the new address",
      newEmail: updated.newEmail,
    });
  }

  /* --------------------------------------------------------- apply */

  /* Re-checked at the last moment: a day may have passed since the
     request was made, and the address could have been registered by
     somebody else in between. */
  const clash = await accountByEmail(updated.newEmail);
  if (clash && String(clash.id) !== String(updated.userId)) {
    await changes().update(updated.id, { cancelledAt: new Date(), cancelledBy: "address taken" });
    return res.status(409).json({
      error: "That address has been registered on another account since this change was requested.",
      code: "address_taken",
    });
  }

  await saveAccount(updated.userId, { email: updated.newEmail });
  await changes().update(updated.id, { appliedAt: new Date() });

  /* Both addresses are told, including the one that no longer works.
     The old mailbox is where somebody would notice a change they did
     not make, so it is the more important of the two. */
  await sendMail(
    buildChangedEmail({ to: updated.oldEmail, oldEmail: updated.oldEmail, newEmail: updated.newEmail })
  ).catch(() => null);
  await sendMail(
    buildChangedEmail({ to: updated.newEmail, oldEmail: updated.oldEmail, newEmail: updated.newEmail })
  ).catch(() => null);

  res.json({ ok: true, outcome: "applied", newEmail: updated.newEmail });
}
