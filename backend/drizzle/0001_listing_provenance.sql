/* ------------------------------------------------------------------ *
 * Catching the migrations up with the schema, and adding provenance.
 *
 * Two separate things, in one migration because the first was missing
 * and would have stopped the second dead.
 *
 * 1. The places, team and review-moderation work all landed in
 *    src/db/schema.js without a migration to match, so a database built
 *    from ./drizzle alone was missing the facility_team table, thirty-odd
 *    facility columns and every moderation column on reviews. Anyone
 *    running `npm run db:reset && npm run seed` hit it immediately: the
 *    seed truncates facility_team, and there was no facility_team.
 *
 * 2. Qualifications, and where an unclaimed listing came from — see the
 *    note on those columns in schema.js.
 * ------------------------------------------------------------------ */

-- Enum types the later work introduced.
DO $$ BEGIN
  CREATE TYPE "facility_regulator" AS ENUM ('cqc', 'ciw', 'his', 'ci', 'rqia', 'gphc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "facility_regulator_rating" AS ENUM ('outstanding', 'good', 'requires_improvement', 'inadequate', 'not_rated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "review_moderation" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

/* Values added to existing enums. These cannot run inside the same
   transaction as a statement that uses them on some Postgres versions,
   which is why they sit here on their own before anything references
   them. A review of a hospital, and the two review-moderation
   notifications, were all being written by code against an enum that
   had never been told about them — the seed failed on the first
   facility review it tried to insert. */
ALTER TYPE "review_subject" ADD VALUE IF NOT EXISTS 'facility';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'review_pending';--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'review_overdue';--> statement-breakpoint

-- The website column was renamed when places gained their full field
-- set; renaming rather than adding keeps the addresses already stored.
DO $$ BEGIN
  ALTER TABLE "facilities" RENAME COLUMN "website" TO "website_url";
EXCEPTION WHEN undefined_column THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "tagline" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "about" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "gallery" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "booking_url" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "socials" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "contact_email" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "contact_phone" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "lat" double precision;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "lng" double precision;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "regulator" facility_regulator;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "regulator_ref" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "regulator_rating" facility_regulator_rating;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "regulator_rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "regulator_url" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "year_established" integer;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "bed_count" integer;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "staff_count" integer;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "open_24h" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "emergency_department" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "languages" text[] DEFAULT '{English}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "amenities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "insurers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "accreditations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "verification_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "application" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan" plan_id DEFAULT 'basic'::plan_id NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan_interval" plan_interval DEFAULT 'yearly'::plan_interval NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan_status" plan_status DEFAULT 'active'::plan_status NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan_selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan_activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "plan_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "moderation_status" review_moderation DEFAULT 'pending'::review_moderation NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "moderated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "moderation_note" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "response_at" timestamp with time zone;--> statement-breakpoint

-- Which specialists practise at a place, and in what role.
CREATE TABLE IF NOT EXISTS "facility_team" (
  "facility_id" text NOT NULL REFERENCES "facilities"("id") ON DELETE CASCADE,
  "specialist_id" text NOT NULL REFERENCES "specialists"("id") ON DELETE CASCADE,
  "role" text,
  CONSTRAINT "facility_team_pk" PRIMARY KEY ("facility_id", "specialist_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facility_team_specialist_idx" ON "facility_team" ("specialist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_moderation_idx" ON "reviews" ("moderation_status", "created_at");--> statement-breakpoint

/* ---------------------------------------------------------- provenance
   Letters after the name, and where an unclaimed listing came from.
   import_source holds the source row verbatim — including the figures
   deliberately NOT imported, because another platform's star rating is
   not this site's star rating. None of it is ever public. */
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "qualifications" text;--> statement-breakpoint
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "source_name" text;--> statement-breakpoint
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "source_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "import_source" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specialists_source_url_idx" ON "specialists" ("source_url");
