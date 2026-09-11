import { isDbConfigured } from "../config/db.js";
import {
  facilities as facilityRepo,
  reviews as reviewRepo,
  specialists as specialistRepo,
  taxonomy,
  users as userRepo,
} from "../db/repos.js";
import {
  addSpecialistReview,
  mockSpecialistsWithRelations,
  specialists as mockSpecialists,
  facilities as mockFacilities,
  featuredApprovedReviews,
  reviewsByModeration,
  reviewCountsByModeration,
  findReviewById,
  moderateReview as moderateMockReview,
  conditions as mockConditions,
} from "../data/mock.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";

/* ------------------------------------------------------------------ *
 * Reviews
 *
 * Nothing a patient writes appears on the site until a person has read
 * it. A review is created in `pending`, contributes to no rating, and
 * every admin is told about it the moment it lands — in the dashboard
 * bell, by email, and by push. A pending review nobody has looked at
 * after 24 hours is chased once more by lib/reminders.js.
 *
 * The one thing that is NOT moderated is the provider's reply. A
 * specialist answering a review that is already public is speech about
 * their own listing, and putting that in a queue would make replying
 * useless — the reply would land days after the complaint.
 * ------------------------------------------------------------------ */

async function loadAdmins() {
  if (!isDbConfigured()) {
    const { demoAccounts } = await import("../data/accounts.js");
    return demoAccounts.all().filter((u) => u.role === "admin" && u.active);
  }
  return userRepo.admins();
}

/**
 * Tell every admin a review is waiting. In-app is the record of truth;
 * the email goes to the address on the admin's own account, which is
 * the mailbox the site is configured with.
 */
export async function alertAdminsOfPendingReview({ review, subjectName, subjectKind }) {
  const admins = await loadAdmins();
  if (admins.length === 0) return;
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const excerpt = review.comment ? `“${String(review.comment).slice(0, 180)}”` : "No written comment.";
  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.REVIEW_PENDING,
    title: `Review awaiting approval: ${subjectName}`,
    body:
      `${stars} (${review.rating}/5) for ${subjectName}. ${excerpt} ` +
      `It stays hidden from patients — and out of the ${subjectKind}'s rating — until you publish or reject it.`,
    url: `/admin/reviews?status=pending&open=${review.id}`,
    subjectId: review.id,
    key: `${NOTIFICATION_TYPES.REVIEW_PENDING}:${review.id}`,
  });
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
}

/** The parts of a submitted review we accept, sanitised. */
function readReviewBody(body) {
  return {
    rating: Math.round(Number(body?.rating)),
    // "Seen for". Accepted, but never trusted: the caller sends an id
    // and createSpecialistReview checks it against what this specialist
    // is actually tagged with before it is stored. An unrecognised id
    // becomes null rather than an error — the review still matters even
    // if that one field was wrong.
    conditionId: body?.conditionId ? String(body.conditionId) : null,
    comment: body?.comment ? String(body.comment).slice(0, 2000) : null,
    patientName: body?.patientName ? String(body.patientName).slice(0, 120) : null,
    // Never asserted from user input: a review is "verified" only when a
    // booking/invite record backs it (Master Doc §16).
    verified: false,
    scores: {
      communication: numberOrNull(body?.scores?.communication),
      expertise: numberOrNull(body?.scores?.expertise),
      care: numberOrNull(body?.scores?.care),
      waitTime: numberOrNull(body?.scores?.waitTime),
    },
  };
}

/* ------------------------------------------------------ public reads */

// GET /api/specialists/:slug/reviews?page=1&pageSize=10
// Paginated review list behind the profile's "View all reviews".
export async function listSpecialistReviews(req, res) {
  const { slug } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));

  let all;
  if (!isDbConfigured()) {
    const specialist = mockSpecialistsWithRelations.find((s) => s.slug === slug);
    if (!specialist) return res.status(404).json({ error: "Specialist not found" });
    // mockSpecialistsWithRelations already carries approved rows only.
    all = [...specialist.reviews].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    const doc = await specialistRepo.rawBySlug(slug);
    if (!doc) return res.status(404).json({ error: "Specialist not found" });
    all = await reviewRepo.forSubject("specialist", doc.id);
  }

  res.json({
    results: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
  });
}

/**
 * GET /api/reviews/featured?limit=12
 *
 * The homepage strip. Approved reviews only, drawn from real rows across
 * both halves of the directory — there are no seeded testimonials
 * behind it, so an empty directory returns an empty array and the
 * section removes itself rather than showing invented praise.
 */
export async function listFeaturedReviews(req, res) {
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));

  if (!isDbConfigured()) {
    return res.json(featuredApprovedReviews(limit));
  }

  const rows = await reviewRepo.byModeration("approved", 200);
  const withComment = rows.filter((r) => r.comment);
  if (withComment.length === 0) return res.json([]);

  const specialistIds = withComment.filter((r) => r.subjectType === "specialist").map((r) => r.subjectId);
  const facilityIds = withComment.filter((r) => r.subjectType === "facility").map((r) => r.subjectId);

  const [specialists, facilities] = await Promise.all([
    specialistIds.length ? specialistRepo.byIds([...new Set(specialistIds)]) : [],
    facilityIds.length ? facilityRepo.byIds([...new Set(facilityIds)]) : [],
  ]);
  const specialistById = new Map(specialists.map((s) => [s.id, s]));
  const facilityById = new Map(facilities.map((f) => [f.id, f]));

  const out = withComment
    .map((review) => {
      if (review.subjectType === "specialist") {
        const sp = specialistById.get(review.subjectId);
        // Only listings the public can actually open. A review of a
        // suspended profile linking to a 404 is worse than no card.
        if (!sp || sp.verificationStatus !== "verified") return null;
        return {
          review,
          subject: {
            kind: "specialist",
            slug: sp.slug,
            name: sp.fullName,
            subtitle: sp.title ?? sp.primarySpecialty?.name ?? null,
            photoUrl: sp.photoUrl ?? null,
            href: `/specialists/${sp.slug}`,
          },
          seenFor:
            (sp.conditions ?? []).find((c) => c.id === review.conditionId)?.name ??
            (sp.treatments ?? []).find((tr) => tr.id === review.conditionId)?.name ??
            null,
        };
      }
      const f = facilityById.get(review.subjectId);
      if (!f) return null;
      return {
        review,
        subject: {
          kind: "facility",
          slug: f.slug,
          name: f.name,
          subtitle: f.categories?.[0]?.name ?? null,
          photoUrl: f.photoUrl ?? null,
          facilityType: f.facilityType,
          href: `/facilities/${f.slug}`,
        },
        seenFor: null,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.review.verified) - Number(a.review.verified) ||
        Number(Boolean(b.seenFor)) - Number(Boolean(a.seenFor)) ||
        new Date(b.review.createdAt) - new Date(a.review.createdAt)
    )
    .slice(0, limit);

  res.json(out);
}

/* ----------------------------------------------------------- writing */

// POST /api/specialists/:slug/reviews
export async function createSpecialistReview(req, res) {
  const { slug } = req.params;
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }
  const review = readReviewBody(req.body);

  if (!isDbConfigured()) {
    const specialist = mockSpecialists.find((s) => s.slug === slug);
    if (!specialist) return res.status(404).json({ error: "Specialist not found" });
    const built = mockSpecialistsWithRelations.find((s) => s.slug === slug);
    const ownConditions = new Set((built?.conditions ?? []).map((c) => c.id));
    if (review.conditionId && !ownConditions.has(review.conditionId)) review.conditionId = null;
    // addSpecialistReview stores it; it lands pending, so the returned
    // aggregate is unchanged — which is the honest answer.
    const stored = addSpecialistReview(specialist.id, review);
    await alertAdminsOfPendingReview({
      review: stored.review,
      subjectName: specialist.fullName,
      subjectKind: "specialist",
    });
    // Same answer as the database path, deliberately: no rating comes
    // back, because none changed. Echoing the current one here would let
    // a client render a figure as if the review had counted.
    return res.status(201).json({
      ok: true,
      demo: true,
      moderationStatus: "pending",
      message: "Thanks — your review has been sent to our team and will appear once it has been checked.",
    });
  }

  const doc = await specialistRepo.rawBySlug(slug);
  if (!doc) return res.status(404).json({ error: "Specialist not found" });

  // Only a condition this specialist actually treats. The column is a
  // foreign key to `conditions`, so an arbitrary id would fail the
  // insert — and an id from some other specialist's list would tag the
  // review with something they were never seen for.
  const full = await specialistRepo.findBySlug(slug);
  const ownConditions = new Set((full?.conditions ?? []).map((c) => c.id));
  if (review.conditionId && !ownConditions.has(review.conditionId)) review.conditionId = null;

  const created = await reviewRepo.create({ ...review, subjectType: "specialist", subjectId: doc.id });
  await alertAdminsOfPendingReview({ review: created, subjectName: doc.fullName, subjectKind: "specialist" });

  // No rating is returned, because none changed: the review is not
  // published yet, and echoing a new average here would be a lie the
  // page would then display.
  res.status(201).json({
    ok: true,
    moderationStatus: "pending",
    message: "Thanks — your review has been sent to our team and will appear once it has been checked.",
  });
}

/* -------------------------------------------------------- moderation */

/** Load one review plus the name of whatever it is about. */
async function loadReviewWithSubject(id) {
  if (!isDbConfigured()) {
    const row = findReviewById(id);
    if (!row) return null;
    const subject =
      row.subjectType === "facility"
        ? mockFacilities.find((f) => f.id === row.subjectId)
        : mockSpecialists.find((s) => s.id === row.subjectId);
    return {
      review: row,
      subjectName: subject?.name ?? subject?.fullName ?? "Unknown listing",
      subjectSlug: subject?.slug ?? null,
    };
  }
  const row = await reviewRepo.findById(id);
  if (!row) return null;
  const subject =
    row.subjectType === "facility"
      ? await facilityRepo.findById(row.subjectId)
      : await specialistRepo.rawById(row.subjectId);
  return {
    review: row,
    subjectName: subject?.name ?? subject?.fullName ?? "Unknown listing",
    subjectSlug: subject?.slug ?? null,
  };
}

/**
 * GET /api/admin/reviews?status=pending
 *
 * The moderation queue. Oldest first: the review that has been waiting
 * longest is the one most at risk of the 24-hour chase.
 */
export async function listReviewsForModeration(req, res) {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";

  let rows;
  if (!isDbConfigured()) {
    rows = reviewsByModeration(status);
  } else {
    rows = await reviewRepo.byModeration(status);
  }

  // "Seen for" comes from the condition the review was tagged with.
  // Resolved once per request rather than per row — the queue can be
  // two hundred rows on a busy week.
  const conditionRows = isDbConfigured() ? await taxonomy.conditions() : mockConditions;
  const conditionName = (id) => (id ? (conditionRows.find((c) => c.id === id)?.name ?? null) : null);

  // Each row is shown with what it is about, so an admin can judge it
  // without opening another tab.
  const results = [];
  for (const row of rows) {
    const loaded = await loadReviewWithSubject(row.id);
    results.push({
      ...row,
      seenFor: conditionName(row.conditionId),
      subject: loaded
        ? {
            kind: row.subjectType,
            name: loaded.subjectName,
            slug: loaded.subjectSlug,
            href:
              row.subjectType === "facility"
                ? `/facilities/${loaded.subjectSlug}`
                : `/specialists/${loaded.subjectSlug}`,
          }
        : null,
      waitingHours: Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 3600_000),
    });
  }

  const counts = isDbConfigured() ? await reviewRepo.countByModeration() : reviewCountsByModeration();
  res.json({ results, counts, status });
}

/**
 * POST /api/admin/reviews/:id/moderate  { status, note }
 *
 * Publishing recomputes the subject's rating from its approved rows —
 * never an increment, so rejecting a review that was live takes its
 * stars back out of the average rather than leaving them behind.
 */
export async function moderateReview(req, res) {
  const { id } = req.params;
  const status = req.body?.status;
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
  // A rejection has to say why. It is the record of a decision to
  // suppress something a patient wrote, and "no reason given" is not an
  // acceptable audit trail for that.
  if (status === "rejected" && !note) {
    return res.status(400).json({ error: "A reason is required when rejecting a review" });
  }

  const loaded = await loadReviewWithSubject(id);
  if (!loaded) return res.status(404).json({ error: "Review not found" });

  let row;
  if (!isDbConfigured()) {
    row = moderateMockReview(id, { status, byUserId: req.user.id, note });
  } else {
    row = await reviewRepo.moderate(id, { status, byUserId: req.user.id, note });
    if (row.subjectType === "facility") await facilityRepo.recomputeRating(row.subjectId);
    else await specialistRepo.recomputeRating(row.subjectId);
  }

  // Clear the admin to-do items for this review, for every admin — so
  // two admins never moderate the same review twice.
  const { notificationStore } = await import("../lib/notifications.js");
  await notificationStore.resolveSubject(id);

  res.json({ ok: true, id, status, subject: loaded.subjectName });
}
