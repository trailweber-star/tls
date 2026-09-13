/* ------------------------------------------------------------------ *
 * ClinWell event envelopes — contract v1.0.1 §4.1
 *
 * This file exists to make two classes of silent failure impossible.
 *
 * FIELD PLACEMENT. `dueAt` and `effectiveAt` are top-level siblings of
 * `plan`, not properties of it. Nest them and ClinWell simply ignores
 * them: the request still returns 200, the event still applies, and the
 * date that decides when a practice loses access is quietly absent.
 * Nothing about that failure looks like a failure, which is why the
 * placement is asserted in a test rather than trusted to a comment.
 *
 * ORDERING. ClinWell applies events by `occurredAt`, not by arrival
 * order (§6.6), so a late retry can never overwrite a newer state.
 * That only holds if we cooperate:
 *
 *   1. occurredAt is stamped when the state change happens.
 *   2. A retry carries the original value. Never refreshed.
 *   3. It is strictly increasing per practice, so two events for one
 *      practice cannot tie and leave the winner undefined.
 *
 * Point 3 is enforced by a unique index on (specialist_id,
 * occurred_at), not by this code. The contract's own example uses
 * second precision, so that is what we serialise; when two changes
 * land inside the same second for one practice, the second one is
 * advanced by a second rather than made ambiguous. A second of
 * inaccuracy is a fair price for an unambiguous order.
 *
 * MINIMALISM. §4.1 is explicit that on resumed, cancelled,
 * payment.failed and payment.recovered, only `practice.slug` and the
 * date field are read — and that regulator and registration numbers
 * must never be sent, because ClinWell does not store them. So those
 * events carry the slug and nothing else. Sending a full practice
 * record where a slug will do is a GDPR problem waiting for an audit,
 * not a harmless extra.
 * ------------------------------------------------------------------ */

export const EVENTS = {
  ACTIVATED: "subscription.activated",
  RESUMED: "subscription.resumed",
  CANCELLED: "subscription.cancelled",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_RECOVERED: "payment.recovered",
};

/** The one plan name ClinWell recognises (§4.1). */
export const PLAN_NAME = "full_practice_suite";

const SLUG = /^[a-z0-9-]+$/;

/* ------------------------------------------------------- formatting */

/** ISO 8601 UTC at second precision, matching the contract's examples. */
export function isoSeconds(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`clinwell: unusable date ${String(value)}`);
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** YYYY-MM-DD, which is what dueAt, effectiveAt and renewsAt take. */
export function isoDate(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`clinwell: unusable date ${String(value)}`);
  return date.toISOString().slice(0, 10);
}

/** Second-precision Date, so the stored value and the sent value agree. */
export function truncateToSecond(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * TLS says `yearly`, ClinWell says `annual`. One word, and the kind of
 * mismatch that produces a 400 nobody can see from either side's logs.
 */
export function intervalFor(interval) {
  return String(interval) === "monthly" ? "monthly" : "annual";
}

/**
 * E.164, max 16. UK numbers are stored in this application however the
 * member typed them, so separators come out and 0-prefixed numbers
 * become +44. A number that cannot be made to fit is dropped rather
 * than sent malformed: `phone` is optional, and an invalid value would
 * fail the whole event.
 */
export function e164(phone) {
  const raw = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!raw) return null;
  const candidate = raw.startsWith("+") ? raw : raw.startsWith("0") ? `+44${raw.slice(1)}` : `+${raw}`;
  return /^\+\d{7,15}$/.test(candidate) ? candidate : null;
}

/* ------------------------------------------------------- validation */

class EnvelopeError extends Error {
  constructor(problems) {
    super(`clinwell: event rejected before sending — ${problems.join("; ")}`);
    this.name = "EnvelopeError";
    this.problems = problems;
    /* Marks this as our own refusal to send, not a transport failure,
       so the caller does not schedule a retry for something that will
       never become valid on its own. */
    this.invalidEnvelope = true;
  }
}

const LIMITS = {
  eventId: 128,
  "practice.slug": 100,
  "practice.displayName": 200,
  "practice.fullName": 200,
  "practice.email": 320,
  "practice.title": 20,
  "practice.primarySpecialty": 100,
  "practice.phone": 16,
  "locations[].name": 200,
  "locations[].address": 200,
  "locations[].city": 100,
  "locations[].postcode": 10,
};

function trimmed(value) {
  return value === null || value === undefined ? null : String(value).trim() || null;
}

/** Within a limit, or a problem naming the field. Never truncates. */
function bounded(problems, field, value, { required = false } = {}) {
  const text = trimmed(value);
  if (!text) {
    if (required) problems.push(`${field} is required`);
    return null;
  }
  const limit = LIMITS[field];
  if (limit && text.length > limit) {
    problems.push(`${field} is ${text.length} characters, limit ${limit}`);
    return null;
  }
  return text;
}

/* --------------------------------------------------------- builders */

/**
 * The three fields every event carries, and nothing else. Every builder
 * starts here, so no event can be constructed without them.
 */
function base(eventId, event, occurredAt, slug) {
  const problems = [];
  const id = bounded(problems, "eventId", eventId, { required: true });
  const practiceSlug = bounded(problems, "practice.slug", slug, { required: true });
  if (practiceSlug && !SLUG.test(practiceSlug)) {
    /* The slug is registered on ClinWell's side and normalised by
       neither party, so a slug that does not match their pattern is a
       registration mistake to surface, not something to coerce. */
    problems.push(`practice.slug ${JSON.stringify(practiceSlug)} is not ^[a-z0-9-]+$`);
  }
  if (problems.length) throw new EnvelopeError(problems);
  return { eventId: id, event, occurredAt: isoSeconds(occurredAt), practice: { slug: practiceSlug } };
}

/**
 * subscription.activated — the only event carrying the practice record,
 * because it is the only one where ClinWell reads more than the slug.
 *
 * Deliberately absent: regulator and registration number. §4.1 forbids
 * them outright, and this is the one event whose payload is large
 * enough that somebody would otherwise add them "for completeness".
 */
export function activated({ eventId, occurredAt, specialist, plan }) {
  /* Always OUR slug. ClinWell's own clinic slug ("dkc") belongs to the
     embed URL alone and must never be sent here — they join the two on
     their side by the workspace row. */
  const envelope = base(eventId, EVENTS.ACTIVATED, occurredAt, specialist?.slug);
  const problems = [];

  const practice = {
    slug: envelope.practice.slug,
    displayName: bounded(problems, "practice.displayName", specialist?.clinicName ?? specialist?.fullName, {
      required: true,
    }),
    fullName: bounded(problems, "practice.fullName", specialist?.fullName, { required: true }),
    email: bounded(problems, "practice.email", specialist?.email, { required: true }),
  };

  const title = bounded(problems, "practice.title", specialist?.title);
  if (title) practice.title = title;

  const specialty = bounded(problems, "practice.primarySpecialty", specialist?.primarySpecialty);
  if (specialty) practice.primarySpecialty = specialty;

  const phone = e164(specialist?.phone);
  if (phone) practice.phone = bounded(problems, "practice.phone", phone);

  const sources = Array.isArray(specialist?.locations) ? specialist.locations : [];
  if (sources.length === 0) problems.push("practice.locations is required (1 to 10 items)");
  if (sources.length > 10) problems.push(`practice.locations has ${sources.length} items, limit 10`);

  practice.locations = sources.slice(0, 10).map((location) => {
    const city = bounded(problems, "locations[].city", location?.city, { required: true });
    const out = {
      name: bounded(problems, "locations[].name", location?.name) ?? city,
      address: bounded(problems, "locations[].address", location?.address, { required: true }),
      city,
      postcode: bounded(problems, "locations[].postcode", location?.postcode, { required: true }),
    };
    /* Numbers or absent. A string "52.26" would fail their type check. */
    if (Number.isFinite(Number(location?.lat)) && location?.lat !== null && location?.lat !== "") {
      out.lat = Number(location.lat);
    }
    if (Number.isFinite(Number(location?.lng)) && location?.lng !== null && location?.lng !== "") {
      out.lng = Number(location.lng);
    }
    return out;
  });

  if (!plan?.renewsAt) problems.push("plan.renewsAt is required on activated");
  if (problems.length) throw new EnvelopeError(problems);

  return {
    ...envelope,
    practice,
    plan: {
      name: PLAN_NAME,
      interval: intervalFor(plan?.interval),
      renewsAt: isoDate(plan.renewsAt),
    },
    /* Present and null, exactly as the §4.1 example shows. Top-level,
       siblings of plan — never inside it. */
    dueAt: null,
    effectiveAt: null,
  };
}

/** subscription.resumed — un-cancel. Slug only; carries no date. */
export function resumed({ eventId, occurredAt, slug }) {
  return base(eventId, EVENTS.RESUMED, occurredAt, slug);
}

/**
 * subscription.cancelled — also covers a downgrade to a plan without
 * ClinWell (§6.4). effectiveAt is the last day the practice has paid
 * for; ClinWell keeps access until the end of it, then suspends.
 * Nothing is withdrawn early.
 */
export function cancelled({ eventId, occurredAt, slug, effectiveAt }) {
  if (!effectiveAt) throw new EnvelopeError(["effectiveAt is required on cancelled"]);
  return { ...base(eventId, EVENTS.CANCELLED, occurredAt, slug), effectiveAt: isoDate(effectiveAt) };
}

/**
 * payment.failed — dueAt is the renewal date that failed. ClinWell
 * holds access for 14 days from it and then suspends on its own clock,
 * so this date is the only thing standing between a practice and a
 * suspension fourteen days early or late.
 */
export function paymentFailed({ eventId, occurredAt, slug, dueAt }) {
  if (!dueAt) throw new EnvelopeError(["dueAt is required on payment.failed"]);
  return { ...base(eventId, EVENTS.PAYMENT_FAILED, occurredAt, slug), dueAt: isoDate(dueAt) };
}

/**
 * payment.recovered — a failed renewal paid inside the grace period.
 *
 * Never followed by subscription.resumed. `resumed` means "un-cancel"
 * on ClinWell's side, so chaining the two would clear a cancellation
 * the practice actually asked for. This event restores access from a
 * payment-caused suspension on its own and needs nothing after it.
 */
export function paymentRecovered({ eventId, occurredAt, slug }) {
  return base(eventId, EVENTS.PAYMENT_RECOVERED, occurredAt, slug);
}

/**
 * The bytes that get signed and sent.
 *
 * The signature covers the raw body, so this string is stored on the
 * outbox row and reused verbatim by every retry. Re-serialising before
 * a retry would risk a different key order and a signature that is
 * correct for a body nobody sent.
 */
export function serialise(envelope) {
  return JSON.stringify(envelope);
}

export { EnvelopeError };
