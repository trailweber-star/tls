import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { articles as articleRepo, taxonomy as taxonomyRepo } from "../db/repos.js";
import { specialties as mockSpecialties } from "../data/mock.js";
import { demoArticles } from "../data/demo-articles.js";
import {
  excerptFrom,
  outlineOf,
  readingMinutes,
  renderArticleBody,
  slugify,
  toPlainText,
  withHeadingIds,
} from "../lib/articleContent.js";
import { optionalUrlField } from "../lib/urls.js";

/* ------------------------------------------------------------------ *
 * The blog
 *
 * Articles are written in Abun, which publishes only to WordPress,
 * Webflow, Wix and Shopify and offers no API, webhook or Zapier action.
 * So there is no live connection to build against, and this is designed
 * for that fact rather than around it: everything enters through one
 * importer, and where a given article came from is a field on the row.
 *
 *   paste      an admin pastes the markdown or HTML Abun exports
 *   wordpress  a scheduled pull from a WordPress REST feed, if one is
 *              ever put in the middle (lib/articleSources.js)
 *   api        whatever Abun ships later
 *
 * Adding a source means writing something that produces the shape
 * `importArticle` already takes. It does not mean touching the blog.
 * ------------------------------------------------------------------ */

const demoStore = [];

/** The demo-mode rows, built once, through the real sanitiser. */
function demoRows() {
  if (demoStore.length) return demoStore;
  const bySlug = new Map(mockSpecialties.map((s) => [s.slug, s]));
  for (const a of demoArticles) {
    const bodyHtml = withHeadingIds(renderArticleBody(a.body));
    demoStore.push({
      id: `art_demo_${slugify(a.title).slice(0, 24)}`,
      slug: slugify(a.title),
      title: a.title,
      excerpt: a.excerpt ?? excerptFrom(bodyHtml),
      bodyHtml,
      heroImageUrl: a.heroImageUrl ?? null,
      heroImageAlt: a.heroImageAlt ?? null,
      authorName: a.authorName ?? null,
      specialtyId: a.specialtySlug ? (bySlug.get(a.specialtySlug)?.id ?? null) : null,
      tags: a.tags ?? [],
      status: "published",
      publishedAt: new Date(Date.now() - (a.publishedDaysAgo ?? 0) * 86400000),
      seoTitle: null,
      seoDescription: null,
      source: "demo",
      sourceRef: null,
      readingMinutes: readingMinutes(bodyHtml),
      viewCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return demoStore;
}

async function loadSpecialties() {
  return isDbConfigured() ? taxonomyRepo.specialties() : mockSpecialties;
}

async function published(filters = {}) {
  if (!isDbConfigured()) {
    let rows = demoRows().filter((r) => r.status === "published");
    if (filters.tag) rows = rows.filter((r) => r.tags.includes(filters.tag));
    if (filters.specialtyId) rows = rows.filter((r) => r.specialtyId === filters.specialtyId);
    return [...rows].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }
  return articleRepo.published(filters);
}

/* ------------------------------------------------------------ shaping */

/** What a card needs. Never the body — a list of twenty articles should
 *  not ship twenty article bodies to render three lines each. */
function toCard(row, specialtyById) {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? excerptFrom(row.bodyHtml),
    heroImageUrl: row.heroImageUrl ?? null,
    heroImageAlt: row.heroImageAlt ?? null,
    authorName: row.authorName ?? null,
    tags: row.tags ?? [],
    specialty: row.specialtyId
      ? (() => {
          const s = specialtyById.get(row.specialtyId);
          return s ? { slug: s.slug, name: s.name } : null;
        })()
      : null,
    publishedAt: row.publishedAt,
    readingMinutes: row.readingMinutes ?? readingMinutes(row.bodyHtml),
  };
}

function toArticle(row, specialtyById) {
  return {
    ...toCard(row, specialtyById),
    bodyHtml: row.bodyHtml,
    outline: outlineOf(row.bodyHtml),
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? row.excerpt ?? excerptFrom(row.bodyHtml, 155),
    updatedAt: row.updatedAt ?? row.publishedAt,
  };
}

/* ------------------------------------------------------------- public */

// GET /api/articles?tag=Recovery&specialty=orthopaedics&page=1
export async function listArticles(req, res) {
  const specialties = await loadSpecialties();
  const specialtyById = new Map(specialties.map((s) => [s.id, s]));
  const specialtySlug = String(req.query.specialty ?? "").trim();
  const specialty = specialtySlug ? specialties.find((s) => s.slug === specialtySlug) : null;

  const rows = await published({
    tag: req.query.tag ? String(req.query.tag) : null,
    specialtyId: specialty?.id ?? null,
  });

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize) || 9));
  const start = (page - 1) * pageSize;

  // The tag list is built from what is actually published, so a filter
  // can never offer a tag that returns nothing.
  const tagCounts = new Map();
  for (const row of await published()) {
    for (const tag of row.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  res.json({
    results: rows.slice(start, start + pageSize).map((r) => toCard(r, specialtyById)),
    total: rows.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(rows.length / pageSize)),
    tags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    specialty: specialty ? { slug: specialty.slug, name: specialty.name } : null,
  });
}

// GET /api/articles/:slug
export async function getArticle(req, res) {
  const slug = String(req.params.slug ?? "");
  const specialties = await loadSpecialties();
  const specialtyById = new Map(specialties.map((s) => [s.id, s]));

  const row = isDbConfigured()
    ? await articleRepo.findBySlug(slug)
    : demoRows().find((r) => r.slug === slug) ?? null;

  if (!row || row.status !== "published") {
    return res.status(404).json({ error: "That article does not exist." });
  }

  if (isDbConfigured()) articleRepo.recordView(row.id);

  /* Related: same specialty first, then anything sharing a tag. A blog
     on a directory exists to move people towards the listings, so the
     tail of an article should never be a dead end. */
  const all = (await published()).filter((r) => r.slug !== row.slug);
  const sameSpecialty = all.filter((r) => row.specialtyId && r.specialtyId === row.specialtyId);
  const sharedTag = all.filter(
    (r) => !sameSpecialty.includes(r) && (r.tags ?? []).some((t) => (row.tags ?? []).includes(t))
  );
  const related = [...sameSpecialty, ...sharedTag, ...all].slice(0, 3);

  res.json({
    article: toArticle(row, specialtyById),
    related: related.map((r) => toCard(r, specialtyById)),
  });
}

/* -------------------------------------------------------------- admin */

const importSchema = z.object({
  title: z.string().min(3).max(300),
  body: z.string().min(1).max(400_000),
  /** "auto" covers the usual case: Abun exports either, per article. */
  format: z.enum(["auto", "markdown", "html"]).default("auto"),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(600).optional(),
  heroImageUrl: optionalUrlField(),
  heroImageAlt: z.string().max(300).optional(),
  authorName: z.string().max(160).optional(),
  specialtySlug: z.string().max(120).optional(),
  tags: z.array(z.string().min(1).max(60)).max(8).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  publishedAt: z.string().datetime().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
  source: z.string().max(40).default("paste"),
  sourceRef: z.string().max(200).optional(),
});

/**
 * The one way in.
 *
 * POST /api/admin/articles/import
 *
 * Idempotent on (source, sourceRef): re-importing the same Abun article
 * updates the row rather than adding a second copy, which is what makes
 * a scheduled pull safe to run every hour without thinking about it.
 */
export async function importArticle(req, res) {
  const parsed = importSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the fields." });
  }
  const input = parsed.data;

  if (!isDbConfigured()) {
    return res.status(503).json({
      error: "Importing needs a database. This server is running on demo data.",
    });
  }

  const bodyHtml = withHeadingIds(
    renderArticleBody(input.body, { format: input.format === "markdown" ? "md" : input.format })
  );
  if (!toPlainText(bodyHtml)) {
    return res.status(400).json({ error: "That body is empty once the markup is removed." });
  }

  const specialties = await loadSpecialties();
  const specialty = input.specialtySlug
    ? specialties.find((s) => s.slug === input.specialtySlug)
    : null;

  const existing = await articleRepo.findBySource(input.source, input.sourceRef ?? null);

  /* A slug is a permanent public URL, so it is set once at creation and
     never rewritten by a re-import — an edited title must not orphan the
     link somebody already shared. */
  const slug = existing?.slug ?? (await uniqueSlug(input.slug || slugify(input.title)));

  const values = {
    slug,
    title: input.title,
    excerpt: input.excerpt ?? excerptFrom(bodyHtml),
    bodyHtml,
    // Kept so the editor can show what was written rather than what was
    // rendered. Never served to the public.
    bodySource: input.body,
    bodyFormat: input.format,
    heroImageUrl: input.heroImageUrl ?? null,
    heroImageAlt: input.heroImageAlt ?? null,
    authorName: input.authorName ?? null,
    specialtyId: specialty?.id ?? null,
    tags: input.tags ?? [],
    status: input.status,
    publishedAt:
      input.status === "published"
        ? new Date(input.publishedAt ?? existing?.publishedAt ?? Date.now())
        : (existing?.publishedAt ?? null),
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    readingMinutes: readingMinutes(bodyHtml),
  };

  const row = existing
    ? await articleRepo.update(existing.id, values)
    : await articleRepo.create(values);

  res.status(existing ? 200 : 201).json({
    article: { slug: row.slug, title: row.title, status: row.status },
    created: !existing,
  });
}

/** Appends -2, -3 … rather than failing on a title used twice. */
async function uniqueSlug(base) {
  const root = slugify(base) || "article";
  let candidate = root;
  for (let n = 2; n < 50; n += 1) {
    const clash = await articleRepo.findBySlug(candidate);
    if (!clash) return candidate;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

// GET /api/admin/articles — the workspace list, drafts included
export async function listAllArticles(_req, res) {
  if (!isDbConfigured()) {
    return res.json({ results: demoRows().map((r) => ({ ...r, bodyHtml: undefined })), demo: true });
  }
  const rows = await articleRepo.all();
  res.json({
    results: rows.map((r) => ({ ...r, bodyHtml: undefined, bodySource: undefined })),
    demo: false,
  });
}

/**
 * GET /api/admin/articles/:id — one article, as the editor needs it.
 *
 * The list deliberately omits bodies; this is the call the Edit form
 * makes when somebody actually opens one. It returns bodySource — what
 * was typed — in preference to bodyHtml, so editing a pasted markdown
 * article does not turn it into HTML the first time it is saved.
 */
export async function getAdminArticle(req, res) {
  const id = String(req.params.id ?? "");

  if (!isDbConfigured()) {
    const row = demoRows().find((r) => r.id === id);
    if (!row) return res.status(404).json({ error: "No such article." });
    return res.json({ article: { ...row, body: row.bodyHtml, bodyFormat: "html", specialtySlug: null } });
  }

  const row = await articleRepo.findById(id);
  if (!row) return res.status(404).json({ error: "No such article." });

  const specialties = await loadSpecialties();
  const specialty = row.specialtyId ? specialties.find((s) => s.id === row.specialtyId) : null;

  /* A summary nobody wrote should come back empty, not as the derived
     one with its ellipsis — otherwise the first edit quietly promotes a
     truncated auto-excerpt into a hand-written one, and it stops
     following the article from then on. */
  const derived = excerptFrom(row.bodyHtml);

  res.json({
    article: {
      ...row,
      excerpt: row.excerpt === derived ? null : row.excerpt,
      body: row.bodySource ?? row.bodyHtml,
      // A row imported before body_source existed can only be edited as
      // the HTML it became, and saying so keeps the markdown detector
      // from second-guessing it.
      bodyFormat: row.bodySource ? (row.bodyFormat ?? "auto") : "html",
      specialtySlug: specialty?.slug ?? null,
    },
  });
}

// PATCH /api/admin/articles/:id — publish, unpublish, retag, or edit
const patchSchema = z.object({
  status: z.enum(["draft", "published"]).optional(),
  title: z.string().min(3).max(300).optional(),
  /* Editing the body goes through the same renderer and sanitiser as
     the import, because there must be exactly one way HTML gets into
     this table. */
  body: z.string().max(400_000).optional(),
  format: z.enum(["auto", "markdown", "html"]).optional(),
  excerpt: z.string().max(600).optional(),
  tags: z.array(z.string().min(1).max(60)).max(8).optional(),
  specialtySlug: z.string().max(120).nullable().optional(),
  heroImageUrl: optionalUrlField(),
  heroImageAlt: z.string().max(300).optional(),
  authorName: z.string().max(160).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
});

export async function updateArticle(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "Needs a database." });
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the fields." });
  }
  const existing = await articleRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "No such article." });

  const patch = { ...parsed.data };
  const { format } = patch;
  delete patch.format;

  if (typeof patch.body === "string") {
    const source = patch.body;
    delete patch.body;
    if (!source.trim()) {
      return res.status(400).json({ error: "An article needs a body." });
    }
    const bodyHtml = withHeadingIds(
      renderArticleBody(source, { format: format === "markdown" ? "md" : (format ?? "auto") })
    );
    if (!toPlainText(bodyHtml)) {
      return res.status(400).json({ error: "That body is empty once the markup is removed." });
    }
    patch.bodyHtml = bodyHtml;
    patch.bodySource = source;
    patch.bodyFormat = format ?? "auto";
    patch.readingMinutes = readingMinutes(bodyHtml);
  }

  /* An empty summary means "work it out from the article", not "store an
     empty summary" — otherwise clearing the field silently blanks every
     card and meta description. */
  if (patch.excerpt !== undefined && !patch.excerpt.trim()) {
    patch.excerpt = excerptFrom(patch.bodyHtml ?? existing.bodyHtml);
  }
  for (const key of ["heroImageAlt", "authorName", "seoTitle", "seoDescription"]) {
    if (patch[key] !== undefined && !String(patch[key]).trim()) patch[key] = null;
  }

  if ("specialtySlug" in patch) {
    const specialties = await loadSpecialties();
    patch.specialtyId = patch.specialtySlug
      ? (specialties.find((s) => s.slug === patch.specialtySlug)?.id ?? null)
      : null;
    delete patch.specialtySlug;
  }
  // Publishing for the first time sets the date; re-publishing keeps it.
  if (patch.status === "published" && !existing.publishedAt) patch.publishedAt = new Date();

  const row = await articleRepo.update(existing.id, patch);
  res.json({ article: { ...row, bodyHtml: undefined, bodySource: undefined } });
}

// DELETE /api/admin/articles/:id
export async function deleteArticle(req, res) {
  if (!isDbConfigured()) return res.status(503).json({ error: "Needs a database." });
  const existing = await articleRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "No such article." });
  await articleRepo.remove(existing.id);
  res.json({ deleted: true });
}
