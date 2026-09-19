/* ------------------------------------------------------------------ *
 * Who put this treatment on this profile
 *
 * specialist_treatments and specialist_conditions were bare join
 * tables: two ids and nothing else. That was fine while the only way a
 * link got there was a person typing it. It stopped being fine the day
 * a script started writing them, because a script that writes also has
 * to be able to take back — and a delete with no provenance to aim at
 * can only clear EVERYTHING on a listing.
 *
 * That is not hypothetical. derive-treatments.mjs --replace was written
 * to make a re-run mean "the state the current rules produce" rather
 * than "the union of every run ever made", and its delete had no way to
 * say which rows were its own. So a run of the description pass
 * destroyed 1,787 links the website pass had written, on every listing
 * the two had in common, and the only reason it was recoverable is that
 * the website pass is deterministic and could simply be run again.
 *
 * The fix is one nullable column on each table.
 *
 *   description  derive-treatments.mjs, from the listing's own bio
 *   website      derive-from-websites.mjs, from the practice's own site
 *   profile      somebody edited the profile — a claim, or an admin
 *   seed         the demo directory
 *   NULL         written before this column existed
 *
 * WHY NOT A DEFAULT. A default would quietly label every future writer
 * as whatever the default says, including a writer added in two years
 * by somebody who never read this file. Null means "nobody said", which
 * is the truth about the rows that already exist and is a question
 * worth being asked out loud rather than answered wrongly.
 *
 * WHY NOT PART OF THE PRIMARY KEY. One link per (listing, item) is
 * still the rule: a profile does not list Knee Replacement twice
 * because two passes found it. The key stays as it is, the first writer
 * wins by ON CONFLICT DO NOTHING, and source records who that was.
 *
 * WHAT THE NULLS MEAN FOR THE FIRST RUN AFTER THIS. There are ~5,500 of
 * them and no honest way to tell which pass wrote which — so the
 * description pass adopts them: its --replace clears NULL as well as
 * its own rows, exactly as it clears them today, and says so on screen.
 * That leaves one more cycle of the old ordering rule (description
 * first, website second) and then no nulls, after which each pass can
 * only ever delete its own work and the order stops mattering.
 * ------------------------------------------------------------------ */

ALTER TABLE "specialist_treatments" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "specialist_conditions" ADD COLUMN IF NOT EXISTS "source" text;

/* A scoped clear is "these listings, my rows only" — specialist_id is
   already the leading column of the primary key, so this index is for
   the other direction: counting or clearing one writer's work across
   the whole table, which is what the audit reports and what a future
   "undo the website pass" would need. */
CREATE INDEX IF NOT EXISTS "specialist_treatments_source_idx"
  ON "specialist_treatments" ("source");
CREATE INDEX IF NOT EXISTS "specialist_conditions_source_idx"
  ON "specialist_conditions" ("source");
