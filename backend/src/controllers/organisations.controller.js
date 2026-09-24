/* ------------------------------------------------------------------ *
 * Organisations: apply, get quoted, pay
 *
 * An individual clinician sees three prices and picks one. A hospital
 * cannot, because its price depends on how many doctors it wants
 * covered — so there is no figure to publish, and a conversation has to
 * happen before any money does.
 *
 * That conversation is this file. Three steps, and the shape of each is
 * dictated by who is on the other end:
 *
 *   apply    public, unauthenticated, and deliberately forgiving. The
 *            only truly required fields are the organisation, a name
 *            and an email. A practice manager who does not yet know the
 *            doctor count should still be able to ask; refusing the
 *            form over a number they have to go and count is how an
 *            enquiry is lost.
 *
 *   quote    admin only, and audited. Records the agreed figure and the
 *            reasoning in words, because "£2,400" is not a record of an
 *            agreement — "12 doctors, 2 sites, ClinWell for 4" is.
 *
 *   pay      turns the agreed figure into an ordinary order through the
 *            normal checkout, so activation, VAT, renewal reminders and
 *            the ClinWell events behave exactly as they do for a
 *            self-serve subscription. One payment path, not two.
 * ------------------------------------------------------------------ */
import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { organisationApplications as repo, specialists as specialistRepo, users as userRepo } from "../db/repos.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";
import { sendMail } from "../lib/mailer.js";
import { clientIp } from "../lib/requestIp.js";
import { createCheckout, quoteAmount } from "../lib/payments.js";
import { getPlan } from "../lib/plans.js";

import { siteUrl } from "../lib/urls.js";
const SITE_URL = siteUrl();

/**
 * What the form accepts.
 *
 * Three required fields and nothing else, on purpose. Every optional
 * field here is one an applicant might reasonably not know yet, and a
 * required field they cannot answer is a form they abandon.
 */
const applicationSchema = z.object({
  organisationName: z.string().trim().min(2, "Tell us the organisation's name.").max(200),
  organisationType: z.enum(["hospital", "clinic", "care_home", "pharmacy"], {
    error: "Choose whether you are a hospital, clinic, pharmacy or care home.",
  }),
  websiteUrl: z.string().trim().max(500).optional().or(z.literal("")),

  contactName: z.string().trim().min(2, "Tell us who we are speaking to.").max(200),
  contactRole: z.string().trim().max(120).optional().or(z.literal("")),
  contactEmail: z.string().trim().toLowerCase().email("That email address does not look right.").max(320),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),

  /* Coerced, because a number input hands over a string, and capped at
     a figure no real organisation exceeds — 5,000 doctors is larger
     than any NHS trust. A number above it is a typo or a probe. */
  doctorCount: z.coerce.number().int().min(1).max(5000).optional().nullable(),
  siteCount: z.coerce.number().int().min(1).max(500).optional().nullable(),

  specialties: z.array(z.string().trim().min(1).max(120)).max(40).optional().default([]),
  needsClinwell: z.coerce.boolean().optional().default(false),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});

const blank = (v) => (v === undefined || v === null || v === "" ? null : v);

/**
 * POST /api/organisations/apply
 *
 * Public. Saved first, notified second: an organisation's application
 * is the record of record, and a mail failure must not lose it.
 */
export async function applyAsOrganisation(req, res) {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return res.status(400).json({ error: first?.message ?? "Please check the form.", issues: parsed.error.issues });
  }
  const data = parsed.data;

  if (!isDbConfigured()) {
    /* Demo mode has nowhere to put it, and must not pretend otherwise:
       telling an organisation "thank you, we will be in touch" when
       nothing was stored is worse than an honest error. */
    return res.status(503).json({ error: "Applications need a database. Please email us instead." });
  }

  const origin = clientIp ? { ip: clientIp(req), country: req.get("cf-ipcountry") ?? null } : { ip: null, country: null };

  let application;
  try {
    application = await repo.create({
      organisationName: data.organisationName,
      organisationType: data.organisationType,
      websiteUrl: blank(data.websiteUrl),
      contactName: data.contactName,
      contactRole: blank(data.contactRole),
      contactEmail: data.contactEmail,
      contactPhone: blank(data.contactPhone),
      doctorCount: data.doctorCount ?? null,
      siteCount: data.siteCount ?? null,
      specialties: (data.specialties ?? []).filter(Boolean),
      needsClinwell: Boolean(data.needsClinwell),
      notes: blank(data.notes),
      sourceIp: origin.ip,
      sourceCountry: origin.country,
    });
  } catch (err) {
    console.error("[organisations] could not save an application:", err?.message ?? err);
    return res.status(500).json({ error: "Could not save your application. Please try again." });
  }

  /* Everything below is best-effort. The application is already safe. */

  const summary = [
    `${application.organisationName} (${label(application.organisationType)})`,
    application.doctorCount ? `${application.doctorCount} doctors` : "doctor count not given",
    application.siteCount ? `${application.siteCount} sites` : null,
    application.needsClinwell ? "wants ClinWell" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    const admins = await userRepo.admins();
    if (admins?.length) {
      await notifyAdmins(admins, {
        type: NOTIFICATION_TYPES.ORG_APPLICATION,
        title: "An organisation has asked to be quoted",
        body: summary,
        url: "/admin/organisations",
        subjectId: application.id,
        key: `${NOTIFICATION_TYPES.ORG_APPLICATION}:${application.id}`,
      });
    }
  } catch (err) {
    console.error("[organisations] could not raise the application:", err?.message ?? err);
  }

  try {
    await sendMail({
      to: application.contactEmail,
      subject: `We have your enquiry — ${application.organisationName}`,
      text: [
        `Thank you for getting in touch about listing ${application.organisationName} on Top Local Specialists.`,
        ``,
        `Organisations are priced on how many clinicians you want covered, so we work the figure out`,
        `rather than publish one. Somebody will come back to you with a quote and the detail behind it.`,
        ``,
        `What you told us: ${summary}.`,
        ``,
        `If anything there is wrong, just reply to this email and we will correct it before quoting.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[organisations] could not acknowledge an application:", err?.message ?? err);
  }

  res.status(201).json({
    ok: true,
    reference: application.id,
    /* What happens next, in the response rather than only in the email,
       because an email that lands in spam should not leave somebody
       wondering whether the form worked. */
    next: "We will come back to you with a quote. Organisations are priced on the number of clinicians covered.",
  });
}

function label(type) {
  return (
    { hospital: "Hospital", clinic: "Clinic", care_home: "Care home", pharmacy: "Pharmacy" }[type] ?? type
  );
}

/* --------------------------------------------------------- admin side */

// GET /api/admin/organisations
export async function listOrganisationApplications(req, res) {
  if (!isDbConfigured()) return res.json({ results: [], counts: {}, note: "This needs a database." });
  const status = String(req.query.status ?? "").trim() || null;
  const [results, counts] = await Promise.all([repo.all({ status }), repo.counts()]);
  res.json({ results, counts });
}

// GET /api/admin/organisations/:id
export async function getOrganisationApplication(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "This needs a database." });
  const application = await repo.findById(String(req.params.id ?? ""));
  if (!application) return res.status(404).json({ error: "No such application." });
  /* Everything else this organisation has sent. A second application
     from the same address is usually a follow-up, and quoting it as if
     it were new is how you quote the same hospital twice, differently. */
  const history = await repo.byEmail(application.contactEmail);
  res.json({ application, history: history.filter((h) => h.id !== application.id) });
}

const quoteSchema = z.object({
  /* In pounds, because that is what a person types. Converted to pence
     here — the one place that conversion happens, so a quote can never
     be out by a factor of a hundred depending on which screen entered
     it. */
  amount: z.coerce.number().positive("A quote has to be more than nothing.").max(1_000_000),
  plan: z.enum(["basic", "premium", "clinwell"]),
  interval: z.enum(["monthly", "yearly"]).default("yearly"),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * POST /api/admin/organisations/:id/quote
 *
 * Records what was agreed. Does not charge anything: the organisation
 * has to accept first, and an admin typing a figure is not consent to
 * take money.
 */
export async function quoteOrganisation(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "This needs a database." });

  const application = await repo.findById(String(req.params.id ?? ""));
  if (!application) return res.status(404).json({ error: "No such application." });
  if (application.status === "won") {
    return res.status(409).json({ error: "That organisation has already paid. Quote a new application instead." });
  }

  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the quote.", issues: parsed.error.issues });
  }
  const { amount, plan, interval, note } = parsed.data;

  const netMinor = Math.round(amount * 100);
  /* Priced through the same function the checkout will use, so the
     figure shown in the quote email and the figure charged cannot
     disagree. */
  let pricing;
  try {
    pricing = quoteAmount({ netMinor, planId: plan, interval });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message ?? err) });
  }

  const updated = await repo.update(application.id, {
    quotedNetMinor: netMinor,
    quotedInterval: interval,
    quotedPlan: plan,
    quotedAt: new Date(),
    quotedByUserId: req.user?.id ?? null,
    quoteNote: blank(note),
    status: "quoted",
  });

  res.json({
    ok: true,
    application: updated,
    pricing: {
      netMinor: pricing.netMinor,
      vatMinor: pricing.vatMinor,
      totalMinor: pricing.totalMinor,
      currency: pricing.currency,
      planName: getPlan(plan).name,
      interval,
    },
  });
}

const decisionSchema = z.object({
  status: z.enum(["new", "reviewing", "quoted", "won", "lost", "declined"]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

// POST /api/admin/organisations/:id/status
export async function setOrganisationStatus(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "This needs a database." });

  const application = await repo.findById(String(req.params.id ?? ""));
  if (!application) return res.status(404).json({ error: "No such application." });

  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Unknown status." });
  const { status, note } = parsed.data;

  /* "Won" means they paid, and paying happens through checkout — so it
     cannot be set by hand here without leaving an account with a plan
     and no order behind it. */
  if (status === "won") {
    return res.status(409).json({
      error: "An organisation becomes won by paying. Send them a payment link rather than setting this by hand.",
    });
  }

  const updated = await repo.update(application.id, {
    status,
    decidedAt: status === "lost" || status === "declined" ? new Date() : null,
    decidedByUserId: req.user?.id ?? null,
    ...(note ? { quoteNote: note } : {}),
  });

  res.json({ ok: true, application: updated });
}

/**
 * POST /api/admin/organisations/:id/payment-link
 *
 * Turns the agreed figure into an order and hands back a link to pay
 * it. The order is an ordinary one — same table, same webhook, same
 * activation path — so everything downstream works without knowing the
 * price was negotiated.
 *
 * Requires a listing to attach the subscription to. An organisation
 * pays for a listing, so quoting one that does not exist yet would
 * produce an order with nothing to activate.
 */
export async function createOrganisationPaymentLink(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "This needs a database." });

  const application = await repo.findById(String(req.params.id ?? ""));
  if (!application) return res.status(404).json({ error: "No such application." });

  if (!application.quotedNetMinor || !application.quotedPlan) {
    return res.status(409).json({ error: "Agree a quote before sending a payment link." });
  }

  const specialistId = String(req.body?.specialistId ?? "").trim();
  if (!specialistId) {
    return res.status(400).json({
      error: "Say which listing this subscription is for — an organisation pays for a listing.",
    });
  }
  const specialist = await specialistRepo.rawById(specialistId).catch(() => null);
  if (!specialist) return res.status(404).json({ error: "No such listing." });

  const pricing = quoteAmount({
    netMinor: application.quotedNetMinor,
    planId: application.quotedPlan,
    interval: application.quotedInterval ?? "yearly",
  });

  const checkout = await createCheckout({
    specialist: { ...specialist, contactEmail: specialist.contactEmail ?? application.contactEmail },
    planId: application.quotedPlan,
    interval: application.quotedInterval ?? "yearly",
    successUrl: `${SITE_URL}/dashboard/billing?paid=1`,
    cancelUrl: `${SITE_URL}/pricing`,
    pricing,
  });

  await repo.update(application.id, { orderId: checkout.order?.id ?? null });

  if (checkout.status === "unconfigured") {
    /* Honest rather than convenient: without a payment provider there
       is no link to send, and inventing one would be worse than saying
       so. The order is recorded either way, so nothing is lost when
       Stripe is connected. */
    return res.status(409).json({
      error: "No payment provider is connected yet, so there is no link to send. The order has been recorded.",
      orderId: checkout.order?.id ?? null,
    });
  }

  if (checkout.status !== "redirect") {
    return res.status(502).json({ error: checkout.reason ?? "Could not create a payment link." });
  }

  res.json({
    ok: true,
    paymentUrl: checkout.checkoutUrl,
    orderId: checkout.order.id,
    totalMinor: pricing.totalMinor,
    currency: pricing.currency,
  });
}
