import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { leads as leadRepo, specialists as specialistRepo, facilities as facilityRepo, users as userRepo } from "../db/repos.js";
import { specialists as mockSpecialists, facilities as mockFacilities } from "../data/mock.js";
import { demoAccounts } from "../data/accounts.js";
import { buildEnquiryEmail, buildFacilityEnquiryEmail, sendMail } from "../lib/mailer.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";
import { SUPPORT_EMAIL } from "./contact.controller.js";
import { FORWARD_BACKOFF_MS, forwardSavedLead, forwardingGate } from "../lib/clinwellEnquiries.js";
import { demoLeads } from "../data/leads-store.js";
import { entitlementsFor } from "../lib/plans.js";

import { siteUrl } from "../lib/urls.js";
const SITE_URL = siteUrl();

// Look up who the enquiry is for, in whichever storage mode is active.
async function findSpecialist(id) {
  if (!id) return null;
  if (!isDbConfigured()) return mockSpecialists.find((s) => s.id === id) ?? null;
  return specialistRepo.rawById(id);
}

// Same lookup, for a facility-only enquiry (EnquiryForm on
// FacilityProfile.tsx passes facilityId with no specialistId at all).
async function findFacility(id) {
  if (!id) return null;
  if (!isDbConfigured()) return mockFacilities.find((f) => f.id === id) ?? null;
  return facilityRepo.findById(id);
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

/*
 * Notify the facility. contactEmail is where a facility's enquiries are
 * routed — the exact same design as a specialist's own inbox (see the
 * "Where enquiries are routed" comment on both columns in db/schema.js)
 * — so this mirrors notifySpecialist above.
 *
 * The difference is what happens when there is nowhere to send it.
 * Facilities have no owner account or dashboard anywhere in this
 * product, so a missing/unknown facility can't just report
 * "facility-not-found" and stop the way notifySpecialist does: until
 * real facility accounts exist, that silently dropped the enquiry on
 * the floor with the patient told it had been "sent". This stopgap
 * instead falls back to the support inbox and every admin's bell — the
 * same channel contact.controller.js already uses for the site's
 * contact form — so a human sees it and can follow up by hand.
 */
async function notifyFacility(facility, lead) {
  if (facility?.contactEmail) {
    return sendMail(
      buildFacilityEnquiryEmail({
        facility,
        lead,
        profileUrl: facility.slug ? `${SITE_URL}/facilities/${facility.slug}` : undefined,
      })
    );
  }
  return notifySupportFallback(facility, lead);
}

async function notifySupportFallback(facility, lead) {
  const facilityName = facility?.name ?? "an unlisted facility";
  const reason = facility ? "facility-no-contact-email" : "facility-not-found";

  const admins = isDbConfigured()
    ? await userRepo.admins()
    : demoAccounts.all().filter((u) => u.role === "admin" && u.active);

  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.ENQUIRY_RECEIVED,
    title: `Facility enquiry: ${facilityName}`,
    body: lead.message
      ? lead.message.length > 140
        ? `${lead.message.slice(0, 140)}…`
        : lead.message
      : `${lead.patientName} enquired about ${facilityName}.`,
    url: "/admin/messages",
    subjectId: lead.id ?? null,
    // The bell is the alert; the support-inbox email below carries the
    // full message with reply-to set to the patient, so an admin can
    // just hit reply rather than needing a second copy from notify().
    key: lead.id ? `facility-enquiry:${lead.id}` : null,
    channels: { inApp: true, email: false, push: true },
  });

  const delivery = await sendMail({
    to: SUPPORT_EMAIL,
    replyTo: lead.email || undefined,
    subject: `New facility enquiry — ${facilityName}`,
    text: [
      facility
        ? `A patient enquired about ${facilityName}, which has no contact email on file.`
        : `A patient enquired about a facility listing that could not be found (id may be stale).`,
      ``,
      `From: ${lead.patientName}`,
      lead.email ? `Email: ${lead.email}` : null,
      lead.phone ? `Phone: ${lead.phone}` : null,
      ``,
      lead.message ? `Message:` : null,
      lead.message ? lead.message : null,
      ``,
      facility?.slug ? `Listing: ${SITE_URL}/facilities/${facility.slug}` : null,
      ``,
      `Reply directly to this email to reach ${lead.patientName}.`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  });
  return { ...delivery, reason: delivery.sent ? undefined : delivery.reason ?? reason, routedTo: "support" };
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
    const lead = demoLeads.create(parsed.data);
    const specialist = await findSpecialist(parsed.data.specialistId);
    let delivery;
    if (specialist) {
      delivery = await notifySpecialist(specialist, parsed.data);
    } else if (parsed.data.facilityId) {
      delivery = await notifyFacility(await findFacility(parsed.data.facilityId), lead);
    } else {
      delivery = await notifySpecialist(specialist, parsed.data);
    }
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
    // alert waits for the cap to reset. A facility-only lead (no
    // specialistId) has no specialist to alert, so it goes to
    // notifyFacility instead — see the comment there for why that's not
    // just a silent "not found" the way it used to be.
    let delivery;
    if (held) {
      delivery = { sent: false, reason: "held-monthly-cap" };
    } else if (specialist) {
      delivery = await notifySpecialist(specialist, parsed.data);
    } else if (parsed.data.facilityId) {
      delivery = await notifyFacility(await findFacility(parsed.data.facilityId), lead);
    } else {
      delivery = await notifySpecialist(specialist, parsed.data);
    }

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
