/* ------------------------------------------------------------------ *
 * The ClinWell outbox, for a person to look at
 *
 * An event dies when the retry schedule runs out or when ClinWell
 * answers 4xx — and a 4xx means the request will never be accepted in
 * the form we are sending, so retrying it twelve hours later only
 * delays anybody finding out.
 *
 * That is why this screen exists rather than a silent dead-letter
 * table. The consequences of a lost event are asymmetric and none of
 * them are visible from inside TLS:
 *
 *   a lost subscription.cancelled  a practice keeps clinical software
 *                                  it stopped paying for, indefinitely
 *   a lost payment.failed          ClinWell never starts the 14-day
 *                                  clock, so a lapsed practice keeps
 *                                  full access with no warning banner
 *   a lost subscription.activated  a practice that paid has no
 *                                  workspace and no invitation email
 *
 * Every one of those looks fine on this side. The sender raises a
 * notification when an event dies; this is the screen that
 * notification points at.
 *
 * Requeue is deliberate rather than automatic. A dead event is usually
 * dead because the data was wrong — a slug ClinWell does not recognise,
 * a practice with no locations — so the fix is to correct the data and
 * then send it again. Re-sending first would just produce the same 4xx.
 * ------------------------------------------------------------------ */
import { isDbConfigured } from "../config/db.js";
import { clinwellEvents as eventRepo, specialists as specialistRepo } from "../db/repos.js";
import { clinwellConfig, drainOutbox } from "../lib/clinwellSender.js";
import { forwardingGate } from "../lib/clinwellEnquiries.js";

/**
 * GET /api/admin/clinwell
 *
 * The dead events, plus enough configuration state to tell "nothing has
 * been sent because it is broken" from "nothing has been sent because
 * it is not switched on yet" — which, today, is the answer.
 */
export async function getClinwellOutbox(req, res) {
  const { baseUrl, partnerKey, configured } = clinwellConfig();
  const gate = forwardingGate();

  const state = {
    /* No secrets, ever — only whether each one is present. An admin
       screen that displayed a signing secret would be a signing secret
       in a browser history. */
    baseUrl: baseUrl || null,
    eventsConfigured: configured,
    partnerKeyPresent: Boolean(partnerKey),
    inboundKeyPresent: Boolean(String(process.env.CLINWELL_INBOUND_KEY ?? "").trim()),
    inboundSecretPresent: Boolean(String(process.env.CLINWELL_INBOUND_SECRET ?? "").trim()),
    enquiryForwarding: gate.allowed ? "on" : gate.reason,
  };

  if (!isDbConfigured()) return res.json({ state, dead: [], note: "The outbox needs a database." });

  const rows = await eventRepo.dead(100);

  /* One lookup per practice on the page rather than one per row. */
  const names = new Map();
  for (const id of new Set(rows.map((r) => r.specialistId))) {
    const s = await specialistRepo.findById(id).catch(() => null);
    if (s) names.set(id, { id: s.id, slug: s.slug, fullName: s.fullName });
  }

  res.json({
    state,
    dead: rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      event: row.event,
      practiceSlug: row.practiceSlug,
      occurredAt: row.occurredAt,
      attempts: row.attempts,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
      deadAt: row.deadAt,
      specialist: names.get(row.specialistId) ?? { id: row.specialistId, slug: null, fullName: null },
      /* The payload is worth showing: for a 400 it IS the diagnosis,
         and it contains no patient data — subscription events carry a
         practice, never a patient. */
      payload: row.payload,
    })),
  });
}

/**
 * POST /api/admin/clinwell/events/:id/requeue
 *
 * Clear the death and try again, keeping the ORIGINAL occurredAt.
 *
 * That last part is the whole reason this is not simply "create a new
 * event". ClinWell orders by occurredAt (§6.6), so an event resent with
 * today's timestamp would claim to describe something that happened
 * now — and a cancellation from last Tuesday, resent on Friday with
 * Friday's stamp, would override a resumption that legitimately
 * happened on Wednesday. The event describes a moment that has already
 * passed, and requeueing must not rewrite when it was.
 */
export async function requeueClinwellEvent(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "The outbox needs a database." });

  const row = await eventRepo.findById(String(req.params.id ?? ""));
  if (!row) return res.status(404).json({ error: "No such event." });
  if (row.deliveredAt) return res.status(409).json({ error: "That event was already delivered." });
  if (!row.deadAt) return res.status(409).json({ error: "That event is still being retried." });

  const { configured } = clinwellConfig();
  if (!configured) {
    return res.status(409).json({
      error: "ClinWell is not configured on this server, so a requeued event would not be sent.",
    });
  }

  await eventRepo.revive(row.id);

  /* Try immediately so the admin sees the outcome rather than waiting
     for the next sweep — but do not make the response wait on ClinWell. */
  drainOutbox().catch(() => {});

  res.json({ ok: true, eventId: row.eventId, occurredAt: row.occurredAt });
}
