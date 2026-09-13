/* ------------------------------------------------------------------ *
 * Forwarding state on the enquiry itself — contract v1.0.1 §4.3
 *
 * An enquiry is a patient trying to reach a clinician, and for the
 * practice it is revenue. Losing one silently because ClinWell answered
 * 500 while the first delivery was still in flight is not acceptable,
 * so forwarding gets the same treatment the subscription events get:
 * state on the row, and a sweep that retries.
 *
 * This reuses the shape `leads.held` / `releasedAt` already established
 * for deferred enquiry delivery rather than inventing a second outbox.
 *
 * THE COLUMN THAT MATTERS MOST IS forwardable_at.
 *
 * Forwarding is switched off today and will stay off until the
 * processor terms and the privacy-notice wording exist. On the day it is
 * switched on there will be a backlog of enquiries already in this
 * table — and those were submitted by patients under a privacy notice
 * that did not mention ClinWell. Sending them would be a retrospective
 * disclosure nobody consented to, and it would happen in one sweep, in
 * seconds, before anybody noticed.
 *
 * So a lead is only ever forwarded if it was created after forwarding
 * became lawful. The sweep reads this column; it is set at creation
 * time only when the gate is already open. A null here means "never
 * forward", permanently, and that is the safe default for every row
 * that exists today.
 * ------------------------------------------------------------------ */

/* Set at creation, and only when the forwarding gate is already open.
   Null means this enquiry predates lawful forwarding and must never be
   sent — which is every row in the table right now. */
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_forwardable_at" timestamp with time zone;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_forwarded_at" timestamp with time zone;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_next_attempt_at" timestamp with time zone;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_last_error" text;

/* ClinWell's own id for the lead, so a duplicate can be recognised as
   one rather than re-posted. */
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "clinwell_lead_id" text;

/* The sweep's query: forwardable, not yet forwarded, due now. Partial,
   because the overwhelming majority of rows will never be forwardable
   and there is no reason to index them. */
CREATE INDEX IF NOT EXISTS "leads_clinwell_pending_idx"
  ON "leads" ("clinwell_next_attempt_at")
  WHERE "clinwell_forwardable_at" IS NOT NULL AND "clinwell_forwarded_at" IS NULL;
