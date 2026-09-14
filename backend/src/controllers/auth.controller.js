import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import {
  specialists as specialistRepo,
  taxonomy as taxonomyRepo,
  users as userRepo,
} from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import {
  specialists as mockSpecialists,
  mockSpecialistsWithRelations,
  addDemoSpecialist,
  regulatorIdFromNumber,
} from "../data/mock.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { issueSession } from "../lib/sessions.js";
import { challengeFor, needsSecondFactor } from "./mfa.controller.js";
import { requestOrigin } from "../lib/requestIp.js";
import { entitlementsFor, getPlan, isPaidPlan } from "../lib/plans.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";
import { attachSpecialistId } from "../db/repos.js";

/**
 * Tell every admin a new application is waiting.
 *
 * Awaited rather than fired and forgotten: the in-app row is what makes
 * the queue visible, and a registration that silently fails to raise one
 * is an application nobody ever sees.
 */
async function announceApplication({ specialist, plan, planInterval }) {
  const admins = isDbConfigured()
    ? await userRepo.admins()
    : demoAccounts.all().filter((u) => u.role === "admin" && u.active);

  const planLabel = getPlan(plan).name;
  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.SIGNUP_PENDING,
    title: `New application: ${specialist.fullName}`,
    body:
      `${specialist.fullName} applied on ${planLabel}` +
      `${isPaidPlan(plan) ? ` (${planInterval}, unpaid until approved)` : ""}. ` +
      `Their profile is hidden from patients until you approve it.`,
    url: `/admin/verifications?status=pending&open=${specialist.id}`,
    subjectId: specialist.id,
    key: `${NOTIFICATION_TYPES.SIGNUP_PENDING}:${specialist.id}`,
  });
}

// The account shape the client gets. passwordHash is stripped here rather
// than anywhere else, so there is exactly one place to check.
function publicUser(user) {
  return {
    id: String(user.id ?? user._id),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    specialistId: user.specialistId ? String(user.specialistId) : user.specialist ? String(user.specialist) : null,
  };
}

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  title: z.string().max(160).optional().or(z.literal("")),
  registrationNumber: z.string().max(60).optional().or(z.literal("")),
  primarySpecialtySlug: z.string().max(120).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  // Chosen on the pricing page and carried through signup. A paid plan
  // does not charge anyone here: it records the intent and waits for
  // verification (see billing.controller.js).
  plan: z.enum(["basic", "premium", "clinwell"]).default("basic"),
  planInterval: z.enum(["monthly", "yearly"]).default("yearly"),
  // Fields only offered by the form when the chosen plan grants them.
  websiteUrl: z.string().max(300).optional().or(z.literal("")),
  bookingUrl: z.string().max(300).optional().or(z.literal("")),
  linkedin: z.string().max(300).optional().or(z.literal("")),
  instagram: z.string().max(300).optional().or(z.literal("")),
});

/**
 * POST /api/auth/register
 *
 * Creates the account AND a specialist profile in "pending" — never
 * "verified". Registration puts an application in the admin queue; it
 * does not put anyone on the platform. Only an admin approval does that
 * (see admin.controller.js).
 */
export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration", issues: parsed.error.issues });
  }
  const {
    fullName, email, password, title, registrationNumber, primarySpecialtySlug, phone,
    plan, planInterval, websiteUrl, bookingUrl, linkedin, instagram,
  } = parsed.data;

  // Anything the chosen plan does not grant is discarded here rather
  // than trusted from the client — a hand-crafted request must not be
  // able to smuggle Premium content onto a Basic listing.
  const granted = getPlan(plan).features;
  const socials =
    granted.websiteAndSocial && (linkedin || instagram)
      ? { linkedin: linkedin || null, instagram: instagram || null, x: null, facebook: null, youtube: null }
      : null;
  const siteUrl = granted.websiteAndSocial ? websiteUrl || null : null;
  const booking = granted.bookingLink ? bookingUrl || null : null;
  // Free tier is live as soon as it is approved; a paid tier waits for
  // verification and then for payment.
  const planStatus = isPaidPlan(plan) ? "pending_verification" : "active";

  if (!isDbConfigured()) {
    if (demoAccounts.findByEmail(email)) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    const specialist = addDemoSpecialist({
      fullName,
      title: title || null,
      contactEmail: email,
      contactPhone: phone || null,
      registrationNumber: registrationNumber || null,
      primarySpecialtySlug: primarySpecialtySlug || null,
      plan,
      planInterval,
      planStatus,
      websiteUrl: siteUrl,
      socials,
      bookingUrl: booking,
    });
    const signupDemo = requestOrigin(req);
    const user = demoAccounts.create({
      email,
      password,
      fullName,
      role: "specialist",
      signupIp: signupDemo.ip,
      signupCountry: signupDemo.country,
      lastLoginIp: signupDemo.ip,
      lastLoginCountry: signupDemo.country,
      lastLoginAt: new Date().toISOString(),
      specialistId: specialist.id,
    });
    await announceApplication({ specialist, plan, planInterval });

    const demoSession = await issueSession(req, user);
    return res.status(201).json({ token: demoSession.token, user: publicUser(user) });
  }

  const existing = await userRepo.findByEmail(email);
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });

  const slugBase = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = slugBase;
  for (let i = 2; await specialistRepo.slugExists(slug); i += 1) slug = `${slugBase}-${i}`;

  // Same first guess as the demo branch: map the number's prefix to a
  // regulator so the admin queue shows one, then let the admin confirm it.
  const code = String(registrationNumber ?? "").trim().toUpperCase();
  const regulatorCode = ["GMC", "GDC", "NMC", "HCPC"].find((c) => code.startsWith(c)) ?? null;
  const regulator = regulatorCode ? await taxonomyRepo.regulatorByCode(regulatorCode) : null;

  const primarySpecialty = primarySpecialtySlug
    ? await taxonomyRepo.specialtyBySlug(primarySpecialtySlug)
    : null;

  const now = new Date();
  /* Where this sign-up came from, kept on the account. It is the first
     thing an admin looks at when deciding whether a new listing is a
     real practice or a bot with a plausible name. */
  const signup = requestOrigin(req);
  const user = await userRepo.create({
    email,
    passwordHash: hashPassword(password),
    fullName,
    role: "specialist",
    signupIp: signup.ip,
    signupCountry: signup.country,
    lastLoginIp: signup.ip,
    lastLoginCountry: signup.country,
    lastLoginAt: now,
  });

  const specialist = await specialistRepo.create(
    {
      slug,
      fullName,
      userId: user.id,
      regulatorId: regulator?.id ?? null,
      primarySpecialtyId: primarySpecialty?.id ?? null,
      title: title || null,
      contactEmail: email,
      contactPhone: phone || null,
      registrationNumber: registrationNumber || null,
      plan,
      planInterval,
      planStatus,
      planSelectedAt: now,
      websiteUrl: siteUrl,
      socials: socials ?? {},
      bookingUrl: booking,
      verificationStatus: "pending",
      claimed: true,
      application: { submittedAt: now.toISOString(), notes: null, documents: [] },
      verificationHistory: [{ action: "submitted", byName: fullName, at: now.toISOString() }],
    },
    { specialtyIds: primarySpecialty ? [primarySpecialty.id] : [] }
  );

  user.specialistId = specialist.id;

  await announceApplication({
    specialist: { id: specialist.id, fullName: specialist.fullName },
    plan,
    planInterval,
  });

  const opened = await issueSession(req, user);
  res.status(201).json({ token: opened.token, user: publicUser(user) });
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/* What the browser gets when the password was right and a second factor
   is switched on. No token, and the shape is different enough from a
   successful sign-in that a client cannot mistake one for the other. */
function secondFactorNeeded(user) {
  return { mfaRequired: true, challenge: challengeFor(user) };
}

// POST /api/auth/login
export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  // Deliberately vague: distinguishing "no such account" from "wrong
  // password" tells an attacker which emails are registered.
  const invalid = () => res.status(401).json({ error: "Email or password is incorrect" });
  if (!parsed.success) return invalid();
  const { email, password } = parsed.data;

  if (!isDbConfigured()) {
    const user = demoAccounts.findByEmail(email);
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) return invalid();
    const originDemo = requestOrigin(req);
    demoAccounts.update(user.id, {
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: originDemo.ip,
      lastLoginCountry: originDemo.country,
    });
    if (needsSecondFactor(user)) return res.json(secondFactorNeeded(user));
    const demoOpened = await issueSession(req, user);
    return res.json({ token: demoOpened.token, user: publicUser(user) });
  }

  const user = await userRepo.findByEmail(email);
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) return invalid();

  /* The password was right, and that is now only half of it.
     Nothing is recorded as a sign-in yet and no session is opened —
     what comes back is a challenge, which deliberately cannot be used
     as a session token (see mfa.controller.js). */
  if (needsSecondFactor(user)) return res.json(secondFactorNeeded(user));

  /* Recorded on every sign-in, not just the first: the admin members
     list shows where the most recent session came from, which is what
     catches a shared or stolen account rather than a dubious sign-up. */
  const origin = requestOrigin(req);
  await userRepo.update(user.id, {
    lastLoginAt: new Date(),
    lastLoginIp: origin.ip,
    lastLoginCountry: origin.country,
  });
  await attachSpecialistId(user);
  const session = await issueSession(req, user);
  res.json({ token: session.token, user: publicUser(user) });
}

/**
 * GET /api/auth/me
 *
 * Returns the account plus just enough of the linked profile for the
 * dashboard shell to render (name, status, photo) without a second call.
 */
export async function me(req, res) {
  const user = req.user;
  const payload = { user: publicUser(user), specialist: null };

  /* Whose account is being worn, and by whom.
     The interface needs this to put a banner across the top: an
     administrator acting inside somebody else's dashboard must never be
     in any doubt about whose data they are looking at, because the
     mistake that follows from forgetting is editing the wrong profile.
     It comes from the signed token, not from anything the browser
     sends, so it cannot be hidden by the page. */
  if (req.impersonatorId) {
    payload.impersonation = {
      active: true,
      byUserId: req.impersonatorId,
      byName: req.impersonatorName ?? "An administrator",
    };
  }

  const specialistId = user.specialistId ?? user.specialist;
  if (specialistId) {
    if (!isDbConfigured()) {
      const s = mockSpecialistsWithRelations.find((x) => x.id === String(specialistId));
      if (s) {
        payload.specialist = {
          id: s.id,
          slug: s.slug,
          fullName: s.fullName,
          title: s.title,
          photoUrl: s.photoUrl,
          verificationStatus: s.verificationStatus,
          ...planSummary(s),
        };
      }
    } else {
      const s = await specialistRepo.rawById(String(specialistId));
      if (s) {
        payload.specialist = {
          id: s.id,
          slug: s.slug,
          fullName: s.fullName,
          title: s.title ?? null,
          photoUrl: s.photoUrl ?? null,
          verificationStatus: s.verificationStatus,
          ...planSummary(s),
        };
      }
    }
  }

  res.json(payload);
}

/** The plan facts the shell needs, without leaking the whole matrix. */
function planSummary(s) {
  const ent = entitlementsFor(s);
  return {
    plan: ent.effectivePlan,
    planName: ent.effectivePlanName,
    selectedPlan: ent.selectedPlan,
    planStatus: ent.planStatus,
    awaitingActivation: ent.awaitingActivation,
    features: ent.features,
  };
}

// Convenience for the demo: which logins exist. Demo mode only — it would
// be an account-enumeration hole against a real database.
export function demoCredentials(req, res) {
  /* Against a real database there are no demo logins to hand out — but
     the answer is an empty list rather than a 404. The sign-in page asks
     this on every visit, and a 404 there is a red line in the browser
     console of a perfectly healthy production site, which is exactly the
     kind of noise that hides a real error later. */
  if (isDbConfigured()) return res.json({ accounts: [] });
  res.json({
    accounts: demoAccounts.all().map((u) => ({ email: u.email, role: u.role, password: "demo1234" })),
  });
}

export { publicUser, mockSpecialists };
