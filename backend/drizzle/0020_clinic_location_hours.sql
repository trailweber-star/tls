/* ------------------------------------------------------------------ *
 * Opening hours per practice address, not per specialist
 *
 * facilities already carries opening_hours; individual specialists never
 * had anywhere to put practice hours at all, even though a consultant who
 * sees patients at two hospitals on different days genuinely has
 * different hours at each. This puts the same shape the site already
 * uses on facilities onto clinic_locations instead of onto specialists,
 * because hours are a fact about the ADDRESS, not the person -- exactly
 * like `phone` on this same table.
 *
 * Same convention as facilities.opening_hours:
 *   { mon: { open: "08:00", close: "20:00" } … sun: null, notes: "" }
 * A null day means closed; the whole object empty (the default) means
 * unpublished, and the profile says so rather than guessing "closed".
 * ------------------------------------------------------------------ */

ALTER TABLE "clinic_locations" ADD COLUMN IF NOT EXISTS "opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL;
