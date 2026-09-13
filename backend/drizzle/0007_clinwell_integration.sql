/* ------------------------------------------------------------------ *
 * ClinWell integration — contract v1.0.1
 *
 * Three things, and a deliberate choice in each.
 *
 * 1. clinwell_events is an outbox, not a fire-and-forget call. The
 *    contract's retry schedule runs for over fourteen hours (1 min,
 *    5 min, 30 min, 2 h, 12 h), which is far longer than any request
 *    this application serves. An event therefore has to survive a
 *    deploy, and that means a row.
 *
 *    occurred_at is the ordering key on ClinWell's side (§6.6), so it
 *    is stamped when the state change happens and never touched again.
 *    The unique index on (specialist_id, occurred_at) is what makes
 *    "strictly increasing per practice" a database guarantee rather
 *    than a promise in a comment: two events for one practice cannot
 *    share a timestamp, so ClinWell can never be handed a tie it has
 *    to break arbitrarily.
 *
 * 2. clinwell_batches exists so a repeated batchId returns the FIRST
 *    response, byte for byte, rather than being applied twice
 *    (Appendix B). Storing the response is the only way to honour
 *    that, so the response body is the row.
 *
 * 3. The badge columns are separate from verification_status, and that
 *    separation is the whole point. "Runs on ClinWell" is a statement
 *    about a software subscription. "Verified" is a statement that a
 *    human checked a licence against a regulator's register. A lapsed
 *    direct debit must never be able to un-verify a clinician, and
 *    keeping the two in different columns is what makes that
 *    structurally impossible instead of merely unlikely.
 * ------------------------------------------------------------------ */

/* ---------------------------------------------------- the badge ---- */

ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_live" boolean NOT NULL DEFAULT false;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_live_at" timestamp with time zone;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_badge_expires_at" timestamp with time zone;

/* The value ClinWell last told us about this practice, so a push that
   disagrees with what we stored at activation can be rejected as a
   workspace_mismatch rather than silently overwriting it. */
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_status" text;
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_status_at" timestamp with time zone;

/* The practice slug as registered on the ClinWell side, which is NOT
   always this application's own slug. Dr Moholkar's clinic is "dkc" to
   ClinWell while its public profile here is a longer, name-based slug,
   and §4.1 forbids normalising on either side — so the two cannot be
   assumed equal and the registered value has to be storable.

   Null means "use our slug", which is the right default: for every
   practice registered from scratch the two will be the same string. */
ALTER TABLE "specialists" ADD COLUMN IF NOT EXISTS "clinwell_slug" text;

CREATE UNIQUE INDEX IF NOT EXISTS "specialists_clinwell_slug_idx"
  ON "specialists" ("clinwell_slug")
  WHERE "clinwell_slug" IS NOT NULL;

/* Badge expiry is swept, so it needs an index; live is a filter on the
   public site. */
CREATE INDEX IF NOT EXISTS "specialists_clinwell_live_idx"
  ON "specialists" ("clinwell_live", "clinwell_badge_expires_at");

/* ------------------------------------------------- the outbox ----- */

CREATE TABLE IF NOT EXISTS "clinwell_events" (
  "id" text PRIMARY KEY NOT NULL,

  /* Unique per event, 1-128 chars, and ClinWell's idempotency key:
     resending the same one does nothing and returns the same response.
     Ours, generated once, reused by every retry. */
  "event_id" text NOT NULL,

  "event" text NOT NULL,
  "specialist_id" text NOT NULL REFERENCES "specialists"("id") ON DELETE CASCADE,

  /* The practice slug as registered on the ClinWell side. Stored on the
     row rather than read from the specialist at send time, because the
     event describes a moment that has already happened and a later
     rename must not rewrite history. */
  "practice_slug" text NOT NULL,

  /* When the thing happened. NOT when we sent it. */
  "occurred_at" timestamp with time zone NOT NULL,

  /* The serialised body, exactly as it will be signed. Held rather than
     rebuilt because the signature covers raw bytes, so a rebuild that
     reorders one key would invalidate a signature that was already
     correct. */
  "payload" jsonb NOT NULL,

  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,

  /* Set when the schedule is exhausted or a 4xx says retrying is
     pointless. A dead row is never retried and is surfaced to an
     administrator, because silent loss of a cancellation event means a
     practice keeps clinical software it stopped paying for. */
  "dead_at" timestamp with time zone,

  "last_status" integer,
  "last_error" text,

  /* What ClinWell answered, so a 409-with-existing-workspaceId is not
     lost and the workspace id can be reconciled. */
  "response" jsonb,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinwell_events_event_id_idx"
  ON "clinwell_events" ("event_id");

/* The guarantee that makes §6.6 ordering safe: one practice cannot
   produce two events bearing the same instant. */
CREATE UNIQUE INDEX IF NOT EXISTS "clinwell_events_practice_occurred_idx"
  ON "clinwell_events" ("specialist_id", "occurred_at");

/* The sender's query: undelivered, not dead, due now, oldest first. */
CREATE INDEX IF NOT EXISTS "clinwell_events_due_idx"
  ON "clinwell_events" ("next_attempt_at")
  WHERE "delivered_at" IS NULL AND "dead_at" IS NULL;

/* ------------------------------- inbound batch idempotency -------- */

CREATE TABLE IF NOT EXISTS "clinwell_batches" (
  /* ClinWell's batchId, 1-128 chars, fresh per nightly run. */
  "batch_id" text PRIMARY KEY NOT NULL,

  "received_at" timestamp with time zone DEFAULT now() NOT NULL,

  /* NULL while the first delivery is still being processed. A second
     request arriving in that window gets 409 and is told to retry in
     30 seconds — the same rule we asked ClinWell to adopt on their
     enquiry route, so it would be poor form not to honour it here. */
  "completed_at" timestamp with time zone,

  /* The first response, returned verbatim on a repeat with
     duplicate: true added. */
  "response" jsonb,

  "practice_count" integer
);

CREATE INDEX IF NOT EXISTS "clinwell_batches_received_idx"
  ON "clinwell_batches" ("received_at");

/* --------------------------------------------- notification type -- */

/* §6.2 renewal reminders are TLS's obligation: 10 days, 3 days, 48
   hours and 24 hours before the renewal date. */
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'renewal_due';

/* A dead outbox row needs somebody to look at it. */
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'clinwell_event_failed';
