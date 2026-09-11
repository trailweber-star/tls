/* ------------------------------------------------------------------ *
 * The admin members workspace
 *
 * Two things:
 *
 * 1. Sign-up provenance on the account. An admin reviewing a list of
 *    new members asks "is this real?" before anything else, and the IP
 *    a sign-up came from is the most useful answer available. Country
 *    is whatever the edge reported, never inferred from the address —
 *    a wrong flag is worse than no flag.
 *
 * 2. The audit log, which exists because of impersonation. An admin can
 *    sign in as any member; an unlogged impersonation is
 *    indistinguishable from the member acting themselves, so without
 *    this there is no honest answer to "who changed my price?".
 * ------------------------------------------------------------------ */

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_ip" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_country" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_ip" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_country" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "admin_notes" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_audit" (
  "id" text PRIMARY KEY,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "actor_email" text,
  "action" text NOT NULL,
  "subject_type" text,
  "subject_id" text,
  "subject_label" text,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_created_idx" ON "admin_audit" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_actor_idx" ON "admin_audit" ("actor_user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_subject_idx" ON "admin_audit" ("subject_type", "subject_id");--> statement-breakpoint
/* Searching members by name or email is the first thing that happens on
   that page, on every visit. */
CREATE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specialists_claimed_idx" ON "specialists" ("claimed", "verification_status");
