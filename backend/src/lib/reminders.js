import { isDbConfigured } from "../config/db.js";
import {
  facilities as facilityRepo,
  leads as leadRepo,
  reviews as reviewRepo,
  specialists as specialistRepo,
  users as userRepo,
} from "../db/repos.js";
import { entitlementsFor } from "./plans.js";
import { buildEnquiryEmail, sendMail } from "./mailer.js";
import { NOTIFICATION_TYPES, notify, notifyAdmins } from "./notifications.js";
import { expireStaleBadges } from "../controllers/clinwellStatus.controller.js";

/* ------------------------------------------------------------------ *
 * Overdue-approval sweep
 *
 * An application nobody has looked at is invisible unless something goes
 * looking for it. This sweep runs on a timer, finds applications that
 * have been waiting longer than the threshold with no decision recorded,
 * and raises one reminder per application.
 *
 * "One" is enforced by the notification key, not by a flag on the
 * specialist — so the sweep can run every hour, or twice after a
 * restart, without stacking duplicates in the admin's bell.
 * ------------------------------------------------------------------ */

const OVERDUE_AFTER_MS = Number(process.env.APPROVAL_REMINDER_HOURS ?? 24) * 3600_000;
const SWEEP_EVERY_MS = Number(process.env.APPROVAL_SWEEP_MINUTES ?? 30) * 60_000;

let timer = null;

/** Applications submitted before the cut-off and still undecided. */
async function overdueApplications() {
  const cutoff = Date.now() - OVERDUE_AFTER_MS;

  if (!isDbConfigured()) {
    const { mockSpecialistsWithRelations } = await import("../data/mock.js");
    return mockSpecialistsWithRelations.filter(
      (s) =>
        s.verificationStatus === "pending" &&
        s.application?.submittedAt &&
        new Date(s.application.submittedAt).getTime() < cutoff
    );
  }

  const pending = await specialistRepo.byStatus("pending");
  return pending.filter(
    (s) => s.application?.submittedAt && new Date(s.application.submittedAt).getTime() < cutoff
  );
}

async function loadAdmins() {
  if (!isDbConfigured()) {
    const { demoAccounts } = await import("../data/accounts.js");
    return demoAccounts.all().filter((u) => u.role === "admin" && u.active);
  }
  return userRepo.admins();
}

/** One pass. Exported so it can be run on demand and in tests. */
export async function sweepOverdueApprovals() {
  const overdue = await overdueApplications();
  if (overdue.length === 0) return { checked: 0, raised: 0 };

  const admins = await loadAdmins();
  if (admins.length === 0) return { checked: overdue.length, raised: 0 };

  let raised = 0;
  for (const specialist of overdue) {
    const waitingHours = Math.floor(
      (Date.now() - new Date(specialist.application.submittedAt).getTime()) / 3600_000
    );
    const results = await notifyAdmins(admins, {
      type: NOTIFICATION_TYPES.APPROVAL_OVERDUE,
      title: `Still waiting: ${specialist.fullName}`,
      body:
        `${specialist.fullName} applied ${waitingHours} hours ago and hasn't been reviewed. ` +
        `Their profile stays hidden from patients until someone decides.`,
      url: `/admin/verifications?status=pending&open=${specialist.id}`,
      subjectId: specialist.id,
      key: `${NOTIFICATION_TYPES.APPROVAL_OVERDUE}:${specialist.id}`,
    });
    if (results.some((r) => r.created)) raised += 1;
  }

  if (raised > 0) console.log(`[reminders] raised ${raised} overdue-approval reminder(s)`);
  return { checked: overdue.length, raised };
}

/* ------------------------------------------------------------------ *
 * Unmoderated-review chase
 *
 * A patient review sits invisible until an admin publishes or rejects
 * it, which makes an unnoticed queue worse than an unnoticed inbox: the
 * patient has been silenced by inaction, and the provider cannot answer
 * a review they cannot see. So a review still pending 24 hours after it
 * was written raises a second, sharper alert — push, email and bell.
 *
 * Exactly once per review. `reminderSentAt` on the row is what stops
 * that, rather than the notification key alone, so the chase does not
 * quietly become a daily one for a review that is simply contentious.
 * ------------------------------------------------------------------ */

const REVIEW_OVERDUE_AFTER_MS = Number(process.env.REVIEW_REMINDER_HOURS ?? 24) * 3600_000;

async function overdueReviews() {
  const cutoff = Date.now() - REVIEW_OVERDUE_AFTER_MS;
  if (!isDbConfigured()) {
    const { overduePendingReviews } = await import("../data/mock.js");
    return overduePendingReviews(cutoff);
  }
  return reviewRepo.overduePending(new Date(cutoff));
}

/** The name of whatever a review is about, for the alert text. */
async function subjectNameOf(review) {
  if (!isDbConfigured()) {
    const { specialists, facilities } = await import("../data/mock.js");
    const row =
      review.subjectType === "facility"
        ? facilities.find((f) => f.id === review.subjectId)
        : specialists.find((s) => s.id === review.subjectId);
    return row?.name ?? row?.fullName ?? "a listing";
  }
  if (review.subjectType === "facility") {
    const f = await facilityRepo.findById(review.subjectId);
    return f?.name ?? "a listing";
  }
  const sp = await specialistRepo.rawById(review.subjectId);
  return sp?.fullName ?? "a listing";
}

export async function sweepOverdueReviews() {
  const overdue = await overdueReviews();
  if (overdue.length === 0) return { checked: 0, raised: 0 };

  const admins = await loadAdmins();
  if (admins.length === 0) return { checked: overdue.length, raised: 0 };

  let raised = 0;
  for (const review of overdue) {
    const waitingHours = Math.floor((Date.now() - new Date(review.createdAt).getTime()) / 3600_000);
    const subjectName = await subjectNameOf(review);
    const results = await notifyAdmins(admins, {
      type: NOTIFICATION_TYPES.REVIEW_OVERDUE,
      title: `Review still unpublished after ${waitingHours}h: ${subjectName}`,
      body:
        `A ${review.rating}-star review of ${subjectName} has been waiting ${waitingHours} hours for a decision. ` +
        `Until it is published or rejected the patient's words are hidden and ${subjectName} cannot reply to them.`,
      url: `/admin/reviews?status=pending&open=${review.id}`,
      subjectId: review.id,
      key: `${NOTIFICATION_TYPES.REVIEW_OVERDUE}:${review.id}`,
    });
    if (results.some((r) => r.created)) {
      raised += 1;
      // Marked whether or not every channel succeeded: the durable bell
      // row exists, and re-chasing daily is not what "strict 24 hours"
      // asked for.
      if (isDbConfigured()) await reviewRepo.markReminded(review.id);
      else (await import("../data/mock.js")).markReviewReminded(review.id);
    }
  }

  if (raised > 0) console.log(`[reminders] raised ${raised} unmoderated-review reminder(s)`);
  return { checked: overdue.length, raised };
}

/* ------------------------------------------------------------------ *
 * Held-enquiry release
 *
 * A Basic listing's enquiry form is capped at 5 a month, and the pricing
 * FAQ promises the ones past the cap are held and released when the cap
 * resets — not turned away. This is the half that keeps that promise:
 * it releases held enquiries as soon as there is room for them, whether
 * that came from a new month or from an upgrade to Premium, and sends
 * the alert that was withheld at the time.
 * ------------------------------------------------------------------ */
const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

export async function releaseHeldEnquiries() {
  if (!isDbConfigured()) return { held: 0, released: 0 };

  const held = await leadRepo.held();
  if (held.length === 0) return { held: 0, released: 0 };

  // Room is counted per specialist as we go, so releasing four enquiries
  // for one person cannot overshoot their cap in a single pass.
  const roomBySpecialist = new Map();
  let released = 0;

  for (const lead of held) {
    if (!lead.specialistId) continue;
    const specialist = await specialistRepo.rawById(lead.specialistId);
    if (!specialist) continue;

    if (!roomBySpecialist.has(specialist.id)) {
      const cap = entitlementsFor(specialist).limit("enquiryMonthlyCap");
      const used = await leadRepo.countThisMonth(specialist.id);
      roomBySpecialist.set(specialist.id, cap == null ? Infinity : Math.max(0, cap - used));
    }

    const room = roomBySpecialist.get(specialist.id);
    if (room <= 0) continue;

    await leadRepo.release(lead.id);
    roomBySpecialist.set(specialist.id, room - 1);
    released += 1;

    if (specialist.contactEmail) {
      await sendMail(
        buildEnquiryEmail({
          specialist,
          lead,
          profileUrl: `${SITE_URL}/specialists/${specialist.slug}`,
        })
      );
    }
  }

  if (released > 0) console.log(`[reminders] released ${released} held enquir(ies)`);
  return { held: held.length, released };
}

/**
 * Start the timer. `unref()` so a pending sweep never keeps the process
 * alive during a shutdown.
 */
export function startReminderSweep() {
  if (timer) return;
  // A first pass shortly after boot catches anything that went overdue
  // while the server was down.
  setTimeout(() => void runSweep(), 20_000).unref?.();
  timer = setInterval(() => void runSweep(), SWEEP_EVERY_MS);
  timer.unref?.();
  console.log(
    `[reminders] sweeping every ${SWEEP_EVERY_MS / 60000}m — approvals older than ` +
      `${OVERDUE_AFTER_MS / 3600000}h, unmoderated reviews older than ${REVIEW_OVERDUE_AFTER_MS / 3600000}h`
  );
}

/* ------------------------------------------------------------------ *
 * Renewal reminders — contract v1.0.1 §6.2
 *
 * "TLS sends the practice reminders at 10 days, 3 days, 48 hours and
 * 24 hours before the renewal date. These are TLS emails; ClinWell
 * sends nothing before the due date."
 *
 * So this is an obligation, not a nicety: if it does not run, nobody
 * warns the practice, the renewal fails, and the first thing they hear
 * about it is a banner inside ClinWell telling them access ends in
 * fourteen days.
 *
 * Each threshold fires in its own window rather than "any time after
 * the threshold is crossed". The difference matters on the day this
 * ships: a practice already six days from renewal would otherwise get
 * the ten-day, three-day, forty-eight-hour and twenty-four-hour
 * notices in the same sweep. With windows, exactly one bucket can match
 * at any moment, so a late start sends one email rather than four.
 *
 * The notification key carries the bucket, which is what stops a sweep
 * running every half hour from re-sending the same notice fifty times.
 * ------------------------------------------------------------------ */

/** Hours before renewal, largest first. Each is its own bucket. */
export const RENEWAL_THRESHOLDS = [
  { bucket: "10d", hours: 240, label: "10 days" },
  { bucket: "3d", hours: 72, label: "3 days" },
  { bucket: "48h", hours: 48, label: "48 hours" },
  { bucket: "24h", hours: 24, label: "24 hours" },
];

/**
 * Which reminder, if any, is due for a renewal date right now.
 *
 * Returns the one bucket whose window contains `now`, or null. Windows
 * are half-open and abut exactly, so no instant belongs to two buckets
 * and none falls between them.
 */
export function renewalBucket(renewsAt, now = Date.now()) {
  const due = new Date(renewsAt).getTime();
  if (!Number.isFinite(due) || now >= due) return null;

  for (const [i, threshold] of RENEWAL_THRESHOLDS.entries()) {
    const opens = due - threshold.hours * 3600_000;
    const next = RENEWAL_THRESHOLDS[i + 1];
    const closes = next ? due - next.hours * 3600_000 : due;
    if (now >= opens && now < closes) return threshold;
  }
  return null;
}

/** Paid subscriptions with a renewal date ahead of them. */
async function renewingSubscriptions() {
  if (!isDbConfigured()) {
    const { mockSpecialistsWithRelations } = await import("../data/mock.js");
    return mockSpecialistsWithRelations.filter((s) => s.planRenewsAt && s.planStatus === "active");
  }
  const rows = await specialistRepo.all();
  return rows.filter((s) => s.planRenewsAt && s.planStatus === "active");
}

/** One pass. Exported so it can be run on demand and in tests. */
export async function sweepRenewalReminders({ now = Date.now() } = {}) {
  const subscriptions = await renewingSubscriptions();
  let checked = 0;
  let raised = 0;

  for (const specialist of subscriptions) {
    /* Only plans that cost money have a renewal worth warning about,
       and entitlementsFor is the only sanctioned way to ask. */
    const entitlements = entitlementsFor(specialist);
    if (entitlements.selectedPlan === "basic") continue;

    checked += 1;

    const threshold = renewalBucket(specialist.planRenewsAt, now);
    if (!threshold) continue;

    /* A notification needs an account to belong to. A listing with no
       user attached is an imported one nobody has claimed, and it has
       no renewal either. */
    if (!specialist.userId) continue;

    const renews = new Date(specialist.planRenewsAt);
    const amount = entitlements.selectedPlanName ?? "your subscription";
    const body =
      `${amount} renews on ${renews.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` +
      ` — ${threshold.label} from now.`;

    const result = await notify({
      userId: String(specialist.userId),
      type: NOTIFICATION_TYPES.RENEWAL_DUE,
      title: `Your renewal is ${threshold.label} away`,
      body,
      url: "/dashboard/billing",
      subjectId: specialist.id,
      email: specialist.email ?? null,
      /* The bucket is in the key, so each threshold sends once and a
         sweep every thirty minutes cannot re-send it. */
      key: `${NOTIFICATION_TYPES.RENEWAL_DUE}:${specialist.id}:${threshold.bucket}`,
    });

    if (result?.created) raised += 1;
  }

  if (raised > 0) console.log(`[reminders] ${raised} renewal reminder(s) sent`);
  return { checked, raised };
}

async function runSweep() {
  await sweepOverdueApprovals().catch((e) => console.error("[reminders] approval sweep failed:", e?.message ?? e));
  await sweepOverdueReviews().catch((e) => console.error("[reminders] review sweep failed:", e?.message ?? e));
  await releaseHeldEnquiries().catch((e) => console.error("[reminders] enquiry release failed:", e?.message ?? e));
  await sweepRenewalReminders().catch((e) => console.error("[reminders] renewal sweep failed:", e?.message ?? e));
  /* Appendix B: a badge nobody has confirmed for 72 hours comes down,
     so a ClinWell outage cannot leave "Runs on ClinWell" on the public
     site indefinitely. */
  await expireStaleBadges().catch((e) => console.error("[reminders] badge expiry failed:", e?.message ?? e));
}

export function stopReminderSweep() {
  if (timer) clearInterval(timer);
  timer = null;
}
