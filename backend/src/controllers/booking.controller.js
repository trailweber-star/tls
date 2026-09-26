import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import {
  specialists as specialistRepo,
  specialistAvailability as availabilityRepo,
  appointments as appointmentRepo,
} from "../db/repos.js";
import { sendMail, buildAppointmentEmails } from "../lib/mailer.js";
import { siteUrl } from "../lib/urls.js";
import { londonMinutesToUtc, nextDateStr, utcToLondonParts } from "../lib/londonTime.js";

/* ------------------------------------------------------------------ *
 * Booking, from a specialist's public profile
 *
 * No sign-in on this side -- a patient booking an appointment has no
 * account, same reasoning as an enquiry.
 *
 * Availability rules (specialistAvailability.startMinute/endMinute) are
 * minutes since LOCAL midnight -- a UK clinician's own wall clock, per
 * schema.js's comment on the column and the plain <input type="time">
 * that sets it in the dashboard. Every conversion to and from a real
 * UTC instant goes through lib/londonTime.js, which is DST-aware, so a
 * "9am" rule means 9am on the specialist's clock whether that is GMT
 * or BST, not 9am UTC.
 * ------------------------------------------------------------------ */

const SLOT_MINUTES = 30;

function isValidDateStr(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// GET /api/specialists/:slug/availability?date=YYYY-MM-DD
export async function getAvailableSlots(req, res) {
  if (!isDbConfigured()) return res.json({ slots: [], slotMinutes: SLOT_MINUTES });

  const specialist = await specialistRepo.findBySlug(req.params.slug);
  if (!specialist) return res.status(404).json({ error: "Specialist not found" });

  const dateStr = req.query.date;
  if (!isValidDateStr(dateStr)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  // dateStr is a local (Europe/London) calendar date -- the day the
  // booking widget's picker and the specialist's own dashboard show,
  // not a UTC one. Reject anything before today on that same calendar,
  // not before today in UTC, which around midnight would disagree.
  const todayDateStr = utcToLondonParts(new Date()).dateStr;
  if (dateStr < todayDateStr) return res.json({ slots: [], slotMinutes: SLOT_MINUTES });

  const dayStart = londonMinutesToUtc(dateStr, 0);
  const dayEnd = londonMinutesToUtc(nextDateStr(dateStr), 0);
  // The weekday of a YYYY-MM-DD string is unambiguous local-calendar
  // arithmetic -- no instant, no offset, so no DST question to ask.
  const weekday = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();

  const rules = (await availabilityRepo.forSpecialist(specialist.id)).filter((r) => r.weekday === weekday);
  if (rules.length === 0) return res.json({ slots: [], slotMinutes: SLOT_MINUTES });

  const booked = await appointmentRepo.activeOnDay(specialist.id, dayStart, dayEnd);
  const bookedStarts = new Set(booked.map((a) => new Date(a.startsAt).toISOString()));

  const now = new Date();
  const slots = [];
  for (const rule of rules) {
    for (let m = rule.startMinute; m + SLOT_MINUTES <= rule.endMinute; m += SLOT_MINUTES) {
      const slotStart = londonMinutesToUtc(dateStr, m);
      if (slotStart < now) continue;
      if (bookedStarts.has(slotStart.toISOString())) continue;
      slots.push(slotStart.toISOString());
    }
  }
  res.json({ slots, slotMinutes: SLOT_MINUTES });
}

const bookSchema = z.object({
  startsAt: z.string().datetime(),
  patientName: z.string().min(2).max(120),
  patientEmail: z.string().email().nullable().optional(),
  patientPhone: z.string().max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// POST /api/specialists/:slug/appointments
export async function createAppointment(req, res) {
  if (!isDbConfigured()) return res.status(501).json({ error: "Booking needs a database" });

  const specialist = await specialistRepo.findBySlug(req.params.slug);
  if (!specialist) return res.status(404).json({ error: "Specialist not found" });

  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid booking", issues: parsed.error.issues });
  if (!parsed.data.patientEmail && !parsed.data.patientPhone) {
    return res.status(400).json({ error: "Add an email or phone number so the specialist can reach you" });
  }

  const startsAt = new Date(parsed.data.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt < new Date()) {
    return res.status(400).json({ error: "Choose a time in the future" });
  }
  const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60000);

  /* Re-checked here, not trusted from the slot list the widget already
     showed -- that list can be a minute or two stale by the time
     someone clicks. This is the "hundreds of bookings a day" version of
     that guarantee, not the "payment system" version: good enough that
     two people picking the same slot within the same request is rare
     and gets a clear 409 rather than a double booking, not a database
     constraint that makes it provably impossible.

     Both checks below matter, and used to only be the first one:

     - withinRule also requires the offset from the rule's own start to
       be a whole number of slots. Without it, a request for 09:17 --
       never a slot getAvailableSlots would offer against a 09:00 rule
       -- still passed, because the old check only compared against the
       rule's start and end minute, not the slot grid inside it.

     - the overlap check below compares real time ranges, not just an
       exact startsAt match. Combined with the gap above, an
       off-grid 09:17 booking would not have collided with a 09:00 or
       09:30 booking on an exact-timestamp check, despite genuinely
       overlapping both. */
  const { weekday, minuteOfDay: startMinuteOfDay, dateStr } = utcToLondonParts(startsAt);
  const rules = await availabilityRepo.forSpecialist(specialist.id);
  const withinRule = rules.some(
    (r) =>
      r.weekday === weekday &&
      startMinuteOfDay >= r.startMinute &&
      startMinuteOfDay + SLOT_MINUTES <= r.endMinute &&
      (startMinuteOfDay - r.startMinute) % SLOT_MINUTES === 0
  );
  if (!withinRule) return res.status(409).json({ error: "That time is no longer available" });

  const dayStart = londonMinutesToUtc(dateStr, 0);
  const dayEnd = londonMinutesToUtc(nextDateStr(dateStr), 0);
  const booked = await appointmentRepo.activeOnDay(specialist.id, dayStart, dayEnd);
  const overlaps = booked.some((a) => new Date(a.startsAt) < endsAt && new Date(a.endsAt) > startsAt);
  if (overlaps) {
    return res.status(409).json({ error: "That time was just booked by someone else" });
  }

  /* The overlap check above and this write are not one atomic
     operation -- two requests for the same slot close enough together
     could both pass it and both reach here. The database's own
     appointments_specialist_slot_idx (drizzle/0018) is what actually
     rules that out; catching its violation here just means the rare
     loser of that race gets the same clear 409 as the common case
     above; instead of a raw 500. */
  let appointment;
  try {
    appointment = await appointmentRepo.create({
      specialistId: specialist.id,
      patientName: parsed.data.patientName,
      patientEmail: parsed.data.patientEmail || null,
      patientPhone: parsed.data.patientPhone || null,
      notes: parsed.data.notes || null,
      startsAt,
      endsAt,
      status: "confirmed",
    });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "That time was just booked by someone else" });
    }
    throw err;
  }

  const profileUrl = `${siteUrl()}/dashboard/appointments`;
  const { toSpecialist, toPatient } = buildAppointmentEmails({ specialist, appointment, profileUrl });
  /* sendMail() is documented and implemented to never reject (see the
     header comment on lib/mailer.js) -- every failure path resolves
     with { sent: false, reason }, which the appointment response above
     never even looks at. These .catch()s cannot actually fire today,
     but logging costs nothing and means a future change to that
     contract fails loud here instead of a silently swallowed rejection
     right after the appointment was already confirmed. */
  if (specialist.contactEmail) {
    await sendMail(toSpecialist).catch((err) =>
      console.error("[booking] specialist confirmation email failed:", err?.message ?? err)
    );
  }
  if (toPatient) {
    await sendMail(toPatient).catch((err) =>
      console.error("[booking] patient confirmation email failed:", err?.message ?? err)
    );
  }

  res.status(201).json({ ok: true, appointment });
}
