/* ------------------------------------------------------------------ *
 * Organisation applications
 *
 * Individual clinicians see a price and pay it. Hospitals, clinics,
 * pharmacies and care homes cannot: their price depends on how many
 * doctors they want covered, so there is no figure to publish and the
 * conversation has to happen before any money does.
 *
 * That makes this table the front door for every organisation, and it
 * is deliberately NOT the leads table. A patient enquiry and a hospital
 * asking to be quoted have nothing in common except arriving through a
 * form: different fields, different lifecycle, different reader, and
 * different retention. Sharing one table would mean a nullable column
 * per difference and a status enum that means two things.
 *
 * The quoted figure lives here rather than only on the order, because
 * the agreement exists before the order does and often before the
 * account does. When it is accepted, it becomes an order through the
 * normal checkout (lib/payments.js) so that activation, VAT, renewal
 * reminders and the ClinWell events all behave exactly as they do for
 * a self-serve subscription. There is one payment path, not two.
 * ------------------------------------------------------------------ */

CREATE TYPE "org_application_status" AS ENUM (
  'new',
  -- Somebody has read it and is working out a figure.
  'reviewing',
  -- A figure has been agreed and sent. quoted_* is populated.
  'quoted',
  -- They paid; an account and a listing exist.
  'won',
  -- They went elsewhere, or went quiet. Kept, not deleted: a hospital
  -- that said no in March is the warmest lead in September.
  'lost',
  -- We declined them. Distinct from lost, because the reason matters.
  'declined'
);

CREATE TABLE IF NOT EXISTS "organisation_applications" (
  "id" text PRIMARY KEY NOT NULL,

  /* ------------------------------------------------ the organisation */
  "organisation_name" text NOT NULL,
  -- hospital | clinic | care_home | pharmacy, reusing the vocabulary the
  -- facilities table already uses so a won application can become a
  -- facility without a translation step.
  "organisation_type" "facility_type" NOT NULL,
  "website_url" text,

  /* ------------------------------------------------------- who asked */
  "contact_name" text NOT NULL,
  "contact_role" text,
  "contact_email" text NOT NULL,
  "contact_phone" text,

  /* ------------------------------------------- what they are asking for
     doctor_count is the pricing input. It is stored as an integer and
     nullable rather than required, because an organisation that does not
     know yet should still be able to ask — refusing the form over a
     number they have to go and count is how an enquiry is lost. */
  "doctor_count" integer,
  "site_count" integer,
  -- Free text, one per entry: the specialties they want covered. Not
  -- foreign keys, because an applicant types what they do rather than
  -- picking from our taxonomy, and forcing a match would drop anything
  -- we have not catalogued yet.
  "specialties" text[] NOT NULL DEFAULT '{}',
  "needs_clinwell" boolean NOT NULL DEFAULT false,
  "notes" text,

  /* --------------------------------------------------- the quote
     Minor units and an ISO currency, like every other money value in
     this schema. Never a float. */
  "quoted_net_minor" integer,
  "quoted_currency" text NOT NULL DEFAULT 'GBP',
  "quoted_interval" "plan_interval",
  -- Which tier the quote is for, so entitlements are unambiguous once
  -- they pay. An organisation still gets a plan; only its price is
  -- negotiated.
  "quoted_plan" "plan_id",
  "quoted_at" timestamp with time zone,
  "quoted_by_user_id" text REFERENCES "users"("id"),
  -- What was agreed, in words: "12 doctors, 2 sites, ClinWell for 4".
  -- The figure alone is not a record of the agreement.
  "quote_note" text,
  -- The order the quote became, once they went to pay.
  "order_id" text,

  "status" "org_application_status" NOT NULL DEFAULT 'new',
  "decided_at" timestamp with time zone,
  "decided_by_user_id" text REFERENCES "users"("id"),

  /* Where it came from, same reasoning as users.signup_ip: an
     application from an unexpected country is the most useful single
     signal that it is not what it says it is. */
  "source_ip" text,
  "source_country" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

/* The queue: oldest unanswered first, which is the order a person
   should work through them in. */
CREATE INDEX IF NOT EXISTS "org_applications_status_idx"
  ON "organisation_applications" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "org_applications_email_idx"
  ON "organisation_applications" ("contact_email");

/* An organisation applying twice is normal — a follow-up, or a second
   site — so this is not unique. The index exists so an admin opening
   one can see the others. */

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'org_application';
