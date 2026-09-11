// Aggregation shared by both storage modes so demo mode and MongoDB can
// never disagree about what a profile's review breakdown says.

const CATEGORIES = ["communication", "expertise", "care", "waitTime"];

/**
 * Average each review category across the reviews that carry scores.
 * Categories nobody has scored are returned as null rather than 0, so
 * the profile can omit that bar instead of showing a false zero.
 */
export function aggregateReviewScores(reviews = []) {
  const out = {};
  let any = false;
  for (const key of CATEGORIES) {
    const values = reviews.map((r) => r?.scores?.[key]).filter((v) => typeof v === "number");
    if (values.length) {
      out[key] = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
      any = true;
    } else {
      out[key] = null;
    }
  }
  return any ? out : null;
}

export { CATEGORIES as REVIEW_SCORE_CATEGORIES };
