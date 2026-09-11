/* ------------------------------------------------------------------ *
 * Facility facets — the shared vocabulary for places
 *
 * One list, read by the search filters, the listing page and (via its
 * mirror in the frontend's lib/facilityFacets.ts) the UI labels. The
 * alternative — a slug typed into a filter in one file and into a chip
 * in another — is how a filter quietly stops matching anything.
 *
 * Amenities are deliberately the things a patient or a family actually
 * chooses on: can I park, can a wheelchair get in, can I be seen today,
 * can I bring the dog to see my mother. They are not a feature list.
 * ------------------------------------------------------------------ */

/** Amenity slugs, with the place types each one is offered for. */
export const FACILITY_AMENITIES = [
  { slug: "on-site-parking", label: "On-site parking", types: ["hospital", "clinic", "care_home", "pharmacy"] },
  { slug: "wheelchair-access", label: "Step-free access", types: ["hospital", "clinic", "care_home", "pharmacy"] },
  { slug: "accessible-wc", label: "Accessible toilet", types: ["hospital", "clinic", "care_home", "pharmacy"] },
  { slug: "public-transport", label: "Near public transport", types: ["hospital", "clinic", "care_home", "pharmacy"] },
  { slug: "hearing-loop", label: "Hearing loop", types: ["hospital", "clinic", "care_home", "pharmacy"] },
  { slug: "interpreter", label: "Interpreter on request", types: ["hospital", "clinic", "care_home"] },

  { slug: "on-site-imaging", label: "On-site imaging", types: ["hospital", "clinic"] },
  { slug: "on-site-pharmacy", label: "On-site pharmacy", types: ["hospital", "clinic"] },
  { slug: "on-site-pathology", label: "On-site pathology", types: ["hospital", "clinic"] },
  { slug: "overnight-stay", label: "Overnight stay", types: ["hospital"] },
  { slug: "private-rooms", label: "Private ensuite rooms", types: ["hospital", "care_home"] },
  { slug: "critical-care", label: "Critical care unit", types: ["hospital"] },
  { slug: "childrens-ward", label: "Children's ward", types: ["hospital"] },

  { slug: "ensuite-rooms", label: "En-suite bedrooms", types: ["care_home"] },
  { slug: "garden", label: "Garden or grounds", types: ["care_home"] },
  { slug: "pets-welcome", label: "Pets welcome", types: ["care_home"] },
  { slug: "visiting-anytime", label: "Open visiting", types: ["care_home"] },
  { slug: "on-site-nurse", label: "Nurse on site 24/7", types: ["care_home"] },
  { slug: "activities-programme", label: "Activities programme", types: ["care_home"] },

  { slug: "walk-in", label: "Walk-ins accepted", types: ["clinic", "pharmacy"] },
  { slug: "same-day-appointments", label: "Same-day appointments", types: ["clinic"] },
  { slug: "evening-clinics", label: "Evening clinics", types: ["clinic"] },
  { slug: "weekend-clinics", label: "Weekend clinics", types: ["clinic"] },

  { slug: "prescription-delivery", label: "Prescription delivery", types: ["pharmacy"] },
  { slug: "consultation-room", label: "Private consultation room", types: ["pharmacy"] },
];

const AMENITY_BY_SLUG = new Map(FACILITY_AMENITIES.map((a) => [a.slug, a]));

export function amenityLabel(slug) {
  return AMENITY_BY_SLUG.get(slug)?.label ?? slug;
}

export function amenitiesFor(facilityType) {
  return FACILITY_AMENITIES.filter((a) => a.types.includes(facilityType));
}

/* ------------------------------------------------------------ regulator */

export const REGULATORS = {
  cqc: { short: "CQC", name: "Care Quality Commission", nation: "England" },
  ciw: { short: "CIW", name: "Care Inspectorate Wales", nation: "Wales" },
  his: { short: "HIS", name: "Healthcare Improvement Scotland", nation: "Scotland" },
  ci: { short: "Care Inspectorate", name: "Care Inspectorate", nation: "Scotland" },
  rqia: { short: "RQIA", name: "Regulation and Quality Improvement Authority", nation: "Northern Ireland" },
  gphc: { short: "GPhC", name: "General Pharmaceutical Council", nation: "Great Britain" },
};

export const REGULATOR_RATINGS = {
  outstanding: { label: "Outstanding", tone: "best" },
  good: { label: "Good", tone: "good" },
  requires_improvement: { label: "Requires improvement", tone: "warn" },
  inadequate: { label: "Inadequate", tone: "bad" },
  not_rated: { label: "Not yet rated", tone: "neutral" },
};

/* -------------------------------------------------------------- hours */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Is the place open at `when`? Returns null — not false — when the hours
 * were never published, so the caller can say "hours not published"
 * instead of "closed". An "Open now" filter that treats silence as
 * closed hides every listing that has not filled the field in yet.
 */
export function isOpenAt(facility, when = new Date()) {
  if (facility.open24h) return true;
  const hours = facility.openingHours;
  if (!hours || typeof hours !== "object" || !DAY_KEYS.some((d) => d in hours)) return null;
  const day = hours[DAY_KEYS[(when.getDay() + 6) % 7]];
  if (!day || !day.open || !day.close) return false;
  const minutes = when.getHours() * 60 + when.getMinutes();
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  // A close time earlier than the open time means it runs past midnight.
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

/* --------------------------------------------------------- type labels */

export const FACILITY_TYPES = {
  hospital: { label: "Hospital", plural: "Hospitals", article: "a hospital" },
  clinic: { label: "Clinic", plural: "Clinics", article: "a clinic" },
  care_home: { label: "Care home", plural: "Care homes", article: "a care home" },
  pharmacy: { label: "Pharmacy", plural: "Pharmacies", article: "a pharmacy" },
};
