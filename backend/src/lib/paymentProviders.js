import crypto from "node:crypto";
import { setPaymentProvider } from "./payments.js";

/* ------------------------------------------------------------------ *
 * Real payments
 *
 * lib/payments.js owns the billing lifecycle — quoting, orders, VAT,
 * renewals, activation. This file is the other half: the part that talks
 * to a payment company. It is separate so that the lifecycle can be read
 * and tested without any of Stripe's vocabulary in it, and so switching
 * provider is a new function here rather than an edit everywhere.
 *
 * Switching payments on is two environment variables and a restart:
 *
 *   STRIPE_SECRET_KEY=sk_live_…
 *   STRIPE_WEBHOOK_SECRET=whsec_…
 *
 * Until they are set, nothing here runs and checkout stays simulated —
 * the interface says so rather than pretending a card was taken.
 *
 * Stripe is spoken to over plain HTTPS rather than through its SDK. Two
 * endpoints and one signature check is a small enough surface that the
 * dependency — and its transitive tree, inside a healthcare product that
 * has to be auditable — costs more than it saves.
 * ------------------------------------------------------------------ */

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe's API is form-encoded, including nested keys like a[0][b]. */
function formEncode(value, prefix = "", out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.set(prefix, String(value));
  }
  return out;
}

async function stripeCall(path, body) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      // Pinned so a future API version cannot silently change the
      // shape of what comes back here.
      "stripe-version": process.env.STRIPE_API_VERSION || "2024-06-20",
    },
    body: formEncode(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? `Stripe returned ${res.status}`);
  }
  return payload;
}

/**
 * A configured Stripe Price for this plan and interval, if there is one.
 *
 * With prices configured, checkout opens a real subscription that Stripe
 * renews and dunning-manages. Without them it falls back to a one-off
 * charge for the same amount, which is enough to trade on day one and
 * keeps our own renewal dates authoritative.
 *
 *   STRIPE_PRICE_PREMIUM_YEARLY=price_123
 *   STRIPE_PRICE_CLINWELL_MONTHLY=price_456
 */
function configuredPrice(planId, interval) {
  const key = `STRIPE_PRICE_${String(planId).toUpperCase()}_${String(interval).toUpperCase()}`;
  return process.env[key] || null;
}

const stripe = {
  name: "stripe",

  async createCheckout({ order, successUrl, cancelUrl, customer }) {
    const price = configuredPrice(order.planId ?? order.plan, order.interval);

    const session = await stripeCall("/checkout/sessions", {
      mode: price ? "subscription" : "payment",
      customer_email: customer.email || undefined,
      /* Both, deliberately. client_reference_id is what comes back on a
         Checkout session; metadata is what survives onto the invoice and
         subscription events. Either one finds the order again. */
      client_reference_id: order.id,
      metadata: { orderId: order.id, specialistId: order.specialistId },
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        price
          ? { price, quantity: 1 }
          : {
              quantity: 1,
              price_data: {
                currency: (order.currency ?? "GBP").toLowerCase(),
                // Our own quote, VAT included — the figure the member was
                // shown on the pricing page is the figure they are charged.
                unit_amount: order.totalMinor,
                product_data: {
                  name: `${order.planName} — Top Local Specialists`,
                  description:
                    order.interval === "monthly" ? "Monthly membership" : "12-month membership",
                },
              },
            },
      ],
      ...(price ? { subscription_data: { metadata: { orderId: order.id } } } : {}),
    });

    return { checkoutUrl: session.url, providerRef: session.id };
  },

  /**
   * Verify Stripe's signature over the raw request body.
   *
   * This is the security boundary of the whole billing system: the
   * webhook is the only thing in the application that can switch a paid
   * plan on, so an unverified POST to it would be a free subscription for
   * anyone who guessed an order id. The check is Stripe's documented
   * scheme — HMAC-SHA256 over "timestamp.body" — with a five-minute
   * tolerance so a replayed capture from last week is refused too.
   */
  verifyWebhook(rawBody, headers) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

    const header = headers["stripe-signature"] || headers["Stripe-Signature"];
    if (!header) throw new Error("no stripe-signature header");

    const parts = Object.fromEntries(
      String(header)
        .split(",")
        .map((p) => p.split("=").map((s) => s.trim()))
        .filter((p) => p.length === 2)
    );
    const timestamp = Number(parts.t);
    if (!timestamp) throw new Error("malformed signature header");

    const toleranceSeconds = Number(process.env.STRIPE_WEBHOOK_TOLERANCE ?? 300);
    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
      throw new Error("signature timestamp outside tolerance");
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex");

    // Every v1 signature on the header — Stripe sends more than one while
    // a secret is being rotated.
    const signatures = String(header)
      .split(",")
      .map((p) => p.split("="))
      .filter(([k]) => k.trim() === "v1")
      .map(([, v]) => v.trim());

    const matched = signatures.some((sig) => {
      const a = Buffer.from(sig, "hex");
      const b = Buffer.from(expected, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!matched) throw new Error("signature mismatch");

    return JSON.parse(body);
  },
};

/**
 * Switch payments on if the environment says to.
 *
 * Called once from server.js, beside registerMailer(). Returns the name
 * of whatever was connected so the boot log can say it out loud.
 */
export function registerPaymentProvider() {
  const forced = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (forced === "none" || forced === "off") {
    console.log("[payments] disabled (PAYMENT_PROVIDER=none) — checkout is simulated");
    return { provider: "none" };
  }

  if (process.env.STRIPE_SECRET_KEY) {
    const live = process.env.STRIPE_SECRET_KEY.startsWith("sk_live");
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      /* Refused rather than half-connected. Without the webhook secret a
         payment can be taken and never applied: the member is charged and
         their listing stays switched off, which is the worst of the three
         possible states. */
      console.error(
        "[payments] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — " +
          "payments stay simulated, because a payment that cannot be confirmed " +
          "would charge a member and never activate their plan."
      );
      return { provider: "none", reason: "missing-webhook-secret" };
    }
    setPaymentProvider(stripe);
    console.log(`[payments] Stripe connected (${live ? "LIVE — real money" : "test mode"})`);
    return { provider: "stripe", live };
  }

  console.log("[payments] no provider configured — checkout is simulated (see .env.example)");
  return { provider: "none" };
}

export { stripe };
