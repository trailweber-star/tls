/* ------------------------------------------------------------------ *
 * Sub-Accounts & Multi-Practice Profiles (lib/plans.js's subAccounts
 * flag) was advertised on the Premium and Full Practice Suite pricing
 * cards with nothing behind it -- no table, no invite flow, nothing a
 * specialist could actually use.
 *
 * specialists.userId stays the one owner who can manage billing and
 * the team itself. A row here grants a second account dashboard access
 * to that SAME listing (enquiries, messages, reviews, profile,
 * analytics) without becoming a second owner. Modelled on facility_team
 * (0001_listing_provenance.sql) -- same shape, same reasoning.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS "specialist_team_members" (
  "specialist_id" text NOT NULL REFERENCES "specialists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invited_email" text NOT NULL,
  "role" text,
  "invited_at" timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_at" timestamp with time zone,
  CONSTRAINT "specialist_team_members_pk" PRIMARY KEY ("specialist_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specialist_team_members_user_idx" ON "specialist_team_members" ("user_id");
