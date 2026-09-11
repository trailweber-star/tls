// Per-specialty imagery and headline copy for the search results hero.
//
// The hero photo, the heading and the location line are all driven by the
// live query: search Orthopaedics in London and you get the orthopaedic
// photo and "London"; search Dentistry in Birmingham and both change.
// Adding a new top-level specialty means adding one row here — the page
// itself needs no edit, and falls back to the generic hero if a slug has
// no image yet.
import orthopaedics from "../assets/images/hero-orthopaedics.jpg";
import physiotherapy from "../assets/images/hero-physiotherapy.jpg";
import dentistry from "../assets/images/hero-dentistry.jpg";
import aesthetics from "../assets/images/hero-aesthetics.jpg";
import ent from "../assets/images/hero-ent.jpg";
import gynaecology from "../assets/images/hero-gynaecology.jpg";
import fallback from "../assets/images/hero-surgeon.webp";
import hospital from "../assets/images/hero-hospital.jpg";
import clinic from "../assets/images/hero-clinic.jpg";
import careHome from "../assets/images/hero-care-home.jpg";
import pharmacy from "../assets/images/hero-pharmacy.webp";

export const SPECIALTY_HERO_PHOTOS: Record<string, string> = {
  orthopaedics,
  physiotherapy,
  dentistry,
  "aesthetics-specialists": aesthetics,
  ent,
  gynaecology,
};

export const FALLBACK_HERO_PHOTO = fallback;

/* ------------------------------------------------------------------ *
 * Places
 *
 * The results page serves both halves of the directory, so the hero has
 * to follow the place type the same way it follows a specialty.
 * ------------------------------------------------------------------ */
export const PLACE_HERO_PHOTOS: Record<string, string> = {
  hospital,
  clinic,
  care_home: careHome,
  pharmacy,
};

export function placeHeroFor(facilityType: string | null | undefined): string {
  if (!facilityType) return fallback;
  return PLACE_HERO_PHOTOS[facilityType] ?? fallback;
}

// "Orthopaedics" -> "Orthopaedic Specialists" reads better as a page
// title than the raw taxonomy name, so top-level slugs get a headline
// form. Anything without an entry falls back to "<name> Specialists".
const HERO_HEADINGS: Record<string, string> = {
  orthopaedics: "Orthopaedic Specialists",
  physiotherapy: "Physiotherapists",
  dentistry: "Dental Specialists",
  "aesthetics-specialists": "Cosmetic & Aesthetic Specialists",
  ent: "ENT Specialists",
  gynaecology: "Gynaecologists",
};

export function heroPhotoFor(specialtySlug: string | null | undefined): string {
  if (!specialtySlug) return FALLBACK_HERO_PHOTO;
  return SPECIALTY_HERO_PHOTOS[specialtySlug] ?? FALLBACK_HERO_PHOTO;
}

/**
 * Page heading for the current search. A picked sub-specialty is more
 * specific than the parent, so it wins ("Knee Specialists" over
 * "Orthopaedic Specialists").
 */
export function heroHeadingFor(
  specialty: { slug: string; name: string } | null | undefined,
  subspecialties: { slug: string; name: string }[] = []
): string {
  if (subspecialties.length === 1) return `${subspecialties[0].name} Specialists`;
  if (subspecialties.length > 1) return `${specialty?.name ?? "All"} Specialists`;
  if (!specialty) return "All Specialists";
  return HERO_HEADINGS[specialty.slug] ?? `${specialty.name} Specialists`;
}
