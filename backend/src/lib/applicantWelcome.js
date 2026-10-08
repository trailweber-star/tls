import { getPlan } from "./plans.js";
import { profileCompletion } from "../controllers/dashboard.controller.js";

/**
 * The email an applicant gets asking for their registration certificate
 * and telling them what is left on their profile. Built from that
 * applicant's own record, so each person sees their own name and their
 * own remaining items. Used at signup (auth.controller.js) and by the
 * one-off reminder script (scripts/remind-pending-applicants.mjs).
 */
export function regulatorFromNumber(registrationNumber) {
  const value = String(registrationNumber ?? "").trim().toUpperCase();
  return ["GMC", "GDC", "NMC", "HCPC"].find((c) => value.startsWith(c)) ?? null;
}

export function applicantWelcomeBody({ specialist, plan, regulatorCode = null, intro = null }) {
  const certificate = regulatorCode
    ? `${regulatorCode} registration certificate`
    : "professional registration certificate (GMC, GDC, NMC or HCPC)";

  let completion = { percent: 0, missing: [] };
  try {
    completion = profileCompletion(specialist);
  } catch {
    // fall through with an empty list
  }
  const missing = completion.missing ?? [];
  const profileSection = missing.length
    ? `Your profile is ${completion.percent}% complete. Patients find and choose specialists with full profiles far more easily, so adding these will help them find you:\n` +
      missing.map((m) => `- ${m.label}`).join("\n") +
      `\n\nSign in to your dashboard and choose Update profile to add them. `
    : `Your profile is complete, which will help patients find you. You can sign in to your dashboard at any time to keep it up to date. `;

  return (
    `Hi ${specialist.fullName},\n\n` +
    (intro ??
      `Thanks for applying to Top Local Specialists on the ${getPlan(plan).name} plan. ` +
        `Your profile stays hidden from patients until our team has checked it by hand and approved it.\n\n`) +
    `To speed that up, please reply to this email with:\n` +
    `1. A copy of your ${certificate}.\n` +
    `2. Your practice location, if the address you entered has changed or you work at more than one site.\n\n` +
    profileSection +
    `We'll email you as soon as you are approved.`
  );
}
