import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { articles as articleRepo, specialists as specialistRepo, taxonomy as taxonomyRepo } from "../db/repos.js";
import { specialistIdOf } from "../middleware/auth.js";
import { entitlementsFor } from "../lib/plans.js";
import { NOTIFICATION_TYPES, notify, notifyAdmins } from "../lib/notifications.js";
import {
  excerptFrom,
  readingMinutes,
  renderArticleBody,
  slugify,
  toPlainText,
  withHeadingIds,
} from "../lib/articleContent.js";
import { optionalUrlField } from "../lib/urls.js";

/* ------------------------------------------------------------------ *
 * Members writing articles
 *
 * Two ways an article gets written, one queue, and the publish decision
 * always ends with an administrator:
 *
 *   TLS drafts  ─assign─▶ awaiting_author ─member edits─▶ in_review ─▶ published
 *   member drafts ─────────────submits──────────────────▶ in_review ─▶ published
 *                                      sent back ─▶ changes_requested ─▶ member
 *
 * Two rules are worth stating because everything here exists to enforce
 * them:
 *
 *   Nothing is published under a clinician's name that the clinician has
 *   not read. That is what awaiting_author is for — an article written
 *   for a member sits with them until they have been through it.
 *
 *   Nothing medical reaches a patient on this site without a person at
 *   TLS having looked at it. Reviews already work this way, and an
 *   article carries far more clinical claim than a review does.
 * ------------------------------------------------------------------ */

/** What a member may do from where. Anything not listed is refused. */
const MEMBER_MOVES = {
  draft: ["draft", "in_review"],
  awaiting_author: ["awaiting_author", "in_review"],
  changes_requested: ["changes_requested", "in_review"],
  // Once submitted it is the administrator's, and a published article is
  // not editable in place — a correction is a new review cycle.
  in_review: [],
  published: [],
};

const ADMIN_MOVES = {
  draft: ["draft", "awaiting_author", "in_review", "published"],
  awaiting_author: ["awaiting_author", "draft", "published"],
  in_review: ["published", "changes_requested", "in_review"],
  changes_requested: ["changes_requested", "in_review", "published"],
  published: ["published", "draft"],
};

export function canMove(role, from, to) {
  const table = role === "admin" ? ADMIN_MOVES : MEMBER_MOVES;
  return (table[from] ?? []).includes(to);
}

/* ------------------------------------------------------------- shapes */

function toRow(row, specialtyById) {
  const specialty = row.specialtyId ? specialtyById.get(row.specialtyId) : null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? null,
    status: row.status,
    heroImageUrl: row.heroImageUrl ?? null,
    tags: row.tags ?? [],
    specialty: specialty ? { slug: specialty.slug, name: specialty.name } : null,
    readingMinutes: row.readingMinutes ?? 1,
    viewCount: row.viewCount ?? 0,
    /* The note an administrator left when sending it back. This is the
       one field a member most needs and would otherwise have to be told
       by email. */
    reviewNote: row.reviewNote ?? null,
    submittedAt: row.submittedAt ?? null,
    publishedAt: row.publishedAt ?? null,
    updatedAt: row.updatedAt,
    /** True when TLS wrote it and it is waiting on the member. */
    writtenForYou: row.status === "awaiting_author",
  };
}

async function specialtyIndex() {
  const rows = isDbConfigured() ? await taxonomyRepo.specialties() : [];
  return new Map(rows.map((s) => [s.id, s]));
}

/* -------------------------------------------------------- the gate */

/**
 * Publishing is a Premium feature, and the plan catalogue is the only
 * place that says so.
 *
 * Returns the specialist, or null with the reason already sent.
 */
async function requirePublisher(req, res) {
  const id = specialistIdOf(req.user);
  if (!id) {
    res.status(400).json({ error: "This account has no specialist profile." });
    return null;
  }
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Writing articles needs a database. This server is on demo data." });
    return null;
  }
  const specialist = await specialistRepo.findById(id);
  if (!specialist) {
    res.status(404).json({ error: "Profile not found." });
    return null;
  }
  if (!entitlementsFor(specialist).features.contentPublishing) {
    res.status(403).json({
      error: "Publishing articles is part of Premium. Upgrade your plan to write for the guides.",
      upgrade: true,
    });
    return null;
  }
  return specialist;
}

/** An article this member is allowed to see or touch. */
async function ownArticle(specialist, id) {
  const row = await articleRepo.findById(String(id ?? ""));
  if (!row) return null;
  return row.authorSpecialistId === specialist.id ? row : null;
}

/* ------------------------------------------------------------ member */

// GET /api/dashboard/articles
export async function listMyArticles(req, res) {
  const specialist = await requirePublisher(req, res);
  if (!specialist) return;

  const [rows, specialtyById] = await Promise.all([
    articleRepo.forAuthorSpecialist(specialist.id),
    specialtyIndex(),
  ]);
  res.json({
    results: rows.map((r) => toRow(r, specialtyById)),
    counts: {
      awaitingYou: rows.filter((r) => r.status === "awaiting_author" || r.status === "changes_requested").length,
      inReview: rows.filter((r) => r.status === "in_review").length,
      published: rows.filter((r) => r.status === "published").length,
    },
  });
}

// GET /api/dashboard/articles/:id
export async function getMyArticle(req, res) {
  const specialist = await requirePublisher(req, res);
  if (!specialist) return;
  const row = await ownArticle(specialist, req.params.id);
  if (!row) return res.status(404).json({ error: "No such article." });

  const specialtyById = await specialtyIndex();
  const specialty = row.specialtyId ? specialtyById.get(row.specialtyId) : null;
  res.json({
    article: {
      ...toRow(row, specialtyById),
      body: row.bodySource ?? row.bodyHtml,
      bodyFormat: row.bodySource ? (row.bodyFormat ?? "auto") : "html",
      heroImageAlt: row.heroImageAlt ?? null,
      specialtySlug: specialty?.slug ?? null,
    },
  });
}

const writeSchema = z.object({
  title: z.string().min(3, "needs at least three characters").max(300),
  body: z.string().min(1, "cannot be empty").max(400_000),
  format: z.enum(["auto", "markdown", "html"]).optional(),
  excerpt: z.string().max(600).optional(),
  tags: z.array(z.string().min(1).max(60)).max(8).optional(),
  specialtySlug: z.string().max(120).nullable().optional(),
  heroImageUrl: optionalUrlField(),
  heroImageAlt: z.string().max(300).optional(),
  /** True submits it for review in the same call as saving. */
  submit: z.boolean().optional(),
});

function firstProblem(error) {
  const issue = error?.issues?.[0];
  if (!issue) return "Check the fields.";
  const labels = {
    title: "Title",
    body: "Body",
    excerpt: "Summary",
    tags: "Tags",
    heroImageUrl: "Cover image",
    heroImageAlt: "Image description",
  };
  const label = labels[issue.path?.[0]] ?? issue.path?.[0];
  return label ? `${label}: ${issue.message}` : issue.message;
}

/** Everything a title and body imply, worked out once. */
async function renderFields(input, existing) {
  const format = input.format ?? "auto";
  const bodyHtml = withHeadingIds(
    renderArticleBody(input.body, { format: format === "markdown" ? "md" : format })
  );
  if (!toPlainText(bodyHtml)) {
    const err = new Error("That body is empty once the markup is removed.");
    err.status = 400;
    throw err;
  }

  const specialties = await taxonomyRepo.specialties();
  const specialty = input.specialtySlug ? specialties.find((s) => s.slug === input.specialtySlug) : null;

  return {
    title: input.title.trim(),
    bodyHtml,
    bodySource: input.body,
    bodyFormat: format,
    excerpt: input.excerpt?.trim() || excerptFrom(bodyHtml),
    heroImageUrl: input.heroImageUrl ?? existing?.heroImageUrl ?? null,
    heroImageAlt: input.heroImageAlt?.trim() || null,
    specialtyId: specialty?.id ?? (input.specialtySlug === null ? null : (existing?.specialtyId ?? null)),
    tags: input.tags ?? existing?.tags ?? [],
    readingMinutes: readingMinutes(bodyHtml),
  };
}

// POST /api/dashboard/articles
export async function createMyArticle(req, res) {
  const specialist = await requirePublisher(req, res);
  if (!specialist) return;

  const parsed = writeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: firstProblem(parsed.error) });

  let fields;
  try {
    fields = await renderFields(parsed.data, null);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }

  const status = parsed.data.submit ? "in_review" : "draft";
  const row = await articleRepo.create({
    ...fields,
    slug: await uniqueSlug(fields.title),
    status,
    authorSpecialistId: specialist.id,
    authorName: specialist.fullName,
    createdByUserId: String(req.user.id ?? req.user._id),
    submittedAt: status === "in_review" ? new Date() : null,
    source: "member",
    sourceRef: null,
  });

  if (status === "in_review") await raiseForReview(row, specialist);
  res.status(201).json({ article: toRow(row, await specialtyIndex()) });
}

// PATCH /api/dashboard/articles/:id
export async function updateMyArticle(req, res) {
  const specialist = await requirePublisher(req, res);
  if (!specialist) return;

  const existing = await ownArticle(specialist, req.params.id);
  if (!existing) return res.status(404).json({ error: "No such article." });

  const target = req.body?.submit ? "in_review" : existing.status;
  if (!canMove("specialist", existing.status, target)) {
    return res.status(409).json({
      error:
        existing.status === "in_review"
          ? "This is with the Top Local Specialists team for review. You will be told when it is published."
          : "A published article cannot be edited here — ask the team for a correction.",
    });
  }

  const parsed = writeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: firstProblem(parsed.error) });

  let fields;
  try {
    fields = await renderFields(parsed.data, existing);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }

  const row = await articleRepo.update(existing.id, {
    ...fields,
    status: target,
    submittedAt: target === "in_review" ? new Date() : existing.submittedAt,
    // Sending it back in clears the old note: it has been acted on.
    reviewNote: target === "in_review" ? null : existing.reviewNote,
  });

  if (target === "in_review" && existing.status !== "in_review") await raiseForReview(row, specialist);
  res.json({ article: toRow(row, await specialtyIndex()) });
}

/** Appends -2, -3 … rather than failing on a title used twice. */
async function uniqueSlug(base) {
  const root = slugify(base) || "article";
  let candidate = root;
  for (let n = 2; n < 50; n += 1) {
    if (!(await articleRepo.findBySlug(candidate))) return candidate;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Put it in front of an administrator.
 *
 * An article waiting in a queue nobody is told about is an article that
 * sits there for a fortnight, and the member is left wondering whether
 * anyone read it.
 */
async function raiseForReview(row, specialist) {
  const { users } = await import("../db/repos.js");
  const admins = await users.admins().catch(() => []);
  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.ARTICLE_PENDING,
    title: "An article is waiting for review",
    body: `${specialist.fullName}: \u201c${row.title}\u201d`,
    url: "/admin/articles",
    subjectId: row.id,
    key: `article_pending:${row.id}`,
  }).catch(() => {});
}

/* ------------------------------------------------------------- admin */

/**
 * POST /api/admin/articles/:id/assign
 *
 * Hands a draft TLS wrote to the member it is about. This is the whole
 * ghostwriting case: the article leaves the admin's hands, appears in
 * that member's dashboard as "written for you", and cannot be published
 * until it has come back through review.
 */
export async function assignArticle(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "Needs a database." });

  const schema = z.object({
    specialistId: z.string().min(1).max(64),
    note: z.string().max(2000).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Pick a member to send this to." });

  const existing = await articleRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "No such article." });
  if (!canMove("admin", existing.status, "awaiting_author")) {
    return res.status(409).json({
      error: `An article that is ${existing.status.replace("_", " ")} cannot be sent to a member.`,
    });
  }

  const specialist = await specialistRepo.findById(parsed.data.specialistId);
  if (!specialist) return res.status(404).json({ error: "No such member." });

  const row = await articleRepo.update(existing.id, {
    status: "awaiting_author",
    authorSpecialistId: specialist.id,
    authorName: specialist.fullName,
    reviewNote: parsed.data.note?.trim() || null,
    submittedAt: null,
  });

  /* Told, not left to be discovered. A draft sitting in a dashboard
     nobody mentioned is a draft nobody reads. */
  await notify({
    userId: String(specialist.userId ?? ""),
    type: NOTIFICATION_TYPES.ARTICLE_PENDING,
    title: "An article has been written for you",
    body: `“${row.title}” is ready for you to read and edit before it goes live.`,
    url: "/dashboard/articles",
    subjectId: row.id,
    key: `article_assigned:${row.id}`,
  }).catch(() => {});

  res.json({ article: toRow(row, await specialtyIndex()) });
}

/**
 * POST /api/admin/articles/:id/review
 *
 * The decision at the end of the queue: publish it, or send it back
 * with a note saying why. Sending back without a note is refused —
 * "changes requested" with no changes named is just a rejection the
 * member cannot act on.
 */
export async function reviewArticle(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "Needs a database." });

  const schema = z.object({
    decision: z.enum(["publish", "changes"]),
    note: z.string().max(2000).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Say publish or changes." });
  const { decision, note } = parsed.data;

  const existing = await articleRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "No such article." });

  const target = decision === "publish" ? "published" : "changes_requested";
  if (!canMove("admin", existing.status, target)) {
    return res.status(409).json({ error: `Cannot go from ${existing.status} to ${target}.` });
  }
  if (decision === "changes" && !note?.trim()) {
    return res.status(400).json({ error: "Say what needs changing — the member reads this note." });
  }

  const row = await articleRepo.update(existing.id, {
    status: target,
    reviewNote: decision === "changes" ? note.trim() : null,
    reviewedAt: new Date(),
    reviewedByUserId: String(req.user.id ?? req.user._id),
    publishedAt: decision === "publish" ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
  });

  const author = row.authorSpecialistId ? await specialistRepo.findById(row.authorSpecialistId) : null;
  if (author?.userId) {
    await notify({
      userId: String(author.userId),
      type: NOTIFICATION_TYPES.ARTICLE_PENDING,
      title: decision === "publish" ? "Your article is live" : "Your article needs a change",
      body:
        decision === "publish"
          ? `“${row.title}” is published on the guides.`
          : `“${row.title}”: ${note.trim().slice(0, 160)}`,
      url: decision === "publish" ? `/blog/${row.slug}` : "/dashboard/articles",
      subjectId: row.id,
      key: `article_${target}:${row.id}:${Date.now()}`,
    }).catch(() => {});
  }

  res.json({ article: toRow(row, await specialtyIndex()) });
}
