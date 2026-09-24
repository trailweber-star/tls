/* ------------------------------------------------------------------ *
 * Appointments, threaded messages, and persistent view analytics
 *
 * Three features that were "Soon" in the dashboard nav, landing
 * together because they share the same shape of gap: real data that
 * only ever lived in memory (profile views) or in a single column
 * (leads.response, one reply and no more).
 *
 *   lead_messages            the rest of a conversation past the first
 *                            reply. leads.response/responded_at is left
 *                            exactly as it is -- nothing that reads it
 *                            changes.
 *   leads.reply_token        the patient's door into that thread with
 *                            no account to sign in to. Backfilled for
 *                            every existing lead so the column can be
 *                            NOT NULL from here on, same as a fresh row
 *                            gets from $defaultFn.
 *   profile_view_events      one row per view, replacing the in-memory
 *                            counter in lib/analytics.js that reset on
 *                            every deploy.
 *   specialist_availability  a standing weekly rule ("Tuesdays 9-5").
 *   appointments             one booked slot. Kept separate from
 *                            availability because they change at a
 *                            different rate -- see schema.js.
 * ------------------------------------------------------------------ */

CREATE TYPE "appointment_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "lead_id" text NOT NULL,
  "sender_role" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "lead_messages"
  ADD CONSTRAINT "lead_messages_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lead_messages_lead_idx" ON "lead_messages" ("lead_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_view_events" (
  "id" text PRIMARY KEY NOT NULL,
  "specialist_id" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "referrer" text,
  "search_term" text,
  "path" text
);
--> statement-breakpoint

ALTER TABLE "profile_view_events"
  ADD CONSTRAINT "profile_view_events_specialist_id_specialists_id_fk"
  FOREIGN KEY ("specialist_id") REFERENCES "specialists"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "profile_view_events_specialist_idx" ON "profile_view_events" ("specialist_id", "occurred_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "specialist_availability" (
  "id" text PRIMARY KEY NOT NULL,
  "specialist_id" text NOT NULL,
  "weekday" integer NOT NULL,
  "start_minute" integer NOT NULL,
  "end_minute" integer NOT NULL
);
--> statement-breakpoint

ALTER TABLE "specialist_availability"
  ADD CONSTRAINT "specialist_availability_specialist_id_specialists_id_fk"
  FOREIGN KEY ("specialist_id") REFERENCES "specialists"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "specialist_availability_specialist_idx" ON "specialist_availability" ("specialist_id", "weekday");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "appointments" (
  "id" text PRIMARY KEY NOT NULL,
  "specialist_id" text NOT NULL,
  "clinic_location_id" text,
  "patient_name" text NOT NULL,
  "patient_email" text,
  "patient_phone" text,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "status" "appointment_status" DEFAULT 'confirmed' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_specialist_id_specialists_id_fk"
  FOREIGN KEY ("specialist_id") REFERENCES "specialists"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_clinic_location_id_clinic_locations_id_fk"
  FOREIGN KEY ("clinic_location_id") REFERENCES "clinic_locations"("id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "appointments_specialist_idx" ON "appointments" ("specialist_id", "starts_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "appointments_status_idx" ON "appointments" ("status");
--> statement-breakpoint

/* Nullable first, backfilled, then locked down -- the standard shape
   for adding a NOT NULL column to a table that already has rows.
   md5(random-ish) is fine here: it only has to be unguessable, not
   cryptographically perfect, and it never collides in practice at this
   table's size. */
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reply_token" text;
--> statement-breakpoint

UPDATE "leads" SET "reply_token" = 'rt_' || md5(random()::text || "id") WHERE "reply_token" IS NULL;
--> statement-breakpoint

ALTER TABLE "leads" ALTER COLUMN "reply_token" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "leads" ADD CONSTRAINT "leads_reply_token_unique" UNIQUE ("reply_token");
