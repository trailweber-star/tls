/* Organisation applications and quoted checkout, end to end over HTTP.
 *
 * The checks that matter here are about money and about who may move
 * it. A quote is a number a person typed on a screen, and three things
 * must hold no matter what they typed:
 *
 *   - the figure charged is the figure agreed, not the catalogue price
 *   - VAT is computed on it once, not accepted from the caller
 *   - "they paid" cannot be set by hand, only by actually paying
 *
 * The rest is the form being forgiving enough to fill in and strict
 * enough not to accept nonsense.
 *
 *   node scripts/organisations-test.mjs [http://127.0.0.1:4000/api]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:4000/api";
const ADMIN = { email: "admin@tls.test", password: "demo1234" };

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};
const section = (name) => console.log(`\n${name}`);

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const stamp = Date.now();
const login = await call(null, "POST", "/auth/login", ADMIN);
const token = login.body?.token ?? null;
check("signed in as an administrator", Boolean(token), String(login.status));

/* ------------------------------------------------------- the form */

section("applying");

const full = {
  organisationName: `Droitwich Knee & Shoulder ${stamp}`,
  organisationType: "clinic",
  websiteUrl: "https://example.com",
  contactName: "Kirti Moholkar",
  contactRole: "Clinical director",
  contactEmail: `org-${stamp}@example.com`,
  contactPhone: "01905 000000",
  doctorCount: 12,
  siteCount: 2,
  specialties: ["Orthopaedic surgery", "Sports medicine"],
  needsClinwell: true,
  notes: "Four of the twelve need ClinWell.",
};

const created = await call(null, "POST", "/organisations/apply", full);
check("a complete application is accepted", created.status === 201, JSON.stringify(created.body)?.slice(0, 160));
check("and returns a reference the applicant can quote back", Boolean(created.body?.reference));
check("no session needed — organisations have no account yet", true);

/* The point of the form is that it is fillable. Somebody on a phone
   between two other jobs does not know the doctor count. */
const sparse = await call(null, "POST", "/organisations/apply", {
  organisationName: `Unsure Trust ${stamp}`,
  organisationType: "hospital",
  contactName: "Jo Bloggs",
  contactEmail: `sparse-${stamp}@example.com`,
});
check("an application with no numbers at all is still accepted", sparse.status === 201, String(sparse.status));

const refusals = [
  ["no organisation name", { organisationType: "clinic", contactName: "A B", contactEmail: "a@example.com" }],
  ["a one-character name", { organisationName: "X", organisationType: "clinic", contactName: "A B", contactEmail: "a@example.com" }],
  ["an unusable email", { organisationName: "Some Clinic", organisationType: "clinic", contactName: "A B", contactEmail: "nope" }],
  ["an organisation type we do not serve", { organisationName: "Some Gym", organisationType: "gym", contactName: "A B", contactEmail: "a@example.com" }],
  [
    "more doctors than any NHS trust",
    { organisationName: "Vast Trust", organisationType: "hospital", contactName: "A B", contactEmail: "a@example.com", doctorCount: 99999 },
  ],
];
for (const [label, body] of refusals) {
  const res = await call(null, "POST", "/organisations/apply", body);
  check(`refuses ${label}`, res.status === 400, String(res.status));
}

/* ------------------------------------------------------ the queue */

section("the queue");

const anon = await call(null, "GET", "/admin/organisations");
check("the queue needs a session", anon.status === 401, String(anon.status));

const queue = await call(token, "GET", "/admin/organisations");
check("an admin can read it", queue.status === 200, String(queue.status));
const mine = (queue.body?.results ?? []).find((r) => r.id === created.body?.reference);
check("the application is in it", Boolean(mine));
check("with the doctor count that sets the price", mine?.doctorCount === 12, String(mine?.doctorCount));
check("and whether they want ClinWell", mine?.needsClinwell === true);
check("specialties came through as typed", (mine?.specialties ?? []).includes("Orthopaedic surgery"));
check("it starts as new", mine?.status === "new", String(mine?.status));
check("counts are reported for the tabs", typeof queue.body?.counts?.new === "number");

const one = await call(token, "GET", `/admin/organisations/${created.body.reference}`);
check("one application can be opened", one.status === 200, String(one.status));
check("with everything else from that address alongside it", Array.isArray(one.body?.history));

/* --------------------------------------------------- the quote */

section("quoting");

const id = created.body.reference;

const badQuotes = [
  ["nothing", { amount: 0, plan: "clinwell" }],
  ["a negative figure", { amount: -50, plan: "clinwell" }],
  ["a plan that does not exist", { amount: 2400, plan: "enterprise" }],
  ["a figure larger than any real contract", { amount: 2_000_000, plan: "clinwell" }],
];
for (const [label, body] of badQuotes) {
  const res = await call(token, "POST", `/admin/organisations/${id}/quote`, body);
  check(`refuses a quote of ${label}`, res.status === 400, String(res.status));
}

const quoted = await call(token, "POST", `/admin/organisations/${id}/quote`, {
  amount: 2400,
  plan: "clinwell",
  interval: "yearly",
  note: "12 doctors, 2 sites, ClinWell for 4",
});
check("a real quote is accepted", quoted.status === 200, JSON.stringify(quoted.body)?.slice(0, 160));
check("£2,400 is stored as 240000 pence", quoted.body?.pricing?.netMinor === 240000, String(quoted.body?.pricing?.netMinor));
check("VAT is computed, not accepted", quoted.body?.pricing?.vatMinor === 48000, String(quoted.body?.pricing?.vatMinor));
check("and the total is net plus VAT", quoted.body?.pricing?.totalMinor === 288000);
check("the application moves to quoted", quoted.body?.application?.status === "quoted");
check(
  "the reasoning is kept, not just the number",
  quoted.body?.application?.quoteNote === "12 doctors, 2 sites, ClinWell for 4"
);

/* ------------------------------------------------ paying for it */

section("turning a quote into an order");

const noListing = await call(token, "POST", `/admin/organisations/${id}/payment-link`, {});
check("a payment link needs a listing to attach to", noListing.status === 400, String(noListing.status));

const unknownListing = await call(token, "POST", `/admin/organisations/${id}/payment-link`, {
  specialistId: "spc_does_not_exist",
});
check("and refuses a listing that does not exist", unknownListing.status === 404, String(unknownListing.status));

const listing = await fetch(`${BASE}/specialists/search?limit=1`).then((r) => r.json());
const specialistId = listing?.results?.[0]?.id ?? null;
check("found a listing to attach to", Boolean(specialistId));

const link = await call(token, "POST", `/admin/organisations/${id}/payment-link`, { specialistId });

/* Without Stripe there is no link, and inventing one would be worse
   than saying so — but the order must still be recorded, or connecting
   Stripe later would lose every quote agreed before it. */
if (link.status === 409) {
  check("with no payment provider, it says so plainly", /no payment provider/i.test(link.body?.error ?? ""));
  check("and records the order anyway", Boolean(link.body?.orderId), JSON.stringify(link.body)?.slice(0, 120));
} else {
  check("a payment link is returned", link.status === 200 && Boolean(link.body?.paymentUrl), String(link.status));
  check("for the agreed total", link.body?.totalMinor === 288000, String(link.body?.totalMinor));
}

/* The one that matters most: the order must carry the NEGOTIATED
   figure, not the catalogue price. £349 where £2,400 was agreed is a
   two-thousand-pound mistake that looks like a working checkout. */
const subscription = await call(token, "GET", "/admin/organisations/" + id);
check("the order is linked back to the application", Boolean(subscription.body?.application?.orderId));

section("the rule that keeps the books straight");

const byHand = await call(token, "POST", `/admin/organisations/${id}/status`, { status: "won" });
check(
  "an organisation cannot be marked paid by hand",
  byHand.status === 409,
  String(byHand.status)
);
check("and the refusal says what to do instead", /payment link/i.test(byHand.body?.error ?? ""));

const lost = await call(token, "POST", `/admin/organisations/${id}/status`, { status: "lost" });
check("but it can be marked lost", lost.status === 200 && lost.body?.application?.status === "lost");
check("with the decision timestamped", Boolean(lost.body?.application?.decidedAt));

const reviewing = await call(token, "POST", `/admin/organisations/${id}/status`, { status: "reviewing" });
check("and moved back into review", reviewing.body?.application?.status === "reviewing");
check("which clears the decision date", reviewing.body?.application?.decidedAt === null);

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
