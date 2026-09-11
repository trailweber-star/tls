import { z } from "zod";
import { optionalUrlField, urlField } from "../lib/urls.js";
import { isDbConfigured } from "../config/db.js";
import {
  clinicLocations as locationRepo,
  leads as leadRepo,
  reviews as reviewRepo,
  specialists as specialistRepo,
  taxonomy as taxonomyRepo,
} from "../db/repos.js";
import {
  mockSpecialistsWithRelations,
  specialists as mockSpecialists,
  specialties as mockSpecialties,
  updateDemoSpecialist,
  setDemoSpecialistTreatments,
  setDemoSpecialistLocations,
  findReviewById,
  respondToReview as respondToDemoReview,
} from "../data/mock.js";
import { demoLeads } from "../data/leads-store.js";
import { specialistIdOf } from "../middleware/auth.js";
import { viewStats } from "../lib/analytics.js";
import { sendMail } from "../lib/mailer.js";
import { aggregateReviewScores } from "../lib/reviews.js";
import { entitlementsFor } from "../lib/plans.js";

/* ------------------------------------------------------------------ *
 * Profile completion
 *
 * A real percentage, computed from the fields the public profile
 * actually renders — not a decorative number. Each item carries the
 * label and the section it lives in, so "Complete profile" can send the
 * specialist straight to what is missing instead of to a generic form.
 * ------------------------------------------------------------------ */
const COMPLETION_ITEMS = [
  { key: "photoUrl", label: "Add a profile photo", section: "basic", weight: 2, has: (s) => Boolean(s.photoUrl) },
  { key: "title", label: "Add your professional title", section: "basic", weight: 2, has: (s) => Boolean(s.title) },
  { key: "bio", label: "Write your biography", section: "basic", weight: 2, has: (s) => (s.bio ?? "").length > 80 },
  {
    key: "yearsExperience",
    label: "Add your years of experience",
    section: "professional",
    weight: 1,
    has: (s) => s.yearsExperience != null,
  },
  {
    key: "registrationNumber",
    label: "Add your registration number",
    section: "professional",
    weight: 3,
    has: (s) => Boolean(s.registrationNumber),
  },
  {
    key: "primarySpecialty",
    label: "Choose your primary specialty",
    section: "specialties",
    weight: 3,
    has: (s) => Boolean(s.primarySpecialty ?? s.primarySpecialtyId),
  },
  {
    key: "treatments",
    label: "List the treatments you offer",
    section: "treatments",
    weight: 2,
    has: (s) => (s.treatments ?? []).length > 0,
  },
  {
    key: "locations",
    label: "Add a clinic location",
    section: "locations",
    weight: 3,
    has: (s) => (s.clinicLocations ?? []).length > 0,
  },
  {
    key: "consultationPrice",
    label: "Add your consultation price",
    section: "consultation",
    weight: 2,
    has: (s) => s.consultationPriceMinor != null,
  },
  {
    key: "availability",
    label: "Publish your next available appointment",
    section: "consultation",
    weight: 1,
    has: (s) => Boolean(s.nextAvailableAt ?? s.nextAvailableInDays != null),
  },
  { key: "video", label: "Add an introduction video", section: "media", weight: 1, has: (s) => Boolean(s.videoUrl) },
  {
    key: "contactEmail",
    label: "Confirm your contact email",
    section: "basic",
    weight: 2,
    has: (s) => Boolean(s.contactEmail),
  },
];

export function profileCompletion(specialist) {
  const total = COMPLETION_ITEMS.reduce((sum, i) => sum + i.weight, 0);
  const done = COMPLETION_ITEMS.filter((i) => i.has(specialist));
  const earned = done.reduce((sum, i) => sum + i.weight, 0);
  return {
    percent: Math.round((earned / total) * 100),
    missing: COMPLETION_ITEMS.filter((i) => !i.has(specialist)).map(({ key, label, section }) => ({
      key,
      label,
      section,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Data access — one shape, both storage modes
 * ------------------------------------------------------------------ */
async function loadSpecialist(id) {
  if (!isDbConfigured()) return mockSpecialistsWithRelations.find((s) => s.id === id) ?? null;
  return specialistRepo.findById(id);
}

async function loadLeads(specialistId) {
  if (!isDbConfigured()) return demoLeads.forSpecialist(specialistId);
  const rows = await leadRepo.forSpecialist(specialistId);
  return rows.map((l) => ({
    id: l.id,
    patientName: l.patientName,
    email: l.email ?? null,
    phone: l.phone ?? null,
    message: l.message ?? null,
    status: l.status,
    response: l.response ?? null,
    respondedAt: l.respondedAt ? new Date(l.respondedAt).toISOString() : null,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    // An enquiry past a Basic listing's monthly cap is stored in full and
    // shown here as held, so the specialist can see it is waiting rather
    // than wondering why a patient never appeared.
    held: Boolean(l.held),
  }));
}

/**
 * GET /api/dashboard/overview
 *
 * Everything the dashboard home renders, in one request: profile
 * completion, verification state, the KPI row, recent enquiries and the
 * review summary. Every figure is counted from real records.
 */
export async function getOverview(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  const leads = await loadLeads(id);
  const views = viewStats(id, 30);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 86400000);
  const twoDaysAgo = new Date(Date.now() - 172800000);

  const newLeads = leads.filter((l) => l.status === "new");
  const leadsLast24h = leads.filter((l) => new Date(l.createdAt) >= dayAgo).length;
  const leadsPrev24h = leads.filter(
    (l) => new Date(l.createdAt) >= twoDaysAgo && new Date(l.createdAt) < dayAgo
  ).length;

  const completion = profileCompletion(specialist);

  res.json({
    specialist: {
      id,
      slug: specialist.slug,
      fullName: specialist.fullName,
      title: specialist.title ?? null,
      photoUrl: specialist.photoUrl ?? null,
      verificationStatus: specialist.verificationStatus,
      verificationHistory: specialist.verificationHistory ?? [],
    },
    completion,
    plan: {
      id: entitlementsFor(specialist).effectivePlan,
      name: entitlementsFor(specialist).effectivePlanName,
      status: entitlementsFor(specialist).planStatus,
      awaitingActivation: entitlementsFor(specialist).awaitingActivation,
      selectedPlan: entitlementsFor(specialist).selectedPlan,
      selectedPlanName: entitlementsFor(specialist).selectedPlanName,
    },
    kpis: {
      // Appointments are not modelled yet; the card is rendered from this
      // field, so it appears the moment a booking model exists rather than
      // showing an invented number in the meantime.
      todaysAppointments: null,
      newEnquiries: { value: newLeads.length, changeFromYesterday: leadsLast24h - leadsPrev24h },
      profileViews: { value: views.total, changePct: views.changePct, series: views.series },
      rating: { value: specialist.ratingAvg ?? 0, count: specialist.ratingCount ?? 0 },
    },
    recentEnquiries: leads.slice(0, 5).map((l) => ({
      id: l.id,
      patientName: l.patientName,
      subject: (l.message ?? "").slice(0, 60) || "General enquiry",
      status: l.status,
      createdAt: l.createdAt,
    })),
  });
}

/* ------------------------------------------------------------------ *
 * Profile management
 * ------------------------------------------------------------------ */

const profileSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  title: z.string().max(160).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  registrationNumber: z.string().max(60).nullable().optional(),
  consultationPriceMinor: z.number().int().min(0).max(10_000_00).nullable().optional(),
  currency: z.string().length(3).optional(),
  languages: z.array(z.string().max(40)).max(12).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  photoUrl: optionalUrlField(),
  videoUrl: optionalUrlField(),
  videoThumbnailUrl: optionalUrlField(),
  videoDurationSeconds: z.number().int().min(0).max(7200).nullable().optional(),
  primarySpecialtySlug: z.string().max(120).nullable().optional(),
  nextAvailableAt: z.string().datetime().nullable().optional(),
  // Premium-tier content. Accepted from any plan and stored, but only
  // served publicly where the plan allows (lib/profileGate.js) — so a
  // lapsed subscription hides this rather than losing it.
  coverImageUrl: optionalUrlField(),
  gallery: z
    .array(z.object({ url: urlField(), caption: z.string().max(120).nullable().optional() }))
    .max(60)
    .optional(),
  websiteUrl: optionalUrlField({ max: 300 }),
  socials: z
    .object({
      linkedin: optionalUrlField({ max: 300 }),
      x: optionalUrlField({ max: 300 }),
      instagram: optionalUrlField({ max: 300 }),
      facebook: optionalUrlField({ max: 300 }),
      youtube: optionalUrlField({ max: 300 }),
    })
    .nullable()
    .optional(),
  bookingUrl: optionalUrlField({ max: 300 }),
  // Joined collections. Sent as complete sets — the server replaces what
  // the specialist has rather than trying to diff two lists.
  treatmentNames: z.array(z.string().min(2).max(120)).max(40).optional(),
  locations: z
    .array(
      z.object({
        address: z.string().min(3).max(200),
        cityId: z.string().min(1).max(80),
        postcode: z.string().max(16).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        // Set when the address was picked from the geocoded suggestions.
        // Optional, because a typed address is still a valid address —
        // it just falls back to the city centre for distance search.
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
      })
    )
    .max(10)
    .optional(),
});

// GET /api/dashboard/profile — the editable record, plus completion.
export async function getProfile(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });
  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  const plain = specialist;
  res.json({
    profile: {
      id,
      slug: plain.slug,
      fullName: plain.fullName,
      title: plain.title ?? null,
      bio: plain.bio ?? null,
      photoUrl: plain.photoUrl ?? null,
      yearsExperience: plain.yearsExperience ?? null,
      registrationNumber: plain.registrationNumber ?? null,
      consultationPriceMinor: plain.consultationPriceMinor ?? null,
      currency: plain.currency ?? "GBP",
      languages: plain.languages ?? [],
      contactEmail: plain.contactEmail ?? null,
      contactPhone: plain.contactPhone ?? null,
      videoUrl: plain.videoUrl ?? null,
      videoThumbnailUrl: plain.videoThumbnailUrl ?? null,
      videoDurationSeconds: plain.videoDurationSeconds ?? null,
      nextAvailableAt: plain.nextAvailableAt ?? null,
      coverImageUrl: plain.coverImageUrl ?? null,
      gallery: (plain.gallery ?? []).map((g) => ({ url: g.url, caption: g.caption ?? null })),
      websiteUrl: plain.websiteUrl ?? null,
      socials: plain.socials ?? null,
      bookingUrl: plain.bookingUrl ?? null,
      verificationStatus: plain.verificationStatus,
      primarySpecialty: plain.primarySpecialty
        ? {
            slug: plain.primarySpecialty.slug ?? null,
            name: plain.primarySpecialty.name ?? null,
          }
        : null,
      treatments: (plain.treatments ?? []).map((t) => ({ id: String(t.id ?? t._id), name: t.name })),
      clinicLocations: (plain.clinicLocations ?? []).map((l) => ({
        id: String(l.id ?? l._id),
        address: l.address,
        city: l.city?.name ?? null,
        // The editor needs the id to send the set back unchanged.
        cityId: String(l.city?.id ?? l.city?._id ?? l.cityId ?? "") || null,
        postcode: l.postcode ?? null,
        phone: l.phone ?? null,
        lat: l.lat ?? null,
        lng: l.lng ?? null,
        /* Which clinic this address belongs to, if any.
         *
         * This was missing, and its absence was the cause of a blank
         * profile page: the editor could not tell a hospital's address
         * from one the specialist typed themselves, so it sent both back
         * as their own and the link to the hospital was dropped. A
         * clinic's address is the clinic's to change, so the editor
         * shows it and does not offer to edit it. */
        clinic: l.clinic ? { id: String(l.clinic.id), name: l.clinic.name, slug: l.clinic.slug } : null,
      })),
    },
    completion: profileCompletion(specialist),
  });
}

/**
 * PATCH /api/dashboard/profile
 *
 * Only ever writes the profile attached to the session. Note what is NOT
 * editable here: verificationStatus, ratingAvg and ratingCount. Status is
 * an admin decision and ratings are derived from reviews — letting a
 * profile form write either would make both meaningless.
 */
export async function updateProfile(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid profile", issues: parsed.error.issues });
  }
  const { primarySpecialtySlug, treatmentNames, locations, nextAvailableAt, ...fields } = parsed.data;

  // Plan limits are enforced here, not in the form. A hand-crafted
  // request must not be able to load 60 gallery images onto a Basic
  // listing and have them appear the day they upgrade.
  const current = await loadSpecialist(id);
  if (!current) return res.status(404).json({ error: "Profile not found" });
  const ent = entitlementsFor(current);
  if (fields.gallery && ent.features.galleryImageLimit >= 0) {
    fields.gallery = fields.gallery.slice(0, Math.max(ent.features.galleryImageLimit, 0));
  }

  if (!isDbConfigured()) {
    const patch = { ...fields };
    if (nextAvailableAt !== undefined) {
      // Demo data stores availability as a day offset so it never goes
      // stale; translate the date the form sends into that offset.
      patch.nextAvailableInDays =
        nextAvailableAt == null
          ? null
          : Math.max(0, Math.round((new Date(nextAvailableAt) - Date.now()) / 86400000));
    }
    if (primarySpecialtySlug !== undefined) {
      const node = mockSpecialties.find((s) => s.slug === primarySpecialtySlug);
      patch.primarySpecialtyId = node?.id ?? null;
    }
    let updated = updateDemoSpecialist(id, patch);
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    if (treatmentNames) updated = setDemoSpecialistTreatments(id, treatmentNames) ?? updated;
    if (locations) updated = setDemoSpecialistLocations(id, locations) ?? updated;
    return res.json({ ok: true, completion: profileCompletion(updated) });
  }

  const patch = { ...fields };
  if (nextAvailableAt !== undefined) {
    patch.nextAvailableAt = nextAvailableAt ? new Date(nextAvailableAt) : null;
  }

  let specialtyIds;
  if (primarySpecialtySlug !== undefined) {
    const node = primarySpecialtySlug ? await taxonomyRepo.specialtyBySlug(primarySpecialtySlug) : null;
    patch.primarySpecialtyId = node?.id ?? null;
    specialtyIds = node ? [node.id] : [];
  }

  let treatmentIds;
  if (treatmentNames) {
    const existing = await taxonomyRepo.treatments();
    const bySlug = new Map(existing.map((t) => [t.slug, t]));
    treatmentIds = [];
    for (const raw of treatmentNames) {
      const name = raw.trim();
      if (!name) continue;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      // Reuse the platform's treatment where one exists so the same
      // procedure isn't duplicated under a dozen near-identical names.
      const treatment =
        bySlug.get(slug) ??
        (await taxonomyRepo.createTreatment({
          slug,
          name,
          specialtyId: patch.primarySpecialtyId ?? current.primarySpecialtyId ?? null,
        }));
      bySlug.set(slug, treatment);
      if (!treatmentIds.includes(treatment.id)) treatmentIds.push(treatment.id);
    }
  }

  let locationIds;
  if (locations) {
    const cities = await taxonomyRepo.cities();
    // Only addresses this specialist owns are cleared — a shared clinic
    // address stays, because other specialists are linked to it.
    const shared = (current.clinicLocations ?? [])
      .filter((l) => !l.ownedBySpecialistId)
      .map((l) => l.id);
    await locationRepo.deleteOwned(id);

    const rows = [];
    for (const entry of locations) {
      const city = cities.find((c) => c.id === entry.cityId || c.slug === entry.cityId);
      if (!city) continue;
      rows.push({
        cityId: city.id,
        address: entry.address,
        postcode: entry.postcode ?? null,
        phone: entry.phone ?? null,
        // The address's own coordinates when it was picked from the
        // geocoded suggestions, and the city centre when it was typed.
        // "Within 5km" used to mean "in a city whose centre is within
        // 5km", which is a different and much vaguer promise.
        lat: entry.lat ?? city.lat,
        lng: entry.lng ?? city.lng,
      });
    }
    const created = await locationRepo.createOwned(id, rows);
    locationIds = [...shared, ...created.map((l) => l.id)];
  }

  await specialistRepo.update(id, patch);
  if (specialtyIds || treatmentIds || locationIds) {
    await specialistRepo.setLinks(id, { specialtyIds, treatmentIds, locationIds });
  }

  const updated = await specialistRepo.findById(id);
  res.json({ ok: true, completion: profileCompletion(updated) });
}

/* ------------------------------------------------------------------ *
 * Enquiries
 * ------------------------------------------------------------------ */

// GET /api/dashboard/enquiries?status=new
export async function listEnquiries(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  const status = req.query.status;
  let leads = await loadLeads(id);
  if (status && status !== "all") leads = leads.filter((l) => l.status === status);

  const all = await loadLeads(id);
  res.json({
    results: leads,
    counts: {
      all: all.length,
      new: all.filter((l) => l.status === "new").length,
      responded: all.filter((l) => l.status === "responded").length,
      in_progress: all.filter((l) => l.status === "in_progress").length,
      closed: all.filter((l) => l.status === "closed").length,
    },
  });
}

const respondSchema = z.object({
  message: z.string().min(1).max(4000),
  status: z.enum(["responded", "in_progress", "closed"]).optional(),
});

/**
 * POST /api/dashboard/enquiries/:id/respond
 *
 * Records the reply, moves the enquiry along its workflow, and emails the
 * patient. Delivery is reported but never fails the request — the reply
 * is saved either way (see lib/mailer.js).
 */
export async function respondToEnquiry(req, res) {
  const specialistId = specialistIdOf(req.user);
  if (!specialistId) return res.status(400).json({ error: "This account has no specialist profile" });

  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid response", issues: parsed.error.issues });
  const { message, status = "responded" } = parsed.data;

  const specialist = await loadSpecialist(specialistId);

  if (!isDbConfigured()) {
    // Ownership is checked against the session's profile, so one account
    // can never answer another's enquiry by guessing an id.
    const lead = demoLeads.findForSpecialist(req.params.id, specialistId);
    if (!lead) return res.status(404).json({ error: "Enquiry not found" });
    demoLeads.update(lead.id, { status, response: message, respondedAt: new Date().toISOString() });
    const delivery = await sendMail({
      to: lead.email,
      replyTo: specialist?.contactEmail ?? undefined,
      subject: `Reply from ${specialist?.fullName ?? "your specialist"}`,
      text: `${message}\n\n—\n${specialist?.fullName ?? ""}\nSent via Top Local Specialists`,
    });
    return res.json({ ok: true, delivery });
  }

  // Ownership is checked against the session's profile, so one account
  // can never answer another's enquiry by guessing an id.
  const lead = await leadRepo.findById(req.params.id);
  if (!lead || lead.specialistId !== specialistId) {
    return res.status(404).json({ error: "Enquiry not found" });
  }
  await leadRepo.update(lead.id, { status, response: message, respondedAt: new Date() });

  const delivery = await sendMail({
    to: lead.email,
    replyTo: specialist?.contactEmail ?? undefined,
    subject: `Reply from ${specialist?.fullName ?? "your specialist"}`,
    text: `${message}\n\n—\n${specialist?.fullName ?? ""}\nSent via Top Local Specialists`,
  });
  res.json({ ok: true, delivery });
}

// GET /api/dashboard/reviews — the specialist's own reviews.
export async function listOwnReviews(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  if (!isDbConfigured()) {
    const s = mockSpecialistsWithRelations.find((x) => x.id === id);
    const rows = s?.reviews ?? [];
    return res.json({
      results: rows,
      ratingAvg: s?.ratingAvg ?? 0,
      ratingCount: s?.ratingCount ?? 0,
      // Per-category averages, derived from the same reviews the public
      // profile shows — one source, so the two can never disagree.
      scores: aggregateReviewScores(rows),
      distribution: ratingDistribution(rows),
    });
  }
  const [mapped, pending, doc] = await Promise.all([
    reviewRepo.forSubject("specialist", id),
    // Shown separately so a specialist can see a review exists and is
    // with us, rather than hearing about it from the patient first.
    reviewRepo.forSubject("specialist", id, { status: "pending" }),
    specialistRepo.rawById(id),
  ]);
  res.json({
    results: mapped,
    awaitingApproval: pending.length,
    ratingAvg: doc?.ratingAvg ?? 0,
    ratingCount: doc?.ratingCount ?? 0,
    // Per-category averages, derived from the same reviews the public
    // profile shows — one source, so the two can never disagree.
    scores: aggregateReviewScores(mapped),
    distribution: ratingDistribution(mapped),
  });
}

/**
 * POST /api/dashboard/reviews/:id/respond  { response }
 *
 * The specialist's public reply to a review of their own listing.
 *
 * Deliberately NOT moderated. The review itself was read by an admin
 * before it went live; making the provider queue behind the same desk to
 * answer it would mean their side of the story lands days late, which is
 * the one thing that makes a reply worthless. Replying is also a paid
 * feature, so the entitlement is checked here rather than only hidden in
 * the interface.
 */
export async function respondToOwnReview(req, res) {
  const specialistId = specialistIdOf(req.user);
  if (!specialistId) return res.status(400).json({ error: "This account has no specialist profile" });

  const parsed = z
    .object({ response: z.string().trim().min(2).max(2000) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "A reply is required", issues: parsed.error.issues });
  }

  const source = isDbConfigured()
    ? await specialistRepo.rawById(specialistId)
    : mockSpecialists.find((s) => s.id === specialistId);
  if (!source) return res.status(404).json({ error: "Profile not found" });

  if (!entitlementsFor(source).features.reviewReplies) {
    return res.status(402).json({
      error: "Replying to reviews is part of the Premium listing.",
      upgrade: "/dashboard/billing",
    });
  }

  const { id } = req.params;
  if (!isDbConfigured()) {
    const row = findReviewById(id);
    // Only your own reviews. Without this check any signed-in specialist
    // could answer on someone else's listing.
    if (!row || row.subjectId !== specialistId) return res.status(404).json({ error: "Review not found" });
    if (row.moderationStatus !== "approved") {
      return res.status(409).json({ error: "This review has not been published yet" });
    }
    return res.json({ ok: true, review: respondToDemoReview(id, parsed.data.response) });
  }

  const row = await reviewRepo.findById(id);
  if (!row || row.subjectId !== specialistId || row.subjectType !== "specialist") {
    return res.status(404).json({ error: "Review not found" });
  }
  if (row.moderationStatus !== "approved") {
    return res.status(409).json({ error: "This review has not been published yet" });
  }
  const updated = await reviewRepo.respond(id, parsed.data.response);
  res.json({ ok: true, review: updated });
}

export { mockSpecialists };

/** How many reviews sit at each star value, 5 down to 1. */
function ratingDistribution(rows) {
  const buckets = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  rows.forEach((r) => {
    const star = Math.round(r.rating);
    if (buckets[star] != null) buckets[star] += 1;
  });
  return buckets;
}
