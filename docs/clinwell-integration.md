# ClinWell integration — what is settled

The contract is ClinWell's document, currently **v1.0.1**. This file is
not a copy of it. It records the decisions taken in conversation that
the code must satisfy, so that nobody has to reconstruct them from a
chat log, and so a disagreement between this file and the PDF is
obvious rather than silent.

**The PDF wins.** If a line here contradicts v1.0.1, the PDF is right
and this file is stale — fix it.

- Contract: ClinWell → TLS Integration Contract v1.0.1 (§6.6 ordering
  and late arrival; Appendix B is our §5 badge spec, summarised).
- Our badge spec: `TLS-Section-5-verified-badge-spec` — the source
  Appendix B was drawn from.
- Counterpart: Sahil (Synthiq), who builds and runs ClinWell.

## Transport

| | |
|---|---|
| Endpoint shape | one batch endpoint, per-item results in the response |
| Auth | bearer token **and** `clinwell-signature` |
| Idempotency | `batchId` — ours to generate, one per batch, stable across retries |
| Tracing | `X-Request-Id`, echoed back in their logs |
| Expiry | signed requests valid 72 hours |
| Inbound secrets | they accept **current and previous**, so rotation is zero-downtime in both directions once live. Before go-live: coordinated cutover. |

## Ordering — the rule that shapes the sender

ClinWell applies our events **by `occurredAt`, not by arrival order**.
A late retry therefore cannot overwrite a newer state.

What that requires of us:

1. `occurredAt` is stamped **when the state change is written**, not
   when the request is sent.
2. A retry carries the **original** `occurredAt`. Never refreshed.
3. `occurredAt` is **strictly increasing per workspace**, so two events
   for one practice can never tie and leave the winner undefined.

Breaking any of the three makes our events unorderable on their side,
and the failure is silent.

## Event semantics

**`payment.recovered`** restores access from a **payment-caused**
suspension only.

- It never undoes a cancellation.
- It is **never followed by `subscription.resumed`**. Chaining them
  would clear a cancellation the practice actually asked for.
- Valid even after we have suspended on `dueAt` + 14 — it restores.
- *Open:* behaviour when nothing is suspended (recovery inside the
  grace window). 2xx no-op, or an error? Decides whether the sender
  retries.

**`subscription.resumed`** means exactly one thing: *un-cancel*.

- Sent before `effectiveAt` on a pending cancellation, it clears the
  cancellation; access continues as though they never cancelled, and
  the suspension scheduled for `effectiveAt` does not fire.
- It does **not** change payment standing. A grace period still
  running resolves on `payment.recovered` or on its own clock.

## Field placement — lock the serialiser

Top level, siblings of `plan`:

- `dueAt`
- `effectiveAt`

Top level, **outside** `enquirer`:

- `message`
- `listing_id`

These are covered by a test, not a comment. A serialiser that nests
them is the kind of bug that only shows up as "ClinWell ignored it".

## Identifiers

- `workspaceId` is a **UUID string**. No `ws_` prefix — the examples in
  our own §5 draft used one and are wrong; validate as a UUID.
- Practice slug for §4.3 and §4.4 is **`dkc`**, exactly as registered on
  their side. **No normalising on either side** — not case, not
  punctuation. Future practices: they give us the slug at
  pre-registration and the same rule applies.
- Enquiry embed, once switched on: `/book/dkc/enquiry`. It returns
  **404 until ClinWell switches it on**, so the booking link must stay
  hidden behind `integrations.clinwell.live`.

## The boundary that must not erode

ClinWell subscription state lives in `integrations.clinwell.*` and
**never touches `verificationStatus`**. A practice paying for the
clinical suite is not a verified clinician, and a lapsed subscription
must not be able to un-verify anybody. Confirmed as correct by
ClinWell; it is the one piece of this integration worth refusing to
compromise on.

## Gates before anything goes live

1. **No live enquiries are forwarded** until ClinWell sends the
   processor-terms reference and the exact line for our privacy notice.
   That text is TLS's to publish, with Kirti's sign-off. Enquiry
   forwarding is therefore built behind a flag that is **off by
   default** — the gate is in code, not in anybody's memory.
2. Credentials move by **one-time link from a password manager, 24-hour
   expiry, password sent separately**, the same method in both
   directions. Nothing goes in chat or email.
3. Staging date: to come.

## Known, accepted, not ours to fix

Their enquiry webhook currently answers **500 where it should answer
409** on a duplicate. Sahil will change it the next time that route is
touched. Until then we cannot distinguish a duplicate from a genuine
failure, so the sender dedupes on our side, never re-posts an enquiry
already accepted, and caps retries into an admin-visible failure rather
than retrying a route that will keep answering 500.

## Still to build

- The event sender: v1.0 limits, the retry schedule, `occurredAt`
  discipline above.
- The badge receiver, per §5 / Appendix B.
- Workspace status in the member dashboard.
- §6.2 renewal reminders at 10 days, 3 days, 48 h and 24 h. This is
  **TLS's obligation** under the contract and does not exist yet.
