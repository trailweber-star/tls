/* ------------------------------------------------------------------ *
 * Sub-Accounts & Multi-Practice Profiles
 *
 * Premium and the Full Practice Suite advertise this on the pricing
 * page (lib/plans.js's subAccounts flag) -- a specialist can bring a
 * practice manager or receptionist into the dashboard without handing
 * over their own login. Until this file, nothing behind that promise
 * existed at all: no table, no invite, nothing to gate.
 *
 * The shape deliberately mirrors lib/organisationProvisioning.js's
 * shell-account pattern: create a user with no usable password, mail a
 * single-use link that lets them set one. The difference is what the
 * account administers -- specialistTeamMembers links it to someone
 * ELSE's listing instead of creating its own.
 *
 * Scope, on purpose: this only covers inviting someone who has no
 * account yet, which is the common case (a practice manager signing in
 * for the first time). An email that already belongs to an account is
 * refused with a clear reason rather than silently granting that
 * existing account access to a listing it never asked to join --
 * accepting an invite onto an account you did not just create for that
 * purpose needs its own confirmation step, which is a real but separate
 * piece of work.
 * ------------------------------------------------------------------ */
import {
  specialistTeamMembers as teamRepo,
  users as userRepo,
} from "../db/repos.js";
import { passwordResets as resetRepo } from "../db/repos.js";
import { UNUSABLE_PASSWORD } from "./auth.js";
import { sendMail } from "./mailer.js";
import { hashToken, mintToken, TOKEN_TTL_MS } from "../controllers/password.controller.js";
import { siteUrl } from "./urls.js";

const SITE_URL = siteUrl();

function buildTeamInviteEmail({ user, specialistName, inviterName, url }) {
  return {
    to: user.email,
    subject: `You've been added to ${specialistName}'s team on Top Local Specialists`,
    text: [
      `Hello,`,
      ``,
      `${inviterName} has added you to help manage ${specialistName}'s listing on Top Local Specialists.`,
      `Set a password to finish signing in and get started:`,
      ``,
      url,
      ``,
      `The link works once and expires in an hour -- ask ${inviterName} to resend the invite from their`,
      `dashboard's Team page if it goes stale.`,
      ``,
      `Once you're in, you'll see the same dashboard ${inviterName} does -- enquiries, messages, reviews and`,
      `the profile itself -- but not the plan or billing, which stays with the account that invited you.`,
      ``,
      `Top Local Specialists`,
    ].join("\n"),
  };
}

async function sendTeamInviteLink(user, specialistName, inviterName) {
  const token = mintToken();
  await resetRepo.create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestedIp: null,
  });
  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail(buildTeamInviteEmail({ user, specialistName, inviterName, url })).catch(() => null);
}

/**
 * Invite someone onto a specialist's listing. Returns { ok: true, member }
 * or { ok: false, reason }, never throws for an expected refusal --
 * only for something the caller genuinely could not have predicted.
 */
export async function inviteTeamMember({ specialist, email, role, inviterName }) {
  const normalizedEmail = String(email).toLowerCase().trim();

  const existingUser = await userRepo.findByEmail(normalizedEmail);
  if (existingUser) {
    return { ok: false, reason: "email_in_use" };
  }

  const user = await userRepo.create({
    email: normalizedEmail,
    // Not a real hash -- see lib/auth.js's UNUSABLE_PASSWORD and the
    // "shell account" comment on organisationProvisioning.js. No
    // password exists yet; sendTeamInviteLink is what lets them choose
    // one.
    passwordHash: UNUSABLE_PASSWORD,
    fullName: normalizedEmail.split("@")[0],
    role: "specialist",
  });

  const member = await teamRepo.create({
    specialistId: specialist.id,
    userId: user.id,
    invitedEmail: normalizedEmail,
    role: role?.trim() || null,
    // Accepted immediately: this account was created FOR this
    // membership and administers nothing else, so there is no other
    // account it could be mistaken for -- unlike inviting an email
    // that already has one, which this function already refused above.
    acceptedAt: new Date(),
  });

  await sendTeamInviteLink(user, specialist.fullName, inviterName);

  return { ok: true, member: { ...member, email: normalizedEmail } };
}

export async function removeTeamMember(specialistId, userId) {
  await teamRepo.remove(specialistId, userId);
}
