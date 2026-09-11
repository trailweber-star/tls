// Rating aggregation.
//
// ratingAvg / ratingCount are stored on the Specialist as a denormalised
// cache — reading a profile must not scan every review row. This module
// is the single place that derives them, and `recomputeSpecialistRating`
// is what every write path (a new review, an edited one, a removed one)
// calls so the cache can never drift from the underlying reviews.

/** Derive { ratingAvg, ratingCount } from a set of review rows. */
export function deriveRating(reviews = []) {
  const ratings = reviews.map((r) => r?.rating).filter((n) => typeof n === "number" && n > 0);
  if (!ratings.length) return { ratingAvg: 0, ratingCount: 0 };
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return { ratingAvg: Number(avg.toFixed(1)), ratingCount: ratings.length };
}
