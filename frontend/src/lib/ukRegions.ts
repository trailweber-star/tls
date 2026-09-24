/* ------------------------------------------------------------------ *
 * UK regions — mirrors backend/src/lib/ukRegions.js
 *
 * One canonical list, so a region picked here always matches the same
 * string the search filter and the specialist profile editor use. Order
 * is the order every regions dropdown on the site shows them in: the
 * home nations and constituent countries first, then England's regions
 * north to south, "Nationwide" last as the catch-all.
 * ------------------------------------------------------------------ */
export const UK_REGIONS = [
  "London",
  "South East",
  "South West",
  "East of England",
  "West Midlands",
  "East Midlands",
  "Yorkshire and the Humber",
  "North West",
  "North East",
  "Wales",
  "Scotland",
  "Northern Ireland",
  "Nationwide",
] as const;

export type UkRegion = (typeof UK_REGIONS)[number];

/** "Yorkshire and the Humber" -> "yorkshire-and-the-humber", for URL/filter values. */
export function regionSlug(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
