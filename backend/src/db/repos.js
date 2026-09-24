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

import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
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

  /**
   * ClinWell's own clinic slug, for the §7 embed URL. One column, on
   * purpose: it is the only ClinWell value a person ever sets by hand,
   * and it is part of a contract with a third party.
   *
   * Null means "no booking embed" — never "use our slug instead". Our
   * slug on their host builds a URL that 404s.
   */
  async setClinwellClinicSlug(id, slug) {
    const [row] = await db()
      .update(t.specialists)
      .set({ clinwellClinicSlug: slug })
      .where(eq(t.specialists.id, id))
      .returning({ id: t.specialists.id, clinwellClinicSlug: t.specialists.clinwellClinicSlug });
    return row ?? null;
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
  /* ------------------------------------------------ one link at a time

     setLinks below REPLACES a listing's links, which is what a profile
     editor wants: the form holds the whole set. These four are for the
     admin's bulk actions, which add or remove a single tag across many
     listings at once — there, replacing would mean one click emptying
     twelve profiles of everything the click did not mention.

     onConflictDoNothing rather than a read-then-write: adding a specialty
     a listing already has should be a no-op, not a duplicate-key error
     halfway through a batch. */
  async addSpecialty(specialistId, specialtyId) {
    await db()
      .insert(t.specialistSpecialties)
      .values({ specialistId, specialtyId })
      .onConflictDoNothing();
  },

  async removeSpecialty(specialistId, specialtyId) {
    await db()
      .delete(t.specialistSpecialties)
      .where(
        and(
          eq(t.specialistSpecialties.specialistId, specialistId),
          eq(t.specialistSpecialties.specialtyId, specialtyId)
        )
      );
  },

  async addLocation(specialistId, clinicLocationId) {
    await db()
      .insert(t.specialistClinicLocations)
      .values({ specialistId, clinicLocationId })
      .onConflictDoNothing();
  },

  async removeLocation(specialistId, clinicLocationId) {
    await db()
      .delete(t.specialistClinicLocations)
      .where(
        and(
          eq(t.specialistClinicLocations.specialistId, specialistId),
          eq(t.specialistClinicLocations.clinicLocationId, clinicLocationId)
        )
      );
  },

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
  /* The fourth element is the provenance the join table records, where
     it records one. Anything written through here came from a person
     using the site — a clinician who claimed the listing, or an admin
     on their behalf — so it is tagged "profile", which is what keeps
     the derivation scripts' --replace from ever deleting it. The two
     tables with no source column take null and ignore it. */
  const pairs = [
    [t.specialistSpecialties, "specialtyId", specialtyIds, null],
    [t.specialistConditions, "conditionId", conditionIds, t.LINK_SOURCES.profile],
    [t.specialistTreatments, "treatmentId", treatmentIds, t.LINK_SOURCES.profile],
    [t.specialistClinicLocations, "clinicLocationId", locationIds, null],
  ];
  for (const [table, column, ids, source] of pairs) {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (unique.length === 0) continue;
    await tx
      .insert(table)
      .values(unique.map((value) => ({ specialistId, [column]: value, ...(source ? { source } : {}) })))
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

  /**
   * Every location, named the way a person would recognise it, for the
   * admin's location picker.
   *
   * Locations a specialist owns privately (ownedBySpecialistId) are left
   * out: those are one consultant's own consulting address, not a place
   * another listing should be filed at.
   */
  async listForPicker() {
    const rows = await db()
      .select({
        id: t.clinicLocations.id,
        address: t.clinicLocations.address,
        postcode: t.clinicLocations.postcode,
        clinicName: t.clinics.name,
        cityName: t.cities.name,
        ownedBy: t.clinicLocations.ownedBySpecialistId,
      })
      .from(t.clinicLocations)
      .leftJoin(t.clinics, eq(t.clinics.id, t.clinicLocations.clinicId))
      .leftJoin(t.cities, eq(t.cities.id, t.clinicLocations.cityId));

    return rows
      .filter((r) => !r.ownedBy)
      .map(({ ownedBy, ...r }) => r)
      .sort((a, b) => String(a.clinicName ?? "").localeCompare(String(b.clinicName ?? "")));
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

/* ------------------------------------------------------------------ *
 * Articles
 *
 * Rows come back exactly as the demo array in data/mock.js supplies
 * them, so the blog controller never branches on which mode it is in.
 * ------------------------------------------------------------------ */
export const articles = {
  /** Published only, newest first — what the public blog reads. */
  async published({ tag = null, specialtyId = null } = {}) {
    const where = [eq(t.articles.status, "published")];
    if (specialtyId) where.push(eq(t.articles.specialtyId, specialtyId));
    const rows = await db()
      .select()
      .from(t.articles)
      .where(and(...where))
      .orderBy(desc(t.articles.publishedAt));
    // Tag filtering in JavaScript rather than SQL: the array containment
    // operator differs across drivers, the set is small, and this keeps
    // the demo and database paths behaving identically.
    return tag ? rows.filter((r) => (r.tags ?? []).includes(tag)) : rows;
  },

  /** Everything, including drafts — the admin list. */
  async all() {
    return db().select().from(t.articles).orderBy(desc(t.articles.updatedAt));
  },

  /** One member's own articles, whatever state they are in. */
  async forAuthorSpecialist(specialistId) {
    return db()
      .select()
      .from(t.articles)
      .where(eq(t.articles.authorSpecialistId, specialistId))
      .orderBy(desc(t.articles.updatedAt));
  },

  /** The review queue: submitted, oldest first, because that is fair. */
  async awaitingReview() {
    return db()
      .select()
      .from(t.articles)
      .where(eq(t.articles.status, "in_review"))
      .orderBy(asc(t.articles.submittedAt));
  },

  async findBySlug(slug) {
    const [row] = await db().select().from(t.articles).where(eq(t.articles.slug, slug)).limit(1);
    return row ?? null;
  },

  async findById(id) {
    const [row] = await db().select().from(t.articles).where(eq(t.articles.id, id)).limit(1);
    return row ?? null;
  },

  /** The row a re-import should update rather than duplicate. */
  async findBySource(source, sourceRef) {
    if (!sourceRef) return null;
    const [row] = await db()
      .select()
      .from(t.articles)
      .where(and(eq(t.articles.source, source), eq(t.articles.sourceRef, sourceRef)))
      .limit(1);
    return row ?? null;
  },

  async create(input) {
    const [row] = await db()
      .insert(t.articles)
      .values({ ...input, id: input.id ?? newId("art") })
      .returning();
    return row;
  },

  async update(id, patch) {
    const [row] = await db()
      .update(t.articles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.articles.id, id))
      .returning();
    return row ?? null;
  },

  async remove(id) {
    await db().delete(t.articles).where(eq(t.articles.id, id));
  },

  /** Fire-and-forget: a failed counter must never fail a page view. */
  async recordView(id) {
    await db()
      .update(t.articles)
      .set({ viewCount: sql`${t.articles.viewCount} + 1` })
      .where(eq(t.articles.id, id))
      .catch(() => {});
  },
};

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


/* ========================================================== ClinWell */

/**
 * The outbound event outbox. The contract's retry schedule runs for
 * over fourteen hours (§4.1), so an event is a row that survives a
 * deploy rather than an awaited call inside a request.
 */
export const clinwellEvents = {
  async create(input) {
    const [row] = await db()
      .insert(t.clinwellEvents)
      .values({ id: input.id ?? newId("cwe"), ...input })
      .returning();
    return row;
  },

  /**
   * Is this practice already using that exact instant? ClinWell orders
   * by occurredAt, so a tie is a state it has to break arbitrarily —
   * and between "cancelled" and "resumed" that is the difference
   * between a practice keeping access and losing it.
   */
  async occupied(specialistId, occurredAt) {
    const [row] = await db()
      .select({ id: t.clinwellEvents.id })
      .from(t.clinwellEvents)
      .where(
        and(eq(t.clinwellEvents.specialistId, specialistId), eq(t.clinwellEvents.occurredAt, occurredAt))
      )
      .limit(1);
    return Boolean(row);
  },

  /** Undelivered, not dead, due now — oldest first, so order is kept. */
  async due(limit = 25) {
    return db()
      .select()
      .from(t.clinwellEvents)
      .where(
        and(
          sql`${t.clinwellEvents.deliveredAt} is null`,
          sql`${t.clinwellEvents.deadAt} is null`,
          lt(t.clinwellEvents.nextAttemptAt, new Date())
        )
      )
      .orderBy(asc(t.clinwellEvents.occurredAt))
      .limit(limit);
  },

  async markDelivered(id, { status, response }) {
    const [row] = await db()
      .update(t.clinwellEvents)
      .set({
        deliveredAt: new Date(),
        lastStatus: status ?? null,
        lastError: null,
        response: response ?? null,
        attempts: sql`${t.clinwellEvents.attempts} + 1`,
      })
      .where(eq(t.clinwellEvents.id, id))
      .returning();
    return row ?? null;
  },

  async scheduleRetry(id, { attempts, nextAttemptAt, status, error }) {
    const [row] = await db()
      .update(t.clinwellEvents)
      .set({ attempts, nextAttemptAt, lastStatus: status ?? null, lastError: error ?? null })
      .where(eq(t.clinwellEvents.id, id))
      .returning();
    return row ?? null;
  },

  async markDead(id, { status, error, attempts }) {
    const [row] = await db()
      .update(t.clinwellEvents)
      .set({ deadAt: new Date(), attempts, lastStatus: status ?? null, lastError: error ?? null })
      .where(eq(t.clinwellEvents.id, id))
      .returning();
    return row ?? null;
  },

  async findByEventId(eventId) {
    const [row] = await db()
      .select()
      .from(t.clinwellEvents)
      .where(eq(t.clinwellEvents.eventId, eventId))
      .limit(1);
    return row ?? null;
  },

  /**
   * Clear a death so the sweep picks it up again.
   *
   * occurredAt is deliberately untouched: ClinWell orders by it (§6.6),
   * so restamping a requeued event with "now" would let a cancellation
   * from last week override a resumption from Wednesday. Attempts reset
   * to zero because the practice is getting a fresh schedule, not a
   * sixth attempt at the old one.
   */
  async revive(id) {
    const [row] = await db()
      .update(t.clinwellEvents)
      .set({ deadAt: null, attempts: 0, nextAttemptAt: new Date(), lastError: null, lastStatus: null })
      .where(eq(t.clinwellEvents.id, id))
      .returning();
    return row ?? null;
  },

  async findById(id) {
    const [row] = await db().select().from(t.clinwellEvents).where(eq(t.clinwellEvents.id, id)).limit(1);
    return row ?? null;
  },

  /** For the admin screen: what has died and needs a person. */
  async dead(limit = 50) {
    return db()
      .select()
      .from(t.clinwellEvents)
      .where(sql`${t.clinwellEvents.deadAt} is not null`)
      .orderBy(desc(t.clinwellEvents.deadAt))
      .limit(limit);
  },
};

/**
 * Inbound badge batches. A repeated batchId must return the FIRST
 * response rather than apply twice (Appendix B), so the response is
 * stored on the row — it is the only way to honour that.
 */
export const clinwellBatches = {
  /**
   * Claim a batchId. Returns { claimed: true } for a new one, the
   * stored row for one already seen. The insert is the lock: two
   * concurrent deliveries of the same batch race on the primary key
   * and exactly one wins, which is what makes the 409 correct rather
   * than a guess.
   */
  async claim(batchId, practiceCount) {
    const existing = await this.find(batchId);
    if (existing) return { claimed: false, row: existing };
    try {
      const [row] = await db()
        .insert(t.clinwellBatches)
        .values({ batchId, practiceCount: practiceCount ?? null })
        .returning();
      return { claimed: true, row };
    } catch {
      /* Lost the race. Whoever won is either still working (409) or
         finished (duplicate), and find() tells the caller which. */
      const row = await this.find(batchId);
      return { claimed: false, row: row ?? null };
    }
  },

  async find(batchId) {
    const [row] = await db()
      .select()
      .from(t.clinwellBatches)
      .where(eq(t.clinwellBatches.batchId, batchId))
      .limit(1);
    return row ?? null;
  },

  async complete(batchId, response) {
    const [row] = await db()
      .update(t.clinwellBatches)
      .set({ completedAt: new Date(), response })
      .where(eq(t.clinwellBatches.batchId, batchId))
      .returning();
    return row ?? null;
  },

  /** A batch that never completed must not block the next delivery. */
  async release(batchId) {
    await db().delete(t.clinwellBatches).where(eq(t.clinwellBatches.batchId, batchId));
  },
};

/**
 * The badge, and only the badge.
 *
 * This is a deliberately tiny repo with a deliberately tiny surface,
 * because it is the write path for data that arrives from outside the
 * company (the nightly ClinWell push, Appendix B). `set` names five
 * columns and can reach nothing else: verificationStatus, plan,
 * publication and contact details are not addressable from here.
 *
 * "Runs on ClinWell" is a statement about a software subscription.
 * "Verified" is a statement that a human checked a licence against a
 * regulator's register. Keeping them on separate write paths is what
 * stops a billing failure at a software vendor from ever downgrading a
 * clinician's credibility on a healthcare directory.
 */
export const clinwellBadges = {
  /**
   * Just the columns the decision needs — no profile assembly.
   *
   * Matches OUR slug, because that is what the nightly push carries.
   * Sahil confirmed `practice.slug` is the TLS slug in both directions,
   * and that ClinWell's own clinic slug ("dkc") never travels in the
   * badge batch — the two are joined on their side by the workspace
   * row.
   *
   * An earlier version also matched the clinic slug. That was tolerance
   * for a contract ambiguity which has since been resolved, and it
   * carried a real hazard: if one clinic's ClinWell slug ever equalled
   * another practice's TLS slug, a push would have applied a badge to
   * the wrong listing.
   */
  async forSlug(slug) {
    const [row] = await db()
      .select({
        id: t.specialists.id,
        slug: t.specialists.slug,
        fullName: t.specialists.fullName,
        clinwellClinicSlug: t.specialists.clinwellClinicSlug,
        clinwellWorkspaceId: t.specialists.clinwellWorkspaceId,
        clinwellLive: t.specialists.clinwellLive,
        clinwellLiveAt: t.specialists.clinwellLiveAt,
        clinwellStatus: t.specialists.clinwellStatus,
        clinwellStatusAt: t.specialists.clinwellStatusAt,
        clinwellBadgeExpiresAt: t.specialists.clinwellBadgeExpiresAt,
      })
      .from(t.specialists)
      .where(eq(t.specialists.slug, slug))
      .limit(1);
    return row ?? null;
  },

  /**
   * Write the badge. Every field is picked out by name rather than
   * spread from the argument, so a caller cannot smuggle in a column
   * this endpoint has no business writing.
   */
  async set(id, patch) {
    const [row] = await db()
      .update(t.specialists)
      .set({
        clinwellLive: Boolean(patch.clinwellLive),
        clinwellLiveAt: patch.clinwellLiveAt ?? null,
        clinwellBadgeExpiresAt: patch.clinwellBadgeExpiresAt ?? null,
        clinwellStatus: patch.clinwellStatus ?? null,
        clinwellStatusAt: patch.clinwellStatusAt ?? null,
      })
      .where(eq(t.specialists.id, id))
      .returning({
        id: t.specialists.id,
        clinwellLive: t.specialists.clinwellLive,
        clinwellStatus: t.specialists.clinwellStatus,
      });
    return row ?? null;
  },

  /** Live badges nobody has confirmed since `before` (Appendix B: 72h). */
  async expiredBefore(before) {
    return db()
      .select({
        id: t.specialists.id,
        slug: t.specialists.slug,
        clinwellStatus: t.specialists.clinwellStatus,
        clinwellStatusAt: t.specialists.clinwellStatusAt,
      })
      .from(t.specialists)
      .where(
        and(
          eq(t.specialists.clinwellLive, true),
          sql`${t.specialists.clinwellBadgeExpiresAt} is not null`,
          lt(t.specialists.clinwellBadgeExpiresAt, before)
        )
      );
  },
};

/**
 * Enquiry forwarding state (§4.3). Separate from the `leads` repo so
 * the forwarding sweep cannot accidentally reach a patient's details
 * through a general-purpose update.
 */
export const clinwellForwarding = {
  /**
   * Enquiries cleared for forwarding, not yet forwarded, due now.
   *
   * `forwardableAt is not null` is the permission check, and it is the
   * whole safeguard: rows created before forwarding became lawful have
   * no value there and can never be selected, however the sweep is
   * called. Age is capped too, so a queue that went unnoticed for a
   * fortnight does not suddenly deliver a fortnight of enquiries.
   */
  async due({ limit = 25, maxAgeMs = 48 * 3600_000 } = {}) {
    const oldest = new Date(Date.now() - maxAgeMs);
    return db()
      .select()
      .from(t.leads)
      .where(
        and(
          sql`${t.leads.clinwellForwardableAt} is not null`,
          sql`${t.leads.clinwellForwardedAt} is null`,
          sql`(${t.leads.clinwellNextAttemptAt} is null or ${t.leads.clinwellNextAttemptAt} < now())`,
          sql`${t.leads.createdAt} > ${oldest}`
        )
      )
      .orderBy(asc(t.leads.createdAt))
      .limit(limit);
  },

  async markForwarded(id, { leadId, attempts }) {
    const [row] = await db()
      .update(t.leads)
      .set({
        clinwellForwardedAt: new Date(),
        clinwellLeadId: leadId ?? null,
        clinwellAttempts: attempts,
        clinwellNextAttemptAt: null,
        clinwellLastError: null,
      })
      .where(eq(t.leads.id, id))
      .returning({ id: t.leads.id });
    return row ?? null;
  },

  async scheduleRetry(id, { attempts, nextAttemptAt, error }) {
    const [row] = await db()
      .update(t.leads)
      .set({ clinwellAttempts: attempts, clinwellNextAttemptAt: nextAttemptAt, clinwellLastError: error ?? null })
      .where(eq(t.leads.id, id))
      .returning({ id: t.leads.id });
    return row ?? null;
  },

  /**
   * Stop trying. Recorded as an error with no next attempt rather than
   * as forwarded, so it is visibly unsent instead of quietly counted as
   * delivered.
   */
  async giveUp(id, { attempts, error }) {
    const [row] = await db()
      .update(t.leads)
      .set({ clinwellAttempts: attempts, clinwellNextAttemptAt: null, clinwellLastError: error ?? null })
      .where(eq(t.leads.id, id))
      .returning({ id: t.leads.id });
    return row ?? null;
  },
};

/* ============================================ organisation applications */

/**
 * Hospitals, clinics, pharmacies and care homes asking to be quoted.
 *
 * Deliberately not the leads repo. A patient enquiry and a hospital
 * asking for a price share nothing but arriving through a form:
 * different fields, different lifecycle, different reader, different
 * retention. Sharing one table would mean a nullable column per
 * difference and a status enum meaning two things at once.
 */
export const organisationApplications = {
  async create(input) {
    const [row] = await db()
      .insert(t.organisationApplications)
      .values({ ...input, id: input.id ?? newId("org") })
      .returning();
    return row;
  },

  async findById(id) {
    const [row] = await db()
      .select()
      .from(t.organisationApplications)
      .where(eq(t.organisationApplications.id, id))
      .limit(1);
    return row ?? null;
  },

  /**
   * The queue. Unanswered first and oldest first within that, because
   * that is the order a person should work through them in — an
   * organisation that applied on Monday should not wait behind one that
   * applied this morning.
   */
  async all({ status = null, limit = 200 } = {}) {
    const base = db().select().from(t.organisationApplications);
    const rows = status
      ? await base
          .where(eq(t.organisationApplications.status, status))
          .orderBy(asc(t.organisationApplications.createdAt))
          .limit(limit)
      : await base.orderBy(asc(t.organisationApplications.createdAt)).limit(limit);
    return rows;
  },

  /** Everything this organisation has ever sent, by contact address. */
  async byEmail(email) {
    return db()
      .select()
      .from(t.organisationApplications)
      .where(eq(t.organisationApplications.contactEmail, String(email ?? "").toLowerCase()))
      .orderBy(desc(t.organisationApplications.createdAt));
  },

  async update(id, patch) {
    const [row] = await db()
      .update(t.organisationApplications)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.organisationApplications.id, id))
      .returning();
    return row ?? null;
  },

  /** Counts per status, for the queue's tabs. */
  async counts() {
    const rows = await db()
      .select({ status: t.organisationApplications.status })
      .from(t.organisationApplications);
    return rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  },
};

/* ================================================= password resets */

/**
 * Reset tokens, stored as hashes.
 *
 * Nothing here ever sees the token the member was emailed — the caller
 * hashes it and passes the hash in. That is not ceremony: it means this
 * table can be dumped, backed up, or read over somebody's shoulder
 * without handing out a single working link.
 */
export const passwordResets = {
  async create({ userId, tokenHash, expiresAt, requestedIp = null }) {
    const [row] = await db()
      .insert(t.passwordResetTokens)
      .values({ id: newId("prt"), userId, tokenHash, expiresAt, requestedIp })
      .returning();
    return row ?? null;
  },

  /** The redeem path's only lookup. Validity is the caller's decision. */
  async findByHash(tokenHash) {
    const [row] = await db()
      .select()
      .from(t.passwordResetTokens)
      .where(eq(t.passwordResetTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  },

  /** Single use. Returns null if somebody redeemed it first. */
  async markUsed(id) {
    const [row] = await db()
      .update(t.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(t.passwordResetTokens.id, id), isNull(t.passwordResetTokens.usedAt)))
      .returning();
    return row ?? null;
  },

  /**
   * Burn every outstanding link for one account. Run on every successful
   * reset and every password change, so a second email already in flight
   * — or one an attacker requested — is dead the moment the password
   * moves.
   */
  async burnAllFor(userId) {
    const rows = await db()
      .update(t.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(t.passwordResetTokens.userId, userId), isNull(t.passwordResetTokens.usedAt)))
      .returning({ id: t.passwordResetTokens.id });
    return rows.length;
  },

  /**
   * How many links this account has asked for since a given moment —
   * the rate limit's only input. Counting rows rather than keeping a
   * counter in memory means the limit survives a restart and applies
   * across every instance the site runs on.
   */
  async countSince(userId, since) {
    const [row] = await db()
      .select({ count: sql`count(*)::int` })
      .from(t.passwordResetTokens)
      .where(and(eq(t.passwordResetTokens.userId, userId), gte(t.passwordResetTokens.createdAt, since)));
    return row?.count ?? 0;
  },

  /** Housekeeping: expired and spent tokens are of no use to anybody. */
  async purgeExpired(before = new Date()) {
    const rows = await db()
      .delete(t.passwordResetTokens)
      .where(lt(t.passwordResetTokens.expiresAt, before))
      .returning({ id: t.passwordResetTokens.id });
    return rows.length;
  },
};

/* ========================================================= sessions */

/**
 * Live sessions.
 *
 * `find` is on the request path — it runs on every authenticated call —
 * so it is a single primary-key read and nothing else. Everything that
 * costs more (the list, the sweeps) is only ever reached from the
 * account screen.
 */
export const sessions = {
  async create({ userId, actorUserId = null, userAgent = null, ip = null, country = null, expiresAt }) {
    const [row] = await db()
      .insert(t.sessions)
      .values({ id: newId("ses"), userId, actorUserId, userAgent, ip, country, expiresAt })
      .returning();
    return row ?? null;
  },

  async find(id) {
    const [row] = await db().select().from(t.sessions).where(eq(t.sessions.id, id)).limit(1);
    return row ?? null;
  },

  /** Written at most once a minute by the caller — see middleware/auth.js. */
  async touch(id, { ip = null, country = null } = {}) {
    await db()
      .update(t.sessions)
      .set({ lastSeenAt: new Date(), ...(ip ? { ip } : {}), ...(country ? { country } : {}) })
      .where(eq(t.sessions.id, id));
  },

  /**
   * What the account screen shows: everything still live, most recently
   * used first. Expired rows are filtered rather than deleted, so the
   * list never shows a session that cannot actually be used.
   */
  async liveFor(userId) {
    return db()
      .select()
      .from(t.sessions)
      .where(
        and(
          eq(t.sessions.userId, userId),
          isNull(t.sessions.revokedAt),
          gte(t.sessions.expiresAt, new Date())
        )
      )
      .orderBy(desc(t.sessions.lastSeenAt));
  },

  /** Returns the row only if it was still live, so a double revoke is visible. */
  async revoke(id, reason = "signed out") {
    const [row] = await db()
      .update(t.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(t.sessions.id, id), isNull(t.sessions.revokedAt)))
      .returning();
    return row ?? null;
  },

  /**
   * Everything on this account except one — "sign out my other devices".
   * Passing null for `exceptId` ends every session, which is what a
   * password change and a two-factor change both do.
   */
  async revokeAllFor(userId, { exceptId = null, reason = "signed out elsewhere" } = {}) {
    const where = [eq(t.sessions.userId, userId), isNull(t.sessions.revokedAt)];
    if (exceptId) where.push(ne(t.sessions.id, exceptId));
    const rows = await db()
      .update(t.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...where))
      .returning({ id: t.sessions.id });
    return rows.length;
  },

  /** Housekeeping: rows for sessions that expired weeks ago. */
  async purgeExpired(before = new Date()) {
    const rows = await db()
      .delete(t.sessions)
      .where(lt(t.sessions.expiresAt, before))
      .returning({ id: t.sessions.id });
    return rows.length;
  },
};

/* ==================================================== email changes */

export const emailChanges = {
  async create(input) {
    const [row] = await db()
      .insert(t.emailChangeRequests)
      .values({ ...input, id: newId("ecr") })
      .returning();
    return row ?? null;
  },

  /** The one request in flight, if there is one. */
  async openFor(userId) {
    const [row] = await db()
      .select()
      .from(t.emailChangeRequests)
      .where(
        and(
          eq(t.emailChangeRequests.userId, userId),
          isNull(t.emailChangeRequests.appliedAt),
          isNull(t.emailChangeRequests.cancelledAt)
        )
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * A link, whichever of the three it is. One query rather than three:
   * the caller works out which side was clicked by comparing the hash
   * against the row it gets back.
   */
  async findByAnyToken(hash) {
    const [row] = await db()
      .select()
      .from(t.emailChangeRequests)
      .where(
        or(
          eq(t.emailChangeRequests.newTokenHash, hash),
          eq(t.emailChangeRequests.oldTokenHash, hash),
          eq(t.emailChangeRequests.cancelTokenHash, hash)
        )
      )
      .limit(1);
    return row ?? null;
  },

  async update(id, patch) {
    const [row] = await db()
      .update(t.emailChangeRequests)
      .set(patch)
      .where(eq(t.emailChangeRequests.id, id))
      .returning();
    return row ?? null;
  },
};

/* =================================================== recovery codes */

export const recoveryCodes = {
  /** Replaces the whole set: codes are issued ten at a time, never singly. */
  async replaceAll(userId, hashes) {
    await db().delete(t.mfaRecoveryCodes).where(eq(t.mfaRecoveryCodes.userId, userId));
    if (hashes.length === 0) return [];
    return db()
      .insert(t.mfaRecoveryCodes)
      .values(hashes.map((codeHash) => ({ id: newId("rcv"), userId, codeHash })))
      .returning();
  },

  /**
   * Spend one. The unused-only condition is what makes it single use
   * under concurrency — two requests with the same code cannot both
   * come back with a row.
   */
  async consume(userId, codeHash) {
    const [row] = await db()
      .update(t.mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(t.mfaRecoveryCodes.userId, userId),
          eq(t.mfaRecoveryCodes.codeHash, codeHash),
          isNull(t.mfaRecoveryCodes.usedAt)
        )
      )
      .returning();
    return row ?? null;
  },

  /** How many are left, for the "you have 7 codes remaining" line. */
  async remaining(userId) {
    const [row] = await db()
      .select({ count: sql`count(*)::int` })
      .from(t.mfaRecoveryCodes)
      .where(and(eq(t.mfaRecoveryCodes.userId, userId), isNull(t.mfaRecoveryCodes.usedAt)));
    return row?.count ?? 0;
  },

  async clear(userId) {
    await db().delete(t.mfaRecoveryCodes).where(eq(t.mfaRecoveryCodes.userId, userId));
  },
};

/* ------------------------------------------------------------------ *
 * Messages -- the thread behind a lead
 * ------------------------------------------------------------------ */
export const leadMessages = {
  async forLead(leadId) {
    return db().select().from(t.leadMessages).where(eq(t.leadMessages.leadId, leadId)).orderBy(asc(t.leadMessages.createdAt));
  },

  async create({ leadId, senderRole, body }) {
    const [row] = await db().insert(t.leadMessages).values({ leadId, senderRole, body }).returning();
    return row;
  },

  /** Everything the OTHER side sent, marked read -- a specialist opening
   *  a thread reads the patient's messages, never their own. */
  async markRead(leadId, readerRole) {
    const otherRole = readerRole === "specialist" ? "patient" : "specialist";
    await db()
      .update(t.leadMessages)
      .set({ readAt: new Date() })
      .where(and(eq(t.leadMessages.leadId, leadId), eq(t.leadMessages.senderRole, otherRole), isNull(t.leadMessages.readAt)));
  },

  /** Unread-from-patient counts for every lead of a specialist, in one
   *  query rather than one per thread. */
  async unreadCountsFor(specialistId) {
    const rows = await db()
      .select({ leadId: t.leadMessages.leadId, count: sql`count(*)::int` })
      .from(t.leadMessages)
      .innerJoin(t.leads, eq(t.leads.id, t.leadMessages.leadId))
      .where(
        and(
          eq(t.leads.specialistId, specialistId),
          eq(t.leadMessages.senderRole, "patient"),
          isNull(t.leadMessages.readAt)
        )
      )
      .groupBy(t.leadMessages.leadId);
    return new Map(rows.map((r) => [r.leadId, r.count]));
  },

  async findLeadByToken(token) {
    const [row] = await db().select().from(t.leads).where(eq(t.leads.replyToken, token)).limit(1);
    return row ?? null;
  },
};

/* ------------------------------------------------------------------ *
 * Appointments
 * ------------------------------------------------------------------ */
export const specialistAvailability = {
  async forSpecialist(specialistId) {
    return db()
      .select()
      .from(t.specialistAvailability)
      .where(eq(t.specialistAvailability.specialistId, specialistId))
      .orderBy(asc(t.specialistAvailability.weekday), asc(t.specialistAvailability.startMinute));
  },

  /** Replace the whole week in one go -- the editor holds the whole set,
   *  same reasoning as specialists.setLinks. */
  async replaceWeek(specialistId, blocks) {
    await db().transaction(async (tx) => {
      await tx.delete(t.specialistAvailability).where(eq(t.specialistAvailability.specialistId, specialistId));
      if (blocks.length) {
        await tx.insert(t.specialistAvailability).values(blocks.map((b) => ({ ...b, specialistId })));
      }
    });
    return specialistAvailability.forSpecialist(specialistId);
  },
};

export const appointments = {
  async forSpecialist(specialistId, { from, to } = {}) {
    const conditions = [eq(t.appointments.specialistId, specialistId)];
    if (from) conditions.push(gte(t.appointments.startsAt, from));
    if (to) conditions.push(lt(t.appointments.startsAt, to));
    return db()
      .select()
      .from(t.appointments)
      .where(and(...conditions))
      .orderBy(asc(t.appointments.startsAt));
  },

  async findById(id) {
    const [row] = await db().select().from(t.appointments).where(eq(t.appointments.id, id)).limit(1);
    return row ?? null;
  },

  /** Booked, non-cancelled slots for one day -- what a booking widget
   *  subtracts from the day's availability rule to find open slots. */
  async activeOnDay(specialistId, dayStart, dayEnd) {
    return db()
      .select()
      .from(t.appointments)
      .where(
        and(
          eq(t.appointments.specialistId, specialistId),
          ne(t.appointments.status, "cancelled"),
          gte(t.appointments.startsAt, dayStart),
          lt(t.appointments.startsAt, dayEnd)
        )
      );
  },

  async create(input) {
    const [row] = await db().insert(t.appointments).values(input).returning();
    return row;
  },

  async setStatus(id, specialistId, status) {
    const [row] = await db()
      .update(t.appointments)
      .set({ status })
      .where(and(eq(t.appointments.id, id), eq(t.appointments.specialistId, specialistId)))
      .returning();
    return row ?? null;
  },
};
