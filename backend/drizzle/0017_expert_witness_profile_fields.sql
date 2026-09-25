/* ------------------------------------------------- Expert Witness profile
 * Structured sections particular to a medico-legal CV, imported from
 * McCollum Consultants et al. (see imports/expert-witness-enriched.jsonl
 * and scripts/enrich-expert-witnesses.mjs) and rendered as their own
 * labelled sections on the profile page -- the same shape the source
 * sites use, rather than folded into the one generic `bio` column. Null
 * for every specialist outside Expert Witness; nothing here is required
 * or invented on import, only what the source page actually stated.
 *
 * areasOfExpertise is the fine-grained self-described tag list
 * ("Cataracts", "Glaucoma", "Diabetic Complications") -- one level more
 * specific than the specialty taxonomy and too numerous per person
 * (10-30 each) to make filterable nodes of without drowning the
 * Medicolegal "Type of report" filter. Shown as tag pills on the profile
 * instead; specialistSpecialties is what search actually filters on.
 * ------------------------------------------------------------------ */

ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "medico_legal_experience" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinical_practice_experience" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinical_interests" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "management_experience" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "research_interests" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "summary_of_publications" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "teaching_training" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "prizes_and_awards" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "memberships" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "areas_of_expertise" text[];
