import type { FacilityRegulator, FacilityRegulatorRating, FacilityType, OpeningHours } from "./types";

/* ------------------------------------------------------------------ *
 * Facility facets — the UI half of backend/src/lib/facilityFacets.js
 *
 * The slugs must stay identical on both sides: the filter panel sends
 * these strings and the API matches on them, so a typo here is a filter
 * that silently returns nothing.
 * ------------------------------------------------------------------ */

export interface Amenity {
  slug: string;
  label: string;
  types: FacilityType[];
}

export const FACILITY_AMENITIES: Amenity[] = [
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

export function amenityLabel(slug: string): string {
  return AMENITY_BY_SLUG.get(slug)?.label ?? slug;
}

export function amenitiesFor(type: FacilityType | "" | null | undefined): Amenity[] {
  if (!type) return FACILITY_AMENITIES;
  return FACILITY_AMENITIES.filter((a) => a.types.includes(type));
}

/* ------------------------------------------------------------ regulator */

export const REGULATORS: Record<FacilityRegulator, { short: string; name: string; nation: string }> = {
  cqc: { short: "CQC", name: "Care Quality Commission", nation: "England" },
  ciw: { short: "CIW", name: "Care Inspectorate Wales", nation: "Wales" },
  his: { short: "HIS", name: "Healthcare Improvement Scotland", nation: "Scotland" },
  ci: { short: "Care Inspectorate", name: "Care Inspectorate", nation: "Scotland" },
  rqia: { short: "RQIA", name: "Regulation and Quality Improvement Authority", nation: "Northern Ireland" },
  gphc: { short: "GPhC", name: "General Pharmaceutical Council", nation: "Great Britain" },
};

/**
 * Rating colours are semantic, not decorative — the same four words a
 * regulator uses, coloured the way a regulator's own report colours
 * them, so a family scanning results reads the grade at a glance.
 */
export const REGULATOR_RATINGS: Record<
  FacilityRegulatorRating,
  { label: string; chip: string; dot: string }
> = {
  outstanding: { label: "Outstanding", chip: "bg-teal-100 text-teal-800 ring-teal-200", dot: "bg-teal-600" },
  good: { label: "Good", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-600" },
  requires_improvement: {
    label: "Requires improvement",
    chip: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  inadequate: { label: "Inadequate", chip: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-600" },
  not_rated: { label: "Not yet rated", chip: "bg-paper-tint text-ink-muted ring-line", dot: "bg-ink-faint" },
};

/* --------------------------------------------------------- type labels */

export const FACILITY_TYPES: Record<FacilityType, { label: string; plural: string }> = {
  hospital: { label: "Hospital", plural: "Hospitals" },
  clinic: { label: "Clinic", plural: "Clinics" },
  care_home: { label: "Care home", plural: "Care homes" },
  pharmacy: { label: "Pharmacy", plural: "Pharmacies" },
};

/* -------------------------------------------------------------- hours */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Open right now? `null` means the hours were never published — which
 * the interface must show as "hours not published", never as "closed".
 * A place that has not filled the field in has not told you it is shut.
 */
export function isOpenNow(
  facility: { open24h: boolean; openingHours: OpeningHours | null },
  when = new Date()
): boolean | null {
  if (facility.open24h) return true;
  const hours = facility.openingHours;
  if (!hours) return null;
  const day = hours[DAY_KEYS[(when.getDay() + 6) % 7]];
  if (!day || !day.open || !day.close) return false;
  const minutes = when.getHours() * 60 + when.getMinutes();
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

/** "Closes 20:00" / "Opens 08:00 tomorrow" — the line under "Open now". */
export function hoursSummary(
  facility: { open24h: boolean; openingHours: OpeningHours | null },
  when = new Date()
): string | null {
  if (facility.open24h) return "Open 24 hours";
  const hours = facility.openingHours;
  if (!hours) return null;
  const todayIndex = (when.getDay() + 6) % 7;
  const today = hours[DAY_KEYS[todayIndex]];
  if (today && isOpenNow(facility, when)) return `Closes ${today.close}`;
  // Walk forward to the next day that actually has hours, so a place
  // closed Sunday says when it next opens rather than nothing at all.
  for (let step = today && when.getHours() * 60 + when.getMinutes() < toMinutes(today.open) ? 0 : 1; step <= 7; step += 1) {
    const key = DAY_KEYS[(todayIndex + step) % 7];
    const day = hours[key];
    if (day?.open) {
      if (step === 0) return `Opens ${day.open}`;
      return step === 1 ? `Opens ${day.open} tomorrow` : `Opens ${day.open} ${DAY_LABELS[key]}`;
    }
  }
  return null;
}
