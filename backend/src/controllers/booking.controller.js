import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import {
  specialists as specialistRepo,
  specialistAvailability as availabilityRepo,
  appointments as appointmentRepo,
} from "../db/repos.js";
import { sendMail, buildAppointmentEmails } from "../lib/mailer.js";
import { siteUrl } from "../lib/urls.js";

/* ------------------------------------------------------------------ *
 * Booking, from a specialist's public profile
 *
 * No sign-in on this side -- a patient booking an appointment has no
 * account, same reasoning as an enquiry. Time is handled as minutes
 * since UTC midnight throughout (see schema.js): simple, and correct
 * for a single-country UK directory right up until the day it needs a
 * specialist who consults across time zones, which is a real limit
 * worth knowing about rather than a timezone library nobody asked for
 * yet.
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

  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: "Invalid date" });

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  if (dayStart < todayStart) return res.json({ slots: [], slotMinutes: SLOT_MINUTES });

  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekday = dayStart.getUTCDay();

  const rules = (await availabilityRepo.forSpecialist(specialist.id)).filter((r) => r.weekday === weekday);
  if (rules.length === 0) return res.json({ slots: [], slotMinutes: SLOT_MINUTES });

  const booked = await appointmentRepo.activeOnDay(specialist.id, dayStart, dayEnd);
  const bookedStarts = new Set(booked.map((a) => new Date(a.startsAt).toISOString()));

  const now = new Date();
  const slots = [];
  for (const rule of rules) {
    for (let m = rule.startMinute; m + SLOT_MINUTES <= rule.endMinute; m += SLOT_MINUTES) {
      const slotStart = new Date(dayStart.getTime() + m * 60000);
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
     constraint that makes it provably impossible. */
  const weekday = startsAt.getUTCDay();
  const startMinuteOfDay = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
  const rules = await availabilityRepo.forSpecialist(specialist.id);
  const withinRule = rules.some(
    (r) => r.weekday === weekday && startMinuteOfDay >= r.startMinute && startMinuteOfDay + SLOT_MINUTES <= r.endMinute
  );
  if (!withinRule) return res.status(409).json({ error: "That time is no longer available" });

  const dayStart = new Date(startsAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const booked = await appointmentRepo.activeOnDay(specialist.id, dayStart, dayEnd);
  if (booked.some((a) => new Date(a.startsAt).getTime() === startsAt.getTime())) {
    return res.status(409).json({ error: "That time was just booked by someone else" });
  }

  const appointment = await appointmentRepo.create({
    specialistId: specialist.id,
    patientName: parsed.data.patientName,
    patientEmail: parsed.data.patientEmail || null,
    patientPhone: parsed.data.patientPhone || null,
    notes: parsed.data.notes || null,
    startsAt,
    endsAt,
    status: "confirmed",
  });

  const profileUrl = `${siteUrl()}/dashboard/appointments`;
  const { toSpecialist, toPatient } = buildAppointmentEmails({ specialist, appointment, profileUrl });
  if (specialist.contactEmail) await sendMail(toSpecialist).catch(() => {});
  if (toPatient) await sendMail(toPatient).catch(() => {});

  res.status(201).json({ ok: true, appointment });
}
