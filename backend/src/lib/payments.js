import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { CURRENCY, getPlan, isPaidPlan, priceFor } from "./plans.js";
import { getDb, isDbConfigured } from "../db/client.js";
import { orders } from "../db/schema.js";

/* ------------------------------------------------------------------ *
 * Payments
 *
 * The whole billing lifecycle is implemented here — quoting a price,
 * opening a checkout, recording an order, applying a webhook, renewing,
 * cancelling. What is NOT here is a payment provider, because that is
 * the one part that needs an account, keys and a live domain.
 *
 * Connecting Stripe (or anything else) is one call at boot:
 *
 *   import Stripe from "stripe";
 *   import { setPaymentProvider } from "./lib/payments.js";
 *
 *   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
 *   setPaymentProvider({
 *     name: "stripe",
 *     async createCheckout({ order, successUrl, cancelUrl, customer }) {
 *       const session = await stripe.checkout.sessions.create({
 *         mode: "subscription",
 *         customer_email: customer.email,
 *         client_reference_id: order.id,
 *         line_items: [{ price: order.providerPriceId, quantity: 1 }],
 *         success_url: successUrl,
 *         cancel_url: cancelUrl,
 *       });
 *       return { checkoutUrl: session.url, providerRef: session.id };
 *     },
 *     verifyWebhook(rawBody, headers) {
 *       return stripe.webhooks.constructEvent(
 *         rawBody, headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET
 *       );
 *     },
 *   });
 *
 * Nothing else in the codebase changes. Until that call is made,
 * checkout returns `provider: "none"` and the interface says plainly
 * that payment is not connected instead of pretending a card was taken.
 * ------------------------------------------------------------------ */

let provider = null;

export function setPaymentProvider(impl) {
  provider = impl;
}

export function paymentProviderName() {
  return provider?.name ?? null;
}

export function hasPaymentProvider() {
  return Boolean(provider);
}

/** Whether the connected provider signs its webhooks (Stripe does). */
export function verifiesWebhooks() {
  return typeof provider?.verifyWebhook === "function";
}

/**
 * Check a webhook's signature and return the event it carries.
 * Throws when the signature is absent, stale or wrong — the caller turns
 * that into a 400 and applies nothing.
 */
export function verifyWebhookSignature(rawBody, headers) {
  if (!provider?.verifyWebhook) throw new Error("no provider to verify against");
  return provider.verifyWebhook(rawBody, headers);
}

/* ------------------------------------------------------------------ *
 * Orders
 *
 * An order is the record of an intent to pay: which specialist, which
 * plan, how much, and what happened. It exists before any money moves,
 * which is what makes a webhook idempotent — the webhook finds the
 * order it refers to rather than inventing a subscription from an
 * event.
 *
 * In demo mode these live in memory. With a database configured the
 * same shape is persisted in the `orders` table.
 * ------------------------------------------------------------------ */

const demoOrders = [];

/** Dates come back from Postgres as Date objects and from the demo store
 *  as ISO strings. The API contract is ISO strings, so normalise once
 *  here rather than in each caller. */
function normaliseOrder(row) {
  if (!row) return null;
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
  return { ...row, periodEnd: iso(row.periodEnd), paidAt: iso(row.paidAt), createdAt: iso(row.createdAt) };
}

function toRow(order) {
  const date = (v) => (v ? new Date(v) : null);
  return { ...order, periodEnd: date(order.periodEnd), paidAt: date(order.paidAt) };
}

/**
 * Orders were held in memory, which meant a restart lost every payment
 * in flight — including ones Stripe had already taken money for. With a
 * database configured they are rows; without one they stay in memory,
 * which is what demo mode is for.
 */
export const orderStore = {
  async create(order) {
    if (!isDbConfigured()) {
      demoOrders.push(order);
      return order;
    }
    const { createdAt, ...rest } = toRow(order);
    const [row] = await getDb().insert(orders).values(rest).returning();
    return normaliseOrder(row);
  },

  async find(id) {
    if (!isDbConfigured()) return demoOrders.find((o) => o.id === id) ?? null;
    const [row] = await getDb().select().from(orders).where(eq(orders.id, id)).limit(1);
    return normaliseOrder(row);
  },

  async forSpecialist(specialistId) {
    if (!isDbConfigured()) {
      return demoOrders
        .filter((o) => o.specialistId === specialistId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    const rows = await getDb()
      .select()
      .from(orders)
      .where(eq(orders.specialistId, specialistId))
      .orderBy(desc(orders.createdAt));
    return rows.map(normaliseOrder);
  },

  async update(id, patch) {
    if (!isDbConfigured()) {
      const order = demoOrders.find((o) => o.id === id);
      if (!order) return null;
      Object.assign(order, patch);
      return order;
    }
    const [row] = await getDb().update(orders).set(toRow(patch)).where(eq(orders.id, id)).returning();
    return normaliseOrder(row);
  },

  async all() {
    if (!isDbConfigured()) return [...demoOrders];
    const rows = await getDb().select().from(orders).orderBy(desc(orders.createdAt));
    return rows.map(normaliseOrder);
  },
};

/** VAT is charged on directory subscriptions; the rate lives here. */
export const VAT_RATE = 0.2;

/**
 * What this purchase costs, itemised. Computed rather than typed so the
 * checkout page, the invoice and the provider all quote one number.
 */
export function quote(planId, interval = "yearly") {
  const netMinor = priceFor(planId, interval);
  const vatMinor = Math.round(netMinor * VAT_RATE);
  return {
    planId,
    planName: getPlan(planId).name,
    interval,
    currency: CURRENCY,
    netMinor,
    vatMinor,
    vatRate: VAT_RATE,
    totalMinor: netMinor + vatMinor,
    // A yearly subscription renews in a year, a monthly one in a month.
    periodEnd: addInterval(new Date(), interval).toISOString(),
  };
}

export function addInterval(from, interval) {
  const date = new Date(from);
  if (interval === "monthly") date.setMonth(date.getMonth() + 1);
  else date.setFullYear(date.getFullYear() + 1);
  return date;
}

/**
 * Open a checkout for a plan change.
 *
 * Returns one of three shapes, and the caller renders each differently:
 *   { status: "free" }      — nothing to pay, activate immediately
 *   { status: "redirect" }  — send the browser to checkoutUrl
 *   { status: "unconfigured" } — no provider; the order is recorded and
 *                                waiting, and the UI says so honestly
 */
/**
 * A quote for a figure somebody agreed, rather than one from the
 * catalogue.
 *
 * Organisations are priced on how many doctors they want covered, so
 * there is no published price to look up — but everything downstream of
 * the order (VAT, activation, renewal reminders, the ClinWell events)
 * only ever reads the order's own numbers. So an agreed figure becomes
 * an ordinary order and the rest of the system never learns the
 * difference. That is the whole reason this is six lines and not a
 * second payment path.
 *
 * VAT is computed here rather than accepted from the caller: a quote
 * entered as a total would otherwise be charged as a net figure plus
 * 20%, and nobody would notice until a hospital queried its invoice.
 */
export function quoteAmount({ netMinor, planId, interval = "yearly" }) {
  const net = Math.round(Number(netMinor));
  if (!Number.isFinite(net) || net <= 0) {
    throw new Error("A quoted amount must be a positive number of pence.");
  }
  const vatMinor = Math.round(net * VAT_RATE);
  return {
    planId,
    planName: getPlan(planId).name,
    interval,
    currency: CURRENCY,
    netMinor: net,
    vatMinor,
    vatRate: VAT_RATE,
    totalMinor: net + vatMinor,
    periodEnd: addInterval(new Date(), interval).toISOString(),
    /* Marks the order as negotiated, so an invoice or a report can tell
       a quoted subscription from a self-serve one without inferring it
       from the amount. */
    quoted: true,
  };
}

/**
 * @param pricing  optional, from quoteAmount(): an agreed figure to
 *                 charge instead of the catalogue price. Everything
 *                 else about the order is identical.
 */
export async function createCheckout({ specialist, planId, interval, successUrl, cancelUrl, pricing = null }) {
  if (!isPaidPlan(planId)) {
    return { status: "free", order: null };
  }

  const agreed = pricing ?? quote(planId, interval);
  const order = await orderStore.create({
    id: `ord_${crypto.randomBytes(9).toString("hex")}`,
    specialistId: specialist.id,
    specialistName: specialist.fullName,
    email: specialist.contactEmail ?? null,
    ...agreed,
    status: "awaiting_payment",
    provider: provider?.name ?? "none",
    providerRef: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
  });

  if (!provider) {
    console.log(
      `[payments] no provider configured — order ${order.id} recorded for ` +
        `${order.specialistName}: ${order.planName} (${interval}), ` +
        `${(order.totalMinor / 100).toFixed(2)} ${order.currency} inc. VAT`
    );
    return { status: "unconfigured", order, reason: "no-provider-configured" };
  }

  try {
    const { checkoutUrl, providerRef } = await provider.createCheckout({
      order,
      successUrl,
      cancelUrl,
      customer: { email: order.email, name: order.specialistName },
    });
    await orderStore.update(order.id, { providerRef });
    return { status: "redirect", order, checkoutUrl };
  } catch (err) {
    console.error("[payments] checkout failed:", err?.message ?? err);
    await orderStore.update(order.id, { status: "failed", failureReason: String(err?.message ?? err) });
    return { status: "error", order, reason: String(err?.message ?? err) };
  }
}

/**
 * Mark an order paid. Called by the webhook when the provider confirms,
 * and by the demo-mode simulator so the flow is testable without one.
 *
 * Idempotent on purpose: providers retry webhooks, and paying twice for
 * one order must not extend a subscription twice.
 */
export async function markOrderPaid(orderId, { providerRef } = {}) {
  const order = await orderStore.find(orderId);
  if (!order) return { ok: false, reason: "unknown-order" };
  if (order.status === "paid") return { ok: true, order, alreadyApplied: true };
  await orderStore.update(orderId, {
    status: "paid",
    paidAt: new Date().toISOString(),
    providerRef: providerRef ?? order.providerRef,
  });
  return { ok: true, order: await orderStore.find(orderId), alreadyApplied: false };
}

/**
 * Translate a provider event into the two facts this application cares
 * about: which order, and did it succeed. Keeping the mapping here means
 * the controller never learns any provider's event names.
 */
export function interpretWebhook(event) {
  if (provider?.interpretWebhook) return provider.interpretWebhook(event);

  // Stripe's shape by default, since it is the most likely provider.
  const type = event?.type ?? "";
  const object = event?.data?.object ?? {};
  const orderId = object.client_reference_id ?? object.metadata?.orderId ?? null;

  if (type === "checkout.session.completed" || type === "invoice.payment_succeeded") {
    return { kind: "paid", orderId, providerRef: object.id ?? null };
  }
  if (type === "invoice.payment_failed") {
    return { kind: "payment_failed", orderId, providerRef: object.id ?? null };
  }
  if (type === "customer.subscription.deleted") {
    return { kind: "canceled", orderId, providerRef: object.id ?? null };
  }
  return { kind: "ignored", orderId: null };
}
