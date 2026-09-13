/* ------------------------------------------------------------------ *
 * POST /api/partners/clinwell/practices/status
 *
 * The inbound half of the integration: ClinWell pushes one row per
 * practice every night at 03:00 UK time, for every practice it has
 * ever provisioned for TLS (contract v1.0.1 Appendix B). The payload
 * is state, not an event, so repeats are harmless.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * This endpoint may write `clinwellLive` and nothing else. It cannot
 * touch verificationStatus, publication, plan or contact details.
 *
 * That is not a convention here, it is the shape of the code: the only
 * write path is the clinwellBadges repo, whose `set` picks five columns
 * out by name and cannot address any other. A future edit that wanted
 * to touch verificationStatus from this handler would have to add a
 * second, differently-named write to do it — which is a thing a
 * reviewer can see in a diff.
 *
 * Why it matters enough to design around: "Runs on ClinWell" says a
 * practice pays for clinical software. "Verified" says a human checked
 * a licence against the GMC register. If a lapsed direct debit could
 * clear a verification, then a billing failure at a software vendor
 * would silently downgrade a clinician's public credibility on a
 * healthcare directory. There is no acceptable version of that bug, so
 * the two values do not share a write path.
 *
 * ORDER AND REPEATS
 *
 * `updatedAt` per practice lets a late batch be ignored rather than
 * applied — same principle ClinWell applies to our events (§6.6), in
 * the other direction. `batchId` is the idempotency key: a repeat
 * returns the FIRST response with `duplicate: true`, and a repeat
 * arriving while the first is still in flight gets 409 and is told to
 * wait 30 seconds. That 409 is the rule we asked ClinWell to adopt on
 * their enquiry route, so it would be poor form not to honour it here.
 * ------------------------------------------------------------------ */
import { isDbConfigured } from "../config/db.js";
import { clinwellBadges as badgeRepo, clinwellBatches as batchRepo } from "../db/repos.js";
import { verify, secretsFrom } from "../lib/clinwellSignature.js";

/** Appendix B. A batch over this is malformed, not merely large. */
const MAX_PRACTICES = 500;

/** Appendix B: the badge dies 72 hours after the last batch naming it. */
export const BADGE_TTL_MS = 72 * 3600_000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------ auth */

/**
 * Bearer key, then signature. Both answer 401 with the same body: which
 * one failed is useful to us in the log and to an attacker on the wire,
 * so it goes in the log only.
 *
 * The bearer key is a single value — §3 rotates bearer keys by
 * coordinated cutover, and only signing secrets are dual-valued.
 */
function authenticate(req) {
  const expected = String(process.env.CLINWELL_INBOUND_KEY ?? "").trim();
  if (!expected) return { ok: false, reason: "no-inbound-key-configured" };

  const header = String(req.get("authorization") ?? "");
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  if (!presented || presented !== expected) return { ok: false, reason: "bad-key" };

  const secrets = secretsFrom("CLINWELL_INBOUND_SECRET", "CLINWELL_INBOUND_SECRET_PREVIOUS");
  /* The signature covers the raw bytes. req.rawBody is captured by the
     json parser in app.js precisely so this check is possible; without
     it, re-encoding the parsed body would change key order and nothing
     would ever verify. */
  const signature = verify(req.rawBody ?? "", req.get("clinwell-signature"), secrets);
  if (!signature.ok) return { ok: false, reason: `signature:${signature.reason}` };

  return { ok: true, secret: signature.secret };
}

/* ------------------------------------------------------ validation */

function readBatch(body) {
  const problems = [];

  const batchId = String(body?.batchId ?? "").trim();
  if (!batchId) problems.push("batchId is required");
  if (batchId.length > 128) problems.push("batchId exceeds 128 characters");

  const practices = body?.practices;
  if (!Array.isArray(practices)) {
    problems.push("practices must be an array");
  } else if (practices.length === 0) {
    problems.push("practices is empty");
  } else if (practices.length > MAX_PRACTICES) {
    problems.push(`practices has ${practices.length} items, limit ${MAX_PRACTICES}`);
  }

  return { batchId, practices: Array.isArray(practices) ? practices : [], problems };
}

/* --------------------------------------------------- one practice */

/**
 * Decide one row's outcome. Pure: it reads the stored specialist and
 * the pushed row and returns a decision plus the patch to apply, so
 * the five outcomes in Appendix B can be tested without a database.
 */
export function decide(stored, pushed, { now = new Date() } = {}) {
  if (!stored) return { outcome: "unknown_practice" };

  const pushedWorkspace = String(pushed?.workspaceId ?? "").trim();

  /* Cross-check against what we stored at activation. A push naming a
     different workspace for a slug we already know is either a mix-up
     on their side or a slug collision on ours; either way, applying it
     would attach one practice's clinical workspace to another's public
     listing. Refuse and let a person look. */
  if (stored.clinwellWorkspaceId && pushedWorkspace && stored.clinwellWorkspaceId !== pushedWorkspace) {
    return { outcome: "workspace_mismatch" };
  }

  /* A workspaceId that is not a UUID cannot be one ClinWell issued
     (§4.1), so it is not trustworthy enough to store. */
  if (pushedWorkspace && !UUID_V4.test(pushedWorkspace)) {
    return { outcome: "workspace_mismatch" };
  }

  /* Out-of-order delivery: a batch generated before the state we
     already hold tells us nothing new. */
  const updatedAt = pushed?.updatedAt ? new Date(pushed.updatedAt) : null;
  if (updatedAt && !Number.isNaN(updatedAt.getTime()) && stored.clinwellStatusAt) {
    if (updatedAt.getTime() < new Date(stored.clinwellStatusAt).getTime()) {
      return { outcome: "stale" };
    }
  }

  const live = pushed?.verified === true;
  const status = pushed?.status ? String(pushed.status) : null;

  /* Every successful mention refreshes the 72-hour window, including
     one that changes nothing — the practice was named, which is what
     the expiry measures. */
  const patch = {
    clinwellLive: live,
    clinwellLiveAt: live ? (stored.clinwellLive ? (stored.clinwellLiveAt ?? now) : now) : null,
    clinwellBadgeExpiresAt: new Date(now.getTime() + BADGE_TTL_MS),
    clinwellStatus: status,
    clinwellStatusAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : now,
  };

  const same = stored.clinwellLive === live && (stored.clinwellStatus ?? null) === status;
  return { outcome: same ? "unchanged" : "applied", patch };
}

/* ------------------------------------------------------- the route */

export async function receivePracticeStatus(req, res) {
  const auth = authenticate(req);
  if (!auth.ok) {
    console.warn(`[clinwell] rejected a status push — ${auth.reason}`);
    return res.status(401).json({ error: "Bad key or signature." });
  }

  const { batchId, practices, problems } = readBatch(req.body);
  if (problems.length) return res.status(400).json({ error: problems.join("; ") });

  if (!isDbConfigured()) {
    /* Demo mode has no practices to update and must not pretend it
       applied anything. 503 is the honest answer, and Appendix B lists
       it as retryable. */
    return res.status(503).json({ error: "This deployment has no database configured." });
  }

  /* The insert is the lock: two concurrent deliveries of one batch race
     on the primary key, exactly one wins, and the loser can be told
     definitively whether the winner is still working or already done. */
  const claim = await batchRepo.claim(batchId, practices.length);
  if (!claim.claimed) {
    if (claim.row?.completedAt && claim.row.response) {
      return res.status(200).json({ ...claim.row.response, duplicate: true });
    }
    res.set("retry-after", "30");
    return res.status(409).json({ error: "That batchId is still being processed. Retry in 30 seconds." });
  }

  const now = new Date();
  const results = [];
  let applied = 0;
  let unchanged = 0;
  let rejected = 0;

  try {
    for (const pushed of practices) {
      const slug = String(pushed?.slug ?? "").trim();
      const stored = slug ? await badgeRepo.forSlug(slug).catch(() => null) : null;
      const decision = decide(stored, pushed, { now });

      if (decision.outcome === "applied" || decision.outcome === "unchanged") {
        /* The ONLY write this endpoint performs. Five named columns,
           and nothing that could reach verificationStatus. */
        await badgeRepo.set(stored.id, decision.patch);
        if (decision.outcome === "applied") applied += 1;
        else unchanged += 1;
      } else {
        rejected += 1;
      }

      results.push({ slug, outcome: decision.outcome });
    }
  } catch (err) {
    /* Release the claim so the retry ClinWell is about to make is not
       met with a 409 for a batch nobody is working on any more. */
    await batchRepo.release(batchId).catch(() => {});
    console.error("[clinwell] status batch failed part-way:", err?.message ?? err);
    return res.status(503).json({ error: "Could not apply the batch. Retry." });
  }

  const response = {
    batchId,
    receivedAt: now.toISOString(),
    applied,
    unchanged,
    rejected,
    results,
  };

  await batchRepo.complete(batchId, response);

  if (rejected > 0) {
    const kinds = results.filter((r) => r.outcome !== "applied" && r.outcome !== "unchanged");
    console.warn(`[clinwell] status batch ${batchId}: ${rejected} rejected — ${kinds.map((k) => `${k.slug}:${k.outcome}`).join(", ")}`);
  }

  return res.status(200).json(response);
}

/**
 * Expire badges nobody has confirmed for 72 hours.
 *
 * Without this, a ClinWell outage that stops the nightly push would
 * leave "Runs on ClinWell" on the public site indefinitely — a claim
 * about a live integration, still displayed long after anyone last
 * confirmed it was live. Exported so it can be run on demand and in
 * tests.
 */
export async function expireStaleBadges({ now = new Date() } = {}) {
  if (!isDbConfigured()) return { expired: 0 };
  const stale = await badgeRepo.expiredBefore(now);
  for (const row of stale) {
    await badgeRepo.set(row.id, {
      clinwellLive: false,
      clinwellLiveAt: null,
      clinwellBadgeExpiresAt: null,
      clinwellStatus: row.clinwellStatus ?? null,
      clinwellStatusAt: row.clinwellStatusAt ?? null,
    });
  }
  if (stale.length) console.log(`[clinwell] expired ${stale.length} badge(s) unconfirmed for 72h`);
  return { expired: stale.length };
}
