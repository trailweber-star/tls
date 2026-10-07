/* ------------------------------------------------------------------ *
 * A claimant can attach a headshot while claiming. It is held on the
 * claim, not the listing, so nothing public changes until an admin
 * approves the claim (see decideClaim in claims.controller.js).
 * ------------------------------------------------------------------ */
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "photo_url" text;
