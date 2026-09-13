/* The ClinWell integration, checked against contract v1.0.1.
 *
 * Two halves. The pure functions are asserted directly — envelopes,
 * signatures, the retry ladder, the badge decision, reminder windows.
 * Then the inbound endpoint is exercised over real HTTP against a
 * server this script starts itself, because signature verification
 * depends on the raw bytes surviving the body parser, and that is
 * exactly the kind of thing a unit test cannot see.
 *
 * The checks worth the most are the negative ones. An integration like
 * this fails by returning 200 and doing the wrong thing: a date nested
 * one level too deep, a retry that looks newer than it is, a badge push
 * that reaches a column it should never touch. Those get their own
 * assertions.
 *
 *   node scripts/clinwell-test.mjs
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.CLINWELL_TEST_PORT ?? 4131;
const BASE = `http://127.0.0.1:${PORT}/api`;

const KEY = "tls_test_inbound_key";
const SECRET = "whsec_inbound_current";
const PREVIOUS = "whsec_inbound_previous";

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};
const section = (name) => console.log(`\n${name}`);

/* ============================================================ pure */

const {
  activated,
  cancelled,
  paymentFailed,
  paymentRecovered,
  resumed,
  e164,
  intervalFor,
  isoDate,
  isoSeconds,
  EnvelopeError,
} = await import("../src/lib/clinwellEvents.js");
const { sign, verify, signedString } = await import("../src/lib/clinwellSignature.js");
const { BACKOFF_MS, attempt } = await import("../src/lib/clinwellSender.js");
const { eventForPayment, practiceSlug } = await import("../src/lib/clinwellLifecycle.js");
const { decide, BADGE_TTL_MS } = await import("../src/controllers/clinwellStatus.controller.js");
const { renewalBucket } = await import("../src/lib/reminders.js");
const { enquiryBody, forwardingGate } = await import("../src/lib/clinwellEnquiries.js");

section("Appendix A — the signature scheme");
{
  const secret = "whsec_test_0123456789abcdef";
  const body =
    '{"eventId":"evt_test_001","event":"subscription.activated","occurredAt":"2026-09-12T08:00:00Z","practice":{"slug":"test-practice","email":"test@example.com"}}';
  check("the worked example is 158 bytes", Buffer.byteLength(body) === 158, String(Buffer.byteLength(body)));
  check("signed string is <unix>.<raw body>", signedString(1789200000, body) === `1789200000.${body}`);

  const signed = sign(body, secret, { now: 1789200000 * 1000 });
  check(
    "produces the contract's v1",
    signed.value === "81c3d86041bf59a0924f66346d7717a695d092a92540190d1fdd6130cf377ac3",
    signed.value
  );
  check("header format is t=…,v1=…", /^t=\d+,v1=[0-9a-f]{64}$/.test(signed.header), signed.header);

  const now = 1789200000 * 1000;
  check("verifies with the current secret", verify(body, signed.header, [secret], { now }).ok);
  check(
    "verifies with the previous secret, so rotation is zero-downtime",
    verify(body, signed.header, ["a-new-secret", secret], { now }).secret === "previous"
  );
  check("rejects a body altered by one byte", !verify(`${body} `, signed.header, [secret], { now }).ok);
  check(
    "rejects a timestamp 301 seconds out",
    verify(body, signed.header, [secret], { now: now + 301_000 }).reason === "timestamp-outside-window"
  );
  check("accepts one 299 seconds out", verify(body, signed.header, [secret], { now: now + 299_000 }).ok);
  check(
    "an unconfigured server rejects rather than trusting an empty secret",
    verify(body, signed.header, [], { now }).reason === "no-secret-configured"
  );
}

section("§4.1 — the envelope, and where the dates live");
{
  const specialist = {
    slug: "dkc",
    fullName: "Kirti Moholkar",
    clinicName: "Droitwich Knee & Shoulder Clinic",
    email: "practice@example.com",
    title: "Mr",
    primarySpecialty: "Orthopaedic surgery",
    phone: "01905 000000",
    locations: [{ address: "1 High Street", city: "Droitwich", postcode: "WR9 8ED", lat: 52.26, lng: -2.15 }],
  };
  const a = activated({
    eventId: "evt_1",
    occurredAt: "2026-09-11T09:30:00.500Z",
    specialist,
    plan: { interval: "yearly", renewsAt: "2027-09-11" },
  });

  check("dueAt is top-level", "dueAt" in a);
  check("dueAt is NOT inside plan", !("dueAt" in a.plan));
  check("effectiveAt is top-level", "effectiveAt" in a);
  check("effectiveAt is NOT inside plan", !("effectiveAt" in a.plan));
  check("both are present as null on activated, as the example shows", a.dueAt === null && a.effectiveAt === null);
  check("plan.name is full_practice_suite", a.plan.name === "full_practice_suite");
  check("yearly becomes annual", a.plan.interval === "annual" && intervalFor("monthly") === "monthly");
  check("renewsAt is YYYY-MM-DD", a.plan.renewsAt === "2027-09-11");
  check("occurredAt is second-precision ISO UTC", a.occurredAt === "2026-09-11T09:30:00Z");

  check("regulator is never sent", !("regulator" in a.practice));
  check("registrationNumber is never sent", !("registrationNumber" in a.practice));
  check("displayName carries the clinic name", a.practice.displayName === specialist.clinicName);
  check("a UK phone is normalised to E.164", a.practice.phone === "+441905000000");
  check("0-prefixed and +44 forms agree", e164("07700 900123") === e164("+44 7700 900123"));
  check("an unusable phone is dropped, not sent malformed", e164("call the clinic") === null);
  check("location name defaults to the city", a.practice.locations[0].name === "Droitwich");
  check("lat and lng are numbers", typeof a.practice.locations[0].lat === "number");

  const c = cancelled({ eventId: "e", occurredAt: new Date(), slug: "dkc", effectiveAt: "2026-10-01" });
  check("cancelled carries effectiveAt top-level", c.effectiveAt === "2026-10-01" && !("plan" in c));
  const f = paymentFailed({ eventId: "e", occurredAt: new Date(), slug: "dkc", dueAt: "2026-09-11" });
  check("payment.failed carries dueAt top-level", f.dueAt === "2026-09-11");

  const r = resumed({ eventId: "e", occurredAt: new Date(), slug: "dkc" });
  check("resumed sends the slug and nothing more", Object.keys(r.practice).length === 1 && !("plan" in r));
  const pr = paymentRecovered({ eventId: "e", occurredAt: new Date(), slug: "dkc" });
  check("payment.recovered sends the slug and nothing more", Object.keys(pr.practice).length === 1);
  check("neither carries a date field", !("dueAt" in r) && !("effectiveAt" in pr));

  const refusals = [
    ["a slug outside ^[a-z0-9-]+$", () => resumed({ eventId: "e", occurredAt: new Date(), slug: "DKC Clinic" })],
    ["cancelled with no effectiveAt", () => cancelled({ eventId: "e", occurredAt: new Date(), slug: "dkc" })],
    ["payment.failed with no dueAt", () => paymentFailed({ eventId: "e", occurredAt: new Date(), slug: "dkc" })],
    [
      "a practice with no locations",
      () =>
        activated({
          eventId: "e",
          occurredAt: new Date(),
          specialist: { ...specialist, locations: [] },
          plan: { interval: "monthly", renewsAt: "2027-01-01" },
        }),
    ],
    [
      "a title over 20 characters",
      () =>
        activated({
          eventId: "e",
          occurredAt: new Date(),
          specialist: { ...specialist, title: "x".repeat(21) },
          plan: { interval: "monthly", renewsAt: "2027-01-01" },
        }),
    ],
  ];
  for (const [label, fn] of refusals) {
    let threw = false;
    try {
      fn();
    } catch (err) {
      threw = err instanceof EnvelopeError;
    }
    check(`refuses to send ${label}`, threw);
  }
  check("isoDate tolerates a Date and a string alike", isoDate(new Date("2026-09-11T23:00:00Z")) === "2026-09-11");
  check("isoSeconds drops milliseconds", isoSeconds("2026-09-11T09:30:00.999Z") === "2026-09-11T09:30:00Z");
}

section("§6.6 — which event a payment actually is");
{
  const fresh = { id: "s1", slug: "dkc", clinwellWorkspaceId: null, planStatus: "pending_payment" };
  const pastDue = { id: "s1", slug: "dkc", clinwellWorkspaceId: "uuid", planStatus: "past_due" };
  const canceled = { id: "s1", slug: "dkc", clinwellWorkspaceId: "uuid", planStatus: "canceled" };
  const active = { id: "s1", slug: "dkc", clinwellWorkspaceId: "uuid", planStatus: "active" };

  check("no workspace yet → activated", eventForPayment(fresh, { planId: "clinwell" }) === "subscription.activated");
  check(
    "past_due → payment.recovered, NOT resumed",
    eventForPayment(pastDue, { planId: "clinwell" }) === "payment.recovered"
  );
  check("canceled → resumed", eventForPayment(canceled, { planId: "clinwell" }) === "subscription.resumed");
  check("an ordinary renewal sends nothing", eventForPayment(active, { planId: "clinwell" }) === null);
  check("a plan without ClinWell sends nothing", eventForPayment(fresh, { planId: "premium" }) === null);
  check("the registered slug wins over ours", practiceSlug({ slug: "mr-k-moholkar", clinwellSlug: "dkc" }) === "dkc");
  check("ours is used when none is registered", practiceSlug({ slug: "mr-k-moholkar" }) === "mr-k-moholkar");
}

section("§4.1 — the retry ladder");
{
  check(
    "1 min, 5 min, 30 min, 2 h, 12 h",
    JSON.stringify(BACKOFF_MS) === JSON.stringify([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000])
  );

  const previous = { ...process.env };
  process.env.CLINWELL_BASE_URL = "https://clinwell.example";
  process.env.CLINWELL_WEBHOOK_SECRET = "whsec_test_0123456789abcdef";

  const row = {
    id: "r1",
    eventId: "evt_1",
    event: "payment.failed",
    specialistId: "s1",
    attempts: 0,
    payload: paymentFailed({ eventId: "evt_1", occurredAt: "2026-09-11T09:30:00Z", slug: "dkc", dueAt: "2026-09-11" }),
  };
  const reply = (status, body = {}, headers = {}) => async () => {
    if (status === "abort") {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (status === "throw") throw new Error("ECONNREFUSED");
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    };
  };

  const expectations = [
    ["200", 200, "delivered"],
    ["202", 202, "delivered"],
    ["409 on activated is the workspace id, not an error", 409, "delivered"],
    ["500", 500, "retry"],
    ["503", 503, "retry"],
    ["429", 429, "retry"],
    ["a timeout", "abort", "retry"],
    ["a refused connection", "throw", "retry"],
    ["401", 401, "dead"],
    ["400", 400, "dead"],
    ["404", 404, "dead"],
  ];
  for (const [label, status, expected] of expectations) {
    const result = await attempt(row, { fetchImpl: reply(status) });
    check(`${label} → ${expected}`, result.outcome === expected, result.outcome);
  }

  const rateLimited = await attempt(row, { fetchImpl: reply(429, {}, { "retry-after": "90" }) });
  check("Retry-After overrides our own schedule", rateLimited.waitMs === 90_000, String(rateLimited.waitMs));

  let sentBody = null;
  let sentHeaders = null;
  await attempt(row, {
    fetchImpl: async (_url, init) => {
      sentBody = init.body;
      sentHeaders = init.headers;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    },
  });
  check("the stored bytes are sent unchanged", sentBody === JSON.stringify(row.payload));
  check("signs with tls-signature outbound", /^t=\d+,v1=[0-9a-f]{64}$/.test(sentHeaders["tls-signature"]));
  check("echoes the event id as X-Request-Id", sentHeaders["x-request-id"] === "evt_1");

  for (const key of ["CLINWELL_BASE_URL", "CLINWELL_WEBHOOK_SECRET"]) delete process.env[key];
  Object.assign(process.env, previous);
}

section("Appendix B — the badge decision");
{
  const now = new Date("2026-09-13T03:00:00Z");
  const WS = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const stored = {
    id: "s1",
    slug: "dkc",
    clinwellWorkspaceId: WS,
    clinwellLive: false,
    clinwellLiveAt: null,
    clinwellStatus: null,
    clinwellStatusAt: null,
  };

  check("an unknown slug → unknown_practice", decide(null, { slug: "nope" }, { now }).outcome === "unknown_practice");
  check(
    "verified true → applied",
    decide(stored, { slug: "dkc", workspaceId: WS, verified: true, status: "active" }, { now }).outcome === "applied"
  );
  check(
    "the same value again → unchanged",
    decide(
      { ...stored, clinwellLive: true, clinwellStatus: "active" },
      { slug: "dkc", workspaceId: WS, verified: true, status: "active" },
      { now }
    ).outcome === "unchanged"
  );
  check(
    "verified false takes the badge down",
    decide({ ...stored, clinwellLive: true }, { slug: "dkc", workspaceId: WS, verified: false }, { now }).patch
      .clinwellLive === false
  );
  check(
    "a different workspace for a known slug → workspace_mismatch",
    decide(stored, { slug: "dkc", workspaceId: "11111111-2222-4333-8444-555555555555", verified: true }, { now })
      .outcome === "workspace_mismatch"
  );
  check(
    "a workspaceId that is not a UUID → workspace_mismatch",
    decide({ ...stored, clinwellWorkspaceId: null }, { slug: "dkc", workspaceId: "ws_dkc", verified: true }, { now })
      .outcome === "workspace_mismatch"
  );
  check(
    "a batch older than what we hold → stale",
    decide(
      { ...stored, clinwellStatusAt: new Date("2026-09-13T03:00:00Z") },
      { slug: "dkc", workspaceId: WS, verified: true, updatedAt: "2026-09-12T03:00:00Z" },
      { now }
    ).outcome === "stale"
  );
  check(
    "a newer batch applies",
    decide(
      { ...stored, clinwellStatusAt: new Date("2026-09-12T03:00:00Z") },
      { slug: "dkc", workspaceId: WS, verified: true, updatedAt: "2026-09-13T03:00:00Z" },
      { now }
    ).outcome === "applied"
  );

  const patch = decide(stored, { slug: "dkc", workspaceId: WS, verified: true, status: "active" }, { now }).patch;
  check("every mention refreshes the 72-hour window", patch.clinwellBadgeExpiresAt - now === BADGE_TTL_MS);
  check("72 hours is three nightly pushes' grace", BADGE_TTL_MS === 72 * 3600_000);

  /* The one that matters most. */
  const keys = Object.keys(patch);
  check("the patch names five columns and no more", keys.length === 5, keys.join(","));
  check("verificationStatus is not among them", !keys.includes("verificationStatus"));
  check("nor plan, publication or contact details", !keys.some((k) => /plan|published|email|phone/i.test(k)));
}

section("§6.2 — renewal reminder windows");
{
  const due = new Date("2026-10-01T09:00:00Z");
  const at = (hoursOut) => renewalBucket(due, due.getTime() - hoursOut * 3600_000)?.bucket ?? "none";
  check("300 hours out → nothing yet", at(300) === "none");
  check("240 hours out → the 10-day notice", at(240) === "10d");
  check("100 hours out → still the 10-day notice", at(100) === "10d");
  check("72 hours out → the 3-day notice", at(72) === "3d");
  check("48 hours out → the 48-hour notice", at(48) === "48h");
  check("24 hours out → the 24-hour notice", at(24) === "24h");
  check("1 hour out → still the 24-hour notice", at(1) === "24h");
  check("past the date → nothing", at(0) === "none" && at(-1) === "none");
  check(
    "a practice first seen 6 days out gets ONE notice, not four",
    [240, 144, 100].map(at).filter((b) => b === "10d").length === 3
  );
}

section("§4.3 — enquiry forwarding, and the gate in front of it");
{
  const previous = { ...process.env };
  delete process.env.CLINWELL_ENQUIRY_FORWARDING;
  delete process.env.CLINWELL_PROCESSOR_TERMS_REF;

  check("off by default", forwardingGate().reason === "forwarding-not-enabled");
  process.env.CLINWELL_ENQUIRY_FORWARDING = "true";
  check(
    "the switch alone is not enough without the processor-terms reference",
    forwardingGate().reason === "no-processor-terms-reference"
  );
  process.env.CLINWELL_PROCESSOR_TERMS_REF = "CW-TLS-DPA-2026-11";
  process.env.CLINWELL_BASE_URL = "https://clinwell.example";
  process.env.CLINWELL_WEBHOOK_SECRET = "whsec_x";
  check("both, plus configuration, opens the gate", forwardingGate().allowed === true);

  /* Restored by deletion, not by Object.assign: assigning the old
     object back puts every previous key in place but leaves the ones
     this block ADDED, and those then leak into the server spawned
     below — which started with forwarding switched on the first time
     this was written. */
  const added = [
    "CLINWELL_ENQUIRY_FORWARDING",
    "CLINWELL_PROCESSOR_TERMS_REF",
    "CLINWELL_BASE_URL",
    "CLINWELL_WEBHOOK_SECRET",
  ];

  const lead = {
    id: "lead_abc",
    patientName: "Jane Doe",
    email: "jane@example.com",
    phone: "07700 900123",
    message: "Knee pain for three months",
    specialistId: "spec_1",
    createdAt: "2026-09-11T10:00:00Z",
  };
  const body = enquiryBody({ lead, workspaceId: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" });
  check("message is top-level", "message" in body);
  check("message is NOT inside enquirer", !("message" in body.enquirer));
  check("listing_id is top-level", "listing_id" in body);
  check("listing_id is NOT inside enquirer", !("listing_id" in body.enquirer));
  check("this endpoint keeps snake_case", "enquiry_id" in body && "submitted_at" in body);
  check("except workspaceId, which is new", "workspaceId" in body);

  let unreachable = false;
  try {
    enquiryBody({ lead: { ...lead, email: null, phone: null }, workspaceId: "w" });
  } catch {
    unreachable = true;
  }
  check("refuses a lead with no email and no phone", unreachable);

  for (const key of added) delete process.env[key];
  Object.assign(process.env, previous);
  check("the gate is shut again afterwards", forwardingGate().allowed !== true, forwardingGate().reason);
}

/* ============================================================ HTTP */

section("the inbound endpoint, over real HTTP");

const server = spawn(process.execPath, ["src/server.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    CLINWELL_INBOUND_KEY: KEY,
    CLINWELL_INBOUND_SECRET: SECRET,
    CLINWELL_INBOUND_SECRET_PREVIOUS: PREVIOUS,
    CLINWELL_PROVIDER: "none",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => {
  serverLog += d.toString();
});
server.stderr.on("data", (d) => {
  serverLog += d.toString();
});

const stop = () => {
  server.kill("SIGTERM");
};
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/specialists/search?limit=1`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (!(await waitForServer())) {
  console.log("\n  could not start a server — is the database reachable?\n");
  console.log(serverLog.split("\n").slice(-12).join("\n"));
  stop();
  process.exit(1);
}

/** Post a batch, signed the way ClinWell will sign it. */
async function push(body, { key = KEY, secret = SECRET, skew = 0, signature = null } = {}) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000) + skew;
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const res = await fetch(`${BASE}/partners/clinwell/practices/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      "clinwell-signature": signature ?? `t=${t},v1=${v1}`,
    },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

/* A real slug to aim at, taken from whatever this deployment holds. */
const listing = await fetch(`${BASE}/specialists/search?limit=1`).then((r) => r.json());
const slug = listing?.results?.[0]?.slug ?? null;
check("found a specialist to test against", Boolean(slug), JSON.stringify(listing)?.slice(0, 120));

const WS = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const batch = (batchId, practices) => ({ batchId, generatedAt: new Date().toISOString(), practices });

{
  const bad = await push(batch("b-auth-1", [{ slug, workspaceId: WS, verified: true }]), { key: "wrong" });
  check("a bad bearer key is 401", bad.status === 401, String(bad.status));

  const unsigned = await push(batch("b-auth-2", [{ slug, workspaceId: WS, verified: true }]), {
    secret: "not-the-secret",
  });
  check("a bad signature is 401", unsigned.status === 401, String(unsigned.status));

  const stale = await push(batch("b-auth-3", [{ slug, workspaceId: WS, verified: true }]), { skew: -400 });
  check("a timestamp outside the 300-second window is 401", stale.status === 401, String(stale.status));

  const rotated = await push(batch("b-auth-4", [{ slug, workspaceId: WS, verified: true }]), { secret: PREVIOUS });
  check("the PREVIOUS secret is accepted, so rotation needs no downtime", rotated.status === 200, String(rotated.status));

  const malformed = await push(batch("b-auth-4", "not an array"));
  check("a non-array practices list is 400", malformed.status === 400, String(malformed.status));

  const empty = await push(batch("", []));
  check("a missing batchId is 400", empty.status === 400, String(empty.status));

  const huge = await push(
    batch("b-huge", Array.from({ length: 501 }, () => ({ slug, workspaceId: WS, verified: true })))
  );
  check("over 500 practices is 400", huge.status === 400, String(huge.status));
}

{
  const id = `b-apply-${Date.now()}`;
  const first = await push(batch(id, [{ slug, workspaceId: WS, verified: true, status: "active" }]));
  check("a valid batch is 200", first.status === 200, JSON.stringify(first.body)?.slice(0, 160));
  check("the response echoes the batchId", first.body?.batchId === id);
  check("and reports a per-item outcome", Array.isArray(first.body?.results) && first.body.results.length === 1);
  check(
    "the outcome is one of the five in Appendix B",
    ["applied", "unchanged", "unknown_practice", "workspace_mismatch", "stale"].includes(
      first.body?.results?.[0]?.outcome
    ),
    first.body?.results?.[0]?.outcome
  );
  check("counts add up to the practice count", first.body?.applied + first.body?.unchanged + first.body?.rejected === 1);

  const repeat = await push(batch(id, [{ slug, workspaceId: WS, verified: true, status: "active" }]));
  check("the same batchId again returns the first response", repeat.status === 200 && repeat.body?.duplicate === true);
  check("and does not re-apply it", repeat.body?.batchId === id && repeat.body?.receivedAt === first.body?.receivedAt);

  const second = await push(batch(`${id}-b`, [{ slug, workspaceId: WS, verified: true, status: "active" }]));
  check("a fresh batch with the same state reports unchanged", second.body?.results?.[0]?.outcome === "unchanged");

  const unknown = await push(batch(`${id}-c`, [{ slug: "no-such-practice-anywhere", workspaceId: WS, verified: true }]));
  check("an unknown slug reports unknown_practice", unknown.body?.results?.[0]?.outcome === "unknown_practice");
  check("and is counted as rejected, not applied", unknown.body?.rejected === 1 && unknown.body?.applied === 0);

  /* A stored workspaceId is what a push gets cross-checked against, and
     this listing has never been activated, so the reachable form of the
     same refusal is a workspaceId that cannot be one ClinWell issued.
     The cross-check itself is asserted directly against decide() above. */
  const mismatch = await push(batch(`${id}-d`, [{ slug, workspaceId: "ws_not_a_uuid", verified: true }]));
  check(
    "a workspaceId that is not a UUID reports workspace_mismatch",
    mismatch.body?.results?.[0]?.outcome === "workspace_mismatch",
    mismatch.body?.results?.[0]?.outcome
  );
}

{
  /* The boundary. A push claiming a practice is verified must not be
     able to change what "verified" means on this site. */
  const before = await fetch(`${BASE}/specialists/${slug}`).then((r) => r.json());
  const status = before?.specialist?.verificationStatus ?? before?.verificationStatus ?? null;

  await push(
    batch(`b-boundary-${Date.now()}`, [
      {
        slug,
        workspaceId: WS,
        verified: true,
        status: "active",
        /* Everything below is a deliberate attempt to reach further
           than Appendix B allows. All of it must be ignored. */
        verificationStatus: "verified",
        plan: "clinwell",
        planStatus: "active",
        email: "attacker@example.com",
        published: true,
      },
    ])
  );

  const after = await fetch(`${BASE}/specialists/${slug}`).then((r) => r.json());
  const afterStatus = after?.specialist?.verificationStatus ?? after?.verificationStatus ?? null;
  check("a badge push cannot change verificationStatus", afterStatus === status, `${status} → ${afterStatus}`);
  check(
    "nor the contact email",
    (after?.specialist?.email ?? after?.email ?? null) === (before?.specialist?.email ?? before?.email ?? null)
  );
  const planId = (r) => (r?.specialist?.plan ?? r?.plan ?? null)?.id ?? null;
  check("nor the plan", planId(after) === planId(before), `${planId(before)} → ${planId(after)}`);

  /* The leak this test found: the public profile spreads the whole row,
     so every ClinWell column added to `specialists` lands on a public
     endpoint unless profileGate strips it. Only the badge belongs
     there. */
  const flat = after?.specialist ?? after ?? {};
  check("the workspace id is not on a public profile", !("clinwellWorkspaceId" in flat));
  check("nor the registered slug", !("clinwellSlug" in flat));
  check("nor the internal status or badge expiry", !("clinwellStatus" in flat) && !("clinwellBadgeExpiresAt" in flat));
  check("but the badge itself is public", "clinwellLive" in flat);
}

/* The sections below read and write through the repos directly, because
   the permission column on an enquiry and the occurredAt of a requeued
   event have no API to observe them through — and they are the two
   things most worth asserting. */
const { connectDB, isDbConfigured: dbConfigured } = await import("../src/config/db.js");
if (dbConfigured()) await connectDB();

section("the admin surface");

const adminToken = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@tls.test", password: "demo1234" }),
})
  .then((r) => r.json())
  .then((d) => d?.token ?? null)
  .catch(() => null);

check("signed in as an administrator", Boolean(adminToken));

async function asAdmin(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

{
  const anon = await fetch(`${BASE}/admin/clinwell`);
  check("the outbox screen needs a session", anon.status === 401, String(anon.status));

  const outbox = await asAdmin("GET", "/admin/clinwell");
  check("an admin can read the outbox", outbox.status === 200, String(outbox.status));
  check("it reports whether ClinWell is configured at all", "eventsConfigured" in (outbox.body?.state ?? {}));
  check(
    "it says WHY forwarding is off rather than just that it is",
    typeof outbox.body?.state?.enquiryForwarding === "string" && outbox.body.state.enquiryForwarding !== "on",
    String(outbox.body?.state?.enquiryForwarding)
  );

  /* An admin screen that showed a signing secret would be a signing
     secret in a browser history and a screenshot. */
  const serialised = JSON.stringify(outbox.body ?? {});
  check("no secret value appears in the response", !/whsec|inbound_current|inbound_previous/.test(serialised));
  check("only presence flags", serialised.includes("inboundSecretPresent"));
}

{
  /* The slug an admin must be able to set, because without it nothing
     can be registered as "dkc" and no staging test is possible. */
  const target = await asAdmin("GET", `/admin/members/${encodeURIComponent(slug)}`);
  check("the member record carries a ClinWell block", Boolean(target.body?.clinwell), String(target.status));
  check(
    "it shows the slug we would actually send",
    typeof target.body?.clinwell?.effectiveSlug === "string",
    JSON.stringify(target.body?.clinwell)?.slice(0, 120)
  );

  const bad = await asAdmin("PATCH", `/admin/members/${encodeURIComponent(slug)}/clinwell`, {
    clinwellSlug: "DKC Clinic",
  });
  check("a slug outside the contract's pattern is refused", bad.status === 400, String(bad.status));
  check("and the refusal explains it is not normalised either side", /not normalised/i.test(bad.body?.error ?? ""));

  const tooLong = await asAdmin("PATCH", `/admin/members/${encodeURIComponent(slug)}/clinwell`, {
    clinwellSlug: "a".repeat(101),
  });
  check("over 100 characters is refused", tooLong.status === 400, String(tooLong.status));

  const set = await asAdmin("PATCH", `/admin/members/${encodeURIComponent(slug)}/clinwell`, { clinwellSlug: "dkc" });
  check("a valid slug is accepted", set.status === 200, String(set.status));
  check("and is echoed back as the effective slug", set.body?.clinwell?.effectiveSlug === "dkc");

  /* The bug this caught the first time: the slug shown and the slug in
     the embed URL were worked out separately and disagreed. */
  const embed = set.body?.clinwell?.embedUrl;
  check(
    "the embed URL uses the same slug it reports",
    !embed || embed.includes("/book/dkc/enquiry"),
    String(embed)
  );

  /* And the inbound push must find the practice by that registered
     slug, which is the reading §7 implies. */
  const byRegistered = await push(batch(`b-registered-${Date.now()}`, [{ slug: "dkc", workspaceId: WS, verified: true }]));
  check(
    "a nightly push naming the REGISTERED slug finds the practice",
    byRegistered.body?.results?.[0]?.outcome !== "unknown_practice",
    byRegistered.body?.results?.[0]?.outcome
  );

  const byOurs = await push(batch(`b-ours-${Date.now()}`, [{ slug, workspaceId: WS, verified: true }]));
  check(
    "and one naming OUR slug still finds it too",
    byOurs.body?.results?.[0]?.outcome !== "unknown_practice",
    byOurs.body?.results?.[0]?.outcome
  );

  await asAdmin("PATCH", `/admin/members/${encodeURIComponent(slug)}/clinwell`, { clinwellSlug: "" });
}

{
  /* Requeue. The rule worth testing is that occurredAt survives: an
     event resent with today's stamp could override a newer state. */
  const { clinwellEvents } = await import("../src/db/repos.js");
  const { paymentFailed: buildFailed } = await import("../src/lib/clinwellEvents.js");
  const { specialists } = await import("../src/db/repos.js");

  const practice = await specialists.findBySlug(slug);
  /* Unique per run: the (specialist_id, occurred_at) index is exactly
     the guarantee this integration relies on, so a fixed timestamp
     makes the second run of this test collide with the first — which
     is the index working, not a bug. */
  const occurredAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 30 * 24 * 3600_000);
  const eventId = `evt_requeue_${Date.now()}`;

  const row = await clinwellEvents.create({
    eventId,
    event: "payment.failed",
    specialistId: practice.id,
    practiceSlug: slug,
    occurredAt,
    payload: buildFailed({ eventId, occurredAt, slug, dueAt: occurredAt }),
  });
  await clinwellEvents.markDead(row.id, { status: 400, error: "bad payload", attempts: 1 });

  const listed = await asAdmin("GET", "/admin/clinwell");
  check(
    "a dead event appears on the admin screen",
    (listed.body?.dead ?? []).some((d) => d.eventId === eventId)
  );
  const shown = (listed.body?.dead ?? []).find((d) => d.eventId === eventId);
  check("with the error that killed it", shown?.lastError === "bad payload", String(shown?.lastError));
  check("and the payload, which for a 400 IS the diagnosis", Boolean(shown?.payload));

  const missing = await asAdmin("POST", "/admin/clinwell/events/nope/requeue");
  check("requeueing an unknown event is 404", missing.status === 404, String(missing.status));

  /* Not configured on this test server, so requeue must refuse rather
     than revive an event nothing will send. */
  const refused = await asAdmin("POST", `/admin/clinwell/events/${row.id}/requeue`);
  check(
    "requeue refuses while ClinWell is unconfigured, instead of silently reviving",
    refused.status === 409,
    String(refused.status)
  );

  await clinwellEvents.revive(row.id);
  const revived = await clinwellEvents.findById(row.id);
  check("reviving clears the death", revived?.deadAt === null);
  check("resets the attempt count", revived?.attempts === 0);
  check(
    "and KEEPS the original occurredAt, so a resend cannot look newer than it is",
    new Date(revived.occurredAt).getTime() === occurredAt.getTime(),
    String(revived?.occurredAt)
  );
}

section("the backlog that must never be forwarded");
{
  /* The safeguard: on the day forwarding is switched on, every enquiry
     already in the table was submitted under a privacy notice that said
     nothing about ClinWell. None of them may be selected, ever. */
  const { leads, clinwellForwarding, specialists } = await import("../src/db/repos.js");
  const practice = await specialists.findBySlug(slug);

  const old = await leads.create({
    patientName: "Predates the gate",
    email: "old@example.com",
    specialistId: practice.id,
    source: "website_enquiry",
    clinwellForwardableAt: null,
  });
  const fresh = await leads.create({
    patientName: "Created after the gate opened",
    email: "new@example.com",
    specialistId: practice.id,
    source: "website_enquiry",
    clinwellForwardableAt: new Date(),
  });

  const due = await clinwellForwarding.due({ limit: 200 });
  const ids = due.map((d) => d.id);
  check("an enquiry stamped forwardable is queued", ids.includes(fresh.id));
  check("one that predates the gate is NEVER queued", !ids.includes(old.id));
  check(
    "every queued enquiry carries the permission",
    due.every((d) => d.clinwellForwardableAt !== null)
  );

  /* Cleared for forwarding, but three days old — a queue that stalled
     over a weekend must not deliver the weekend's enquiries in one
     burst on Monday, to a practice that has already answered them. */
  const ancient = await leads.create({
    patientName: "Forwardable but stale",
    email: "stale@example.com",
    specialistId: practice.id,
    source: "website_enquiry",
    clinwellForwardableAt: new Date(Date.now() - 3 * 24 * 3600_000),
    createdAt: new Date(Date.now() - 3 * 24 * 3600_000),
  });
  const capped = await clinwellForwarding.due({ limit: 200 });
  check(
    "and an enquiry older than the 48-hour cap is left alone",
    !capped.map((c) => c.id).includes(ancient.id)
  );
  check("while a fresh one is still queued", capped.map((c) => c.id).includes(fresh.id));
}

stop();
console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
