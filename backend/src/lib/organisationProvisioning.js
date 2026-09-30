/* ------------------------------------------------------------------ *
 * Organisation login provisioning
 *
 * An organisation's application becomes "won" the moment they pay (see
 * billing.controller.js's webhook), but paying does not by itself give
 * anybody a way to sign in. Somebody has to exist to sign in AS: an
 * account, linked to the listing the subscription was bought for, with
 * a password they get to choose.
 *
 * That is what this file does, and it is deliberately the same shape as
 * an imported listing's "shell account" (see lib/auth.js's
 * UNUSABLE_PASSWORD) — an account that exists and owns a profile, but
 * that nobody has ever set a password on. The difference is who is
 * meant to claim it: an imported listing waits for its owner to find it
 * and go through /claims; an organisation that just paid already IS the
 * owner, so there is no claim to review — we mail them a link straight
 * away.
 *
 * Called from two places, and both must be able to call it twice
 * without it doing the wrong thing:
 *
 *   - the payment webhook, which retries a delivery it is not sure
 *     landed, and must not create a second account for a specialist
 *     that already has one;
 *   - the admin "create login" / "resend welcome email" button, which
 *     exists specifically so somebody can ask for the email again.
 *
 * So the account is created once — after that, every call is just "mint
 * a fresh link and mail it".
 * ------------------------------------------------------------------ */
import { isDbConfigured } from "../config/db.js";
import { adminAudit, passwordResets as resetRepo, specialists as specialistRepo, users as userRepo } from "../db/repos.js";
import { UNUSABLE_PASSWORD } from "./auth.js";
import { sendMail } from "./mailer.js";
import { clientIp } from "./requestIp.js";
import { hashToken, mintToken, TOKEN_TTL_MS } from "../controllers/password.controller.js";

import { siteUrl } from "./urls.js";
const SITE_URL = siteUrl();

/**
 * Same copy job as password.controller.js's buildResetEmail, but this
 * link is not resetting anything — nothing has been set yet — so it
 * says so, and introduces the dashboard rather than assuming they know
 * it exists.
 */
function buildOrganisationWelcomeEmail({ user, application, url }) {
  return {
    to: user.email,
    subject: `Set up your login — ${application.organisationName} on Top Local Specialists`,
    text: [
      `Hello ${user.fullName?.split(" ")[0] ?? "there"},`,
      "",
      `${application.organisationName} is now set up on Top Local Specialists. Set a password to`,
      "finish signing in and manage your listing:",
      "",
      url,
      "",
      "The link works once and expires in an hour — ask us to resend it if it goes stale.",
      "",
      "Once you're in, your dashboard is where you keep your listing up to date and see how",
      "you're being found.",
      "",
      "Top Local Specialists",
    ].join("\n"),
  };
}

/**
 * Mint a single-use password-set link and mail it. The same mechanism
 * forgotPassword uses (lib/reset tokens, /reset-password on the
 * frontend) — deliberately not routed through forgotPassword itself,
 * because that endpoint refuses to mail a shell account (usablePassword
 * check) and a freshly provisioned account is exactly that until this
 * link is used.
 */
async function sendSetPasswordLink(user, application) {
  const token = mintToken();
  await resetRepo.create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestedIp: null,
  });
  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;

  /* Best-effort, like every other mail send in this codebase: a mail
     provider having a bad afternoon must not fail the payment that
     triggered this, or the admin action that asked for a resend. */
  await sendMail(buildOrganisationWelcomeEmail({ user, application, url })).catch(() => null);
}

/**
 * Give an organisation's application a working login on the listing
 * its payment activated.
 *
 * Idempotent: safe to call on a webhook retry, and safe to call again
 * from the admin "resend welcome email" button — the account is
 * created at most once, and the email is sent every time.
 */
export async function provisionOrganisationLogin(application, specialist, { req = null } = {}) {
  const alreadyHadLogin = Boolean(specialist.userId);

  let user;
  if (alreadyHadLogin) {
    user = await userRepo.findById(specialist.userId);
  } else {
    user = await userRepo.create({
      email: application.contactEmail,
      /* Not a real hash — see lib/auth.js's usablePassword and the
         "shell account" comment above it. No password exists yet;
         sendSetPasswordLink below is what lets them choose one. */
      passwordHash: UNUSABLE_PASSWORD,
      fullName: application.contactName || application.organisationName,
      role: "specialist",
    });

    await specialistRepo.update(specialist.id, {
      userId: user.id,
      // Only filled in where the listing does not already say something
      // more specific — an admin may have already set these by hand
      // while the application was being quoted.
      ...(specialist.claimed ? {} : { claimed: true }),
      ...(specialist.contactEmail ? {} : { contactEmail: application.contactEmail }),
    });
  }

  if (user) await sendSetPasswordLink(user, application);

  if (isDbConfigured()) {
    await adminAudit.record({
      actorUserId: req?.user?.id ?? null,
      actorName: req?.user?.fullName ?? "System",
      actorEmail: req?.user?.email ?? null,
      ip: req ? clientIp(req) : null,
      action: "organisation.login_provisioned",
      subjectType: "organisation_application",
      subjectId: application.id,
      subjectLabel: `${application.organisationName} <${application.contactEmail}>`,
      detail: { specialistId: specialist.id, alreadyHadLogin },
    });
  }

  return { alreadyHadLogin, userId: user?.id ?? specialist.userId ?? null };
}
