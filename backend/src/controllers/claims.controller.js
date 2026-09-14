import crypto from "node:crypto";
import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { asc, desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { claims as claimsTable } from "../db/schema.js";
import { specialists as specialistRepo, users as userRepo } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { mockSpecialistsWithRelations, updateDemoSpecialist } from "../data/mock.js";
import { issueSession } from "../lib/sessions.js";
import { hashPassword } from "../lib/auth.js";
import { getPlan, isPaidPlan } from "../lib/plans.js";
import { sendMail } from "../lib/mailer.js";
import { NOTIFICATION_TYPES, notificationStore, notifyAdmins } from "../lib/notifications.js";

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

/* ------------------------------------------------------------------ *
 * Claiming a listing
 *
 * Most profiles in a directory this size were not created by the person
 * they describe — they were compiled from public registers. Claiming is
 * how the real clinician takes ownership of one, and it is a different
 * problem from signing up:
 *
 *   - The profile already exists, with reviews and a rating attached.
 *     Registering fresh would abandon all of that and leave a duplicate,
 *     so claiming has to be the obviously better path.
 *   - The risk is impersonation, not authenticity. So the proof we ask
 *     for is the registration number already recorded against the
 *     listing: someone who can state it is overwhelmingly likely to be
 *     the registrant. A mismatch does not block the claim — it flags it
 *     loudly for the admin, because our own record may simply be wrong.
 *
 * Either way a human decides. Nothing here transfers ownership on its
 * own.
 * ------------------------------------------------------------------ */

const claims = [];

const isoDates = (row) =>
  row
    ? {
        ...row,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        decidedAt: row.decidedAt instanceof Date ? row.decidedAt.toISOString() : row.decidedAt ?? null,
      }
    : null;

/**
 * Rows when a database is configured, memory in demo mode. Claims used
 * to live only in memory, so a restart silently dropped every pending
 * request to take ownership of a listing.
 */
export const claimStore = {
  async create(row) {
    if (!isDbConfigured()) {
      claims.push(row);
      return row;
    }
    const { createdAt, ...rest } = row;
    const [saved] = await getDb().insert(claimsTable).values(rest).returning();
    return isoDates(saved);
  },

  async find(id) {
    if (!isDbConfigured()) return claims.find((c) => c.id === id) ?? null;
    const [row] = await getDb().select().from(claimsTable).where(eq(claimsTable.id, id)).limit(1);
    return isoDates(row);
  },

  async pendingForSpecialist(specialistId) {
    if (!isDbConfigured()) {
      return claims.find((c) => c.specialistId === specialistId && c.status === "pending") ?? null;
    }
    const [row] = await getDb()
      .select()
      .from(claimsTable)
      .where(and(eq(claimsTable.specialistId, specialistId), eq(claimsTable.status, "pending")))
      .orderBy(asc(claimsTable.createdAt))
      .limit(1);
    return isoDates(row);
  },

  async byStatus(status) {
    if (!isDbConfigured()) {
      return claims
        .filter((c) => c.status === status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    const rows = await getDb()
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.status, status))
      .orderBy(desc(claimsTable.createdAt));
    return rows.map(isoDates);
  },

  async counts() {
    if (!isDbConfigured()) {
      return ["pending", "approved", "rejected"].reduce((acc, s) => {
        acc[s] = claims.filter((c) => c.status === s).length;
        return acc;
      }, {});
    }
    const rows = await getDb()
      .select({ status: claimsTable.status, count: sql`count(*)::int` })
      .from(claimsTable)
      .groupBy(claimsTable.status);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    return { pending: 0, approved: 0, rejected: 0, ...byStatus };
  },

  async update(id, patch) {
    if (!isDbConfigured()) {
      const row = claims.find((c) => c.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    }
    const next = { ...patch };
    if (next.decidedAt && !(next.decidedAt instanceof Date)) next.decidedAt = new Date(next.decidedAt);
    const [row] = await getDb().update(claimsTable).set(next).where(eq(claimsTable.id, id)).returning();
    return isoDates(row);
  },
};

async function loadSpecialist(idOrSlug, { bySlug = false } = {}) {
  if (!isDbConfigured()) {
    return (
      mockSpecialistsWithRelations.find((s) => (bySlug ? s.slug === idOrSlug : s.id === idOrSlug)) ?? null
    );
  }
  return bySlug ? specialistRepo.findBySlug(idOrSlug) : specialistRepo.findById(idOrSlug);
}

async function loadAdmins() {
  if (!isDbConfigured()) return demoAccounts.all().filter((u) => u.role === "admin" && u.active);
  return userRepo.admins();
}

/** Registration numbers are compared loosely: "GMC 7012345" == "7012345". */
function normaliseRegistration(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^(GMC|GDC|NMC|HCPC)/, "");
}

/* ------------------------------------------------------------------ *
 * Public: is this listing claimable?
 * ------------------------------------------------------------------ */

// GET /api/claims/eligibility/:slug
export async function claimEligibility(req, res) {
  const specialist = await loadSpecialist(req.params.slug, { bySlug: true });
  if (!specialist) return res.status(404).json({ error: "Specialist not found" });

  const pending = await claimStore.pendingForSpecialist(specialist.id);

  res.json({
    slug: specialist.slug,
    fullName: specialist.fullName,
    title: specialist.title ?? null,
    photoUrl: specialist.photoUrl ?? null,
    primarySpecialty: specialist.primarySpecialty?.name ?? null,
    // What they stand to inherit — the reason to claim rather than
    // start a second, empty profile.
    ratingAvg: specialist.ratingAvg ?? 0,
    ratingCount: specialist.ratingCount ?? 0,
    reviewCount: (specialist.reviews ?? []).length,
    claimable: !specialist.claimed && !pending,
    claimed: Boolean(specialist.claimed),
    claimPending: Boolean(pending),
    // Never say WHICH regulator body or number we hold — that would turn
    // this endpoint into a lookup service for impersonators.
    requiresRegistrationNumber: Boolean(specialist.registrationNumber),
  });
}

/* ------------------------------------------------------------------ *
 * Submit a claim
 * ------------------------------------------------------------------ */

const claimSchema = z.object({
  slug: z.string().min(1).max(160),
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  registrationNumber: z.string().min(2).max(60),
  phone: z.string().max(50).optional().or(z.literal("")),
  message: z.string().max(1000).optional().or(z.literal("")),
  plan: z.enum(["basic", "premium", "clinwell"]).default("basic"),
  planInterval: z.enum(["monthly", "yearly"]).default("yearly"),
});

/**
 * POST /api/claims
 *
 * Creates the claim and the account together, but the account is not
 * linked to the profile until an admin approves — so the claimant can
 * sign in and watch progress without controlling anything.
 */
export async function submitClaim(req, res) {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid claim", issues: parsed.error.issues });
  const { slug, fullName, email, password, registrationNumber, phone, message, plan, planInterval } = parsed.data;

  const specialist = await loadSpecialist(slug, { bySlug: true });
  if (!specialist) return res.status(404).json({ error: "Specialist not found" });
  if (specialist.claimed) return res.status(409).json({ error: "This profile has already been claimed" });
  if (await claimStore.pendingForSpecialist(specialist.id)) {
    return res.status(409).json({ error: "A claim on this profile is already being reviewed" });
  }

  // One account per email, whether it arrived by signup or by claim.
  const existing = isDbConfigured()
    ? await userRepo.findByEmail(email)
    : demoAccounts.findByEmail(email);
  if (existing) {
    return res.status(409).json({
      error: "An account with that email already exists. Sign in first, then claim from your dashboard.",
    });
  }

  const onFile = normaliseRegistration(specialist.registrationNumber);
  const supplied = normaliseRegistration(registrationNumber);
  // The whole verification signal, in one boolean. A match is strong
  // evidence; a mismatch is a reason to look harder, not to refuse.
  const registrationMatches = Boolean(onFile) && onFile === supplied;

  const user = isDbConfigured()
    ? await userRepo.create({
        email,
        passwordHash: hashPassword(password),
        fullName,
        role: "specialist",
      })
    : demoAccounts.create({ email, password, fullName, role: "specialist", specialistId: null });

  const userId = String(user.id ?? user._id);

  const claim = await claimStore.create({
    id: `clm_${crypto.randomBytes(8).toString("hex")}`,
    specialistId: specialist.id,
    specialistSlug: specialist.slug,
    specialistName: specialist.fullName,
    userId,
    fullName,
    email: email.toLowerCase(),
    phone: phone || null,
    registrationNumber,
    registrationMatches,
    message: message || null,
    plan,
    planInterval,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    note: null,
    createdAt: new Date().toISOString(),
  });

  const admins = await loadAdmins();
  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.CLAIM_PENDING,
    title: `Profile claim: ${specialist.fullName}`,
    body:
      `${fullName} says this listing is theirs. Registration number ` +
      `${registrationMatches ? "matches our record" : "does NOT match our record — check carefully"}.`,
    url: `/admin/verifications?tab=claims&open=${claim.id}`,
    subjectId: claim.id,
    key: `${NOTIFICATION_TYPES.CLAIM_PENDING}:${claim.id}`,
  });

  await sendMail({
    to: email,
    subject: `We've received your claim for ${specialist.fullName}`,
    text: [
      `Thank you — we've received your claim on the profile for ${specialist.fullName}.`,
      ``,
      `A member of our team will check it against the ${specialist.regulator?.name ?? "relevant"} register`,
      `and email you with the outcome. Most claims are reviewed within two working days.`,
      ``,
      `You can sign in now to follow progress: ${SITE_URL}/signin`,
    ].join("\n"),
  });

  res.status(201).json({
    ok: true,
    claimId: claim.id,
    // Signed in immediately, but owning nothing yet.
    token: (await issueSession(req, { id: userId, role: "specialist" })).token,
    user: { id: userId, email: email.toLowerCase(), fullName, role: "specialist", specialistId: null },
  });
}

/* ------------------------------------------------------------------ *
 * Admin review
 * ------------------------------------------------------------------ */

// GET /api/admin/claims?status=pending
export async function listClaims(req, res) {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  res.json({ results: await claimStore.byStatus(status), counts: await claimStore.counts() });
}

// GET /api/admin/claims/:id
export async function getClaim(req, res) {
  const claim = await claimStore.find(req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const specialist = await loadSpecialist(claim.specialistId);
  res.json({
    claim,
    specialist: specialist
      ? {
          id: specialist.id,
          slug: specialist.slug,
          fullName: specialist.fullName,
          title: specialist.title ?? null,
          photoUrl: specialist.photoUrl ?? null,
          // Shown only to the admin, who needs it to judge the claim.
          registrationNumber: specialist.registrationNumber ?? null,
          regulator: specialist.regulator ?? null,
          primarySpecialty: specialist.primarySpecialty?.name ?? null,
          ratingAvg: specialist.ratingAvg ?? 0,
          ratingCount: specialist.ratingCount ?? 0,
          contactEmail: specialist.contactEmail ?? null,
        }
      : null,
  });
}

const decisionSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    note: z.string().max(2000).optional().or(z.literal("")),
  })
  // A refusal always carries a reason, because the applicant is told it.
  .refine((d) => d.action !== "reject" || (d.note ?? "").trim().length >= 10, {
    message: "A reason of at least 10 characters is required when refusing a claim — it is sent to the claimant.",
    path: ["note"],
  });

/**
 * POST /api/admin/claims/:id/decide
 *
 * Approving links the account to the existing profile, which is the
 * whole point: the claimant inherits the reviews and rating already
 * attached to it rather than starting from zero.
 */
export async function decideClaim(req, res) {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid decision", issues: parsed.error.issues });
  }
  const { action, note } = parsed.data;

  const claim = await claimStore.find(req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  if (claim.status !== "pending") return res.status(409).json({ error: "This claim has already been decided" });

  const admin = req.user;
  const specialist = await loadSpecialist(claim.specialistId);
  if (!specialist) return res.status(404).json({ error: "The profile this claim refers to no longer exists" });

  if (action === "approve") {
    // A paid plan chosen during the claim behaves exactly as it does at
    // signup: selected now, charged only once it is theirs.
    const planStatus = isPaidPlan(claim.plan) ? "pending_payment" : "active";

    if (!isDbConfigured()) {
      demoAccounts.update(claim.userId, { specialistId: claim.specialistId });
      updateDemoSpecialist(claim.specialistId, {
        claimed: true,
        userId: claim.userId,
        contactEmail: specialist.contactEmail ?? claim.email,
        contactPhone: specialist.contactPhone ?? claim.phone,
        plan: claim.plan,
        planInterval: claim.planInterval,
        planStatus,
        planSelectedAt: claim.createdAt,
      });
    } else {
      // The link lives on the specialist row alone (a nullable, unique
      // user_id), so approving a claim is one write and the account and
      // the listing cannot end up disagreeing about who owns it.
      await specialistRepo.update(claim.specialistId, {
        claimed: true,
        userId: claim.userId,
        contactEmail: specialist.contactEmail ?? claim.email,
        contactPhone: specialist.contactPhone ?? claim.phone,
        plan: claim.plan,
        planInterval: claim.planInterval,
        planStatus,
        planSelectedAt: new Date(claim.createdAt),
      });
    }

    await claimStore.update(claim.id, {
      status: "approved",
      note: note || null,
      decidedBy: admin.fullName ?? "Admin",
      decidedAt: new Date().toISOString(),
    });
  } else {
    await claimStore.update(claim.id, {
      status: "rejected",
      note: note.trim(),
      decidedBy: admin.fullName ?? "Admin",
      decidedAt: new Date().toISOString(),
    });
  }

  // The admin's to-do item is done; clear it for every admin at once.
  await notificationStore.resolveSubject(claim.id);

  const delivery = await sendMail(buildClaimEmail({ claim, specialist, action, note, planStatus: isPaidPlan(claim.plan) }));

  res.json({ ok: true, status: action === "approve" ? "approved" : "rejected", delivery });
}

function buildClaimEmail({ claim, specialist, action, note }) {
  const profileUrl = `${SITE_URL}/specialists/${specialist.slug}`;
  if (action === "approve") {
    return {
      to: claim.email,
      subject: `You now manage ${specialist.fullName} on Top Local Specialists`,
      text: [
        `Good news — your claim has been approved and the profile is now yours to manage.`,
        ``,
        `Everything already on it stays: ${specialist.ratingCount || 0} review${specialist.ratingCount === 1 ? "" : "s"} and`,
        `a ${Number(specialist.ratingAvg ?? 0).toFixed(1)} rating have carried across to your account.`,
        ``,
        `Sign in to complete your profile: ${SITE_URL}/dashboard`,
        `Your public page: ${profileUrl}`,
        ...(isPaidPlan(claim.plan)
          ? [
              ``,
              `You chose ${getPlan(claim.plan).name}. Payment is asked for from your`,
              `dashboard — nothing has been charged yet.`,
            ]
          : []),
        ...(note ? [``, `Note from our team: ${note}`] : []),
      ].join("\n"),
    };
  }
  return {
    to: claim.email,
    subject: `About your claim for ${specialist.fullName}`,
    text: [
      `Thank you for your claim on the profile for ${specialist.fullName}.`,
      ``,
      `We haven't been able to approve it.`,
      ``,
      `Reason: ${note}`,
      ``,
      `If you believe this is a mistake, reply to this email with your`,
      `registration certificate or a link to your entry on the public`,
      `register and we will look again.`,
    ].join("\n"),
  };
}
