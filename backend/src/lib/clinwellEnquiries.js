/* ------------------------------------------------------------------ *
 * Forwarding a patient enquiry to ClinWell — §4.3
 *
 * THE GATE
 *
 * This is the only part of the integration that sends a patient's name,
 * email and phone number to a third party. Sahil has confirmed the
 * processor terms and the privacy-notice wording do not exist yet —
 * they sit in the ClinWell-to-TLS agreement still being settled — and
 * that TLS must not forward live enquiries until the reference and the
 * exact line to publish are in hand.
 *
 * So the gate is in code, not in anybody's memory. Forwarding requires
 * BOTH an explicit switch and a non-empty processor-terms reference,
 * and refuses with a named reason otherwise. Either alone is not
 * enough, which is the point: switching on the feature without the
 * legal basis is exactly the mistake this prevents, and it is the kind
 * of mistake that is discovered by a regulator rather than by a test.
 *
 * CASING
 *
 * §4.3 keeps snake_case, alone among the endpoints: `enquiry_id`,
 * `submitted_at`, `listing_id`. Only `workspaceId` is camelCase,
 * because only it is new. Everything else in this integration is
 * camelCase (§1), so this file is the one place that must not follow
 * the house style — hence the explicit key names below rather than any
 * clever conversion.
 *
 * THEIR 500
 *
 * A completed duplicate answers 200 with `duplicate: true`. The 500 is
 * narrower than it looks: it fires only when a retry arrives while the
 * first delivery is still being processed, and the documented handling
 * is to wait at least 30 seconds. We asked for that to be a 409 and
 * Sahil agreed to change it when the route is next touched; until then
 * a 500 on this route is treated as "in flight", not as a server fault.
 * ------------------------------------------------------------------ */
import { clinwellConfig } from "./clinwellSender.js";
import { sign } from "./clinwellSignature.js";
import { e164 } from "./clinwellEvents.js";

/** §4.3 field limits. */
const LIMITS = { enquiry_id: 128, name: 200, email: 320, phone: 16, message: 5000, listing_id: 128 };

/** Their documented wait before retrying an in-flight collision. */
export const IN_FLIGHT_WAIT_MS = 30_000;

/**
 * Is forwarding permitted at all?
 *
 * Two independent conditions, because one is a feature decision and
 * the other is a legal precondition, and neither implies the other.
 */
export function forwardingGate() {
  const enabled = /^(1|true|yes|on)$/i.test(String(process.env.CLINWELL_ENQUIRY_FORWARDING ?? "").trim());
  const processorTerms = String(process.env.CLINWELL_PROCESSOR_TERMS_REF ?? "").trim();

  if (!enabled) return { allowed: false, reason: "forwarding-not-enabled" };
  if (!processorTerms) {
    /* Deliberately not overridable by the switch above. Until the
       reference exists there is no published basis for sending a
       patient's contact details to a processor, and a feature flag is
       not a lawful basis. */
    return { allowed: false, reason: "no-processor-terms-reference" };
  }

  const { baseUrl, secret } = clinwellConfig();
  if (!baseUrl || !secret) return { allowed: false, reason: "not-configured" };

  return { allowed: true, processorTerms };
}

function bounded(field, value, { required = false } = {}) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text) {
    if (required) throw new Error(`clinwell: ${field} is required on an enquiry`);
    return null;
  }
  if (text.length > LIMITS[field]) throw new Error(`clinwell: ${field} is ${text.length} characters, limit ${LIMITS[field]}`);
  return text;
}

/**
 * The §4.3 body. snake_case throughout except workspaceId.
 *
 * At least one of email or phone must be present, or the lead is
 * unreachable and forwarding it achieves nothing but the data transfer.
 */
export function enquiryBody({ lead, workspaceId }) {
  const email = bounded("email", lead?.email);
  const phone = e164(lead?.phone);
  if (!email && !phone) throw new Error("clinwell: an enquiry needs an email or a phone number");

  const body = {
    event: "enquiry.created",
    enquiry_id: bounded("enquiry_id", lead?.id, { required: true }),
    workspaceId: String(workspaceId ?? "").trim(),
    submitted_at: new Date(lead?.createdAt ?? Date.now()).toISOString(),
    enquirer: {
      name: bounded("name", lead?.patientName, { required: true }),
      ...(email ? { email } : {}),
      ...(phone ? { phone: bounded("phone", phone) } : {}),
    },
  };

  /* Top-level, outside `enquirer`. Confirmed with Sahil and locked by a
     test: nesting either is a silent no-op on their side. */
  const message = bounded("message", lead?.message);
  if (message) body.message = message;

  const listing = bounded("listing_id", lead?.specialistId);
  if (listing) body.listing_id = listing;

  if (!body.workspaceId) throw new Error("clinwell: an enquiry needs a workspaceId");
  return body;
}

/**
 * Forward one enquiry. Returns an outcome rather than throwing, because
 * the patient's enquiry is already saved on our side and nothing about
 * this call is allowed to fail that.
 */
export async function forwardEnquiry({ lead, workspaceId }, { fetchImpl = fetch } = {}) {
  const gate = forwardingGate();
  if (!gate.allowed) return { forwarded: false, reason: gate.reason };

  const { baseUrl, secret, partnerKey } = clinwellConfig();

  let raw;
  try {
    raw = JSON.stringify(enquiryBody({ lead, workspaceId }));
  } catch (err) {
    return { forwarded: false, reason: "invalid-enquiry", error: String(err?.message ?? err) };
  }

  const signature = sign(raw, secret);

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/webhooks/tls`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tls-signature": signature.header,
        "x-request-id": String(lead?.id ?? ""),
        ...(partnerKey ? { authorization: `Bearer ${partnerKey}` } : {}),
      },
      body: raw,
    });
  } catch (err) {
    return { forwarded: false, reason: "transport", retryable: true, error: String(err?.message ?? err) };
  }

  const payload = await res.json().catch(() => null);

  if (res.ok) {
    return {
      forwarded: true,
      duplicate: payload?.duplicate === true,
      leadId: payload?.leadId ?? null,
      status: res.status,
    };
  }

  if (res.status === 500) {
    /* Their in-flight collision, not a fault. Retry no sooner than the
       30 seconds §4.3 asks for. */
    return { forwarded: false, reason: "in-flight", retryable: true, waitMs: IN_FLIGHT_WAIT_MS, status: 500 };
  }

  if (res.status === 429 || res.status === 503) {
    return { forwarded: false, reason: "busy", retryable: true, status: res.status };
  }

  /* 400, 401, 404. Nothing about waiting makes these succeed. */
  return {
    forwarded: false,
    reason: "rejected",
    retryable: false,
    status: res.status,
    error: payload?.error ?? `http ${res.status}`,
  };
}

/* ------------------------------------------------------------------ *
 * The sweep
 *
 * Forwarding is retried rather than attempted once, because their
 * documented 500 ("processing in progress, retry shortly") happens in
 * normal operation and an enquiry is a patient trying to reach a
 * clinician. Losing one to a transient collision is not acceptable.
 *
 * Attempts are capped: four tries over roughly ten minutes, then the
 * row is left visibly unsent with the error on it. That is deliberately
 * shorter than the subscription-event ladder — a subscription event is
 * still correct twelve hours later, whereas an enquiry a practice has
 * already answered by email is not worth delivering to a second inbox
 * half a day after the patient wrote in.
 * ------------------------------------------------------------------ */

/** Roughly 30 s, 2 min, 5 min, 10 min. */
export const FORWARD_BACKOFF_MS = [30_000, 120_000, 300_000, 600_000];

/**
 * Forward one saved lead. Returns the outcome; never throws.
 *
 * Pass the specialist so the workspace id comes from the practice the
 * enquiry was about, never from a default — sending a patient's details
 * into the wrong practice's workspace is the worst thing this code
 * could do.
 */
export async function forwardSavedLead(lead, specialist, { fetchImpl = fetch } = {}) {
  const workspaceId = specialist?.clinwellWorkspaceId ?? null;
  if (!workspaceId) return { forwarded: false, reason: "no-workspace" };
  return forwardEnquiry({ lead, workspaceId }, { fetchImpl });
}

/**
 * Drain the forwarding queue. Exported so it can be run on demand and
 * in tests.
 */
export async function sweepEnquiryForwarding({ fetchImpl = fetch, limit = 25 } = {}) {
  const gate = forwardingGate();
  if (!gate.allowed) return { forwarded: 0, retrying: 0, abandoned: 0, skipped: gate.reason };

  const { isDbConfigured } = await import("../config/db.js");
  if (!isDbConfigured()) return { forwarded: 0, retrying: 0, abandoned: 0, skipped: "demo-mode" };

  const { clinwellForwarding: repo, specialists: specialistRepo } = await import("../db/repos.js");
  const due = await repo.due({ limit });

  let forwarded = 0;
  let retrying = 0;
  let abandoned = 0;

  for (const lead of due) {
    const specialist = lead.specialistId ? await specialistRepo.findById(lead.specialistId).catch(() => null) : null;
    const result = await forwardSavedLead(lead, specialist, { fetchImpl });
    const attempts = (lead.clinwellAttempts ?? 0) + 1;

    if (result.forwarded) {
      await repo.markForwarded(lead.id, { leadId: result.leadId, attempts });
      forwarded += 1;
      continue;
    }

    /* Nothing about waiting fixes a missing workspace or a rejected
       payload, and nothing about waiting fixes a shut gate either. */
    const hopeless = !result.retryable || attempts > FORWARD_BACKOFF_MS.length;
    if (hopeless) {
      await repo.giveUp(lead.id, { attempts, error: result.error ?? result.reason });
      abandoned += 1;
      continue;
    }

    const waitMs = result.waitMs ?? FORWARD_BACKOFF_MS[attempts - 1];
    await repo.scheduleRetry(lead.id, {
      attempts,
      nextAttemptAt: new Date(Date.now() + waitMs),
      error: result.error ?? result.reason,
    });
    retrying += 1;
  }

  if (forwarded || abandoned) {
    console.log(`[clinwell] enquiries: ${forwarded} forwarded, ${retrying} retrying, ${abandoned} abandoned`);
  }
  return { forwarded, retrying, abandoned };
}
