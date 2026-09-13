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
- **There are two slugs, not one.** The first build assumed a single
  slug per practice that TLS would sometimes substitute for ClinWell's.
  Wrong in both directions: see "Identifiers" below. The correction
  removed a fallback that would have built booking URLs out of our own
  slug — a guaranteed 404 shown to patients.
- **The event path was writing the badge's own clock.** Storing
  `clinwellStatusAt` from an event response put OUR timestamp in the
  column the nightly batch is compared against for out-of-order
  delivery. A batch generated at 03:00 would then look older than a
  status written at 14:00, and every push after that would be discarded
  as `stale` while the integration appeared to work. The batch now owns
  those two columns outright; the event path stores only the workspace
  id, and a test asserts it.

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

**`payment.recovered` when nothing is suspended** — settled. It answers
`200 {workspaceId, status: "active"}`, clears the grace clock and does
nothing else. The same 200 when no grace period is running at all. Never
an error: **drop it after one 2xx**, which is what the sender does.

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

## Identifiers — and the two slugs

There are **two slugs** and neither substitutes for the other. This is
the single easiest thing to get wrong in the integration, and both
readings of v1.0.1 as written are wrong; Sahil settled it directly:

| | whose | where it is used |
|---|---|---|
| `practice.slug` | **ours** — `/specialists/<slug>` | every event we send, and the nightly badge push coming back. Never substituted. |
| `clinicSlug` | **ClinWell's** — `dkc` for Dr Moholkar | one place only: the §7 embed URL `app.clinwell.ai/book/<clinicSlug>/enquiry`. Never sent to them; they already have it. |

They are joined **on ClinWell's side by the workspace row**, not by
being the same string. Nothing on this site gets renamed. Sahil has
withdrawn the earlier instruction to make TLS use `dkc`, and §7 will be
corrected in the next revision.

The handshake for a new practice is therefore: we send Synthiq our
listing slug → they store it against their clinic record → their badge
push carries our slug back → an admin enters their clinic slug here for
the embed.

Stored as `specialists.clinwell_clinic_slug`, set by an admin on the
member record. Null means **no booking embed**, never "fall back to our
slug" — our slug on their host is a guaranteed 404, and the code has no
fallback path that could produce one.

- `workspaceId` is a **UUID v4**, issued once on `activated`, never
  changed, echoed in every status push. No `ws_` prefix — the examples
  in our own §5 draft used one and were wrong.
- The embed **404s until ClinWell switches the practice on**. Gated on
  `clinwell_live` so no patient meets that 404.

### Going live for a practice — settled

Nothing inbound announces it. Sahil messages us, and then the **next
03:00 batch carries that practice with `verified: true`**. That batch is
the machine signal, and `clinwell_live` is **only ever written by the
batch** — there is deliberately no manual flip anywhere in this
codebase, and none should be added.

One operational consequence worth knowing before the day arrives: the
embed needs BOTH the badge live and a clinic slug. The badge arrives by
itself overnight; the clinic slug does not. **Enter the clinic slug on
the member record in advance**, or the practice goes live with the badge
showing and no booking widget, and nobody will connect the two.

Enquiry forwarding is a **separate switch** from the badge and stays
shut until Sahil's message *and* the DPA reference — going live on
ClinWell does not open it.

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
| Enquiry forwarding, wired into lead creation | `backend/src/controllers/leads.controller.js` |
| Admin: the ClinWell slug + integration state | `updateMemberClinwell` in `backend/src/controllers/members.controller.js` |
| Admin: events that died, and requeue | `backend/src/controllers/clinwellAdmin.controller.js` |
| The dashboard panel, incl. §6.1 sign-in copy | `frontend/src/components/dashboard/ClinWellPanel.tsx` |
| "Runs on ClinWell" badge + §7 embed | `frontend/src/pages/SpecialistProfile.tsx` |
| Schema | `backend/drizzle/0007_clinwell_integration.sql`, `0008_clinwell_enquiry_forwarding.sql` |
| 162 checks | `backend/scripts/clinwell-test.mjs` — `npm run clinwell:test` |

## The backlog that must never be forwarded

On the day enquiry forwarding is switched on, this table will already
hold enquiries submitted by patients under a privacy notice that said
nothing about ClinWell. Forwarding them would be a retrospective
disclosure nobody consented to, and it would happen in one sweep, in
seconds.

So permission is stamped on the enquiry **at creation**, in
`leads.clinwellForwardableAt`, and only when the gate is already open.
Null means never — which is every row that exists today. The sweep
cannot select them however it is called, and a second guard caps age at
48 hours so a queue that stalls over a weekend does not deliver the
weekend's enquiries in one burst on Monday. Both are asserted by tests.

A date comparison at send time would have done the same job until
somebody got the comparison wrong once.

## Not built, deliberately

- **Review publishing to TLS** — out of scope in v1.0.1 (§5: "Do not
  build a receiving endpoint yet"), held pending governance sign-off on
  ClinWell's side.
- **The TLS practices read endpoint** — §5 says ClinWell has no consumer
  for it; the `activated` event already carries what they need.
- **§4.4 availability** — specified and read-only, but nothing in the
  product surfaces indicative slots yet, and booking happens on
  ClinWell's own pages (§7).

## Found while building

Three bugs that were not in the brief:

- `clinwellWorkspaceId` had been on public profile responses since the
  column was added, because the serialiser spreads the row. Now stripped
  with the four new internal columns.
- The badge lookup selected `specialists.slug` only, so this file's own
  claim to "match an inbound push against either slug" was not actually
  implemented. It now matches the registered slug first, then ours.
- The admin ClinWell block worked out the slug and the embed URL
  separately and they disagreed once the registered slug was set.
