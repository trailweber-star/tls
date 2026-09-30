#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Restoring the 8 blog articles' dead hero images
 *
 * Every article's heroImageUrl pointed at a preview/staging deploy
 * (tls-preview-jmp0.onrender.com) that no longer serves those files --
 * whoever uploaded them was on a copy of the admin panel that never had
 * CLOUDINARY_URL set, so the upload silently landed on that server's own
 * local disk (registerStorageProvider()'s documented fallback) instead
 * of Cloudinary, and the file didn't survive that service's next
 * deploy. Confirmed dead by hand, 2026-09-30: the host now redirects to
 * production, which 404s the path.
 *
 * There is no original copy of these specific images anywhere this
 * project has access to (unlike the hospital photos, these were never
 * harvested from a real business's own site), so this is not a
 * like-for-like backfill -- it replaces each with a real, appropriately
 * licensed stock photo matching the article's topic, picked by hand
 * (see ARTICLE_HERO_IMAGES below), downloaded live and pushed through
 * the same saveImage()/Cloudinary seam every image on this site goes
 * through.
 *
 * Every photo is from Pexels, whose license is free for commercial use
 * with no attribution required (https://www.pexels.com/license/) --
 * chosen over Unsplash for this batch specifically because Unsplash
 * mixes free and Unsplash+ (paid-license) photos in the same search
 * results and a premium one is easy to pick by mistake.
 *
 *   node scripts/backfill-article-hero-images.mjs --dry-run
 *   CLOUDINARY_URL="cloudinary://..." DATABASE_URL="...?sslmode=require" \
 *     node scripts/backfill-article-hero-images.mjs --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { registerStorageProvider, saveImage } from "../src/lib/storage.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const WRITE = flag("write");

const UA = "TopLocalSpecialists-migration/1.0 (first-party data export; contact site owner)";
const FETCH_TIMEOUT_MS = 20_000;

/* One real, freely-licensed Pexels photo per article, picked to match
   its actual topic -- not a generic medical stock shot repeated eight
   times. `credit` is kept for internal traceability only; Pexels'
   license doesn't require displaying it. */
const ARTICLE_HERO_IMAGES = {
  "sports-injury-recovery-with-physiotherapy": {
    url: "https://images.pexels.com/photos/7339493/pexels-photo-7339493.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A physiotherapist applying kinesiology tape to a patient's knee",
    credit: "Pexels photo 7339493",
  },
  "physiotherapy-vs-surgery-which-works-better": {
    url: "https://images.pexels.com/photos/5793695/pexels-photo-5793695.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A physiotherapist working with a patient during a treatment session",
    credit: "Pexels photo 5793695",
  },
  "physiotherapist-in-birmingham-uk-for-back-pain-relief": {
    url: "https://images.pexels.com/photos/20860586/pexels-photo-20860586.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A physiotherapist examining a patient's back",
    credit: "Pexels photo 20860586",
  },
  "orthopaedic-hand-surgery-recovery-post-hand-surgery-physio-hand-surgery-rehab-bo": {
    url: "https://images.pexels.com/photos/5721552/pexels-photo-5721552.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A clinician bandaging a patient's hand",
    credit: "Pexels photo 5721552",
  },
  "orthopaedic-hip-surgery-recovery-tips-from-experts": {
    url: "https://images.pexels.com/photos/24193871/pexels-photo-24193871.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A patient walking with crutches down a hospital corridor",
    credit: "Pexels photo 24193871",
  },
  "knee-health-in-women": {
    url: "https://images.pexels.com/photos/7298659/pexels-photo-7298659.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A woman holding her knee in pain",
    credit: "Pexels photo 7298659",
  },
  "when-to-see-an-orthopaedic-doctor-for-back-or-joint-pain": {
    url: "https://images.pexels.com/photos/4506109/pexels-photo-4506109.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A doctor examining a patient's back",
    credit: "Pexels photo 4506109",
  },
  "how-to-prepare-for-knee-replacement-surgery": {
    url: "https://images.pexels.com/photos/7446985/pexels-photo-7446985.jpeg?auto=compress&cs=tinysrgb&w=1600",
    alt: "A doctor closely examining a patient's knee X-ray ahead of surgery",
    credit: "Pexels photo 7446985",
  },
};

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Set it in backend/.env or on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}

let storageProviderName = "(not checked -- dry run)";
if (WRITE) {
  const storage = await registerStorageProvider();
  storageProviderName = storage.provider;
  if (storage.provider !== "cloudinary") {
    console.error(
      `\nSTOPPING: images would go to "${storage.provider}", not Cloudinary.\n` +
        `CLOUDINARY_URL is not set (or failed to initialise) in this shell. Set it and run again:\n` +
        `  CLOUDINARY_URL="cloudinary://<key>:<secret>@<cloud name>" DATABASE_URL="..." \\\n` +
        `    node scripts/backfill-article-hero-images.mjs --write\n`
    );
    process.exit(1);
  }
}

async function fetchExternalImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "image/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

const db = getDb();
const looksLikeCloudinary = (url) => /res\.cloudinary\.com/.test(String(url ?? ""));

const slugs = Object.keys(ARTICLE_HERO_IMAGES);
const rows = await db
  .select({ id: t.articles.id, slug: t.articles.slug, title: t.articles.title, heroImageUrl: t.articles.heroImageUrl })
  .from(t.articles);

const summary = { updated: 0, alreadyFixed: 0, notFound: 0, problems: [] };

for (const slug of slugs) {
  const row = rows.find((r) => r.slug === slug);
  if (!row) {
    summary.notFound += 1;
    console.log(`  no article with slug ${slug}`);
    continue;
  }
  if (looksLikeCloudinary(row.heroImageUrl)) {
    summary.alreadyFixed += 1;
    console.log(`  ${slug} already has a Cloudinary hero image -- skipped`);
    continue;
  }

  const pick = ARTICLE_HERO_IMAGES[slug];
  try {
    const buffer = await fetchExternalImage(pick.url);
    console.log(`  ${WRITE ? "downloaded" : "would download"} ${pick.credit} (${buffer.length} bytes) -- ${slug}`);
    if (!WRITE) {
      summary.updated += 1;
      continue; // dry run: fetched (proves the photo still resolves) but nothing is uploaded or written
    }
    const saved = await saveImage({ buffer, kind: "article", origin: process.env.PUBLIC_API_URL ?? "" });
    await db.update(t.articles).set({ heroImageUrl: saved.url, heroImageAlt: pick.alt }).where(eq(t.articles.id, row.id));
    summary.updated += 1;
  } catch (err) {
    summary.problems.push(`${slug}: ${err.message}`);
  }
}

console.log(`\nstorage provider: ${storageProviderName}\n`);
console.log(
  WRITE
    ? `Done. ${summary.updated} hero image(s) replaced, ${summary.alreadyFixed} already fixed (skipped), ` +
        `${summary.notFound} slug(s) not found, ${summary.problems.length} problem(s).`
    : `Dry run -- nothing uploaded. Would replace ${summary.updated} hero image(s) (all fetched successfully); ` +
        `${summary.alreadyFixed} already fixed; ${summary.notFound} slug(s) not found. Drop --dry-run (pass --write) to apply.`
);
if (summary.problems.length) {
  console.log("\nProblems");
  for (const p of summary.problems) console.log(`  ${p}`);
}

await disconnectDb();
