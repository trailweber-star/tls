// Shared TypeScript types — mirrors the backend's serialized API shapes
// (see tls-mern/backend/src/controllers/*.js). Keep in sync with those
// serializers.

/**
 * Every state the database column can hold. This used to list three of
 * the six, so an imported listing ("unverified") and a suspended one
 * were both outside the type the page was written against.
 */
export type VerificationStatus =
  | "unverified"
  | "pending"
  | "info_requested"
  | "verified"
  | "rejected"
  | "suspended";

export interface Specialty {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  seoTitle: string | null;
  description: string | null;
}

export interface City {
  id: string;
  countryId: string;
  name: string;
  slug: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * A city as it arrives nested inside something else.
 *
 * Three places declared their own narrower shape without lat/lng, while
 * the API has always sent the whole row — so the coordinates were
 * there, and the types said they were not. Anything wanting to put a
 * pin on the town had to be told the field did not exist. One shape
 * now, matching what is actually sent, with the coordinates optional
 * because a city row is allowed to have none.
 */
export interface CityRef {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  countryId?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface Regulator {
  id: string;
  code: string;
  name: string;
}

export interface Condition {
  id: string;
  slug: string;
  name: string;
}

export interface Treatment {
  id: string;
  slug: string;
  name: string;
}

export interface ClinicRef {
  id: string;
  slug: string;
  name: string;
}

export interface ClinicLocationWithCity {
  id: string;
  address: string;
  postcode: string | null;
  phone: string | null;
  /**
   * The address's own coordinates, when it was picked from the geocoded
   * suggestions rather than typed. Null means the map falls back to the
   * town, and distance searches are approximate — so it is optional
   * here rather than assumed present.
   */
  lat?: number | null;
  lng?: number | null;
  city: CityRef | null;
  /**
   * Null for an address the specialist added from their own dashboard.
   * That is their own practice and belongs to no clinic — the database
   * has always allowed it (clinic_locations.clinic_id is nullable), but
   * this type claimed otherwise, so nothing warned and the profile page
   * read `.slug` off null the moment a specialist edited their
   * locations. The whole page went white.
   */
  clinic: ClinicRef | null;
}

export interface ReviewScores {
  communication: number | null;
  expertise: number | null;
  care: number | null;
  waitTime: number | null;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  patientName: string | null;
  verified: boolean;
  // Optional per-category scores behind the overall rating.
  scores: ReviewScores | null;
  createdAt: string;
}

export interface SpecialistWithRelations {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  /** Letters after the name — "FRCS (Tr&Orth), MBBS". */
  qualifications?: string | null;
  photoUrl: string | null;
  bio: string | null;
  verificationStatus: VerificationStatus;
  claimed: boolean;
  consultationPriceMinor: number | null;
  currency: string;
  languages: string[];
  // UK regions this specialist covers -- Expert Witness only; null/empty
  // for every other category (see lib/ukRegions.js).
  coveredRegions?: string[] | null;
  /* ------------------------------------------------- Expert Witness profile
     The medico-legal CV sections (see migration
     0014_expert_witness_profile_fields.sql) -- null for every specialist
     outside Expert Witness, and null per-field even within it when the
     source page never stated that section. Nothing here is filled in to
     complete the set. */
  medicoLegalExperience?: string | null;
  clinicalPracticeExperience?: string | null;
  clinicalInterests?: string | null;
  managementExperience?: string | null;
  researchInterests?: string | null;
  summaryOfPublications?: string | null;
  teachingTraining?: string | null;
  prizesAndAwards?: string | null;
  memberships?: string | null;
  // Fine-grained self-described tags ("Breast Implants", "Mastopexy") --
  // shown as tag pills, not filterable and not a taxonomy value. See the
  // column's own comment in schema.js for why.
  areasOfExpertise?: string[] | null;
  ratingAvg: number;
  ratingCount: number;
  registrationNumber: string | null;
  // Next bookable appointment (ISO). Null when the specialist hasn't
  // published availability — the UI omits the line rather than guessing.
  nextAvailableAt: string | null;
  // Years in practice — profile subtitle and key-stats bar.
  yearsExperience: number | null;
  // Optional intro video. Without videoUrl the profile omits the card.
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  // Averaged per-category review breakdown; null when no review carries
  // category scores, in which case the breakdown is not rendered.
  reviewScores: ReviewScores | null;
  /* ------------------------------------------------------- plan
     What the API decided this listing is entitled to show. The fields
     below arrive empty rather than absent when a plan does not include
     them, so the page renders from data instead of guessing. */
  plan?: {
    id: "basic" | "premium" | "clinwell";
    name: string;
    verifiedBadge: boolean;
    searchPriority: "standard" | "top";
    features: {
      photoGallery: boolean;
      videoBio: boolean;
      bookingLink: boolean;
      enquiryForm: boolean;
      publicContactEmail: boolean;
      privateChat: boolean;
      websiteAndSocial: boolean;
      phoneReveal: boolean;
      reviewReplies: boolean;
    };
  };

  /* ClinWell (contract v1.0.1). Only these two cross to the public API:
     the badge flag and, when it is live, the one embeddable URL (§7).
     The workspace id, the registered slug and the internal status are
     stripped server-side by profileGate. */
  clinwellLive?: boolean;
  clinwellEmbedUrl?: string | null;

  /** Owner/admin only: what is populated but withheld from patients. */
  planAdmin?: {
    selectedPlan: string;
    selectedPlanName: string;
    planStatus: string;
    awaitingActivation: boolean;
    lockedFields: string[];
  };
  coverImageUrl?: string | null;
  gallery?: { url: string; caption: string | null }[];
  websiteUrl?: string | null;
  socials?: { linkedin?: string | null; x?: string | null; instagram?: string | null; facebook?: string | null; youtube?: string | null } | null;
  bookingUrl?: string | null;
  publicEmail?: string | null;
  publicPhone?: string | null;
  /** Search cards only. */
  verifiedBadge?: boolean;
  planTier?: "basic" | "premium" | "clinwell";
  priority?: boolean;
  // Present only on search results: distance from the searched location
  // once it resolves to coordinates, and why this result matched.
  distanceKm?: number | null;
  matchReasons?: MatchReason[];
  primarySpecialty: { id: string; slug: string; name: string } | null;
  regulator: Regulator | null;
  specialties: { id: string; slug: string; name: string }[];
  conditions: Condition[];
  treatments: Treatment[];
  clinicLocations: ClinicLocationWithCity[];
  reviews: Review[];
}

export interface MatchReason {
  type: "specialty" | "location" | "verification" | "rating" | "availability";
  label: string;
}

export interface FacetCount {
  slug: string;
  name: string;
  count: number;
}

export interface SearchFacets {
  subspecialties: FacetCount[];
  // Only populated (and only meaningful) when the chosen specialty is
  // Expert Witness -- empty for every other category.
  regions: FacetCount[];
  // Same restriction as `regions` -- the law-specific practice areas
  // under Medicolegal (Personal Injury, Clinical Negligence, ...).
  practiceAreas: FacetCount[];
  // Same restriction as `regions` -- the clinical-discipline leaves
  // under Medical Specialty (Cardiology, Neurosurgery, ...).
  clinicalSpecialties: FacetCount[];
  cities: FacetCount[];
  availability: { days: number; label: string; count: number }[];
  ratings: { min: number; count: number }[];
  verified: number;
  price: { minMinor: number | null; maxMinor: number | null; ceilingMinor: number };
}

// What the location string resolved to. `source` is "city-table" today
// and becomes "geocoder" once a Maps API is wired up in the backend's
// lib/geo.js — the frontend reads the same shape either way.
export interface ResolvedLocation {
  query: string;
  label: string | null;
  lat: number | null;
  lng: number | null;
  source: "none" | "city-table" | "geocoder" | "unresolved";
  resolved: boolean;
  radiusKm: number;
}

export type SortOption =
  | "best-match"
  | "rating"
  | "reviews"
  | "price-asc"
  | "price-desc"
  | "availability"
  | "distance";

export interface SearchResponse {
  results: SpecialistWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  location: ResolvedLocation;
  specialty: { id: string; slug: string; name: string } | null;
  subspecialties: { slug: string; name: string }[];
  facets: SearchFacets;
  sort: SortOption;
}

export type FacilityType = "hospital" | "clinic" | "care_home" | "pharmacy";

export interface FacilityCategory {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
}

export type FacilityRegulator = "cqc" | "ciw" | "his" | "ci" | "rqia" | "gphc";
export type FacilityRegulatorRating =
  | "outstanding"
  | "good"
  | "requires_improvement"
  | "inadequate"
  | "not_rated";

/** A day the place is open, or null for closed. */
export interface OpeningDay {
  open: string;
  close: string;
}
export interface OpeningHours {
  mon?: OpeningDay | null;
  tue?: OpeningDay | null;
  wed?: OpeningDay | null;
  thu?: OpeningDay | null;
  fri?: OpeningDay | null;
  sat?: OpeningDay | null;
  sun?: OpeningDay | null;
  notes?: string;
}

/** A clinician who practises at a place, as the place's profile shows them. */
export interface FacilityTeamMember {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  photoUrl: string | null;
  verificationStatus: VerificationStatus;
  ratingAvg: number;
  ratingCount: number;
  role: string | null;
  primarySpecialty: { id: string; slug: string; name: string } | null;
}

/**
 * A place. Mirrors SpecialistWithRelations wherever the two mean the
 * same thing, so the card, the profile and the search page can be built
 * to one standard rather than two.
 */
export interface FacilityWithRelations {
  id: string;
  slug: string;
  name: string;
  facilityType: FacilityType;
  tagline: string | null;
  description: string | null;
  about?: string | null;
  photoUrl: string | null;
  coverImageUrl?: string | null;
  gallery?: { url: string; caption: string | null }[];
  websiteUrl: string | null;
  bookingUrl?: string | null;
  socials?: {
    linkedin?: string | null;
    x?: string | null;
    instagram?: string | null;
    facebook?: string | null;
    youtube?: string | null;
  } | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  lat?: number | null;
  lng?: number | null;

  regulator: FacilityRegulator | null;
  regulatorRef: string | null;
  regulatorRating: FacilityRegulatorRating | null;
  regulatorRatedAt: string | null;
  regulatorUrl: string | null;

  yearEstablished: number | null;
  bedCount: number | null;
  staffCount: number | null;
  openingHours: OpeningHours | null;
  open24h: boolean;
  emergencyDepartment: boolean;

  languages: string[];
  amenities: string[];
  insurers: string[];
  accreditations: string[];

  verificationStatus: VerificationStatus;
  ratingAvg: number;
  ratingCount: number;
  city: CityRef | null;
  categories: { id: string; slug: string; name: string }[];

  /** Profile only. */
  team?: FacilityTeamMember[];
  reviews?: Review[];
  reviewScores?: ReviewScores | null;

  /** Search cards only. */
  teamCount?: number;
  reviewSample?: Review[];
  distanceKm?: number | null;

  plan?: SpecialistWithRelations["plan"];
  planAdmin?: SpecialistWithRelations["planAdmin"];
}

export interface ClinicWithRelations {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  locations: {
    id: string;
    address: string;
    postcode: string | null;
    phone: string | null;
    /**
     * Null when the city row behind this location could not be
     * resolved. The column is NOT NULL, but the API builds this by
     * looking the city up in a map, and a miss yields null — so the
     * type has to admit it or the page throws on a row it was told
     * could not exist.
     */
    city: CityRef | null;
  }[];
  specialists: { id: string; slug: string; fullName: string; title: string | null }[];
}

/**
 * One card of the homepage review strip: an approved review plus enough
 * of what it is about to render and link to it.
 */
export interface FeaturedReview {
  review: Review;
  subject: {
    kind: "specialist" | "facility";
    slug: string;
    name: string;
    subtitle: string | null;
    photoUrl: string | null;
    facilityType?: FacilityType;
    href: string;
  };
  /** The condition or treatment the patient was seen for, when tagged. */
  seenFor: string | null;
}
