/* ------------------------------------------------------------------ *
 * Drop appointments.clinic_location_id
 *
 * Added alongside the appointments table (0014) for a clinic-based
 * specialist's booking to record which of their locations it was at,
 * but nothing ever set it: booking.controller.js's createAppointment
 * never includes clinicLocationId when it writes a row, no seed or
 * demo data ever populates it, and no query anywhere reads or filters
 * on it. A column nothing writes and nothing reads is just a foreign
 * key nothing points through -- dropping it loses no data, since every
 * row's value here has only ever been NULL.
 * ------------------------------------------------------------------ */

ALTER TABLE "appointments" DROP COLUMN IF EXISTS "clinic_location_id";
