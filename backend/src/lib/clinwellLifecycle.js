/* ------------------------------------------------------------------ *
 * Which ClinWell event is this, really?
 *
 * This application has four internal payment outcomes — paid,
 * payment_failed, canceled, ignored — and ClinWell has five events.
 * The mapping is not one to one, and getting it wrong has consequences
 * that are invisible on our side and severe on theirs:
 *
 *   "paid" can mean a first activation, a recovered payment inside the
 *   grace period, or a practice un-cancelling. ClinWell treats those
 *   three as completely different things. Send `activated` for a
 *   practice that already has a workspace and you get a 409. Send
 *   `resumed` after a recovered payment and you clear a cancellation
 *   the practice actually asked for — §6.6 is explicit that
 *   `payment.recovered` needs nothing after it.
 *
 * So the decision lives here, alone, with the state it depends on
 * passed in, and it is tested directly rather than through the billing
 * controller.
 *
 * The transition this application did not previously have is
 * payment.recovered. Nothing in TLS moved a subscription from past_due
 * back to active as its own step: recovery happened incidentally
 * inside activateSubscription, which is why there was nothing to hang
 * an event on. Now `paid` while past_due is recognised as the distinct
 * thing it is.
 * ------------------------------------------------------------------ */
import { EVENTS, activated, cancelled, paymentFailed, paymentRecovered, resumed } from "./clinwellEvents.js";
import { queueEvent } from "./clinwellSender.js";
import { getPlan } from "./plans.js";

/**
 * The slug that goes in `practice.slug` — which is always OURS, the one
 * in /specialists/<slug>.
 *
 * There are two slugs in this integration and confusing them is easy,
 * so it is worth being blunt about which is which:
 *
 *   practice.slug   ours. Sent in every event, and sent back to us in
 *                   the nightly badge push. Never substituted.
 *   clinicSlug      ClinWell's, e.g. "dkc". Used only in the §7 embed
 *                   URL, and never sent to them — they already know it.
 *
 * They are joined on ClinWell's side by the workspace row, not by being
 * the same string. An earlier version of this returned ClinWell's slug
 * in preference to ours, which would have made every event describe a
 * practice under a name their handler does not index by.
 */
export function practiceSlug(specialist) {
  return specialist?.slug ?? null;
}

/**
 * ClinWell's own clinic slug, for the embed URL and nothing else.
 *
 * No fallback to our slug, deliberately: our slug on their host builds
 * a booking URL that 404s, and a 404 shown to a patient trying to reach
 * a doctor is worse than showing no booking widget at all.
 */
export function clinicSlug(specialist) {
  return specialist?.clinwellClinicSlug ?? null;
}

/** Does this plan entitle the practice to ClinWell at all? */
export function hasClinwell(planId) {
  try {
    return Boolean(getPlan(planId)?.features?.clinwell);
  } catch {
    return false;
  }
}

/**
 * What a successful payment means for ClinWell, given where the
 * subscription was before it landed.
 *
 * `before` is the specialist row as it was BEFORE the payment was
 * applied — the caller has to capture it first, because by the time the
 * patch has been written the distinction between an activation and a
 * recovery has been erased.
 */
export function eventForPayment(before, { planId }) {
  if (!hasClinwell(planId)) return null;

  /* No workspace yet: this is the first time ClinWell has heard of
     them, whatever our own status column says. */
  if (!before?.clinwellWorkspaceId) return EVENTS.ACTIVATED;

  /* A failed renewal that has now been paid. Restores access from a
     payment-caused suspension on its own, and must NOT be followed by
     subscription.resumed. */
  if (before.planStatus === "past_due") return EVENTS.PAYMENT_RECOVERED;

  /* They cancelled and have come back. `resumed` is precisely
     "un-cancel", which is what this is. */
  if (before.planStatus === "canceled") return EVENTS.RESUMED;

  /* An ordinary renewal of a live subscription. ClinWell has no event
     for it and does not need one: access was never interrupted, and
     plan.renewsAt is only read on activated. */
  return null;
}

/* --------------------------------------------------------- queueing */

/**
 * Queue whatever a payment implies. Returns what was queued, or a
 * reason nothing was.
 *
 * Never throws into the caller. A practice's payment succeeding and TLS
 * failing to tell ClinWell are different problems: the first is the
 * thing the practice paid for and must stand regardless.
 */
export async function onPaymentSucceeded(before, { planId, interval, renewsAt }) {
  try {
    const event = eventForPayment(before, { planId });
    if (!event) return { skipped: "no-clinwell-event" };
    const slug = practiceSlug(before);
    if (!slug) return { skipped: "no-practice-slug" };

    if (event === EVENTS.ACTIVATED) {
      return await queueEvent({
        specialist: before,
        event,
        build: ({ eventId, occurredAt }) =>
          activated({ eventId, occurredAt, specialist: before, plan: { interval, renewsAt } }),
      });
    }

    if (event === EVENTS.PAYMENT_RECOVERED) {
      return await queueEvent({
        specialist: before,
        event,
        build: ({ eventId, occurredAt }) => paymentRecovered({ eventId, occurredAt, slug }),
      });
    }

    return await queueEvent({
      specialist: before,
      event,
      build: ({ eventId, occurredAt }) => resumed({ eventId, occurredAt, slug }),
    });
  } catch (err) {
    console.error("[clinwell] could not queue a payment event:", err?.message ?? err);
    return { skipped: "error", error: String(err?.message ?? err) };
  }
}

/**
 * A renewal payment failed.
 *
 * dueAt is the renewal date that failed, and it is load-bearing:
 * ClinWell holds access for exactly 14 days from it and then suspends
 * on its own clock (§6.3). A wrong date here suspends a paying practice
 * early or lets a lapsed one keep clinical software for a fortnight
 * longer than it should.
 */
export async function onPaymentFailed(specialist, { dueAt } = {}) {
  try {
    if (!hasClinwell(specialist?.plan)) return { skipped: "no-clinwell-event" };
    const slug = practiceSlug(specialist);
    if (!slug) return { skipped: "no-practice-slug" };

    const due = dueAt ?? specialist?.planRenewsAt;
    if (!due) return { skipped: "no-due-date" };

    return await queueEvent({
      specialist,
      event: EVENTS.PAYMENT_FAILED,
      build: ({ eventId, occurredAt }) => paymentFailed({ eventId, occurredAt, slug, dueAt: due }),
    });
  } catch (err) {
    console.error("[clinwell] could not queue payment.failed:", err?.message ?? err);
    return { skipped: "error", error: String(err?.message ?? err) };
  }
}

/**
 * A subscription ended, or was downgraded to a plan without ClinWell
 * (§6.4 treats both as the same event).
 *
 * effectiveAt is the last day the practice has paid for. ClinWell keeps
 * access until the end of that day and then suspends; nothing is
 * withdrawn early, which is the behaviour a practice mid-consultation
 * needs.
 */
export async function onCancelled(specialist, { effectiveAt } = {}) {
  try {
    if (!hasClinwell(specialist?.plan)) return { skipped: "no-clinwell-event" };
    const slug = practiceSlug(specialist);
    if (!slug) return { skipped: "no-practice-slug" };

    /* With no renewal date on file, the last paid day is today: better
       to end access at the end of today than to send no date at all and
       have ClinWell ignore the cancellation entirely. */
    const effective = effectiveAt ?? specialist?.planRenewsAt ?? new Date();

    return await queueEvent({
      specialist,
      event: EVENTS.CANCELLED,
      build: ({ eventId, occurredAt }) => cancelled({ eventId, occurredAt, slug, effectiveAt: effective }),
    });
  } catch (err) {
    console.error("[clinwell] could not queue subscription.cancelled:", err?.message ?? err);
    return { skipped: "error", error: String(err?.message ?? err) };
  }
}
