// Real photography for the 4 homepage specialty tiles (see categoryVisual()
// for the gradient/icon treatment still used everywhere else — the
// facility-category tiles further down the homepage, and any future
// specialty not covered here). Deliberately small and homepage-specific:
// the reference design shows exactly these 4 tiles with real photos, not
// the full specialty taxonomy.
import orthopaedicsPhoto from "../assets/images/tile-orthopaedics.webp";
import physiotherapyPhoto from "../assets/images/tile-physiotherapy.webp";
import dentistryPhoto from "../assets/images/tile-dentistry.webp";
import aestheticsPhoto from "../assets/images/tile-aesthetics.webp";
import expertWitnessPhoto from "../assets/images/tile-expert-witness.jpg";
import pharmacyPhoto from "../assets/images/tile-pharmacy.webp";

export const CATEGORY_PHOTOS: Record<string, string> = {
  orthopaedics: orthopaedicsPhoto,
  physiotherapy: physiotherapyPhoto,
  dentistry: dentistryPhoto,
  "aesthetics-specialists": aestheticsPhoto,
  "expert-witness": expertWitnessPhoto,
};

// The order + set of specialties shown as photo tiles on the homepage
// (matches the reference design's 4-tile "Explore Our Specialties"
// section). Everything else in the taxonomy is reachable via "View all
// specialties" rather than shown here.
export const HOMEPAGE_SPECIALTY_SLUGS = [
  "orthopaedics",
  "physiotherapy",
  "aesthetics-specialists",
  "dentistry",
  "expert-witness",
];

// Homepage-only display copy for the 4 tiles above — a display-name
// override (the reference mockup labels the aesthetics tile "Cosmetic &
// Aesthetic Surgery" rather than the taxonomy's own "Aesthetics
// Specialists") plus a one-line marketing blurb per tile. This is purely
// presentational and never touches the underlying taxonomy name used
// everywhere else in the app (search, breadcrumbs, etc).
export const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  "aesthetics-specialists": "Cosmetic & Aesthetic Surgery",
  // The taxonomy category stays "Expert Witness" everywhere else
  // (breadcrumbs, the admin taxonomy tree, URLs) -- the homepage-facing
  // label reads "Expert Witnesses" to match the search tab.
  "expert-witness": "Expert Witnesses",
};

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  orthopaedics: "Joint, bone & musculoskeletal care",
  physiotherapy: "Recovery & performance",
  "aesthetics-specialists": "Enhance your natural beauty",
  dentistry: "Healthy smiles, lasting confidence",
  "expert-witness": "Medico-legal reports & testimony",
};

// Pharmacy is a FACILITY category, not a specialty — it has no row in
// topLevelSpecialties, so it can't go through CATEGORY_PHOTOS/HOMEPAGE_
// SPECIALTY_SLUGS above. It's rendered as an extra tile (see Home.tsx)
// alongside the specialty tiles, using the same card design.
export const PHARMACY_TILE = {
  id: "pharmacy",
  name: "Pharmacies",
  description: "Prescriptions, advice & healthcare essentials",
  photo: pharmacyPhoto,
  href: "/search?type=pharmacy",
};
