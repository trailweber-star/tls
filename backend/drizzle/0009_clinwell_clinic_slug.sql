/* ------------------------------------------------------------------ *
 * Rename clinwell_slug → clinwell_clinic_slug
 *
 * A rename, because the column's MEANING changed and the old name now
 * says the wrong thing.
 *
 * It was added believing there was one slug per practice, sometimes
 * differing between the two sides, and that TLS would send ClinWell's
 * version. Sahil has since corrected that: there are two slugs and
 * neither replaces the other.
 *
 *   practice.slug   ours — /specialists/<slug>. This is what we send in
 *                   every event, and what ClinWell sends back in the
 *                   nightly badge push. Never substituted.
 *
 *   clinicSlug      theirs — "dkc" for Dr Moholkar's clinic. Used in
 *                   exactly one place: the §7 embed URL
 *                   app.clinwell.ai/book/<clinicSlug>/enquiry.
 *
 * The two are joined on ClinWell's side by the workspaceId row, not by
 * being the same string. Nothing gets renamed on this site.
 *
 * The old name invited exactly the mistake that was in the code before
 * this: falling back to our own slug when the ClinWell one was unset,
 * which would build a booking URL on their host out of our slug and
 * 404 for every patient who clicked it. A column called
 * clinic_slug cannot plausibly take our slug as a default.
 *
 * Guarded, because this column may or may not exist yet depending on
 * whether 0007 was applied before this landed.
 * ------------------------------------------------------------------ */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'specialists' AND column_name = 'clinwell_slug'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'specialists' AND column_name = 'clinwell_clinic_slug'
  ) THEN
    ALTER TABLE "specialists" RENAME COLUMN "clinwell_slug" TO "clinwell_clinic_slug";
  END IF;
END $$;

/* Belt and braces: if neither existed (a database built before 0007),
   create it. */
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_clinic_slug" text;

/* The unique index followed the old name. Drop and recreate rather than
   rename, so this works whichever branch above ran.

   Still unique: two listings pointing at one ClinWell clinic would put
   two practices' patients through one booking widget. */
DROP INDEX IF EXISTS "specialists_clinwell_slug_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "specialists_clinwell_clinic_slug_idx"
  ON "specialists" ("clinwell_clinic_slug")
  WHERE "clinwell_clinic_slug" IS NOT NULL;
