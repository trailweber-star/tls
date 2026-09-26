import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import {
  leads as leadRepo,
  specialists as specialistRepo,
  facilities as facilityRepo,
  users as userRepo,
} from "../db/repos.js";
import {
  mockSpecialistsWithRelations,
  specialists as mockSpecialists,
  facilities as mockFacilities,
  recordDemoVerification,
  updateDemoSpecialist,
} from "../data/mock.js";
import { demoLeads } from "../data/leads-store.js";
import { demoAccounts } from "../data/accounts.js";
import { isPaidPlan } from "../lib/plans.js";
import { notificationStore } from "../lib/notifications.js";

import { hasMailer, sendMail } from "../lib/mailer.js";
import { hasPaymentProvider, paymentProviderName } from "../lib/payments.js";
import { storageProviderName } from "../lib/storage.js";
import { hasPushProvider, pushProviderName } from "../lib/push.js";
import { mapProvider } from "../lib/maps.js";

import { siteUrl } from "../lib/urls.js";
const SITE_URL = siteUrl();

// Everything in this file sits behind requireRole("admin") — see routes.

/* ------------------------------------------------------------------ *
 * Platform overview
 * ------------------------------------------------------------------ */

// GET /api/admin/overview
export async function getAdminOverview(req, res) {
  /* One shape, two sources. The demo branch and the database branch
     differ only in where the four lists come from; every number below
     is computed once, so the two modes can never disagree about the
     same data. Facilities are fetched alongside specialists purely so
     buildRecentEnquiries below can name one when an enquiry has a
     facilityId and no specialistId — nothing else here uses the list. */
  const [all, enquiries, accounts, facilitiesList] = isDbConfigured()
    ? await Promise.all([specialistRepo.all(), leadRepo.all(), userRepo.count(), facilityRepo.all()])
    : [mockSpecialistsWithRelations, demoLeads.all(), demoAccounts.all().length, mockFacilities];

  const byStatus = (status) => all.filter((s) => s.verificationStatus === status).length;
  const dayAgo = Date.now() - 86400000;
  const weekAgo = Date.now() - 7 * 86400000;

  const recent = [...all]
    .sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0))
    .slice(0, 12);

  res.json({
    counts: {
      totalSpecialists: all.length,
      verified: byStatus("verified"),
      pendingVerification: byStatus("pending"),
      infoRequested: byStatus("info_requested"),
      rejected: byStatus("rejected"),
      newRegistrations7d: all.filter(
        (s) => s.application?.submittedAt && new Date(s.application.submittedAt).getTime() > weekAgo
      ).length,
      totalEnquiries: enquiries.length,
      enquiries24h: enquiries.filter((l) => new Date(l.createdAt).getTime() > dayAgo).length,
      accounts,
    },
    recentActivity: buildActivity(recent),
    trend: buildTrend(all, enquiries),
    topSpecialties: buildSpecialtyBreakdown(all),
    recentEnquiries: buildRecentEnquiries(enquiries, all, facilitiesList),
    system: systemStatus(),
  });
}

/* ------------------------------------------------------------------ *
 * The chart
 *
 * Two real series over the last fortnight: applications submitted, and
 * decisions taken. Both come out of the verification history, which is
 * the only record of when either actually happened — nothing here is
 * smoothed, projected or filled in. A quiet fortnight draws a flat line,
 * and that is the correct picture of a quiet fortnight.
 * ------------------------------------------------------------------ */

const TREND_DAYS = 14;

function dayKey(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function buildTrend(specialists, enquiries) {
  const days = [];
  const index = new Map();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const row = { date, applications: 0, approvals: 0, enquiries: 0 };
    days.push(row);
    index.set(date, row);
  }

  for (const s of specialists) {
    for (const entry of s.verificationHistory ?? []) {
      const key = dayKey(entry.at);
      const row = key && index.get(key);
      if (!row) continue;
      if (entry.action === "submitted") row.applications += 1;
      else if (entry.action === "verified" || entry.action === "approved") row.approvals += 1;
    }
  }

  for (const lead of enquiries) {
    const row = index.get(dayKey(lead.createdAt));
    if (row) row.enquiries += 1;
  }

  const total = days.reduce((n, d) => n + d.applications + d.approvals + d.enquiries, 0);
  return { days, window: TREND_DAYS, empty: total === 0 };
}

/* ------------------------------------------------------------------ *
 * Where the directory actually has depth
 *
 * Counted from the listings themselves, verified and unverified split
 * out, because "86 orthopaedic surgeons" means something different when
 * eighty of them are unclaimed imports.
 * ------------------------------------------------------------------ */

function buildSpecialtyBreakdown(specialists) {
  const bySlug = new Map();
  for (const s of specialists) {
    const slug = s.primarySpecialty?.slug;
    if (!slug) continue;
    const row = bySlug.get(slug) ?? { slug, name: s.primarySpecialty?.name ?? slug, total: 0, verified: 0 };
    row.total += 1;
    if (s.verificationStatus === "verified") row.verified += 1;
    bySlug.set(slug, row);
  }
  return [...bySlug.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 6);
}

/* Latest enquiries across the whole platform. The message is trimmed to
   a line: an administrator needs to see that patients are getting
   through and who to, not to read their correspondence.

   A facility-only enquiry (facilityId set, no specialistId) used to come
   through here with specialistName: null and nothing else — visible in
   the data, but with no name attached, easy to mistake for a specialist
   lookup that simply failed. facilityName resolves it the same way
   specialistName already does for specialists. */
function buildRecentEnquiries(enquiries, specialists, facilities = []) {
  const nameById = new Map(specialists.map((s) => [String(s.id ?? s._id), s.fullName]));
  const facilityNameById = new Map(facilities.map((f) => [String(f.id ?? f._id), f.name]));
  return [...enquiries]
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))
    .slice(0, 5)
    .map((l) => ({
      id: l.id ?? String(l._id),
      patientName: l.patientName ?? "Someone",
      subject: (l.message ?? "").trim().slice(0, 70) || "General enquiry",
      specialistName: nameById.get(String(l.specialistId)) ?? null,
      facilityName: l.facilityId ? facilityNameById.get(String(l.facilityId)) ?? null : null,
      status: l.status ?? "new",
      createdAt: l.createdAt,
    }));
}

/* ------------------------------------------------------------------ *
 * What is actually switched on
 *
 * Every line here is read from the running process, not asserted. A
 * dashboard that prints "email: healthy" beside a mailer that was never
 * configured is worse than printing nothing — it is the reason nobody
 * notices for a fortnight that no approval emails have gone out.
 * ------------------------------------------------------------------ */

function systemStatus() {
  const mailer = hasMailer();
  const payments = hasPaymentProvider();
  const push = hasPushProvider();
  return {
    storage: {
      ok: isDbConfigured(),
      label: isDbConfigured() ? "Postgres" : "Demo data (in memory)",
      note: isDbConfigured() ? null : "Changes are lost when the server restarts.",
    },
    email: {
      ok: mailer,
      label: mailer ? "Connected" : "Not connected",
      note: mailer ? null : "Approval and enquiry emails are logged, not sent.",
    },
    payments: {
      ok: payments,
      label: payments ? paymentProviderName() : "Simulated",
      note: payments ? null : "Checkout completes without taking money.",
    },
    media: { ok: true, label: storageProviderName() },
    maps: { ok: true, label: mapProvider() === "google" ? "Google Maps" : "OpenStreetMap" },
    push: { ok: push, label: push ? pushProviderName() : "Not connected" },
  };
}

// The platform activity feed, built from the verification audit trail —
// so it reflects decisions that were actually taken, in order.
function buildActivity(specialists) {
  return specialists
    .flatMap((s) =>
      (s.verificationHistory ?? []).map((h) => ({
        specialistId: s.id ?? String(s._id),
        specialistName: s.fullName,
        slug: s.slug,
        action: h.action,
        by: h.byName ?? "System",
        note: h.note ?? null,
        at: h.at,
      }))
    )
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 12);
}

/* ------------------------------------------------------------------ *
 * Verification queue
 * ------------------------------------------------------------------ */

const QUEUE_STATUSES = ["pending", "info_requested", "verified", "rejected", "suspended"];

// GET /api/admin/verifications?status=pending
export async function listVerifications(req, res) {
  const status = QUEUE_STATUSES.includes(req.query.status) ? req.query.status : "pending";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

  const shape = (s) => ({
    id: s.id ?? String(s._id),
    slug: s.slug,
    fullName: s.fullName,
    title: s.title ?? null,
    photoUrl: s.photoUrl ?? null,
    registrationNumber: s.registrationNumber ?? null,
    contactEmail: s.contactEmail ?? null,
    verificationStatus: s.verificationStatus,
    primarySpecialty: s.primarySpecialty?.name ?? null,
    documentCount: s.application?.documents?.length ?? 0,
    submittedAt: s.application?.submittedAt ?? null,
  });

  if (!isDbConfigured()) {
    // Newest applications first, matching the Mongo branch's sort — an
    // admin works the queue from the most recent submission down.
    const all = mockSpecialistsWithRelations
      .filter((s) => s.verificationStatus === status)
      .sort((a, b) => {
        const at = a.application?.submittedAt ? new Date(a.application.submittedAt).getTime() : 0;
        const bt = b.application?.submittedAt ? new Date(b.application.submittedAt).getTime() : 0;
        return bt - at;
      });
    const counts = Object.fromEntries(
      QUEUE_STATUSES.map((st) => [st, mockSpecialistsWithRelations.filter((s) => s.verificationStatus === st).length])
    );
    return res.json({
      results: all.slice((page - 1) * pageSize, page * pageSize).map(shape),
      total: all.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      counts,
    });
  }

  const everyone = await specialistRepo.all();
  // Newest applications first — an admin works the queue from the most
  // recent submission down.
  const all = everyone
    .filter((s) => s.verificationStatus === status)
    .sort((a, b) => {
      const at = a.application?.submittedAt ? new Date(a.application.submittedAt).getTime() : 0;
      const bt = b.application?.submittedAt ? new Date(b.application.submittedAt).getTime() : 0;
      return bt - at;
    });
  const counts = Object.fromEntries(
    QUEUE_STATUSES.map((st) => [st, everyone.filter((s) => s.verificationStatus === st).length])
  );

  res.json({
    results: all.slice((page - 1) * pageSize, page * pageSize).map(shape),
    total: all.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
    counts,
  });
}

// GET /api/admin/verifications/:id — the full application under review.
export async function getVerification(req, res) {
  const { id } = req.params;

  if (!isDbConfigured()) {
    const s = mockSpecialistsWithRelations.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: "Application not found" });
    return res.json({ application: shapeDetail(s) });
  }

  const s = await specialistRepo.findById(id);
  if (!s) return res.status(404).json({ error: "Application not found" });
  res.json({ application: shapeDetail(s) });
}

function shapeDetail(s) {
  return {
    id: s.id,
    slug: s.slug,
    fullName: s.fullName,
    title: s.title ?? null,
    bio: s.bio ?? null,
    photoUrl: s.photoUrl ?? null,
    contactEmail: s.contactEmail ?? null,
    contactPhone: s.contactPhone ?? null,
    registrationNumber: s.registrationNumber ?? null,
    regulator: s.regulator ? { code: s.regulator.code, name: s.regulator.name } : null,
    primarySpecialty: s.primarySpecialty?.name ?? null,
    yearsExperience: s.yearsExperience ?? null,
    verificationStatus: s.verificationStatus,
    application: s.application ?? { submittedAt: null, documents: [], notes: null },
    verificationHistory: s.verificationHistory ?? [],
    clinicLocations: (s.clinicLocations ?? []).map((l) => ({
      address: l.address,
      city: l.city?.name ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

const NEEDS_REASON = new Set(["reject", "request_info", "suspend"]);

const decisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "request_info", "suspend", "reinstate"]),
    note: z.string().max(2000).optional().or(z.literal("")),
  })
  // Every negative outcome is emailed to the specialist with the reason
  // quoted in it, so a blank reason would send someone a refusal that
  // explains nothing. Enforced here rather than only in the form: the
  // API is what the guarantee rests on.
  .refine((d) => !NEEDS_REASON.has(d.action) || (d.note ?? "").trim().length >= 10, {
    message:
      "A reason of at least 10 characters is required for this decision — it is sent to the specialist in full.",
    path: ["note"],
  });

const STATUS_FOR = {
  approve: "verified",
  reject: "rejected",
  request_info: "info_requested",
  suspend: "suspended",
  reinstate: "verified",
};

const HISTORY_ACTION = {
  approve: "approved",
  reject: "rejected",
  request_info: "info_requested",
  suspend: "suspended",
  reinstate: "reinstated",
};

/**
 * POST /api/admin/verifications/:id/decide
 *
 * The gate. This is the only way a specialist becomes publicly visible:
 * an admin approving them, by hand. Each decision writes an audit entry
 * naming who made it, and the specialist is emailed the outcome.
 */
export async function decideVerification(req, res) {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid decision",
      issues: parsed.error.issues,
    });
  }
  const { action, note } = parsed.data;
  const status = STATUS_FOR[action];
  const admin = req.user;
  const adminName = admin.fullName ?? "Admin";
  const adminId = String(admin.id ?? admin._id);

  // Approving someone who chose a paid plan does not charge them — it
  // moves them from "waiting on our review" to "ready to pay", which is
  // the point their dashboard first asks for a card.
  const advancesToPayment = action === "approve" || action === "reinstate";

  let specialist;
  if (!isDbConfigured()) {
    specialist = recordDemoVerification(req.params.id, {
      status,
      action: HISTORY_ACTION[action],
      byName: adminName,
      byUserId: adminId,
      note: note || null,
    });
    if (!specialist) return res.status(404).json({ error: "Application not found" });
  } else {
    const current = await specialistRepo.rawById(req.params.id);
    if (!current) return res.status(404).json({ error: "Application not found" });
    // Append-only: the audit trail is what an approval is accounted for
    // by, so a decision is added to it, never written over it.
    const history = [
      ...(Array.isArray(current.verificationHistory) ? current.verificationHistory : []),
      {
        action: HISTORY_ACTION[action],
        byUserId: adminId,
        byName: adminName,
        note: note || null,
        at: new Date().toISOString(),
      },
    ];
    specialist = await specialistRepo.update(req.params.id, {
      verificationStatus: status,
      verificationHistory: history,
    });
  }

  if (advancesToPayment && isPaidPlan(specialist.plan ?? "basic") && specialist.planStatus === "pending_verification") {
    specialist = isDbConfigured()
      ? await specialistRepo.update(req.params.id, { planStatus: "pending_payment" })
      : updateDemoSpecialist(req.params.id, { planStatus: "pending_payment" }) ?? specialist;
  }

  await notificationStore.resolveSubject(req.params.id);

  const delivery = await sendMail(buildDecisionEmail({ specialist, action, note }));

  res.json({
    ok: true,
    verificationStatus: specialist.verificationStatus,
    verificationHistory: specialist.verificationHistory,
    delivery,
  });
}

function buildDecisionEmail({ specialist, action, note }) {
  const profileUrl = `${SITE_URL}/specialists/${specialist.slug}`;
  const bodies = {
    approve: [
      `Good news — your Top Local Specialists profile has been approved.`,
      ``,
      `Patients can now find you in search and view your profile:`,
      profileUrl,
      ...(isPaidPlan(specialist.plan ?? "basic")
        ? [
            ``,
            `You chose ${specialist.plan === "clinwell" ? "the Full Practice Suite" : "Premium Listing"}.`,
            `Sign in to your dashboard to complete payment — your upgraded`,
            `features switch on the moment it goes through. Until then your`,
            `listing is live on the free Basic tier, so nothing is lost.`,
          ]
        : []),
    ],
    reject: [
      `Thank you for applying to Top Local Specialists.`,
      ``,
      `We haven't been able to approve your application at this time.`,
      ``,
      `Reason given by our reviewer:`,
      `${note}`,
      ``,
      `If you think this is a mistake, reply to this email with your`,
      `registration certificate or a link to your entry on the public`,
      `register and we will look at it again.`,
    ],
    request_info: [
      `Thank you for applying to Top Local Specialists.`,
      ``,
      `Before we can complete your verification we need a little more from you:`,
      note ? `` : null,
      note ? note : `Please sign in to your dashboard for details.`,
    ],
    suspend: [`Your Top Local Specialists profile has been suspended.`, note ? `` : null, note ? `Reason: ${note}` : null],
    reinstate: [`Your Top Local Specialists profile has been reinstated and is live again.`, ``, profileUrl],
  };
  const subjects = {
    approve: "Your TLS profile has been approved",
    reject: "About your TLS application",
    request_info: "More information needed for your TLS application",
    suspend: "Your TLS profile has been suspended",
    reinstate: "Your TLS profile is live again",
  };
  return {
    to: specialist.contactEmail,
    subject: subjects[action],
    text: bodies[action].filter((l) => l !== null).join("\n"),
  };
}

/* ------------------------------------------------------------------ *
 * Specialists table
 * ------------------------------------------------------------------ */

// GET /api/admin/specialists?q=&status=&page=
export async function listAdminSpecialists(req, res) {
  const q = (req.query.q ?? "").toString().trim().toLowerCase();
  const status = req.query.status;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

  const shape = (s) => ({
    id: s.id ?? String(s._id),
    slug: s.slug,
    fullName: s.fullName,
    specialty: s.primarySpecialty?.name ?? null,
    verificationStatus: s.verificationStatus,
    ratingAvg: s.ratingAvg ?? 0,
    ratingCount: s.ratingCount ?? 0,
    contactEmail: s.contactEmail ?? null,
  });

  if (!isDbConfigured()) {
    let rows = mockSpecialistsWithRelations;
    if (status && status !== "all") rows = rows.filter((s) => s.verificationStatus === status);
    if (q) rows = rows.filter((s) => s.fullName.toLowerCase().includes(q) || s.slug.includes(q));
    return res.json({
      results: rows.slice((page - 1) * pageSize, page * pageSize).map(shape),
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    });
  }

  let rows = await specialistRepo.all();
  if (status && status !== "all") rows = rows.filter((s) => s.verificationStatus === status);
  if (q) rows = rows.filter((s) => s.fullName.toLowerCase().includes(q) || s.slug.includes(q));
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

  res.json({
    results: rows.slice((page - 1) * pageSize, page * pageSize).map(shape),
    total: rows.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
  });
}

export { mockSpecialists };
