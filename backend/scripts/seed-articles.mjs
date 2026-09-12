/* ------------------------------------------------------------------ *
 * Seed the blog with the demo guides
 *
 *   npm run articles:demo
 *
 * Idempotent: each demo article carries a stable sourceRef, so running
 * this twice updates rather than duplicates. Safe on a database that
 * already has real articles in it — it only touches its own three.
 *
 * This exists because the demo guides live in data/demo-articles.js,
 * which only the in-memory mode reads. A developer running against
 * Postgres would otherwise see an empty blog and have no way to judge
 * the page.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { isDbConfigured } from "../src/config/db.js";
import { articles as repo, taxonomy } from "../src/db/repos.js";
import { demoArticles } from "../src/data/demo-articles.js";
import {
  excerptFrom,
  readingMinutes,
  renderArticleBody,
  slugify,
  withHeadingIds,
} from "../src/lib/articleContent.js";

if (!isDbConfigured()) {
  console.log("[articles] no DATABASE_URL — demo mode already serves these three. Nothing to do.");
  process.exit(0);
}

const specialties = await taxonomy.specialties();
const bySlug = new Map(specialties.map((s) => [s.slug, s]));

let created = 0;
let updated = 0;

for (const a of demoArticles) {
  const bodyHtml = withHeadingIds(renderArticleBody(a.body));
  const sourceRef = slugify(a.title);

  const values = {
    slug: sourceRef,
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
    source: "demo",
    sourceRef,
    readingMinutes: readingMinutes(bodyHtml),
  };

  const existing = (await repo.findBySource("demo", sourceRef)) ?? (await repo.findBySlug(values.slug));
  if (existing) {
    // The slug is never rewritten — it may already be a shared link.
    const { slug: _ignored, ...patch } = values;
    await repo.update(existing.id, patch);
    updated += 1;
  } else {
    await repo.create(values);
    created += 1;
  }
  console.log(`  ${existing ? "updated" : "created"}  /blog/${values.slug}`);
}

console.log(`\n[articles] ${created} created, ${updated} updated.`);
process.exit(0);
