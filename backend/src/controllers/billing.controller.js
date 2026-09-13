import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { specialists as specialistRepo } from "../db/repos.js";
import {
  PLANS,
  PLAN_IDS,
  PRICING_FAQ,
  annualComparison,
  comparisonTable,
  entitlementsFor,
  getPlan,
  isPaidPlan,
} from "../lib/plans.js";
import {
  addInterval,
  createCheckout,
  hasPaymentProvider,
  interpretWebhook,
  markOrderPaid,
  orderStore,
  paymentProviderName,
  quote,
  verifiesWebhooks,
  verifyWebhookSignature,
} from "../lib/payments.js";
/* provisionWorkspace is deliberately not imported any more: under
   contract v1.0.1 the workspace is created by the subscription.activated
   event and its id arrives in ClinWell's response, so there is no
   synchronous "provision" call to make. */
import { isClinWellConnected, ssoUrl, workspaceSummary } from "../lib/clinwell.js";
import { onCancelled, onPaymentFailed, onPaymentSucceeded } from "../lib/clinwellLifecycle.js";
import { mockSpecialistsWithRelations, updateDemoSpecialist } from "../data/mock.js";
import { specialistIdOf } from "../middleware/auth.js";
import { sendMail } from "../lib/mailer.js";

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

/* ------------------------------------------------------------------ *
 * Public catalogue
 * ------------------------------------------------------------------ */

/**
 * GET /api/plans
 *
 * Everything the pricing page renders. It is served rather than
 * hard-coded in the frontend so that the prices a visitor is quoted and
 * the entitlements the API enforces are the same data — a marketing page
 * cannot advertise a feature the server will not grant.
 */
export function getPlans(req, res) {
  res.json({
    currency: "GBP",
    plans: PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      eyebrow: p.eyebrow,
      badge: p.badge ?? null,
      tagline: p.tagline,
      cta: p.cta,
      freeForever: Boolean(p.freeForever),
      priceMinor: p.priceMinor,
      pricing: annualComparison(p.id),
      highlightsHeading: p.highlightsHeading ?? null,
      highlights: p.highlights,
      features: p.features,
    })),
    comparison: comparisonTable(),
    faq: PRICING_FAQ,
    // Told plainly rather than hidden: the checkout page says whether a
    // card can actually be taken right now.
    payments: { connected: hasPaymentProvider(), provider: paymentProviderName() },
  });
}

/* ------------------------------------------------------------------ *
 * Loading and saving, both storage modes
 * ------------------------------------------------------------------ */

async function loadSpecialist(id) {
  if (!isDbConfigured()) return mockSpecialistsWithRelations.find((s) => s.id === id) ?? null;
  return specialistRepo.rawById(id);
}

/** Timestamp columns take Date objects; the callers here speak ISO. */
const DATE_FIELDS = ["planSelectedAt", "planActivatedAt", "planRenewsAt", "nextAvailableAt"];
function coerceDates(patch) {
  const out = { ...patch };
  for (const field of DATE_FIELDS) {
    if (out[field] != null && !(out[field] instanceof Date)) out[field] = new Date(out[field]);
  }
  return out;
}

async function patchSpecialist(id, patch) {
  if (!isDbConfigured()) return updateDemoSpecialist(id, patch);
  return specialistRepo.update(id, coerceDates(patch));
}

/* ------------------------------------------------------------------ *
 * The specialist's own billing state
 * ------------------------------------------------------------------ */

// GET /api/billing/subscription
export async function getSubscription(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });
  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  const ent = entitlementsFor(specialist);
  const orders = await orderStore.forSpecialist(id);

  res.json({
    subscription: {
      selectedPlan: ent.selectedPlan,
      selectedPlanName: ent.selectedPlanName,
      effectivePlan: ent.effectivePlan,
      effectivePlanName: ent.effectivePlanName,
      status: ent.planStatus,
      interval: ent.planInterval,
      renewsAt: ent.renewsAt,
      awaitingActivation: ent.awaitingActivation,
      // Verification and payment are separate gates and the dashboard
      // needs to say which one is outstanding.
      verificationStatus: specialist.verificationStatus,
      canPayNow: specialist.verificationStatus === "verified" && ent.planStatus === "pending_payment",
    },
    features: ent.features,
    quote: isPaidPlan(ent.selectedPlan) ? quote(ent.selectedPlan, ent.planInterval) : null,
    invoices: orders.map((o) => ({
      id: o.id,
      planName: o.planName,
      interval: o.interval,
      netMinor: o.netMinor,
      vatMinor: o.vatMinor,
      totalMinor: o.totalMinor,
      currency: o.currency,
      status: o.status,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    })),
    payments: { connected: hasPaymentProvider(), provider: paymentProviderName() },
  });
}

const changeSchema = z.object({
  planId: z.enum(["basic", "premium", "clinwell"]),
  interval: z.enum(["monthly", "yearly"]).default("yearly"),
});

/**
 * POST /api/billing/change-plan
 *
 * Choosing a plan and paying for it are two separate events, and this is
 * the first. Downgrades to Basic apply immediately (nobody should have
 * to wait to stop being charged); upgrades wait for verification, then
 * for payment.
 */
export async function changePlan(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid plan", issues: parsed.error.issues });
  const { planId, interval } = parsed.data;

  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  // Downgrade — takes effect at once. Premium content is retained and
  // simply stops being served (lib/profileGate.js).
  if (!isPaidPlan(planId)) {
    const updated = await patchSpecialist(id, {
      plan: "basic",
      planStatus: "active",
      planInterval: interval,
      planRenewsAt: null,
    });
    /* §6.4: a downgrade to a plan without ClinWell IS a cancellation to
       ClinWell, with effectiveAt set to the last day already paid for.
       Queued from `specialist`, the row as it was before the downgrade,
       because the patch has just cleared the renewal date this event
       needs. */
    await onCancelled(specialist, { effectiveAt: specialist.planRenewsAt });
    return res.json({ ok: true, outcome: "downgraded", subscription: summarise(updated) });
  }

  // Upgrade. Verification comes first: we do not take money from someone
  // we have not approved, because refunding a rejected applicant is a
  // worse experience than asking them to wait.
  const status = specialist.verificationStatus === "verified" ? "pending_payment" : "pending_verification";

  const updated = await patchSpecialist(id, {
    plan: planId,
    planInterval: interval,
    planStatus: status,
    planSelectedAt: new Date().toISOString(),
  });

  res.json({
    ok: true,
    outcome: status,
    subscription: summarise(updated),
    quote: quote(planId, interval),
  });
}

/**
 * POST /api/billing/checkout
 *
 * Opens payment for the plan already selected. Refuses if the profile
 * has not been approved yet — the one rule this whole flow exists to
 * protect.
 */
export async function startCheckout(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });

  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  const ent = entitlementsFor(specialist);
  const planId = req.body?.planId ?? ent.selectedPlan;
  const interval = req.body?.interval ?? ent.planInterval;

  if (!PLAN_IDS.includes(planId)) return res.status(400).json({ error: "Unknown plan" });
  if (!isPaidPlan(planId)) return res.status(400).json({ error: "The Basic plan is free — there is nothing to pay" });

  if (specialist.verificationStatus !== "verified") {
    return res.status(409).json({
      error: "Your application is still being reviewed. We'll ask for payment once you're approved.",
      code: "awaiting_verification",
    });
  }

  const result = await createCheckout({
    specialist,
    planId,
    interval,
    successUrl: `${SITE_URL}/dashboard/billing?paid=1`,
    cancelUrl: `${SITE_URL}/dashboard/billing?cancelled=1`,
  });

  res.json({
    status: result.status,
    checkoutUrl: result.checkoutUrl ?? null,
    order: result.order
      ? { id: result.order.id, totalMinor: result.order.totalMinor, currency: result.order.currency }
      : null,
    reason: result.reason ?? null,
  });
}

/**
 * POST /api/billing/webhook
 *
 * The provider's callback. Deliberately the only path that can turn a
 * subscription on: nothing in the browser can claim a payment happened.
 */
export async function paymentWebhook(req, res) {
  /* Signature first, always. This endpoint is the only thing in the
     application that can switch a paid plan on, so an unsigned POST to it
     would be a free membership for anyone who could guess an order id.
     When a provider offers verification we require it; with no provider
     connected there is nothing to verify against and the endpoint is only
     reachable in demo mode. */
  let payload = req.body;
  if (verifiesWebhooks()) {
    try {
      payload = verifyWebhookSignature(req.rawBody ?? JSON.stringify(req.body ?? {}), req.headers);
    } catch (err) {
      console.error("[payments] rejected an unverified webhook:", err?.message ?? err);
      return res.status(400).json({ error: "Signature verification failed" });
    }
  }

  const event = interpretWebhook(payload);
  if (event.kind === "ignored" || !event.orderId) return res.json({ received: true, applied: false });

  const order = await orderStore.find(event.orderId);
  if (!order) return res.status(404).json({ error: "Unknown order" });

  if (event.kind === "paid") {
    const applied = await activateSubscription(order, { providerRef: event.providerRef });
    return res.json({ received: true, applied });
  }
  if (event.kind === "payment_failed") {
    const before = await loadSpecialist(order.specialistId);
    await patchSpecialist(order.specialistId, { planStatus: "past_due" });
    /* dueAt is the renewal date that failed, read before the patch.
       ClinWell holds access for exactly 14 days from it and then
       suspends on its own clock (§6.3), so this one date decides
       whether a practice loses clinical software early or a fortnight
       late. */
    if (before) await onPaymentFailed(before, { dueAt: before.planRenewsAt });
    return res.json({ received: true, applied: true });
  }
  if (event.kind === "canceled") {
    const before = await loadSpecialist(order.specialistId);
    await patchSpecialist(order.specialistId, { planStatus: "canceled" });
    /* effectiveAt is the last day already paid for. ClinWell keeps
       access until the end of it and withdraws nothing early (§6.4). */
    if (before) await onCancelled(before, { effectiveAt: before.planRenewsAt });
    return res.json({ received: true, applied: true });
  }
  res.json({ received: true, applied: false });
}

/**
 * Turn a paid order into an active subscription.
 *
 * Shared by the webhook and by the demo-mode simulator so there is one
 * activation path, not two that can drift.
 */
async function activateSubscription(order, { providerRef } = {}) {
  const paid = await markOrderPaid(order.id, { providerRef });
  if (!paid.ok) return false;
  if (paid.alreadyApplied) return true; // providers retry; do not extend twice

  /* Captured BEFORE the patch, because the patch erases the very
     distinction ClinWell cares about: once planStatus reads "active"
     there is no way to tell a first activation from a recovered
     payment from a practice un-cancelling. See lib/clinwellLifecycle.js. */
  const before = await loadSpecialist(order.specialistId);

  const renewsAt = addInterval(new Date(), order.interval).toISOString();
  const patch = {
    plan: order.planId,
    planInterval: order.interval,
    planStatus: "active",
    planActivatedAt: new Date().toISOString(),
    planRenewsAt: renewsAt,
  };

  // The subscription is switched on FIRST, and the ClinWell workspace is
  // provisioned after. The other order was a trap: ClinWell is a separate
  // service with its own database, so there is no transaction spanning
  // both, and an outage on their side would have left a specialist who
  // had paid with a subscription that never activated. Provisioning is
  // retried by the sweep instead, and until it succeeds the dashboard
  // shows "workspace being prepared" rather than a broken page.
  await patchSpecialist(order.specialistId, patch);

  if (getPlan(order.planId).features.clinwell) {
    /* The workspace is created by the subscription.activated event, and
       its id comes back in ClinWell's response — so this queues the
       event rather than awaiting a workspace. The outbox owns delivery
       and the retry schedule from here (lib/clinwellSender.js), which
       is what lets the subscription stand even if ClinWell is down.

       Until the id arrives the dashboard shows "workspace being
       prepared" rather than a broken page. When a payment recovers or a
       practice un-cancels, this sends payment.recovered or resumed
       instead, and never both. */
    const queued = await onPaymentSucceeded(before ?? { id: order.specialistId }, {
      planId: order.planId,
      interval: order.interval,
      renewsAt,
    });
    if (queued?.skipped && queued.skipped !== "no-clinwell-event") {
      console.warn(`[billing] ClinWell event not queued for ${order.specialistId}: ${queued.skipped}`);
    }
    /* Nudge the outbox so a new subscription is not waiting on the next
       sweep tick. Deliberately not awaited: the practice's confirmation
       must not wait on ClinWell answering. */
    import("../lib/clinwellSender.js")
      .then((m) => m.drainOutbox())
      .catch(() => {});
  }

  await sendMail({
    to: order.email,
    subject: `Your ${order.planName} subscription is active`,
    text: [
      `Thank you — your ${order.planName} subscription is now active.`,
      ``,
      `Billed ${order.interval}. Next renewal: ${new Date(renewsAt).toLocaleDateString("en-GB")}.`,
      `Total paid: £${(order.totalMinor / 100).toFixed(2)} including VAT.`,
      ``,
      `Your upgraded profile features are live now.`,
    ].join("\n"),
  });

  return true;
}

/**
 * POST /api/billing/simulate-payment
 *
 * Runs the exact activation path the webhook runs, so the flow can be
 * walked end to end before a payment provider exists. Disabled as soon
 * as one is configured, and always in production.
 */
export async function simulatePayment(req, res) {
  // Gated on there being no real payment provider, not on there being no
  // database: the point of the simulator is to walk the flow before
  // Stripe exists, which is just as useful against a real Postgres in
  // staging. It disappears the moment a provider is configured, and in
  // production regardless.
  if (hasPaymentProvider() || process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not available" });
  }
  const id = specialistIdOf(req.user);
  const order = (await orderStore.forSpecialist(id)).find((o) => o.status === "awaiting_payment");
  if (!order) return res.status(404).json({ error: "No payment is outstanding" });

  await activateSubscription(order, { providerRef: "simulated" });
  const specialist = await loadSpecialist(id);
  res.json({ ok: true, simulated: true, subscription: summarise(specialist) });
}

/* ------------------------------------------------------------------ *
 * ClinWell
 * ------------------------------------------------------------------ */

// GET /api/billing/clinwell — the Full Practice Suite workspace status.
export async function getClinWell(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) return res.status(400).json({ error: "This account has no specialist profile" });
  const specialist = await loadSpecialist(id);
  if (!specialist) return res.status(404).json({ error: "Profile not found" });

  const ent = entitlementsFor(specialist);
  if (!ent.features.clinwell) {
    return res.json({
      entitled: false,
      connected: isClinWellConnected(),
      requiredPlan: "clinwell",
      requiredPlanName: getPlan("clinwell").name,
    });
  }

  const summary = await workspaceSummary({ workspaceId: specialist.clinwellWorkspaceId });
  const sso = await ssoUrl({ workspaceId: specialist.clinwellWorkspaceId, userId: String(req.user.id ?? req.user._id) });
  res.json({ entitled: true, ...summary, ssoUrl: sso.url });
}

/* ------------------------------------------------------------------ */

function summarise(specialist) {
  const ent = entitlementsFor(specialist);
  return {
    selectedPlan: ent.selectedPlan,
    selectedPlanName: ent.selectedPlanName,
    effectivePlan: ent.effectivePlan,
    effectivePlanName: ent.effectivePlanName,
    status: ent.planStatus,
    interval: ent.planInterval,
    renewsAt: ent.renewsAt,
    awaitingActivation: ent.awaitingActivation,
  };
}

export { activateSubscription };
