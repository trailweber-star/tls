/* ------------------------------------------------------------------ *
 * The ClinWell outbox — queue an event, then get it there
 *
 * Contract v1.0.1 §4.1: on 5xx or a timeout, retry with backoff at
 * 1 min, 5 min, 30 min, 2 h and 12 h. Stop on 2xx. Stop and alert on
 * 401 or any other 4xx.
 *
 * That schedule runs for over fourteen hours, which is why this is a
 * table and a sweep rather than an awaited call inside the billing
 * request. Three consequences worth stating plainly:
 *
 * QUEUEING MUST NOT FAIL THE CALLER. A practice's payment succeeding
 * and TLS failing to tell ClinWell are different problems with
 * different fixes. The subscription is the thing the patient paid for,
 * so it is written first and the event is queued after; if queueing
 * throws, the subscription stands and the event is raised to an
 * administrator.
 *
 * A 4XX IS NOT A FAILURE TO RETRY. It means the request will never be
 * accepted in the form we are sending, so retrying it fourteen hours
 * later just burns the schedule and delays anyone finding out. Those
 * die immediately and loudly.
 *
 * 409 ON ACTIVATED IS A SUCCESS. It means the practice was already
 * provisioned and the body carries the existing workspaceId — which is
 * exactly the value we wanted. Treating it as an error would leave a
 * live workspace with no id stored against it, and the retry would
 * keep getting 409 until the schedule ran out.
 * ------------------------------------------------------------------ */
import { randomUUID } from "node:crypto";
import { isDbConfigured } from "../config/db.js";
import { sign, secretsFrom } from "./clinwellSignature.js";
import { serialise, truncateToSecond, EnvelopeError } from "./clinwellEvents.js";

/** §4.1, in milliseconds. Five attempts after the first. */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

/** How long we wait on a single attempt before calling it a timeout. */
const REQUEST_TIMEOUT_MS = Number(process.env.CLINWELL_TIMEOUT_MS ?? 15_000);

const SWEEP_EVERY_MS = Number(process.env.CLINWELL_SWEEP_SECONDS ?? 60) * 1000;

let timer = null;

/* ---------------------------------------------------------- config */

export function clinwellConfig() {
  const baseUrl = String(process.env.CLINWELL_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const partnerKey = String(process.env.CLINWELL_PARTNER_KEY ?? "").trim();
  const secrets = secretsFrom("CLINWELL_WEBHOOK_SECRET", "CLINWELL_WEBHOOK_SECRET_PREVIOUS");
  return {
    baseUrl,
    partnerKey,
    /* Signing always uses the current secret. The previous one exists
       only so we can VERIFY during a rotation — signing with it would
       defeat the point of rotating. */
    secret: secrets[0] ?? "",
    configured: Boolean(baseUrl && secrets[0]),
  };
}

/* ------------------------------------------------------ the outbox */

/**
 * occurredAt at second precision, nudged forward if this practice
 * already has an event on that second.
 *
 * ClinWell orders by occurredAt, so a tie is a state they have to
 * break arbitrarily — and the wrong choice between "cancelled" and
 * "resumed" is the difference between a practice keeping access and
 * losing it. A second of inaccuracy is the cheaper problem.
 */
async function freeOccurredAt(repos, specialistId, at) {
  let candidate = truncateToSecond(at);
  for (let i = 0; i < 10; i += 1) {
    const taken = await repos.clinwellEvents.occupied(specialistId, candidate);
    if (!taken) return candidate;
    candidate = new Date(candidate.getTime() + 1000);
  }
  /* Ten consecutive seconds occupied for one practice means something
     is looping, not that we need an eleventh try. */
  throw new Error(`clinwell: could not find a free occurredAt for ${specialistId}`);
}

/**
 * Queue an event. Returns the row, or `{ skipped }` when there is
 * nothing to queue — demo mode, or a practice with no ClinWell slug.
 *
 * `build` is called with the eventId and occurredAt this row will
 * carry, so the envelope and the row can never disagree about either.
 */
export async function queueEvent({ specialist, event, build, occurredAt = new Date() }) {
  if (!isDbConfigured()) return { skipped: "demo-mode" };

  /* Our slug, always — see practiceSlug() in clinwellLifecycle.js. */
  const slug = specialist?.slug ?? null;
  if (!slug) return { skipped: "no-practice-slug" };

  const repos = await import("../db/repos.js");
  const stamp = await freeOccurredAt(repos, specialist.id, occurredAt);
  const eventId = `evt_${randomUUID()}`;

  let envelope;
  try {
    envelope = build({ eventId, occurredAt: stamp, slug });
  } catch (err) {
    if (err instanceof EnvelopeError) {
      /* Refused before sending. Queueing it would only produce a row
         that can never succeed, so surface it instead. */
      await raise(specialist, event, err.problems.join("; "));
      return { skipped: "invalid-envelope", problems: err.problems };
    }
    throw err;
  }

  return repos.clinwellEvents.create({
    eventId,
    event,
    specialistId: specialist.id,
    practiceSlug: slug,
    occurredAt: stamp,
    payload: envelope,
  });
}

/* -------------------------------------------------- one attempt */

function retryAfterMs(headers) {
  const after = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(after) && after > 0) return after * 1000;
  const reset = headers?.get?.("x-ratelimit-reset");
  if (reset) {
    const at = new Date(reset).getTime();
    if (Number.isFinite(at)) {
      const wait = at - Date.now();
      if (wait > 0) return wait;
    }
  }
  return null;
}

/**
 * Send one row. Returns what the sweep should do with it, never throws
 * for a transport problem — a thrown error would abandon the rest of
 * the queue.
 */
export async function attempt(row, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = clinwellConfig();
  if (!config.configured) return { outcome: "not-configured" };

  const body = serialise(row.payload);
  const signature = sign(body, config.secret, { now: now() });

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetchImpl(`${config.baseUrl}/api/partners/tls/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tls-signature": signature.header,
        "x-request-id": row.eventId,
        ...(config.partnerKey ? { authorization: `Bearer ${config.partnerKey}` } : {}),
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    /* A timeout and a refused connection are the same thing from here:
       nothing was delivered, and the schedule says try again. */
    return { outcome: "retry", error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(abort);
  }

  const payload = await res.json().catch(() => null);

  if (res.ok) return { outcome: "delivered", status: res.status, response: payload };

  if (res.status === 409) {
    /* Already provisioned. The body carries the workspaceId we were
       trying to obtain, so this is the answer, not an error. */
    return { outcome: "delivered", status: 409, response: payload, alreadyProvisioned: true };
  }

  if (res.status === 429) {
    return {
      outcome: "retry",
      status: 429,
      error: "rate limited",
      /* Their header outranks our schedule: they know when they will
         answer and we do not. */
      waitMs: retryAfterMs(res.headers),
    };
  }

  if (res.status >= 500) {
    return { outcome: "retry", status: res.status, error: payload?.error ?? `http ${res.status}` };
  }

  /* 401 or any other 4xx. §4.1: stop and alert. */
  return { outcome: "dead", status: res.status, error: payload?.error ?? `http ${res.status}` };
}

/* ------------------------------------------------------- the sweep */

async function raise(specialist, event, reason) {
  try {
    const { notifyAdmins, NOTIFICATION_TYPES } = await import("./notifications.js");
    const { users } = await import("../db/repos.js");
    const admins = await users.admins().catch(() => []);
    if (!admins?.length) return;
    await notifyAdmins(admins, {
      type: NOTIFICATION_TYPES.CLINWELL_EVENT_FAILED,
      title: "A ClinWell event could not be delivered",
      body: `${event} for ${specialist?.fullName ?? specialist?.id}: ${reason}`,
      url: "/admin/members",
      subjectId: specialist?.id ?? null,
      /* One notification per practice per event type. A dead row that
         nobody has cleared should not produce a new alert every minute. */
      key: `clinwell_event_failed:${specialist?.id}:${event}`,
    });
  } catch (err) {
    console.error("[clinwell] could not raise a delivery failure:", err?.message ?? err);
  }
}

/**
 * Drain everything due. Exported so it can be run on demand and in
 * tests.
 */
export async function drainOutbox({ fetchImpl = fetch, limit = 25 } = {}) {
  if (!isDbConfigured()) return { sent: 0, retrying: 0, dead: 0 };
  const config = clinwellConfig();
  if (!config.configured) return { sent: 0, retrying: 0, dead: 0, skipped: "not-configured" };

  const { clinwellEvents: repo, specialists: specialistRepo } = await import("../db/repos.js");
  const due = await repo.due(limit);

  let sent = 0;
  let retrying = 0;
  let dead = 0;

  for (const row of due) {
    const result = await attempt(row, { fetchImpl });

    if (result.outcome === "not-configured") break;

    if (result.outcome === "delivered") {
      await repo.markDelivered(row.id, { status: result.status, response: result.response ?? null });
      sent += 1;

      /* activated (and a 409 saying it was already done) is where the
         workspace id comes from. It is the only ClinWell value this
         application stores, so it is written the moment it arrives.

         ONLY the workspace id. An event response also carries a
         `status`, and writing it here would be wrong in a way that
         takes weeks to notice: clinwellStatusAt is the timestamp the
         nightly batch is compared against to detect out-of-order
         delivery (Appendix B), and it holds ClinWell's clock. Stamping
         it with OUR clock at event-delivery time would mean a batch
         generated at 03:00 could look older than a status we wrote at
         14:00 — and every badge push after that would be discarded as
         stale while the integration appeared to be working.

         Sahil's rule is the simple version of the same thing: the badge
         is only ever written by the batch. So the batch owns those two
         columns outright, and this path does not touch them. */
      const workspaceId = result.response?.workspaceId;
      if (workspaceId) {
        await specialistRepo
          .update(row.specialistId, { clinwellWorkspaceId: String(workspaceId) })
          .catch((err) => console.error("[clinwell] could not store workspaceId:", err?.message ?? err));
      }
      continue;
    }

    const attempts = row.attempts + 1;

    if (result.outcome === "dead" || attempts > BACKOFF_MS.length) {
      await repo.markDead(row.id, { status: result.status ?? null, error: result.error ?? null, attempts });
      dead += 1;
      const specialist = await specialistRepo.findById(row.specialistId).catch(() => null);
      await raise(specialist ?? { id: row.specialistId }, row.event, result.error ?? `http ${result.status}`);
      continue;
    }

    const waitMs = result.waitMs ?? BACKOFF_MS[attempts - 1];
    await repo.scheduleRetry(row.id, {
      attempts,
      nextAttemptAt: new Date(Date.now() + waitMs),
      status: result.status ?? null,
      error: result.error ?? null,
    });
    retrying += 1;
  }

  if (sent || dead) console.log(`[clinwell] outbox: ${sent} sent, ${retrying} retrying, ${dead} dead`);
  return { sent, retrying, dead };
}

export function startOutboxSweep() {
  if (timer) return;
  const config = clinwellConfig();
  if (!config.configured) {
    console.log("[clinwell] no base URL or webhook secret — events queue but are not sent (see .env.example)");
    return;
  }
  setTimeout(() => void drainOutbox().catch(() => {}), 10_000).unref?.();
  timer = setInterval(() => void drainOutbox().catch((e) => console.error("[clinwell] sweep failed:", e?.message ?? e)), SWEEP_EVERY_MS);
  timer.unref?.();
  console.log(`[clinwell] outbox draining every ${SWEEP_EVERY_MS / 1000}s → ${config.baseUrl}`);
}

export function stopOutboxSweep() {
  if (timer) clearInterval(timer);
  timer = null;
}
