/* ------------------------------------------------------------------ *
 * One booked slot per specialist, enforced by the database
 *
 * booking.controller.js checks for an overlapping active appointment
 * before writing a new one, but that check and the write that follows
 * it are two separate statements, not one atomic operation -- two
 * requests for the same slot arriving close enough together could both
 * pass the check and both insert, which the application-level check
 * already calls out as a real but rare possibility rather than
 * something it can rule out on its own.
 *
 * This makes it actually impossible instead of just unlikely: no two
 * non-cancelled appointments for the same specialist may start at the
 * same instant. Cancelled is excluded on purpose -- rebooking a slot
 * after it was cancelled is the normal case, not a double booking, and
 * a plain (non-partial) unique index would block that.
 * ------------------------------------------------------------------ */

CREATE UNIQUE INDEX IF NOT EXISTS "appointments_specialist_slot_idx"
  ON "appointments" USING btree ("specialist_id", "starts_at")
  WHERE "appointments"."status" <> 'cancelled';
