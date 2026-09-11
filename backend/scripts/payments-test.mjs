import crypto from "node:crypto";
import { registerPaymentProvider, stripe } from "../src/lib/paymentProviders.js";
import { hasPaymentProvider, paymentProviderName, verifiesWebhooks } from "../src/lib/payments.js";

/* ------------------------------------------------------------------ *
 * Payments, proved without a Stripe account
 *
 *   npm run payments:test
 *
 * Two things are checked, and the second is the one that matters.
 *
 * The checkout request: that a member pressing "pay" produces a Stripe
 * session carrying the right amount, the right currency and — above all
 * — our order id, because an order id that does not survive the round
 * trip is a payment that can never be matched to a membership.
 *
 * The webhook signature: that a forged callback cannot switch a paid
 * plan on. This endpoint is the only thing in the application that can,
 * so every way of getting it wrong is tested here — no signature, the
 * wrong secret, a replayed old one, and a body edited after signing.
 * ------------------------------------------------------------------ */

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

/* ------------------------------------------------------- switching on */

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
registerPaymentProvider();
check("with no keys, payments stay simulated", !hasPaymentProvider());

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
registerPaymentProvider();
check(
  "a secret key without a webhook secret is refused, not half-connected",
  !hasPaymentProvider(),
  "a payment that cannot be confirmed would charge a member and never activate them"
);

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
registerPaymentProvider();
check("both keys connect Stripe", hasPaymentProvider() && paymentProviderName() === "stripe");
check("and the webhook is then verified", verifiesWebhooks());

/* ---------------------------------------------------- the checkout */

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: String(init.body), headers: init.headers });
  return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const order = {
  id: "ord_abc123",
  specialistId: "spc_1",
  specialistName: "Mr James Whitfield",
  planId: "premium",
  planName: "Premium Listing",
  interval: "yearly",
  currency: "GBP",
  subtotalMinor: 29900,
  vatMinor: 5980,
  totalMinor: 35880,
};

const session = await stripe.createCheckout({
  order,
  successUrl: "https://toplocalspecialists.com/dashboard/billing?paid=1",
  cancelUrl: "https://toplocalspecialists.com/dashboard/billing",
  customer: { email: "j.whitfield@example.com", name: order.specialistName },
});

const sent = decodeURIComponent(calls[0]?.body ?? "").replace(/\+/g, " ");
check("it calls Stripe's checkout endpoint", calls[0]?.url.endsWith("/checkout/sessions"), calls[0]?.url);
check("it authenticates with the secret key", String(calls[0]?.headers?.authorization).includes("sk_test_fake"));
check("the order id travels as client_reference_id", sent.includes("client_reference_id=ord_abc123"));
check("and again in metadata, which is what survives onto the invoice", sent.includes("metadata[orderId]=ord_abc123"));
check(
  "the amount charged is the quoted total including VAT",
  sent.includes("line_items[0][price_data][unit_amount]=35880"),
  sent
);
check("in the right currency", sent.includes("price_data][currency]=gbp"));
check("the plan is named on the receipt", sent.includes("Premium Listing"));
check("it returns the URL to send the member to", session.checkoutUrl?.startsWith("https://checkout.stripe.com/"));
check("and the provider's own reference for the order", session.providerRef === "cs_test_123");

/* A configured Stripe Price switches it to a real subscription. */
calls.length = 0;
process.env.STRIPE_PRICE_PREMIUM_YEARLY = "price_live_123";
await stripe.createCheckout({ order, successUrl: "https://x/s", cancelUrl: "https://x/c", customer: {} });
const subscription = decodeURIComponent(calls[0]?.body ?? "");
check("a configured Price opens a subscription instead", subscription.includes("mode=subscription"), subscription);
check("using that Price", subscription.includes("line_items[0][price]=price_live_123"));
delete process.env.STRIPE_PRICE_PREMIUM_YEARLY;

globalThis.fetch = realFetch;

/* --------------------------------------------------- the signature */

const secret = "whsec_test_secret";
const event = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_123", client_reference_id: "ord_abc123" } },
});

function sign(body, { secretUsed = secret, at = Math.floor(Date.now() / 1000) } = {}) {
  const signature = crypto.createHmac("sha256", secretUsed).update(`${at}.${body}`, "utf8").digest("hex");
  return { "stripe-signature": `t=${at},v1=${signature}` };
}

const verified = stripe.verifyWebhook(Buffer.from(event), sign(event));
check("a correctly signed webhook is accepted", verified?.type === "checkout.session.completed");
check("and carries the order id back", verified?.data?.object?.client_reference_id === "ord_abc123");

function refuses(label, run) {
  try {
    run();
    check(label, false, "it was accepted");
  } catch (err) {
    check(label, true, err.message);
  }
}

refuses("an unsigned callback is refused", () => stripe.verifyWebhook(Buffer.from(event), {}));
refuses("a callback signed with the wrong secret is refused", () =>
  stripe.verifyWebhook(Buffer.from(event), sign(event, { secretUsed: "whsec_attacker" }))
);
refuses("a replayed callback from an hour ago is refused", () =>
  stripe.verifyWebhook(Buffer.from(event), sign(event, { at: Math.floor(Date.now() / 1000) - 3600 }))
);
refuses("a body edited after signing is refused", () => {
  const headers = sign(event);
  const tampered = event.replace("ord_abc123", "ord_somebody_elses");
  return stripe.verifyWebhook(Buffer.from(tampered), headers);
});

/* Rotation: Stripe sends both signatures while a secret is being rolled,
   and the endpoint must keep working through it. */
const at = Math.floor(Date.now() / 1000);
const good = crypto.createHmac("sha256", secret).update(`${at}.${event}`, "utf8").digest("hex");
const old = crypto.createHmac("sha256", "whsec_previous").update(`${at}.${event}`, "utf8").digest("hex");
check(
  "during a secret rotation, either valid signature is accepted",
  stripe.verifyWebhook(Buffer.from(event), { "stripe-signature": `t=${at},v1=${old},v1=${good}` })?.id === "evt_1"
);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
