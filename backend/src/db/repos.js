/* ------------------------------------------------------------------ *
 * Repositories
 *
 * One job: hand the controllers rows in exactly the shape the demo data
 * already uses (src/data/mock.js). Before this, every controller carried
 * two versions of the same logic — one written against Mongoose
 * documents, one against the mock arrays — and the two drifted. Here the
 * database returns the same shape the mock does, so a controller filters,
 * sorts and scores once and the branch is only about where the rows came
 * from.
 *
 * Queries are deliberately broad-then-assemble rather than clever SQL.
 * The directory is hundreds of specialists, not millions, and the search
 * scoring (paid placement, distance, availability) happens in JavaScript
 * where it can be read and tested. When the directory outgrows that, the
 * place to fix it is here, behind these function signatures.
 * ------------------------------------------------------------------ */

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import * as t from "./schema.js";
import { newId } from "./schema.js";
import { aggregateReviewScores } from "../lib/reviews.js";
import { deriveRating } from "../lib/ratings.js";

const db = () => getDb();

/* ------------------------------------------------------------ helpers */

/** Group rows of a join table into a Map keyed by the left-hand id. */
function groupBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
}

function indexById(rows) {
  return new Map(rows.map((r) => [r.id, r]));
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

/**
 * Postgres hands back Date objects and jsonb defaults ({} for socials,
 * [] for gallery). The API contract — and the demo data it has to match
 * exactly — uses ISO strings and a null socials when there are none, so
 * the two modes are reconciled here rather than in each caller.
 */
function normaliseSpecialist(row) {
  const socials = row.socials && Object.values(row.socials).some(Boolean) ? row.socials : null;
  return {
    ...row,
    socials,
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    application: row.application && Object.keys(row.application).length ? row.application : null,
    verificationHistory: Array.isArray(row.verificationHistory) ? row.verificationHistory : [],
    nextAvailableAt: iso(row.nextAvailableAt),
    planSelectedAt: iso(row.planSelectedAt),
    planActivatedAt: iso(row.planActivatedAt),
    planRenewsAt: iso(row.planRenewsAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Database review row -> the shape the profile and aggregates expect. */
function toReview(row) {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    rating: row.rating,
    comment: row.comment,
    patientName: row.patientName,
    conditionId: row.conditionId,
    verified: row.verified,
    scores: {
      communication: row.scoreCommunication,
      expertise: row.scoreExpertise,
      care: row.scoreCare,
      waitTime: row.scoreWaitTime,
    },
    moderationStatus: row.moderationStatus,
    moderatedAt: iso(row.moderatedAt),
    moderationNote: row.moderationNote,
    response: row.response,
    responseAt: iso(row.responseAt),
    createdAt: iso(row.createdAt),
  };
}

/** The inverse, for writes. */
function fromReview(input) {
  return {
    id: input.id ?? newId("rev"),
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    rating: input.rating,
    comment: input.comment ?? null,
    patientName: input.patientName ?? null,
    conditionId: input.condition ?? input.conditionId ?? null,
    verified: Boolean(input.verified),
    scoreCommunication: input.scores?.communication ?? null,
    scoreExpertise: input.scores?.expertise ?? null,
    scoreCare: input.scores?.care ?? null,
    scoreWaitTime: input.scores?.waitTime ?? null,
    // A review is born pending. Nothing a caller passes can publish one
    // directly — approval goes through reviews.moderate() and an admin.
    moderationStatus: "pending",
    response: input.response ?? null,
  };
}

/* ======================================================== taxonomy */

export const taxonomy = {
  async specialties() {
    return db().select().from(t.specialties).orderBy(asc(t.specialties.name));
  },
  async facilityCategories() {
    return db().select().from(t.facilityCategories).orderBy(asc(t.facilityCategories.name));
  },
  async conditions() {
    return db().select().from(t.conditions).orderBy(asc(t.conditions.name));
  },
  async treatments() {
    return db().select().from(t.treatments).orderBy(asc(t.treatments.name));
  },
  async cities() {
    return db().select().from(t.cities).orderBy(asc(t.cities.name));
  },
  async regulators() {
    return db().select().from(t.regulators).orderBy(asc(t.regulators.code));
  },
  async countries() {
    return db().select().from(t.countries);
  },
  async specialtyBySlug(slug) {
    const [row] = await db().select().from(t.specialties).where(eq(t.specialties.slug, slug)).limit(1);
    return row ?? null;
  },
  async regulatorByCode(code) {
    const [row] = await db().select().from(t.regulators).where(eq(t.regulators.code, code)).limit(1);
    return row ?? null;
  },
  /** Add a treatment a specialist named that the platform doesn't have. */
  async createTreatment({ slug, name, specialtyId = null }) {
    const [row] = await db()
      .insert(t.treatments)
      .values({ slug, name, specialtyId })
      .onConflictDoNothing({ target: t.treatments.slug })
      .returning();
    if (row) return row;
    const [existing] = await db().select().from(t.treatments).where(eq(t.treatments.slug, slug)).limit(1);
    return existing;
  },
  async cityBySlug(slug) {
    const [row] = await db().select().from(t.cities).where(eq(t.cities.slug, slug)).limit(1);
    return row ?? null;
  },
};

/* ===================================================== specialists */

/**
 * Assemble specialists with everything a profile or a result card needs.
 *
 * `ids` narrows to specific rows; omit it for the whole directory.
 * Eight queries regardless of how many specialists come back — the join
 * rows and taxonomy are fetched once and stitched in memory.
 */
async function assembleSpecialists(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [
    specialtyLinks,
    conditionLinks,
    treatmentLinks,
    locationLinks,
    allSpecialties,
    allConditions,
    allTreatments,
    allRegulators,
    reviewRows,
  ] = await Promise.all([
    db().select().from(t.specialistSpecialties).where(inArray(t.specialistSpecialties.specialistId, ids)),
    db().select().from(t.specialistConditions).where(inArray(t.specialistConditions.specialistId, ids)),
    db().select().from(t.specialistTreatments).where(inArray(t.specialistTreatments.specialistId, ids)),
    db().select().from(t.specialistClinicLocations).where(inArray(t.specialistClinicLocations.specialistId, ids)),
    db().select().from(t.specialties),
    db().select().from(t.conditions),
    db().select().from(t.treatments),
    db().select().from(t.regulators),
    db()
      .select()
      .from(t.reviews)
      // Approved only. An unmoderated review must not reach a profile,
      // a card, an average or a JSON-LD aggregateRating — filtering here
      // means no caller can forget.
      .where(
        and(
          eq(t.reviews.subjectType, "specialist"),
          eq(t.reviews.moderationStatus, "approved"),
          inArray(t.reviews.subjectId, ids)
        )
      )
      .orderBy(desc(t.reviews.createdAt)),
  ]);

  const locationIds = [...new Set(locationLinks.map((l) => l.clinicLocationId))];
  const locationRows = locationIds.length
    ? await db().select().from(t.clinicLocations).where(inArray(t.clinicLocations.id, locationIds))
    : [];
  const cityIds = [...new Set(locationRows.map((l) => l.cityId))];
  const clinicIds = [...new Set(locationRows.map((l) => l.clinicId).filter(Boolean))];
  const [cityRows, clinicRows] = await Promise.all([
    cityIds.length ? db().select().from(t.cities).where(inArray(t.cities.id, cityIds)) : [],
    clinicIds.length ? db().select().from(t.clinics).where(inArray(t.clinics.id, clinicIds)) : [],
  ]);

  const specialtyById = indexById(allSpecialties);
  const conditionById = indexById(allConditions);
  const treatmentById = indexById(allTreatments);
  const regulatorById = indexById(allRegulators);
  const cityById = indexById(cityRows);
  const clinicById = indexById(clinicRows);
  const locationById = indexById(locationRows);

  const specialtiesFor = groupBy(specialtyLinks, "specialistId");
  const conditionsFor = groupBy(conditionLinks, "specialistId");
  const treatmentsFor = groupBy(treatmentLinks, "specialistId");
  const locationsFor = groupBy(locationLinks, "specialistId");
  const reviewsFor = groupBy(reviewRows, "subjectId");

  return rows.map((raw) => {
    const row = normaliseSpecialist(raw);
    const reviews = (reviewsFor.get(row.id) ?? []).map(toReview);
    const linkedSpecialties = (specialtiesFor.get(row.id) ?? [])
      .map((l) => specialtyById.get(l.specialtyId))
      .filter(Boolean);
    // The primary specialty is always part of the set, whether or not a
    // join row was written for it — the profile and the search facets
    // both assume that.
    const primarySpecialty = row.primarySpecialtyId ? specialtyById.get(row.primarySpecialtyId) ?? null : null;
    const specialtySet = new Map(linkedSpecialties.map((s) => [s.id, s]));
    if (primarySpecialty) specialtySet.set(primarySpecialty.id, primarySpecialty);

    return {
      ...row,
      // The address a Premium profile publishes for patients to write
      // to. Same inbox enquiries route to, but publishing it is a plan
      // feature — lib/profileGate.js strips it on Basic.
      publicEmail: row.contactEmail ?? null,
      primarySpecialty,
      regulator: row.regulatorId ? regulatorById.get(row.regulatorId) ?? null : null,
      specialties: [...specialtySet.values()],
      conditions: (conditionsFor.get(row.id) ?? []).map((l) => conditionById.get(l.conditionId)).filter(Boolean),
      treatments: (treatmentsFor.get(row.id) ?? []).map((l) => treatmentById.get(l.treatmentId)).filter(Boolean),
      clinicLocations: (locationsFor.get(row.id) ?? [])
        .map((link) => {
          const loc = locationById.get(link.clinicLocationId);
          if (!loc) return null;
          return {
            ...loc,
            city: cityById.get(loc.cityId) ?? null,
            clinic: loc.clinicId ? clinicById.get(loc.clinicId) ?? null : null,
          };
        })
        .filter(Boolean),
      reviews,
      reviewScores: aggregateReviewScores(reviews),
    };
  });
}

export const specialists = {
  /** Every specialist, with relations. */
  async all() {
    const rows = await db().select().from(t.specialists);
    return assembleSpecialists(rows);
  },

  /**
   * Only those the public directory is allowed to show.
   *
   * Two states, not one. "verified" is a listing somebody here checked
   * against the regulator's register; "unverified" is an unclaimed
   * listing seeded from a public professional directory, which is
   * visible precisely so the person it names can find it and claim it.
   * Neither carries the badge unless it is verified.
   *
   * "pending" is still excluded, and that is the important part: a
   * registration lands as pending, so nobody can publish themselves
   * into the directory. See isPubliclyVisible in the specialists
   * controller, which is the same rule for demo mode.
   *
   * The name is kept because every caller means "the public list"; the
   * alternative was renaming it at eight call sites to say the same
   * thing in more words.
   */
  async verified() {
    const rows = await db()
      .select()
      .from(t.specialists)
      .where(inArray(t.specialists.verificationStatus, ["verified", "unverified"]));
    return assembleSpecialists(rows);
  },

  async byStatus(status) {
    const rows = await db().select().from(t.specialists).where(eq(t.specialists.verificationStatus, status));
    return assembleSpecialists(rows);
  },

  async findBySlug(slug) {
    const rows = await db().select().from(t.specialists).where(eq(t.specialists.slug, slug)).limit(1);
    const [full] = await assembleSpecialists(rows);
    return full ?? null;
  },

  async findById(id) {
    const rows = await db().select().from(t.specialists).where(eq(t.specialists.id, id)).limit(1);
    const [full] = await assembleSpecialists(rows);
    return full ?? null;
  },

  /** The bare row, without relations — for updates and cheap checks. */
  async rawBySlug(slug) {
    const [row] = await db().select().from(t.specialists).where(eq(t.specialists.slug, slug)).limit(1);
    return row ?? null;
  },

  async rawById(id) {
    const [row] = await db().select().from(t.specialists).where(eq(t.specialists.id, id)).limit(1);
    return row ?? null;
  },

  async findByUserId(userId) {
    const rows = await db().select().from(t.specialists).where(eq(t.specialists.userId, userId)).limit(1);
    const [full] = await assembleSpecialists(rows);
    return full ?? null;
  },

  async slugExists(slug) {
    const [row] = await db()
      .select({ id: t.specialists.id })
      .from(t.specialists)
      .where(eq(t.specialists.slug, slug))
      .limit(1);
    return Boolean(row);
  },

  /**
   * Create a listing and its taxonomy links in one transaction — a
   * half-written specialist with no specialties is worse than no
   * specialist at all.
   */
  async create(data, { specialtyIds = [], conditionIds = [], treatmentIds = [], locationIds = [] } = {}) {
    const id = data.id ?? newId("spc");
    await db().transaction(async (tx) => {
      await tx.insert(t.specialists).values({ ...data, id });
      await linkAll(tx, id, { specialtyIds, conditionIds, treatmentIds, locationIds });
    });
    return specialists.findById(id);
  },

  /** Patch columns. Relations are handled by setLinks(). */
  async update(id, patch) {
    if (Object.keys(patch).length === 0) return specialists.rawById(id);
    const [row] = await db()
      .update(t.specialists)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.specialists.id, id))
      .returning();
    return row ?? null;
  },

  /** Replace a specialist's taxonomy links wholesale. */
  async setLinks(id, { specialtyIds, conditionIds, treatmentIds, locationIds }) {
    await db().transaction(async (tx) => {
      if (specialtyIds) {
        await tx.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialistId, id));
      }
      if (conditionIds) {
        await tx.delete(t.specialistConditions).where(eq(t.specialistConditions.specialistId, id));
      }
      if (treatmentIds) {
        await tx.delete(t.specialistTreatments).where(eq(t.specialistTreatments.specialistId, id));
      }
      if (locationIds) {
        await tx.delete(t.specialistClinicLocations).where(eq(t.specialistClinicLocations.specialistId, id));
      }
      await linkAll(tx, id, { specialtyIds, conditionIds, treatmentIds, locationIds });
    });
  },

  /** Assembled specialists by id — used by the homepage review strip. */
  async byIds(ids) {
    if (!ids.length) return [];
    const rows = await db().select().from(t.specialists).where(inArray(t.specialists.id, ids));
    return assembleSpecialists(rows);
  },

  async recomputeRating(id) {
    const rows = await db()
      .select()
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.subjectType, "specialist"),
          eq(t.reviews.moderationStatus, "approved"),
          eq(t.reviews.subjectId, id)
        )
      );
    // lib/ratings.js is the single place the rounding rule lives, so the
    // cached aggregate can never disagree with what the profile shows.
    const { ratingAvg, ratingCount } = deriveRating(rows);
    await db()
      .update(t.specialists)
      .set({ ratingAvg, ratingCount, updatedAt: new Date() })
      .where(eq(t.specialists.id, id));
    return { ratingAvg, ratingCount };
  },

  async countByStatus() {
    const rows = await db()
      .select({ status: t.specialists.verificationStatus, count: sql`count(*)::int` })
      .from(t.specialists)
      .groupBy(t.specialists.verificationStatus);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  },
};

async function linkAll(tx, specialistId, { specialtyIds, conditionIds, treatmentIds, locationIds }) {
  const pairs = [
    [t.specialistSpecialties, "specialtyId", specialtyIds],
    [t.specialistConditions, "conditionId", conditionIds],
    [t.specialistTreatments, "treatmentId", treatmentIds],
    [t.specialistClinicLocations, "clinicLocationId", locationIds],
  ];
  for (const [table, column, ids] of pairs) {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (unique.length === 0) continue;
    await tx
      .insert(table)
      .values(unique.map((value) => ({ specialistId, [column]: value })))
      .onConflictDoNothing();
  }
}

/* ========================================================== clinics */

export const clinics = {
  async all() {
    const rows = await db().select().from(t.clinics);
    return assembleClinics(rows);
  },
  async findBySlug(slug) {
    const rows = await db().select().from(t.clinics).where(eq(t.clinics.slug, slug)).limit(1);
    const [full] = await assembleClinics(rows);
    return full ?? null;
  },
};

async function assembleClinics(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const locationRows = await db().select().from(t.clinicLocations).where(inArray(t.clinicLocations.clinicId, ids));
  const cityIds = [...new Set(locationRows.map((l) => l.cityId))];
  const cityRows = cityIds.length ? await db().select().from(t.cities).where(inArray(t.cities.id, cityIds)) : [];
  const cityById = indexById(cityRows);

  const locationIds = locationRows.map((l) => l.id);
  const links = locationIds.length
    ? await db()
        .select()
        .from(t.specialistClinicLocations)
        .where(inArray(t.specialistClinicLocations.clinicLocationId, locationIds))
    : [];
  const specialistIds = [...new Set(links.map((l) => l.specialistId))];
  const specialistRows = specialistIds.length
    ? await db().select().from(t.specialists).where(inArray(t.specialists.id, specialistIds))
    : [];
  const locationsByClinic = groupBy(locationRows, "clinicId");
  const locationIdsByClinic = new Map(
    [...locationsByClinic.entries()].map(([clinicId, locs]) => [clinicId, new Set(locs.map((l) => l.id))])
  );

  return rows.map((clinic) => {
    const own = locationIdsByClinic.get(clinic.id) ?? new Set();
    const ownSpecialistIds = new Set(links.filter((l) => own.has(l.clinicLocationId)).map((l) => l.specialistId));
    return {
      ...clinic,
      locations: (locationsByClinic.get(clinic.id) ?? []).map((l) => ({
        ...l,
        city: cityById.get(l.cityId) ?? null,
      })),
      specialists: specialistRows.filter((s) => ownSpecialistIds.has(s.id)),
    };
  });
}

/** Practice addresses a specialist owns outright, replaced wholesale. */
export const clinicLocations = {
  async createOwned(specialistId, rows) {
    if (rows.length === 0) return [];
    return db()
      .insert(t.clinicLocations)
      .values(rows.map((r) => ({ ...r, id: r.id ?? newId("loc"), ownedBySpecialistId: specialistId })))
      .returning();
  },
  async deleteOwned(specialistId) {
    await db().delete(t.clinicLocations).where(eq(t.clinicLocations.ownedBySpecialistId, specialistId));
  },
  async findById(id) {
    const [row] = await db().select().from(t.clinicLocations).where(eq(t.clinicLocations.id, id)).limit(1);
    return row ?? null;
  },
};

/* ======================================================= facilities */

export const facilities = {
  async all() {
    const rows = await db().select().from(t.facilities);
    return assembleFacilities(rows);
  },
  async findBySlug(slug) {
    const rows = await db().select().from(t.facilities).where(eq(t.facilities.slug, slug)).limit(1);
    const [full] = await assembleFacilities(rows);
    return full ?? null;
  },
  async findById(id) {
    const rows = await db().select().from(t.facilities).where(eq(t.facilities.id, id)).limit(1);
    const [full] = await assembleFacilities(rows);
    return full ?? null;
  },
  async byIds(ids) {
    if (!ids.length) return [];
    const rows = await db().select().from(t.facilities).where(inArray(t.facilities.id, ids));
    return assembleFacilities(rows);
  },

  /** Mirrors specialists.recomputeRating — one rounding rule, two tables. */
  async recomputeRating(id) {
    const rows = await db()
      .select()
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.subjectType, "facility"),
          eq(t.reviews.moderationStatus, "approved"),
          eq(t.reviews.subjectId, id)
        )
      );
    const { ratingAvg, ratingCount } = deriveRating(rows);
    await db()
      .update(t.facilities)
      .set({ ratingAvg, ratingCount, updatedAt: new Date() })
      .where(eq(t.facilities.id, id));
    return { ratingAvg, ratingCount };
  },
};

/**
 * jsonb, arrays and timestamps come back from the driver in shapes the
 * profile page should never have to defend against — a null gallery, a
 * socials object whose every value is empty, a Date where the API
 * contract says ISO string. Same normalisation the specialist rows get,
 * for the same reason: the page renders one shape or the other, and it
 * should not be able to tell which mode it is running in.
 */
function normaliseFacility(row) {
  const socials = row.socials && Object.values(row.socials).some(Boolean) ? row.socials : null;
  const hours =
    row.openingHours && typeof row.openingHours === "object" && Object.keys(row.openingHours).length
      ? row.openingHours
      : null;
  return {
    ...row,
    socials,
    openingHours: hours,
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    languages: Array.isArray(row.languages) ? row.languages : [],
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    insurers: Array.isArray(row.insurers) ? row.insurers : [],
    accreditations: Array.isArray(row.accreditations) ? row.accreditations : [],
    application: row.application && Object.keys(row.application).length ? row.application : null,
    verificationHistory: Array.isArray(row.verificationHistory) ? row.verificationHistory : [],
    regulatorRatedAt: iso(row.regulatorRatedAt),
    planSelectedAt: iso(row.planSelectedAt),
    planActivatedAt: iso(row.planActivatedAt),
    planRenewsAt: iso(row.planRenewsAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function assembleFacilities(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [links, allCategories, cityRows, teamLinks, reviewRows] = await Promise.all([
    db().select().from(t.facilityCategoryLinks).where(inArray(t.facilityCategoryLinks.facilityId, ids)),
    db().select().from(t.facilityCategories),
    db().select().from(t.cities),
    db().select().from(t.facilityTeam).where(inArray(t.facilityTeam.facilityId, ids)),
    db()
      .select()
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.subjectType, "facility"),
          eq(t.reviews.moderationStatus, "approved"),
          inArray(t.reviews.subjectId, ids)
        )
      )
      .orderBy(desc(t.reviews.createdAt)),
  ]);

  // Only the handful of specialists actually on a team, and only the
  // columns a team card shows — a facility listing is not a back door
  // into the full specialist record.
  const specialistIds = [...new Set(teamLinks.map((l) => l.specialistId))];
  const specialistRows = specialistIds.length
    ? await db()
        .select({
          id: t.specialists.id,
          slug: t.specialists.slug,
          fullName: t.specialists.fullName,
          title: t.specialists.title,
          photoUrl: t.specialists.photoUrl,
          verificationStatus: t.specialists.verificationStatus,
          ratingAvg: t.specialists.ratingAvg,
          ratingCount: t.specialists.ratingCount,
          primarySpecialtyId: t.specialists.primarySpecialtyId,
        })
        .from(t.specialists)
        .where(inArray(t.specialists.id, specialistIds))
    : [];
  const specialtyIds = [...new Set(specialistRows.map((s) => s.primarySpecialtyId).filter(Boolean))];
  const specialtyRows = specialtyIds.length
    ? await db().select().from(t.specialties).where(inArray(t.specialties.id, specialtyIds))
    : [];
  const specialtyById = indexById(specialtyRows);
  const specialistById = indexById(specialistRows);

  const categoryById = indexById(allCategories);
  const cityById = indexById(cityRows);
  const linksFor = groupBy(links, "facilityId");
  const teamFor = groupBy(teamLinks, "facilityId");
  const reviewsFor = groupBy(reviewRows, "subjectId");

  return rows.map((row) => ({
    ...normaliseFacility(row),
    city: cityById.get(row.cityId) ?? null,
    categories: (linksFor.get(row.id) ?? []).map((l) => categoryById.get(l.categoryId)).filter(Boolean),
    team: (teamFor.get(row.id) ?? [])
      .map((l) => {
        const sp = specialistById.get(l.specialistId);
        if (!sp) return null;
        const { primarySpecialtyId, ...rest } = sp;
        return {
          ...rest,
          role: l.role ?? null,
          primarySpecialty: primarySpecialtyId ? (specialtyById.get(primarySpecialtyId) ?? null) : null,
        };
      })
      .filter(Boolean),
    reviews: (reviewsFor.get(row.id) ?? []).map(toReview),
    reviewScores: aggregateReviewScores((reviewsFor.get(row.id) ?? []).map(toReview)),
  }));
}

/* ============================================================ users */

export const users = {
  async findByEmail(email) {
    const [row] = await db()
      .select()
      .from(t.users)
      .where(eq(t.users.email, String(email).toLowerCase().trim()))
      .limit(1);
    return row ? withSpecialistId(row) : null;
  },
  async findById(id) {
    const [row] = await db().select().from(t.users).where(eq(t.users.id, id)).limit(1);
    return row ? withSpecialistId(row) : null;
  },
  async create(data) {
    const [row] = await db()
      .insert(t.users)
      .values({ ...data, id: data.id ?? newId("usr"), email: String(data.email).toLowerCase().trim() })
      .returning();
    return withSpecialistId(row);
  },
  async update(id, patch) {
    const [row] = await db()
      .update(t.users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.users.id, id))
      .returning();
    return row ? withSpecialistId(row) : null;
  },
  async count() {
    const [row] = await db().select({ count: sql`count(*)::int` }).from(t.users);
    return row?.count ?? 0;
  },
  /**
   * Every account, with the listing it owns already attached.
   *
   * One query with a join rather than `attachSpecialistId` per row:
   * that helper does a lookup each time it is called, which is fine for
   * one signed-in user on a request and is N+1 for a members list.
   */
  async all() {
    const rows = await db()
      .select({ user: t.users, specialistId: t.specialists.id })
      .from(t.users)
      .leftJoin(t.specialists, eq(t.specialists.userId, t.users.id));
    return rows.map(({ user, specialistId }) => ({ ...user, specialistId: specialistId ?? null }));
  },
  async admins() {
    const rows = await db()
      .select()
      .from(t.users)
      .where(and(eq(t.users.role, "admin"), eq(t.users.active, true)));
    return rows.map(withSpecialistId);
  },
};

/**
 * The specialist link lives on the specialist row (one nullable, unique
 * user_id) rather than on the user, but middleware/auth.js and every
 * dashboard endpoint read `user.specialistId`. Resolved lazily so the
 * common case — an admin, or a sign-in — costs nothing.
 */
function withSpecialistId(user) {
  let cached;
  return Object.defineProperty({ ...user }, "specialistId", {
    enumerable: true,
    get() {
      return cached;
    },
    set(value) {
      cached = value;
    },
  });
}

/** Attach the specialist id for accounts that administer a profile. */
export async function attachSpecialistId(user) {
  if (!user || user.role === "admin") return user;
  const [row] = await db()
    .select({ id: t.specialists.id })
    .from(t.specialists)
    .where(eq(t.specialists.userId, user.id))
    .limit(1);
  user.specialistId = row?.id ?? null;
  return user;
}

/* ========================================================== reviews */

export const reviews = {
  /**
   * Reviews of one subject. Approved only by default — passing a
   * different status is how the specialist's own dashboard sees what is
   * still waiting on us, and how the admin queue sees everything.
   */
  async forSubject(subjectType, subjectId, { status = "approved" } = {}) {
    const clauses = [eq(t.reviews.subjectType, subjectType), eq(t.reviews.subjectId, subjectId)];
    if (status) clauses.push(eq(t.reviews.moderationStatus, status));
    const rows = await db()
      .select()
      .from(t.reviews)
      .where(and(...clauses))
      .orderBy(desc(t.reviews.createdAt));
    return rows.map(toReview);
  },

  async findById(id) {
    const [row] = await db().select().from(t.reviews).where(eq(t.reviews.id, id)).limit(1);
    return row ? toReview(row) : null;
  },

  /** The admin moderation queue, oldest first — longest wait, first seen. */
  async byModeration(status = "pending", limit = 200) {
    const rows = await db()
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.moderationStatus, status))
      .orderBy(asc(t.reviews.createdAt))
      .limit(limit);
    return rows.map(toReview);
  },

  async countByModeration() {
    const rows = await db()
      .select({ status: t.reviews.moderationStatus, count: sql`count(*)::int` })
      .from(t.reviews)
      .groupBy(t.reviews.moderationStatus);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  },

  /**
   * Publish or reject. Returns the raw row (not toReview) because the
   * caller needs subjectType/subjectId to recompute the right aggregate.
   */
  async moderate(id, { status, byUserId = null, note = null }) {
    const [row] = await db()
      .update(t.reviews)
      .set({
        moderationStatus: status,
        moderatedByUserId: byUserId,
        moderatedAt: new Date(),
        moderationNote: note,
      })
      .where(eq(t.reviews.id, id))
      .returning();
    return row ?? null;
  },

  /** The provider's reply. Deliberately not moderated. */
  async respond(id, response) {
    const [row] = await db()
      .update(t.reviews)
      .set({ response, responseAt: new Date() })
      .where(eq(t.reviews.id, id))
      .returning();
    return row ? toReview(row) : null;
  },

  /**
   * Pending reviews older than `cutoff` that have not been chased yet.
   * `reminderSentAt` is what makes the 24-hour chase fire exactly once
   * per review rather than every time the sweep runs.
   */
  async overduePending(cutoff) {
    const rows = await db()
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.moderationStatus, "pending"), lt(t.reviews.createdAt, cutoff)))
      .orderBy(asc(t.reviews.createdAt));
    return rows.filter((r) => !r.reminderSentAt).map(toReview);
  },

  async markReminded(id) {
    await db().update(t.reviews).set({ reminderSentAt: new Date() }).where(eq(t.reviews.id, id));
  },
  async create(input) {
    const [row] = await db().insert(t.reviews).values(fromReview(input)).returning();
    return toReview(row);
  },
  async count() {
    const [row] = await db().select({ count: sql`count(*)::int` }).from(t.reviews);
    return row?.count ?? 0;
  },
};

/* ============================================================ leads */

export const leads = {
  async create(input) {
    const [row] = await db()
      .insert(t.leads)
      .values({ ...input, id: input.id ?? newId("lead") })
      .returning();
    return row;
  },
  async forSpecialist(specialistId) {
    return db()
      .select()
      .from(t.leads)
      .where(eq(t.leads.specialistId, specialistId))
      .orderBy(desc(t.leads.createdAt));
  },
  async findById(id) {
    const [row] = await db().select().from(t.leads).where(eq(t.leads.id, id)).limit(1);
    return row ?? null;
  },
  async update(id, patch) {
    const [row] = await db().update(t.leads).set(patch).where(eq(t.leads.id, id)).returning();
    return row ?? null;
  },
  async all() {
    return db().select().from(t.leads).orderBy(desc(t.leads.createdAt));
  },
  /** Enquiries withheld by the Basic cap, oldest first. */
  async held() {
    return db()
      .select()
      .from(t.leads)
      .where(eq(t.leads.held, true))
      .orderBy(asc(t.leads.createdAt));
  },

  async release(id) {
    const [row] = await db()
      .update(t.leads)
      .set({ held: false, releasedAt: new Date() })
      .where(eq(t.leads.id, id))
      .returning();
    return row ?? null;
  },

  /**
   * How many enquiries a specialist has received this calendar month —
   * the Basic tier's cap is counted here rather than trusted from a
   * stored counter that could drift.
   */
  async countThisMonth(specialistId) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const [row] = await db()
      .select({ count: sql`count(*)::int` })
      .from(t.leads)
      .where(
        and(
          eq(t.leads.specialistId, specialistId),
          eq(t.leads.held, false),
          sql`${t.leads.createdAt} >= ${start}`
        )
      );
    return row?.count ?? 0;
  },
};

export { toReview, fromReview, assembleSpecialists, normaliseSpecialist };


/* ============================================================= audit */

export const adminAudit = {
  /**
   * Write one line. Never throws into the caller: an action must not
   * fail because the log did, and a missing line is visible in the log
   * itself as a gap rather than as a broken feature.
   */
  async record(entry) {
    try {
      const [row] = await db()
        .insert(t.adminAudit)
        .values({ id: newId("aud"), ...entry })
        .returning();
      return row;
    } catch (err) {
      console.error("[audit] could not record", entry?.action, err?.message);
      return null;
    }
  },
  async recent({ limit = 100, subjectId = null } = {}) {
    const base = db().select().from(t.adminAudit);
    const rows = subjectId
      ? await base.where(eq(t.adminAudit.subjectId, subjectId)).orderBy(desc(t.adminAudit.createdAt)).limit(limit)
      : await base.orderBy(desc(t.adminAudit.createdAt)).limit(limit);
    return rows;
  },
};
