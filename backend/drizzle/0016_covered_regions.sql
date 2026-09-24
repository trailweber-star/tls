/* ------------------------------------------------------------------ *
 * Regions an Expert Witness will cover
 *
 * Expert Witness listings are not tied to one clinic the way most
 * specialists are (see clinicLocations) -- a medico-legal expert takes
 * instructions across whichever UK regions they are willing to travel
 * to or produce reports for. This is a closed list (lib/ukRegions.js),
 * not free text, so a value written here always matches what the search
 * filter offers.
 *
 * Nullable and unused outside Expert Witness on purpose: every other
 * specialist category is placed by clinicLocations, and forcing this
 * column on them would just be an always-empty array everywhere else.
 * ------------------------------------------------------------------ */

ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "covered_regions" text[];
