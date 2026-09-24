/* ------------------------------------------------------------------ *
 * UK regions — the closed list "regions covered" is drawn from
 *
 * One canonical list, so a region typed into an expert witness's
 * profile always matches the same string the search filter offers —
 * a free-text region field would let "South East" and "South-East"
 * silently stop matching each other. Order is the order the filter
 * dropdown shows them in: the home nations and constituent countries
 * first, then England's regions north to south, "Nationwide" last as
 * the catch-all.
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
];

export const UK_REGION_SET = new Set(UK_REGIONS);

/** "Yorkshire and the Humber" -> "yorkshire-and-the-humber", for URL/filter values. */
export function regionSlug(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const REGION_BY_SLUG = new Map(UK_REGIONS.map((name) => [regionSlug(name), name]));
