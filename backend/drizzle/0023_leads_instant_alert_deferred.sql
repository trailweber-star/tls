/* ------------------------------------------------------------------ *
 * Instant Enquiry Alerts is a Premium feature (lib/plans.js's feature
 * matrix), but nothing distinguished a Basic alert from a Premium one --
 * every enquiry notified the specialist the moment it was created,
 * regardless of plan.
 *
 * This column lets a Basic enquiry's alert (email + bell/push) wait for
 * the next reminders.js sweep instead of firing immediately, while the
 * enquiry itself is saved and visible in the dashboard right away, same
 * as every plan. Distinct from `held`, which is about the monthly cap
 * and is never also true here -- a held lead's alert is already
 * deferred by that path.
 * ------------------------------------------------------------------ */
ALTER TABLE "leads" ADD COLUMN "instant_alert_deferred" boolean DEFAULT false NOT NULL;
CREATE INDEX "leads_alert_deferred_idx" ON "leads" USING btree ("instant_alert_deferred");
