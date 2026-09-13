/* ------------------------------------------------------------------ *
 * Top Local Specialists — data model
 *
 * Ported from the original Mongoose schemas. The shape is deliberately
 * relational: a specialist's specialties, conditions, treatments and
 * practice addresses were arrays of ObjectIds in Mongo and are join
 * tables here, which is what they always were in spirit.
 *
 * Four things stay as jsonb columns rather than child tables — the
 * application form, the verification audit trail, the photo gallery and
 * the social links. Each is read and written as a whole object by one
 * owner, never queried field by field, so a table would buy nothing and
 * cost a join on every profile read.
 *
 * Money is always integer minor units plus an ISO currency code, never
 * a float. Nothing else in here stores a monetary value.
 * ------------------------------------------------------------------ */

import { randomBytes } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Short, sortable, URL-safe id. Postgres would happily generate a uuid,
 * but ids travel through JSON, query strings and the ClinWell handshake,
 * and a 22-character string is far easier to read in a log than a uuid.
 */
export function newId(prefix = "") {
  const raw = randomBytes(12).toString("base64url");
  return prefix ? `${prefix}_${raw}` : raw;
}

const id = () => text("id").primaryKey().$defaultFn(() => newId());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ============================================================== enums */

export const userRoleEnum = pgEnum("user_role", ["specialist", "admin"]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "pending",
  "info_requested",
  "verified",
  "rejected",
  "suspended",
]);

export const planIdEnum = pgEnum("plan_id", ["basic", "premium", "clinwell"]);
export const planIntervalEnum = pgEnum("plan_interval", ["monthly", "yearly"]);
export const planStatusEnum = pgEnum("plan_status", [
  "active",
  "pending_verification",
  "pending_payment",
  "past_due",
  "canceled",
]);

export const facilityTypeEnum = pgEnum("facility_type", ["hospital", "clinic", "care_home", "pharmacy"]);
export const facilityVerificationEnum = pgEnum("facility_verification", ["verified", "unverified"]);

export const reviewSubjectEnum = pgEnum("review_subject", ["specialist", "clinic", "facility"]);

/**
 * Every review is read by a person before anyone else sees it.
 *
 * "pending" is the state a review is born in — written, stored, counted
 * by nothing. It contributes no stars, appears on no profile and moves
 * no average until an admin approves it. That is a deliberate cost: a
 * directory whose reviews publish themselves is a directory whose
 * reviews are worth nothing, and a clinician has no recourse against a
 * libellous one that is already live.
 */
export const reviewModerationEnum = pgEnum("review_moderation", ["pending", "approved", "rejected"]);

/**
 * Which body actually inspects a place. A UK directory cannot flatten
 * this to "CQC": CQC covers England only, and a Cardiff care home or a
 * Glasgow hospital is inspected by a different regulator entirely under
 * a different rating vocabulary. Storing the body alongside the rating
 * is what lets the profile say "Care Inspectorate Wales" rather than
 * quietly mislabelling it.
 */
export const facilityRegulatorEnum = pgEnum("facility_regulator", [
  "cqc", // Care Quality Commission — England
  "ciw", // Care Inspectorate Wales
  "his", // Healthcare Improvement Scotland
  "ci", // Care Inspectorate — Scotland (social care)
  "rqia", // Regulation and Quality Improvement Authority — Northern Ireland
  "gphc", // General Pharmaceutical Council — pharmacies
]);

/**
 * The CQC four-point scale, which CIW/RQIA map onto closely enough for
 * one shared vocabulary. `not_rated` is a real state, not a missing
 * value: a newly registered service is inspected but unrated, and the
 * profile has to be able to say so rather than imply a bad score.
 */
export const facilityRatingEnum = pgEnum("facility_regulator_rating", [
  "outstanding",
  "good",
  "requires_improvement",
  "inadequate",
  "not_rated",
]);

/**
 * Two vocabularies used to live side by side here: the CRM pipeline the
 * old model declared, and the four states the specialist's Enquiries
 * workspace actually writes and counts (new / responded / in_progress /
 * closed). Replying to an enquiry wrote a value the model did not allow,
 * so the reply failed validation. This is the union, and the workspace's
 * four are first because they are the ones a specialist sees.
 */
export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "responded",
  "in_progress",
  "closed",
  "contact_attempted",
  "contacted",
  "appointment_offered",
  "booked",
  "attended",
  "converted",
  "lost",
  "no_response",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "failed",
  "refunded",
  "canceled",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "signup_pending",
  "claim_pending",
  "approval_overdue",
  "payment_received",
  "enquiry_received",
  "application_decided",
  // A patient review is waiting to be published or rejected, and the
  // 24-hour chase when nobody has looked at it.
  "review_pending",
  "review_overdue",
  // A member submitted an article, or one written for them came back.
  "article_pending",
  // Contract v1.0.1 §6.2: the practice's renewal is approaching. Sent
  // at 10 days, 3 days, 48 hours and 24 hours.
  "renewal_due",
  // An outbound ClinWell event exhausted its retry schedule. Somebody
  // has to look, because a lost cancellation means a practice keeps
  // clinical software it stopped paying for.
  "clinwell_event_failed",
]);

export const claimStatusEnum = pgEnum("claim_status", ["pending", "approved", "rejected"]);

export const contactTopicEnum = pgEnum("contact_topic", ["patient", "practitioner", "partnership", "other"]);
export const contactStatusEnum = pgEnum("contact_status", ["new", "read", "answered", "closed"]);

/* =========================================================== taxonomy */

export const countries = pgTable("countries", {
  id: id(),
  isoCode: text("iso_code").notNull().unique(), // 'GB', 'US', 'IN'
  name: text("name").notNull(),
  currency: text("currency").notNull(), // ISO 4217, e.g. 'GBP'
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("Europe/London"),
});

export const cities = pgTable(
  "cities",
  {
    id: id(),
    countryId: text("country_id")
      .notNull()
      .references(() => countries.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    region: text("region"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
  },
  (t) => [index("cities_country_idx").on(t.countryId)]
);

export const regulators = pgTable("regulators", {
  id: id(),
  countryId: text("country_id")
    .notNull()
    .references(() => countries.id),
  code: text("code").notNull().unique(), // 'GMC', 'GDC', 'HCPC', 'NMC'
  name: text("name").notNull(),
});

/**
 * A row with parentId null is a top-level specialty (Orthopaedics); one
 * with a parent is a subspecialty (Knee Surgery). Taxonomy is
 * admin-editable data, never hard-coded — the search bar's chained
 * dropdowns read from this table.
 */
export const specialties = pgTable(
  "specialties",
  {
    id: id(),
    parentId: text("parent_id"),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    seoTitle: text("seo_title"),
    description: text("description"),
  },
  (t) => [
    index("specialties_parent_idx").on(t.parentId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "specialties_parent_fk" }),
  ]
);

export const conditions = pgTable(
  "conditions",
  {
    id: id(),
    specialtyId: text("specialty_id").references(() => specialties.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [index("conditions_specialty_idx").on(t.specialtyId)]
);

export const treatments = pgTable(
  "treatments",
  {
    id: id(),
    specialtyId: text("specialty_id").references(() => specialties.id),
    conditionId: text("condition_id").references(() => conditions.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [index("treatments_specialty_idx").on(t.specialtyId)]
);

/**
 * Classifies *places* rather than a person's clinical specialty. Same
 * tree shape as specialties, kept separate because tagging a hospital
 * with someone's specialty would be semantically wrong.
 */
export const facilityCategories = pgTable(
  "facility_categories",
  {
    id: id(),
    parentId: text("parent_id"),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [
    index("facility_categories_parent_idx").on(t.parentId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "facility_categories_parent_fk" }),
  ]
);

/* ============================================================= places */

export const clinics = pgTable("clinics", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  website: text("website"),
  createdAt: createdAt(),
});

export const clinicLocations = pgTable(
  "clinic_locations",
  {
    id: id(),
    // Null for an address a specialist added from their own dashboard —
    // that is their practice, and it belongs to no clinic.
    clinicId: text("clinic_id").references(() => clinics.id),
    // Set when a specialist owns this address outright, so replacing
    // their locations never deletes one shared with a clinic.
    ownedBySpecialistId: text("owned_by_specialist_id"),
    cityId: text("city_id")
      .notNull()
      .references(() => cities.id),
    address: text("address").notNull(),
    postcode: text("postcode"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    phone: text("phone"),
  },
  (t) => [
    index("clinic_locations_clinic_idx").on(t.clinicId),
    index("clinic_locations_city_idx").on(t.cityId),
    index("clinic_locations_owner_idx").on(t.ownedBySpecialistId),
    foreignKey({
      columns: [t.ownedBySpecialistId],
      foreignColumns: [specialists.id],
      name: "clinic_locations_owner_fk",
    }).onDelete("cascade"),
  ]
);

/**
 * A place, not a person — a hospital, care home, pharmacy or clinic.
 *
 * This table deliberately mirrors `specialists` field for field wherever
 * the two mean the same thing (photoUrl / coverImageUrl / gallery /
 * socials / bookingUrl / contactEmail / contactPhone / claimed / plan…),
 * because the listing, the result card and the profile page are the same
 * product surfaces and any divergence in naming shows up as a shabbier
 * page for places. Everything below that pair is what a place has and a
 * person does not: a regulator that inspects the building, opening
 * hours, beds, and a team of clinicians who practise there.
 */
export const facilities = pgTable(
  "facilities",
  {
    id: id(),
    facilityType: facilityTypeEnum("facility_type").notNull(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),

    // Set once the listing is claimed or self-registered — the same
    // one-owner rule the specialist listings use.
    userId: text("user_id").references(() => users.id),
    claimed: boolean("claimed").notNull().default(false),


    /** One line under the name. The place's answer to specialist.title. */
    tagline: text("tagline"),
    /** The short summary that rides on cards and in search results. */
    description: text("description"),
    /** Long-form. The place's answer to specialist.bio. */
    about: text("about"),

    photoUrl: text("photo_url"),
    coverImageUrl: text("cover_image_url"),
    // [{ url, caption, addedAt }] — identical shape to specialists.gallery
    gallery: jsonb("gallery").notNull().default([]),

    websiteUrl: text("website_url"),
    bookingUrl: text("booking_url"),
    // { linkedin, x, instagram, facebook, youtube }
    socials: jsonb("socials").notNull().default({}),

    /** Public switchboard number — shown on the listing. */
    phone: text("phone"),
    /** Where enquiries are routed. Never serialised to the public API. */
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    cityId: text("city_id")
      .notNull()
      .references(() => cities.id),
    address: text("address"),
    postcode: text("postcode"),
    // A place has one front door, so unlike a specialist it can carry its
    // own coordinates rather than borrowing the city centroid. Distance
    // sorting uses these when present and falls back to the city.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    /* ------------------------------------------------- the regulator
       The single most load-bearing fact about a care setting, and the
       one thing a patient cannot check from a website's own marketing.
       Stored as body + reference + rating + when + a link to the public
       report, so the profile can cite it rather than assert it. */
    regulator: facilityRegulatorEnum("regulator"),
    regulatorRef: text("regulator_ref"),
    regulatorRating: facilityRatingEnum("regulator_rating"),
    regulatorRatedAt: timestamp("regulator_rated_at", { withTimezone: true }),
    regulatorUrl: text("regulator_url"),

    /* --------------------------------------------------- the building */
    yearEstablished: integer("year_established"),
    // Beds for hospitals and care homes; null for a clinic or pharmacy,
    // where the number would be meaningless rather than zero.
    bedCount: integer("bed_count"),
    staffCount: integer("staff_count"),
    // { mon: { open: "08:00", close: "20:00" } … sun: null, notes: "" }
    // A null day means closed; the whole object absent means unpublished,
    // and the profile says "hours not published" rather than "closed".
    openingHours: jsonb("opening_hours").notNull().default({}),
    open24h: boolean("open_24h").notNull().default(false),
    emergencyDepartment: boolean("emergency_department").notNull().default(false),

    languages: text("languages").array().notNull().default(["English"]),
    /** Slugs from FACILITY_AMENITIES in lib/facilityFacets.js. */
    amenities: text("amenities").array().notNull().default([]),
    /** Free-text insurer names — "Bupa", "AXA Health", "Self-pay". */
    insurers: text("insurers").array().notNull().default([]),
    /** "CQC registered", "JAG accredited", "ISO 9001" — plain strings. */
    accreditations: text("accreditations").array().notNull().default([]),

    verificationStatus: facilityVerificationEnum("verification_status").notNull().default("unverified"),
    // Same audit trail contract as specialists: [{ action, byUserId,
    // byName, note, at }], append-only.
    verificationHistory: jsonb("verification_history").notNull().default([]),
    application: jsonb("application").notNull().default({}),

    /* ----------------------------------------------------------- plan
       Places buy the same three tiers as specialists, so the same
       entitlement code reads these — never `plan` directly. */
    plan: planIdEnum("plan").notNull().default("basic"),
    planInterval: planIntervalEnum("plan_interval").notNull().default("yearly"),
    planStatus: planStatusEnum("plan_status").notNull().default("active"),
    planSelectedAt: timestamp("plan_selected_at", { withTimezone: true }),
    planActivatedAt: timestamp("plan_activated_at", { withTimezone: true }),
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),

    ratingAvg: doublePrecision("rating_avg").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("facilities_city_idx").on(t.cityId),
    index("facilities_type_idx").on(t.facilityType),
    index("facilities_verification_idx").on(t.verificationStatus),
    index("facilities_plan_idx").on(t.plan, t.planStatus),
  ]
);

/**
 * Who practises here. This is the join that makes the two directories
 * one product: a hospital profile can list its consultants, and a
 * consultant's profile can name the hospitals they operate at, without
 * either side re-typing the other's details. Deliberately many-to-many —
 * a consultant with lists at three private hospitals is the normal case,
 * not the exception.
 */
export const facilityTeam = pgTable(
  "facility_team",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    /** "Consultant Orthopaedic Surgeon", "Registered Manager". */
    role: text("role"),
  },
  (t) => [
    primaryKey({ columns: [t.facilityId, t.specialistId] }),
    index("facility_team_specialist_idx").on(t.specialistId),
  ]
);

/* ============================================================= people */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    // scrypt$salt$hash — see lib/auth.js. Never a plaintext password and
    // never returned by any API; the auth serializer strips it
    // explicitly rather than relying on a select rule.
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull().default("specialist"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    /* ------------------------------------------------- where from
       An admin looking at a list of sign-ups is asking one question
       first: is this real? A dental practice in Salford whose account
       was created from an IP in another hemisphere is the single most
       useful signal there is, and it costs two columns to keep.

       Country is whatever the edge told us (Cloudflare and most CDNs
       send it); null when nothing did. Never inferred from the IP here
       — a wrong flag is worse than no flag. */
    signupIp: text("signup_ip"),
    signupCountry: text("signup_country"),
    lastLoginIp: text("last_login_ip"),
    lastLoginCountry: text("last_login_country"),

    /* Admin-applied labels, for the saved filters the members list runs
       on. Not visible to the member and never public. */
    tags: text("tags").array().notNull().default([]),
    /* Free text only an admin sees, on the account rather than the
       listing — "called, waiting on GMC number". */
    adminNotes: text("admin_notes"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_role_idx").on(t.role)]
);

export const specialists = pgTable(
  "specialists",
  {
    id: id(),

    // Set once the listing is claimed or self-registered.
    userId: text("user_id")
      .references(() => users.id)
      .unique(),

    slug: text("slug").notNull().unique(),
    fullName: text("full_name").notNull(),
    title: text("title"),
    photoUrl: text("photo_url"),
    bio: text("bio"),

    primarySpecialtyId: text("primary_specialty_id").references(() => specialties.id),

    regulatorId: text("regulator_id").references(() => regulators.id),
    registrationNumber: text("registration_number"),

    // Nothing reaches the public directory automatically. A specialist
    // registers, an admin reviews the application, and only an explicit
    // approval sets this to "verified". Every public endpoint filters on
    // it — see controllers/specialists.controller.js.
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("pending"),

    // What the specialist submitted for review:
    // { submittedAt, notes, documents: [{ type, name, url, uploadedAt }] }
    application: jsonb("application").notNull().default({}),

    // Append-only audit trail. Every verification decision lands here
    // with who made it and when, so an approval can always be accounted
    // for: [{ action, byUserId, byName, note, at }]
    verificationHistory: jsonb("verification_history").notNull().default([]),

    claimed: boolean("claimed").notNull().default(false),

    /* ------------------------------------------------ letters after the name
       "FRCS (Tr&Orth), MBBS". Free text on purpose: there is no closed
       list of medical post-nominals, and a dropdown of the common ones
       would be wrong for almost everybody. */
    qualifications: text("qualifications"),

    /* ------------------------------------------------------ provenance
       Where an unclaimed listing came from.

       A directory is seeded from public professional listings long
       before the people in it sign up, and when one of them writes in to
       claim their profile the first question is always "where did you
       get this?". These columns answer it, and they are what the admin
       deciding a claim actually reads.

       `importSource` holds the source row verbatim, including the
       figures deliberately NOT imported — another platform's star rating
       is not this site's star rating, and importing one would mean
       publishing a score for reviews we do not hold. None of it is ever
       serialised publicly; see NEVER_PUBLIC in lib/profileGate.js. */
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    sourceImportedAt: timestamp("source_imported_at", { withTimezone: true }),
    importSource: jsonb("import_source"),

    // Integer minor units. Never a float.
    consultationPriceMinor: integer("consultation_price_minor"),
    currency: text("currency").notNull().default("GBP"),
    languages: text("languages").array().notNull().default(["English"]),

    ratingAvg: doublePrecision("rating_avg").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),

    // Where enquiries are routed. Captured on the registration form and
    // deliberately NOT exposed by the public profile API — it is the
    // specialist's own inbox, not a directory listing.
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    yearsExperience: integer("years_experience"),

    // All three travel together: without a url the card is not rendered.
    videoUrl: text("video_url"),
    videoThumbnailUrl: text("video_thumbnail_url"),
    videoDurationSeconds: integer("video_duration_seconds"),

    // Next bookable appointment. The search API filters and sorts on it.
    // Null means "not published", and the card omits the line rather
    // than guessing.
    nextAvailableAt: timestamp("next_available_at", { withTimezone: true }),

    /* ----------------------------------------------------------- plan */
    // Which tier they signed up for, and whether it is actually paid
    // for. Features are never read from `plan` directly — always through
    // entitlementsFor() in lib/plans.js, which accounts for status.
    plan: planIdEnum("plan").notNull().default("basic"),
    planInterval: planIntervalEnum("plan_interval").notNull().default("yearly"),
    planStatus: planStatusEnum("plan_status").notNull().default("active"),
    planSelectedAt: timestamp("plan_selected_at", { withTimezone: true }),
    planActivatedAt: timestamp("plan_activated_at", { withTimezone: true }),
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),

    // Opaque handle for the practice's ClinWell workspace: a UUID v4
    // issued once on subscription.activated and never changed
    // (contract v1.0.1 §4.1). No clinical data crosses the boundary —
    // see lib/clinwell.js.
    clinwellWorkspaceId: text("clinwell_workspace_id"),

    /* The practice slug as registered on ClinWell's side, which is not
       always our own. Dr Moholkar's clinic is "dkc" there while its
       profile here has a longer name-based slug, and §4.1 forbids
       normalising on either side — so the registered value has to be
       storable rather than derived. Null means "the same as our slug",
       which is correct for every practice registered from scratch. */
    clinwellSlug: text("clinwell_slug"),

    /* --------------------------------------- the ClinWell badge
       ClinWell pushes one status per practice nightly (Appendix B) and
       these columns are the ONLY thing that push may write. They are
       deliberately not verificationStatus: "Runs on ClinWell" says a
       practice pays for clinical software, "verified" says a human
       checked a licence against a regulator's register. A lapsed direct
       debit must not be able to un-verify a clinician, and separate
       columns are what make that impossible rather than unlikely.

       The badge expires 72 hours after the last successful batch that
       named the practice, so a ClinWell outage that stops the nightly
       push eventually takes the badge down instead of leaving a stale
       claim on the public site for ever. */
    clinwellLive: boolean("clinwell_live").notNull().default(false),
    clinwellLiveAt: timestamp("clinwell_live_at", { withTimezone: true }),
    clinwellBadgeExpiresAt: timestamp("clinwell_badge_expires_at", { withTimezone: true }),
    // pending_invite | active | suspended, as ClinWell last reported it.
    clinwellStatus: text("clinwell_status"),
    clinwellStatusAt: timestamp("clinwell_status_at", { withTimezone: true }),

    /* ---------------------------------------- premium-tier content
       Stored for every specialist regardless of plan, and hidden rather
       than deleted when a plan lapses — so downgrading and
       re-subscribing restores a profile exactly as it was. The public
       API decides what to serialise; see lib/profileGate.js. */
    coverImageUrl: text("cover_image_url"),
    // [{ url, caption, addedAt }]
    gallery: jsonb("gallery").notNull().default([]),
    websiteUrl: text("website_url"),
    // { linkedin, x, instagram, facebook, youtube }
    socials: jsonb("socials").notNull().default({}),
    // External calendar the "Book an appointment" button opens.
    bookingUrl: text("booking_url"),

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("specialists_verification_idx").on(t.verificationStatus),
    index("specialists_primary_specialty_idx").on(t.primarySpecialtyId),
    index("specialists_plan_idx").on(t.plan, t.planStatus),
  ]
);

/* ======================================================= join tables */

export const specialistSpecialties = pgTable(
  "specialist_specialties",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    specialtyId: text("specialty_id")
      .notNull()
      .references(() => specialties.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.specialistId, t.specialtyId] }),
    index("specialist_specialties_specialty_idx").on(t.specialtyId),
  ]
);

export const specialistConditions = pgTable(
  "specialist_conditions",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    conditionId: text("condition_id")
      .notNull()
      .references(() => conditions.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.specialistId, t.conditionId] }),
    index("specialist_conditions_condition_idx").on(t.conditionId),
  ]
);

export const specialistTreatments = pgTable(
  "specialist_treatments",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    treatmentId: text("treatment_id")
      .notNull()
      .references(() => treatments.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.specialistId, t.treatmentId] }),
    index("specialist_treatments_treatment_idx").on(t.treatmentId),
  ]
);

export const specialistClinicLocations = pgTable(
  "specialist_clinic_locations",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    clinicLocationId: text("clinic_location_id")
      .notNull()
      .references(() => clinicLocations.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.specialistId, t.clinicLocationId] }),
    index("specialist_clinic_locations_location_idx").on(t.clinicLocationId),
  ]
);

export const facilityCategoryLinks = pgTable(
  "facility_category_links",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => facilityCategories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.facilityId, t.categoryId] }),
    index("facility_category_links_category_idx").on(t.categoryId),
  ]
);

/* ===================================================== patient-facing */

export const reviews = pgTable(
  "reviews",
  {
    id: id(),

    // Polymorphic on purpose: a review belongs either to a specialist or
    // to a clinic, and the pair is always read together. Deliberately
    // not a foreign key — the alternative is two nullable columns and a
    // check constraint, which reads worse and buys nothing here.
    subjectType: reviewSubjectEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),

    rating: integer("rating").notNull(),
    comment: text("comment"),
    patientName: text("patient_name"),

    conditionId: text("condition_id").references(() => conditions.id),

    // True only when tied to a real booking, QR or invite record —
    // never asserted by default.
    verified: boolean("verified").notNull().default(false),

    // Optional per-category scores behind the headline rating. The
    // profile averages whichever are present into the Communication /
    // Expertise / Care / Wait time breakdown; a review carrying only an
    // overall rating simply does not contribute to it.
    scoreCommunication: integer("score_communication"),
    scoreExpertise: integer("score_expertise"),
    scoreCare: integer("score_care"),
    scoreWaitTime: integer("score_wait_time"),

    /* -------------------------------------------------------- moderation
       Admin-only. The specialist's own reply below is NOT moderated —
       a provider answering a published review is speech about their own
       listing, and making them queue for it would make replying
       pointless. */
    moderationStatus: reviewModerationEnum("moderation_status").notNull().default("pending"),
    moderatedByUserId: text("moderated_by_user_id").references(() => users.id),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    /** Why it was rejected. Required on a rejection, kept for the audit. */
    moderationNote: text("moderation_note"),
    /**
     * When the 24-hour "still unmoderated" reminder was raised. Stored
     * so the sweep can find the ones that have already been chased
     * without re-reading the notification table.
     */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),

    /** The provider's reply. Published immediately, no approval needed. */
    response: text("response"),
    responseAt: timestamp("response_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_subject_idx").on(t.subjectType, t.subjectId),
    // The admin queue reads this every time the dashboard loads.
    index("reviews_moderation_idx").on(t.moderationStatus, t.createdAt),
  ]
);

/* ============================================================== blog

   Articles are written in Abun and land here through the importer in
   controllers/articles.controller.js. The body is stored as SANITISED
   html: the sanitising happens once, on the way in, so nothing on the
   read path has to remember to do it and no future endpoint can serve
   an unsanitised body by omission.

   sourceRef holds the identifier the origin uses — an Abun article id,
   a WordPress post id — which is what makes re-importing the same
   article an update rather than a duplicate. It is nullable because a
   post pasted by hand has no origin to point at.
   ============================================================== */

/* draft            being written by whoever owns it
   awaiting_author  written for a member, sitting with them to read and edit
   in_review        submitted, in the administrator's queue
   changes_requested sent back to the member with a note
   published        live on /blog

   The order matters to nobody; the transitions are enforced in
   controllers/articles.controller.js, which is the only place that
   knows which move is legal from where. */
export const articleStatusEnum = pgEnum("article_status", [
  "draft",
  "awaiting_author",
  "in_review",
  "changes_requested",
  "published",
]);

export const articles = pgTable(
  "articles",
  {
    id: id(),

    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    bodyHtml: text("body_html").notNull(),

    /* What was actually typed or pasted, kept so the editor can hand it
       back. body_html is what the site renders and the only thing the
       public read path touches; this is never served to a visitor.
       Null for rows imported before the column existed — the editor
       falls back to the rendered HTML for those. */
    bodySource: text("body_source"),
    bodyFormat: text("body_format"),

    heroImageUrl: text("hero_image_url"),
    heroImageAlt: text("hero_image_alt"),

    authorName: text("author_name"),
    /* The specialty this article belongs beside. A knee article shown
       under Orthopaedics is how a blog earns its keep on a directory:
       it links back into the listings rather than sitting in a silo. */
    specialtyId: text("specialty_id").references(() => specialties.id),
    tags: text("tags").array().notNull().default([]),

    status: articleStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    // What Google shows. Falls back to title and excerpt when unset,
    // which is the usual case for generated content.
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    /* Who the article is BY — a member is a specialist or a facility,
       never both, so two nullable references rather than one
       polymorphic column: the database can then enforce that the id
       exists. Both null is an article by the directory itself. */
    authorSpecialistId: text("author_specialist_id").references(() => specialists.id),
    authorFacilityId: text("author_facility_id").references(() => facilities.id),

    /* Who typed it, which is not always who it is by — that is the
       whole point of writing one on a member's behalf. */
    createdByUserId: text("created_by_user_id").references(() => users.id),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    /** What the administrator said when sending it back. The member reads this. */
    reviewNote: text("review_note"),

    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),

    readingMinutes: integer("reading_minutes").notNull().default(1),
    viewCount: integer("view_count").notNull().default(0),

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The list page reads published articles newest first, and nothing
    // else; this is the index that query wants.
    publishedIdx: index("articles_published_idx").on(table.status, table.publishedAt),
    sourceIdx: uniqueIndex("articles_source_ref_idx").on(table.source, table.sourceRef),
  })
);

export const leads = pgTable(
  "leads",
  {
    id: id(),

    patientName: text("patient_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    message: text("message"),

    specialistId: text("specialist_id").references(() => specialists.id),
    clinicId: text("clinic_id").references(() => clinics.id),
    facilityId: text("facility_id").references(() => facilities.id),
    conditionId: text("condition_id").references(() => conditions.id),

    status: leadStatusEnum("status").notNull().default("new"),

    // Basic listings carry a 5-enquiry monthly cap. The pricing FAQ
    // promises that enquiries past it are *held and released when the cap
    // resets*, not turned away — so the lead is always stored, and this
    // flag only withholds the specialist's alert until the sweep in
    // lib/reminders.js releases it (a new month, or an upgrade).
    held: boolean("held").notNull().default(false),
    releasedAt: timestamp("released_at", { withTimezone: true }),

    // The specialist's reply, written from the dashboard's Enquiries
    // workspace and emailed to the patient at the same time.
    response: text("response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),

    source: text("source").notNull().default("website_enquiry"),

    /* ------------------------------- forwarding to ClinWell (§4.3)
       forwardableAt is the important one, and it is a permission rather
       than a timestamp. It is set at creation ONLY when the forwarding
       gate was already open; null means this enquiry must never be
       forwarded, and that is every row that exists today.

       The reason is the day the gate opens. There will be a backlog of
       enquiries in this table submitted by patients under a privacy
       notice that said nothing about ClinWell, and one sweep would
       disclose all of them retrospectively in a few seconds. A column
       set at creation cannot do that, whereas a date comparison could
       be got wrong once. */
    clinwellForwardableAt: timestamp("clinwell_forwardable_at", { withTimezone: true }),
    clinwellForwardedAt: timestamp("clinwell_forwarded_at", { withTimezone: true }),
    clinwellAttempts: integer("clinwell_attempts").notNull().default(0),
    clinwellNextAttemptAt: timestamp("clinwell_next_attempt_at", { withTimezone: true }),
    clinwellLastError: text("clinwell_last_error"),
    // ClinWell's own id for the lead, so a duplicate is recognised
    // rather than re-posted.
    clinwellLeadId: text("clinwell_lead_id"),

    createdAt: createdAt(),
  },
  (t) => [
    index("leads_specialist_idx").on(t.specialistId, t.createdAt),
    index("leads_status_idx").on(t.status),
    index("leads_held_idx").on(t.held),
    index("leads_clinwell_pending_idx").on(t.clinwellNextAttemptAt),
  ]
);

/* ============================================================== money */

/**
 * An order is the record of an intent to pay: which specialist, which
 * plan, how much, and what happened. It exists before any money moves,
 * which is what makes the webhook idempotent — the webhook finds the
 * order it refers to rather than inventing a subscription from an event.
 * Previously held in memory, which meant a server restart lost every
 * payment in flight.
 */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),

    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    specialistName: text("specialist_name").notNull(),
    email: text("email"),

    planId: planIdEnum("plan_id").notNull(),
    planName: text("plan_name").notNull(),
    interval: planIntervalEnum("interval").notNull(),
    currency: text("currency").notNull().default("GBP"),

    netMinor: integer("net_minor").notNull(),
    vatMinor: integer("vat_minor").notNull(),
    vatRate: doublePrecision("vat_rate").notNull(),
    totalMinor: integer("total_minor").notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }),

    status: orderStatusEnum("status").notNull().default("awaiting_payment"),
    provider: text("provider").notNull().default("none"),
    providerRef: text("provider_ref"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("orders_specialist_idx").on(t.specialistId, t.createdAt),
    index("orders_status_idx").on(t.status),
    index("orders_provider_ref_idx").on(t.providerRef),
  ]
);

/* ====================================================== admin workload */

/**
 * One event, up to three destinations: the in-app bell (durable, the
 * record of truth), an email, and a push to registered devices. The row
 * is written first and always — email and push are best-effort, and a
 * failure in either must never lose the admin's to-do item.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),

    // Writing the same key twice is a no-op, which is what stops the
    // 24-hour reminder sweep stacking a new row every time it runs.
    key: text("key").notNull().unique(),

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),

    // The thing it is about, so every outstanding item for that subject
    // can be resolved at once when it is dealt with.
    subjectId: text("subject_id"),

    readAt: timestamp("read_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt), index("notifications_subject_idx").on(t.subjectId)]
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)]
);

/**
 * A request to take ownership of a listing that was imported rather than
 * self-registered. Held in memory until now, which meant a restart
 * silently dropped pending claims.
 */
/* ------------------------------------------------------------------ *
 * The admin audit log
 *
 * Every consequential thing an administrator does, written down with
 * their name on it.
 *
 * The reason this exists is impersonation. An admin can sign in as any
 * member and act as them, which is the single most useful support tool
 * in a directory and also the one capability that could be used to do
 * something indefensible. An unlogged impersonation is indistinguishable
 * from the member doing it themselves — so if there is no record, there
 * is no way to answer "who changed my price?" honestly.
 *
 * Append-only by convention: nothing in the application updates or
 * deletes a row here.
 * ------------------------------------------------------------------ */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: id(),
    // Who did it. Kept as text alongside the id because the answer must
    // survive the account being deleted.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email"),
    // "impersonate.start", "impersonate.stop", "member.approve", …
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    // Denormalised on purpose: the log has to stay readable after the
    // thing it refers to is gone.
    subjectLabel: text("subject_label"),
    detail: jsonb("detail").notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("admin_audit_created_idx").on(t.createdAt),
    index("admin_audit_actor_idx").on(t.actorUserId, t.createdAt),
    index("admin_audit_subject_idx").on(t.subjectType, t.subjectId),
  ]
);

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),

    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),
    specialistSlug: text("specialist_slug").notNull(),
    specialistName: text("specialist_name").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),

    registrationNumber: text("registration_number").notNull(),
    // Whether the number supplied matched the one already on the
    // listing. Never shown to the claimant — only to the admin deciding.
    registrationMatches: boolean("registration_matches").notNull().default(false),

    message: text("message"),

    plan: planIdEnum("plan").notNull().default("basic"),
    planInterval: planIntervalEnum("plan_interval").notNull().default("yearly"),

    status: claimStatusEnum("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Mandatory on refusal, and sent to the claimant in full.
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("claims_status_idx").on(t.status, t.createdAt),
    index("claims_specialist_idx").on(t.specialistId, t.status),
  ]
);

/** Contact-form submissions. The honeypot path stores nothing at all. */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    topic: contactTopicEnum("topic").notNull(),
    message: text("message").notNull(),
    status: contactStatusEnum("status").notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [index("contact_messages_status_idx").on(t.status, t.createdAt)]
);

/* ========================================================== relations
 * These drive the `db.query.<table>.findMany({ with: … })` API, which is
 * what replaced Mongoose's .populate(). Nothing else reads them.
 * ------------------------------------------------------------------ */

export const countriesRelations = relations(countries, ({ many }) => ({
  cities: many(cities),
  regulators: many(regulators),
}));

export const citiesRelations = relations(cities, ({ one, many }) => ({
  country: one(countries, { fields: [cities.countryId], references: [countries.id] }),
  clinicLocations: many(clinicLocations),
  facilities: many(facilities),
}));

export const regulatorsRelations = relations(regulators, ({ one }) => ({
  country: one(countries, { fields: [regulators.countryId], references: [countries.id] }),
}));

export const specialtiesRelations = relations(specialties, ({ one, many }) => ({
  parent: one(specialties, { fields: [specialties.parentId], references: [specialties.id], relationName: "specialtyTree" }),
  children: many(specialties, { relationName: "specialtyTree" }),
  conditions: many(conditions),
  treatments: many(treatments),
  specialistLinks: many(specialistSpecialties),
}));

export const conditionsRelations = relations(conditions, ({ one, many }) => ({
  specialty: one(specialties, { fields: [conditions.specialtyId], references: [specialties.id] }),
  treatments: many(treatments),
  specialistLinks: many(specialistConditions),
}));

export const treatmentsRelations = relations(treatments, ({ one, many }) => ({
  specialty: one(specialties, { fields: [treatments.specialtyId], references: [specialties.id] }),
  condition: one(conditions, { fields: [treatments.conditionId], references: [conditions.id] }),
  specialistLinks: many(specialistTreatments),
}));

export const facilityCategoriesRelations = relations(facilityCategories, ({ one, many }) => ({
  parent: one(facilityCategories, {
    fields: [facilityCategories.parentId],
    references: [facilityCategories.id],
    relationName: "facilityCategoryTree",
  }),
  children: many(facilityCategories, { relationName: "facilityCategoryTree" }),
  facilityLinks: many(facilityCategoryLinks),
}));

export const clinicsRelations = relations(clinics, ({ many }) => ({
  locations: many(clinicLocations),
  leads: many(leads),
}));

export const clinicLocationsRelations = relations(clinicLocations, ({ one, many }) => ({
  clinic: one(clinics, { fields: [clinicLocations.clinicId], references: [clinics.id] }),
  city: one(cities, { fields: [clinicLocations.cityId], references: [cities.id] }),
  ownedBySpecialist: one(specialists, {
    fields: [clinicLocations.ownedBySpecialistId],
    references: [specialists.id],
    relationName: "ownedLocations",
  }),
  specialistLinks: many(specialistClinicLocations),
}));

export const facilitiesRelations = relations(facilities, ({ one, many }) => ({
  city: one(cities, { fields: [facilities.cityId], references: [cities.id] }),
  user: one(users, { fields: [facilities.userId], references: [users.id] }),
  categoryLinks: many(facilityCategoryLinks),
  teamLinks: many(facilityTeam),
  leads: many(leads),
}));

export const facilityTeamRelations = relations(facilityTeam, ({ one }) => ({
  facility: one(facilities, { fields: [facilityTeam.facilityId], references: [facilities.id] }),
  specialist: one(specialists, { fields: [facilityTeam.specialistId], references: [specialists.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  specialist: one(specialists, { fields: [users.id], references: [specialists.userId] }),
  notifications: many(notifications),
  pushSubscriptions: many(pushSubscriptions),
  claims: many(claims),
}));

export const specialistsRelations = relations(specialists, ({ one, many }) => ({
  user: one(users, { fields: [specialists.userId], references: [users.id] }),
  primarySpecialty: one(specialties, {
    fields: [specialists.primarySpecialtyId],
    references: [specialties.id],
  }),
  regulator: one(regulators, { fields: [specialists.regulatorId], references: [regulators.id] }),
  specialtyLinks: many(specialistSpecialties),
  conditionLinks: many(specialistConditions),
  treatmentLinks: many(specialistTreatments),
  clinicLocationLinks: many(specialistClinicLocations),
  ownedLocations: many(clinicLocations, { relationName: "ownedLocations" }),
  facilityLinks: many(facilityTeam),
  leads: many(leads),
  orders: many(orders),
  claims: many(claims),
}));

export const specialistSpecialtiesRelations = relations(specialistSpecialties, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistSpecialties.specialistId],
    references: [specialists.id],
  }),
  specialty: one(specialties, {
    fields: [specialistSpecialties.specialtyId],
    references: [specialties.id],
  }),
}));

export const specialistConditionsRelations = relations(specialistConditions, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistConditions.specialistId],
    references: [specialists.id],
  }),
  condition: one(conditions, {
    fields: [specialistConditions.conditionId],
    references: [conditions.id],
  }),
}));

export const specialistTreatmentsRelations = relations(specialistTreatments, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistTreatments.specialistId],
    references: [specialists.id],
  }),
  treatment: one(treatments, {
    fields: [specialistTreatments.treatmentId],
    references: [treatments.id],
  }),
}));

export const specialistClinicLocationsRelations = relations(specialistClinicLocations, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistClinicLocations.specialistId],
    references: [specialists.id],
  }),
  clinicLocation: one(clinicLocations, {
    fields: [specialistClinicLocations.clinicLocationId],
    references: [clinicLocations.id],
  }),
}));

export const facilityCategoryLinksRelations = relations(facilityCategoryLinks, ({ one }) => ({
  facility: one(facilities, { fields: [facilityCategoryLinks.facilityId], references: [facilities.id] }),
  category: one(facilityCategories, {
    fields: [facilityCategoryLinks.categoryId],
    references: [facilityCategories.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  condition: one(conditions, { fields: [reviews.conditionId], references: [conditions.id] }),
}));

/* ------------------------------------------------------------------ *
 * ClinWell outbound events — an outbox, not a fire-and-forget call
 *
 * The contract's retry schedule (1 min, 5 min, 30 min, 2 h, 12 h) runs
 * for over fourteen hours, far longer than any request this
 * application serves, so an event has to survive a deploy. That means
 * a row.
 *
 * occurredAt is ClinWell's ordering key (§6.6). It is stamped when the
 * state change happens, frozen for the life of the row, and unique per
 * practice — so a retry can never look newer than it is, and two
 * events for one practice can never tie.
 * ------------------------------------------------------------------ */
export const clinwellEvents = pgTable(
  "clinwell_events",
  {
    id: id(),

    // Ours, generated once, reused by every retry. ClinWell's
    // idempotency key: resending the same one does nothing.
    eventId: text("event_id").notNull(),

    // subscription.activated | subscription.resumed |
    // subscription.cancelled | payment.failed | payment.recovered
    event: text("event").notNull(),

    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialists.id, { onDelete: "cascade" }),

    // The slug as registered on the ClinWell side, copied onto the row
    // rather than read at send time: the event describes something that
    // already happened, and a later rename must not rewrite history.
    practiceSlug: text("practice_slug").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    // The body exactly as it will be signed. Held rather than rebuilt,
    // because the signature covers raw bytes and a rebuild that
    // reordered one key would invalidate a signature already correct.
    payload: jsonb("payload").notNull(),

    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    // Set when the schedule is exhausted, or when a 4xx says retrying
    // is pointless. Never retried again, and raised to an administrator.
    deadAt: timestamp("dead_at", { withTimezone: true }),

    lastStatus: integer("last_status"),
    lastError: text("last_error"),

    // What ClinWell answered, so a 409 carrying the existing
    // workspaceId is not thrown away.
    response: jsonb("response"),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("clinwell_events_event_id_idx").on(table.eventId),
    uniqueIndex("clinwell_events_practice_occurred_idx").on(table.specialistId, table.occurredAt),
    index("clinwell_events_due_idx").on(table.nextAttemptAt),
  ]
);

/**
 * Inbound badge batches, kept so a repeated batchId returns the FIRST
 * response rather than being applied twice (Appendix B). Storing the
 * response is the only way to honour that, so the response is the row.
 *
 * completedAt is null while the first delivery is still in flight; a
 * second request arriving in that window gets 409 and is told to retry
 * in 30 seconds — the same rule we asked ClinWell to adopt on their
 * enquiry route, so it would be poor form not to honour it here.
 */
export const clinwellBatches = pgTable(
  "clinwell_batches",
  {
    batchId: text("batch_id").primaryKey().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    response: jsonb("response"),
    practiceCount: integer("practice_count"),
  },
  (table) => [index("clinwell_batches_received_idx").on(table.receivedAt)]
);

export const clinwellEventsRelations = relations(clinwellEvents, ({ one }) => ({
  specialist: one(specialists, {
    fields: [clinwellEvents.specialistId],
    references: [specialists.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  specialist: one(specialists, { fields: [leads.specialistId], references: [specialists.id] }),
  clinic: one(clinics, { fields: [leads.clinicId], references: [clinics.id] }),
  facility: one(facilities, { fields: [leads.facilityId], references: [facilities.id] }),
  condition: one(conditions, { fields: [leads.conditionId], references: [conditions.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  specialist: one(specialists, { fields: [orders.specialistId], references: [specialists.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

export const claimsRelations = relations(claims, ({ one }) => ({
  specialist: one(specialists, { fields: [claims.specialistId], references: [specialists.id] }),
  user: one(users, { fields: [claims.userId], references: [users.id] }),
}));
