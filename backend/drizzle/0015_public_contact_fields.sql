/* ------------------------------------------------------------------ *
 * Published contact details, separate from the private inbox
 *
 * contactEmail/contactPhone are where an enquiry is routed and are
 * never served publicly (see lib/profileGate.js's NEVER_PUBLIC list --
 * that boundary was drawn on purpose after they were once found leaking
 * to every visitor). publicEmail already existed as a gated field in
 * profileGate.js and in the frontend's ContactStrip, but no column ever
 * backed it -- this finally adds it, alongside its phone counterpart,
 * as something a specialist opts into separately from their enquiry
 * address, and that only shows on the profile when their plan's
 * publicContactEmail/phoneReveal feature allows it.
 * ------------------------------------------------------------------ */

ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "public_email" text;
--> statement-breakpoint

ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "public_phone" text;
