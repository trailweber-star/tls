# ClinWell integration — what is settled, and what is built

The contract is ClinWell's document, **v1.0.1, 14 September 2026**.
This file is not a copy of it. It records the decisions the code has to
satisfy and points at the files that satisfy them, so nobody has to
reconstruct either from a chat log.

**The PDF wins.** If a line here contradicts v1.0.1, the PDF is right
and this file is stale — fix it.

- Contract: *TLS ↔ ClinWell integration contract v1.0.1*. §6.6 holds the
  ordering and late-arrival rules; Appendix A the signature scheme;
  Appendix B our own §5 badge spec, which forms part of the contract.
- Our badge spec: `TLS-Section-5-verified-badge-spec` (12 Sep 2026) —
  the source Appendix B was drawn from.
- Counterpart: Sahil (Synthiq), who builds and runs ClinWell. Dr
  Moholkar copied on contract questions.

## Corrections to earlier notes

Three things written down from conversation before v1.0.1 arrived were
wrong. Listed because a stale note is worse than no note:

- **72 hours is the badge expiry, not a signature window.** The
  signature window is **300 seconds** in both directions (Appendix A).
  72 hours is how long TLS keeps showing the badge without a successful
  batch naming the practice (Appendix B).
- **Their enquiry route's 500 is narrower than it looked.** A completed
  duplicate answers `200 {duplicate: true}`. The 500 fires only when a
  retry lands while the first delivery is still in flight, and the
  documented handling is to wait 30 seconds. The 409-not-500 point still
  stands and Sahil has accepted it, but a 500 there is not "cannot tell
  a duplicate from a failure".
- **The embed is a full ClinWell URL**, not a path on our host:
  `https://app.clinwell.ai/book/{clinicSlug}/enquiry`.

## Transport

| | |
|---|---|
| Outbound events | `POST {base}/api/partners/tls/events`, one event per request, `eventId` idempotency |
| Outbound enquiries | `POST {base}/api/webhooks/tls` (§4.3) |
| Outbound reads | §4.2 workspace status, §4.4 availability — bearer partner key |
| Inbound badge | `POST /api/partners/clinwell/practices/status`, batched, `batchId` idempotency, per-item results |
| Signing | HMAC-SHA256 over `<unix>.<raw body>`, lowercase hex, **300-second** window. `tls-signature` outbound, `clinwell-signature` inbound |
| Signing secrets | dual-valued (current + previous) both directions, so rotation is zero-downtime |
| Bearer keys | **single-valued** — they rotate by coordinated cutover (§3). No `_PREVIOUS`. |
| Retries | 5xx or timeout: 1 min, 5 min, 30 min, 2 h, 12 h. Stop on 2xx. Stop **and alert** on 401 or any other 4xx |
| Rate limits | 60/min assumed, 30/min on availability; 429 carries `Retry-After` |

The Appendix A worked example is asserted in
`backend/scripts/clinwell-test.mjs` and matches exactly
(`81c3d860…cf377ac3`, body 158 bytes). If that check passes, our
signatures are ones ClinWell will accept.

## Ordering — the rule that shapes the sender

ClinWell applies our events **by `occurredAt`, not by arrival order**
(§6.6), so a late retry cannot overwrite a newer state. That holds only
if we cooperate, in three ways:

1. `occurredAt` is stamped **when the state change is written**, not
   when the request is sent.
2. A retry carries the **original** `occurredAt`. Never refreshed —
   which is why the serialised body is stored on the outbox row and
   reused verbatim rather than rebuilt.
3. `occurredAt` is **strictly increasing per practice**. Enforced by a
   unique index on `(specialist_id, occurred_at)`, not by a comment: a
   tie is a state ClinWell has to break arbitrarily, and between
   "cancelled" and "resumed" that is the difference between a practice
   keeping access and losing it.

The contract's own examples use second precision, so that is what we
send; a second change colliding on the same second for one practice is
advanced by a second rather than left ambiguous.

## Event semantics

Which event a payment *is* depends on state that the payment itself
erases, so it is decided from the row as it was **before** the patch —
see `backend/src/lib/clinwellLifecycle.js`.

| Before the payment | Event |
|---|---|
| no `clinwellWorkspaceId` | `subscription.activated` |
| `planStatus = past_due` | `payment.recovered` |
| `planStatus = canceled` | `subscription.resumed` |
| already active | nothing — an ordinary renewal needs no event |

**`payment.recovered`** restores access from a **payment-caused**
suspension only. It never undoes a cancellation, and is **never
followed by `subscription.resumed`** — chaining them would clear a
cancellation the practice actually asked for. Valid even after ClinWell
has suspended on `dueAt` + 14.

**`subscription.resumed`** means exactly one thing: *un-cancel*. Sent
before `effectiveAt` on a pending cancellation it clears the
cancellation and the scheduled suspension does not fire. It does not
change payment standing; a running grace period still resolves on
`payment.recovered` or on its own clock. Billing standing and
cancellation are tracked independently on their side and `status` is
derived from both.

**`subscription.cancelled`** also covers a downgrade to a plan without
ClinWell (§6.4). `effectiveAt` is the last day already paid for;
ClinWell keeps access to the end of that day and withdraws nothing
early.

**`payment.failed`** carries `dueAt`, the renewal date that failed.
ClinWell holds access for 14 days from it and then suspends on its own
clock — TLS sends no second event (§6.3). That one date decides whether
a practice loses clinical software a fortnight early or a fortnight
late.

**Still open with Sahil:** what `payment.recovered` does when nothing is
suspended (recovery inside the grace window). A 2xx no-op is assumed;
if it is an error instead, the sender's retry decision changes.

## Payload rules

Top level, siblings of `plan`, present as `null` on `activated`:
`dueAt`, `effectiveAt`. **Never inside `plan`** — nesting them is a
silent no-op, and it is asserted by a test.

On `resumed`, `cancelled`, `payment.failed` and `payment.recovered`,
only `practice.slug` and the date field are read, so those events carry
nothing else. **Regulator and registration numbers are never sent** —
§4.1 forbids it; ClinWell does not store them.

`practice.displayName` (the clinic name as it should appear) is required
on `activated` and is new in v1.0.1. `plan.interval` is `monthly` or
**`annual`** — this application says `yearly`, so it is mapped.

`§4.3` enquiries keep **snake_case** (`enquiry_id`, `submitted_at`,
`listing_id`), alone among the endpoints; only `workspaceId` is
camelCase. `message` and `listing_id` are top-level, outside `enquirer`.

## Identifiers

- `workspaceId` is a **UUID v4**, issued once on `activated`, never
  changed, echoed in every status push. No `ws_` prefix — the examples
  in our own §5 draft used one and were wrong.
- The practice slug for §4.3 and §4.4 is **`dkc`**, exactly as
  registered on ClinWell's side. **No normalising on either side.**
  Future practices: they give us the slug at pre-registration.
- **An ambiguity worth resolving with Sahil.** Appendix B calls the
  pushed slug "the TLS slug", while §7 says `clinicSlug` is the same
  string as `practice.slug` and for Dr Moholkar it is `dkc` — which is
  not this site's own slug for that listing. We therefore store a
  `clinwell_slug` column (null meaning "same as ours") and match an
  inbound push against either. That is tolerant of both readings, but
  one reading is correct and it would be better to know which.
- Embed: `https://app.clinwell.ai/book/dkc/enquiry` in an iframe on
  `toplocalspecialists.com`. It **404s until ClinWell switches the
  integration on**; Synthiq confirms when. Gated on
  `clinwell_live` so no patient ever meets that 404.
- **Also open:** who flips `clinwell_live` at go-live. §7 says "Synthiq
  confirms when", which reads as manual. Asked whether anything inbound
  will say so instead.

## The boundary that must not erode

ClinWell state lives in its own columns and **never touches
`verificationStatus`**. "Runs on ClinWell" says a practice pays for
clinical software; "verified" says a human checked a licence against a
regulator's register. A lapsed direct debit must not be able to
un-verify a clinician.

This is enforced by shape, not by care: the inbound push's only write
path is the `clinwellBadges` repo, whose `set` picks five columns out by
name and cannot address any other. Confirmed as correct by ClinWell, and
the test asserts that a push carrying `verificationStatus`, `plan` and
`email` changes none of them.

Only `clinwellLive` is public. The workspace id, the registered slug and
the internal status are stripped by `profileGate` — building this found
that `clinwellWorkspaceId` had been on public profile responses since
the column was added.

## Gates before anything goes live

1. **No live enquiries are forwarded** until ClinWell sends the
   processor-terms reference and the exact line for our privacy notice.
   That text is TLS's to publish, with Kirti's sign-off. Forwarding
   requires both `CLINWELL_ENQUIRY_FORWARDING` **and**
   `CLINWELL_PROCESSOR_TERMS_REF`; the switch alone does nothing,
   because a feature flag is not a lawful basis.
2. Credentials move by **one-time link from a password manager, 24-hour
   expiry, password sent separately**, same method both directions.
   Never chat, never email.
3. **Staging does not exist yet** (§2: "being set up"). Everything below
   is unit- and HTTP-tested locally; none of it has spoken to ClinWell.
   Do not build against production.

## What is built

| Piece | File |
|---|---|
| Signature, both directions, dual secrets | `backend/src/lib/clinwellSignature.js` |
| Event envelopes, field limits, locked placement | `backend/src/lib/clinwellEvents.js` |
| Which event a transition is | `backend/src/lib/clinwellLifecycle.js` |
| Outbox, retry ladder, dead-letter | `backend/src/lib/clinwellSender.js` |
| Badge receiver (Appendix B) + 72h expiry | `backend/src/controllers/clinwellStatus.controller.js` |
| Enquiry forwarding + the gate | `backend/src/lib/clinwellEnquiries.js` |
| Real client for §4.2 reads | `backend/src/lib/clinwellProvider.js` |
| §6.2 renewal reminders | `sweepRenewalReminders()` in `backend/src/lib/reminders.js` |
| Schema | `backend/drizzle/0007_clinwell_integration.sql` |
| 120 checks | `backend/scripts/clinwell-test.mjs` — `npm run clinwell:test` |

## Not built, deliberately

- **Review publishing to TLS** — out of scope in v1.0.1 (§5: "Do not
  build a receiving endpoint yet"), held pending governance sign-off on
  ClinWell's side.
- **The TLS practices read endpoint** — §5 says ClinWell has no consumer
  for it; the `activated` event already carries what they need.
- **§4.4 availability** — specified and read-only, but nothing in the
  product surfaces indicative slots yet, and booking happens on
  ClinWell's own pages (§7).
- **§6.1 onboarding copy** — the two things the contract requires us to
  tell a practitioner (sign in with the same email the invitation went
  to; ClinWell may require two-step verification) are not yet anywhere
  in the dashboard. This is a writing job, not a building one, and it
  matters: a practitioner who signs in with a different Google account
  is not recognised.
