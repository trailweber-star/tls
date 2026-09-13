import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { leads as leadRepo, specialists as specialistRepo } from "../db/repos.js";
import { specialists as mockSpecialists } from "../data/mock.js";
import { buildEnquiryEmail, sendMail } from "../lib/mailer.js";
import { FORWARD_BACKOFF_MS, forwardSavedLead, forwardingGate } from "../lib/clinwellEnquiries.js";
import { demoLeads } from "../data/leads-store.js";
import { entitlementsFor } from "../lib/plans.js";

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

// Look up who the enquiry is for, in whichever storage mode is active.
async function findSpecialist(id) {
  if (!id) return null;
  if (!isDbConfigured()) return mockSpecialists.find((s) => s.id === id) ?? null;
  return specialistRepo.rawById(id);
}

// Notify the specialist. Never throws: a mail failure must not lose the
// enquiry, so the result is reported back but the lead still stands.
async function notifySpecialist(specialist, lead) {
  if (!specialist) return { sent: false, reason: "specialist-not-found" };
  if (!specialist.contactEmail) return { sent: false, reason: "no-contact-email" };
  return sendMail(
    buildEnquiryEmail({
      specialist,
      lead,
      profileUrl: `${SITE_URL}/specialists/${specialist.slug}`,
    })
  );
}

/**
 * Basic listings include an enquiry form capped at 5 a month. The pricing
 * FAQ is explicit that enquiries past the cap are held and released when
 * it resets rather than refused — "nobody is turned away at your door" —
 * so this never rejects a patient. It decides whether the specialist is
 * alerted now or when lib/reminders.js releases the backlog.
 */
async function isOverCap(specialist) {
  if (!specialist) return false;
  const cap = entitlementsFor(specialist).limit("enquiryMonthlyCap");
  if (cap == null) return false; // null means uncapped
  const used = await leadRepo.countThisMonth(specialist.id);
  return used >= cap;
}

const leadSchema = z.object({
  patientName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  message: z.string().max(2000).optional().or(z.literal("")),
  specialistId: z.string().optional().or(z.literal("")),
  clinicId: z.string().optional().or(z.literal("")),
  facilityId: z.string().optional().or(z.literal("")),
});

// POST /api/leads — public enquiry endpoint. Anyone can create a lead,
// nobody can read leads back through a public API: this route only ever
// writes.
export async function createLead(req, res) {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid enquiry", issues: parsed.error.issues });
  }

  if (!isDbConfigured()) {
    // Demo mode keeps enquiries in memory (data/leads-store.js) so they
    // show up in the specialist's dashboard exactly as a saved lead would.
    demoLeads.create(parsed.data);
    const specialist = await findSpecialist(parsed.data.specialistId);
    const delivery = await notifySpecialist(specialist, parsed.data);
    return res.json({ ok: true, demo: true, delivery });
  }

  try {
    const specialist = await findSpecialist(parsed.data.specialistId);
    const held = await isOverCap(specialist);

    /* Whether this enquiry may EVER be forwarded to ClinWell is decided
       here, at creation, and written onto the row (§4.3).

       Not at forwarding time, and not by comparing dates later. On the
       day forwarding is switched on there will be a backlog of
       enquiries in this table submitted under a privacy notice that
       said nothing about ClinWell, and a date comparison got wrong once
       would disclose all of them retrospectively in a single sweep. A
       permission stamped at creation cannot do that: rows that predate
       the gate have no value in the column and are unselectable. */
    const forwardable = forwardingGate().allowed ? new Date() : null;

    const lead = await leadRepo.create({
      patientName: parsed.data.patientName,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      message: parsed.data.message || null,
      specialistId: parsed.data.specialistId || null,
      clinicId: parsed.data.clinicId || null,
      facilityId: parsed.data.facilityId || null,
      source: "website_enquiry",
      held,
      clinwellForwardableAt: forwardable,
    });

    // The lead is saved first: it is the record of record. Email is a
    // notification on top of it, so a delivery problem is reported but
    // never fails the request. A held enquiry is stored in full and the
    // alert waits for the cap to reset.
    const delivery = held
      ? { sent: false, reason: "held-monthly-cap" }
      : await notifySpecialist(specialist, parsed.data);

    /* One attempt now so the practice sees it in ClinWell while the
       patient is still on the page; the sweep owns every retry after
       that. Deliberately not awaited — the patient's confirmation must
       not wait on a third party, and the lead is already saved. */
    if (forwardable && specialist?.clinwellWorkspaceId) {
      forwardSavedLead(lead, specialist)
        .then(async (result) => {
          const { clinwellForwarding } = await import("../db/repos.js");
          if (result.forwarded) {
            await clinwellForwarding.markForwarded(lead.id, { leadId: result.leadId, attempts: 1 });
          } else if (result.retryable) {
            await clinwellForwarding.scheduleRetry(lead.id, {
              attempts: 1,
              nextAttemptAt: new Date(Date.now() + (result.waitMs ?? FORWARD_BACKOFF_MS[0])),
              error: result.error ?? result.reason,
            });
          } else {
            await clinwellForwarding.giveUp(lead.id, { attempts: 1, error: result.error ?? result.reason });
          }
        })
        .catch((err) => console.error("[clinwell] first enquiry attempt failed:", err?.message ?? err));
    }

    res.json({ ok: true, delivery });
  } catch (err) {
    console.error("[leads] could not save enquiry:", err?.message ?? err);
    res.status(500).json({ error: "Could not save enquiry" });
  }
}
