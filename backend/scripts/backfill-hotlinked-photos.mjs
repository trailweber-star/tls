#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Mirroring hotlinked specialist photos onto Cloudinary
 *
 * import-expert-witnesses.mjs takes photoUrl straight from the source
 * CSV's photo_url column (`photoUrl: clean(row.photo_url)`) with no
 * download/upload step -- unlike every other import path on this site,
 * which runs a photo through saveImage()/Cloudinary before it ever
 * touches a specialist row. Right now that means 10 Expert Witness
 * profiles serve their photo straight off mccollumconsultants.com's own
 * WordPress media library. Every one of those loads fine today (checked
 * live, 2026-09-29) -- this is not the "broken image" bug
 * backfill-photos.mjs fixed -- but TLS has zero control over that file:
 * McCollum can rename, move, or delete it during their own next site
 * redesign and a TLS profile photo goes dead with no warning and no fix
 * on our side except re-scraping.
 *
 * This downloads every specialist's current photo from wherever it's
 * hotlinked and re-hosts it on Cloudinary, the same as every other
 * photo on the site -- same seam as backfill-photos.mjs, just fetched
 * live over HTTP instead of read from a harvest file already on disk.
 * Deliberately not scoped to Expert Witness: the check is just "has a
 * photoUrl that isn't on Cloudinary yet", so it also catches this same
 * shape of bug wherever a future import repeats it.
 *
 *   node scripts/backfill-hotlinked-photos.mjs --dry-run
 *   CLOUDINARY_URL="cloudinary://..." DATABASE_URL="...?sslmode=require" \
 *     node scripts/backfill-hotlinked-photos.mjs --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, and, isNotNull } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { registerStorageProvider, saveImage } from "../src/lib/storage.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const WRITE = flag("write");
const LIMIT = Number(option("limit", "0")) || Infinity;

// Same identification string harvest-live.mjs uses to fetch photos --
// this is the same kind of request (a first-party data export pulling
// its own previously-linked image), so it gets the same courtesy.
const UA = "TopLocalSpecialists-migration/1.0 (first-party data export; contact site owner)";
const FETCH_TIMEOUT_MS = 20_000;

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Set it in backend/.env or on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}

/* Cloudinary or refuse -- same rule as backfill-photos.mjs. A dry run
   is allowed to proceed without it so the counts can be checked before
   anything is configured for real. */
let storageProviderName = "(not checked -- dry run)";
if (WRITE) {
  const storage = await registerStorageProvider();
  storageProviderName = storage.provider;
  if (storage.provider !== "cloudinary") {
    console.error(
      `\nSTOPPING: photos would go to "${storage.provider}", not Cloudinary.\n` +
        `CLOUDINARY_URL is not set (or failed to initialise) in this shell. Set it and run again:\n` +
        `  CLOUDINARY_URL="cloudinary://<key>:<secret>@<cloud name>" DATABASE_URL="..." \\\n` +
        `    node scripts/backfill-hotlinked-photos.mjs --write\n`
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------ retrying
   Same reasoning as backfill-photos.mjs: a managed Postgres connection
   can drop mid-run for reasons that have nothing to do with the row
   being written, and every write here is keyed on the specialist's id,
   so retrying from scratch just reaches the same row again rather than
   duplicating anything. */
function isConnectionLoss(err) {
  const msg = String(err?.message ?? "");
  return (
    msg.includes("Connection terminated unexpectedly") ||
    msg.includes("Connection ended unexpectedly") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    err?.code === "ECONNRESET" ||
    err?.code === "57P01" ||
    err?.code === "57P02" ||
    err?.code === "57P03"
  );
}
async function withRetry(label, fn) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isConnectionLoss(err) || attempt === attempts) throw err;
      console.error(`  [${label}] connection dropped (attempt ${attempt}/${attempts}) -- retrying: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
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

/* --------------------------------------------------------- the specialists */

const db = getDb();
const looksLikeCloudinary = (url) => /res\.cloudinary\.com/.test(String(url ?? ""));

const specialists = await db
  .select({ id: t.specialists.id, slug: t.specialists.slug, fullName: t.specialists.fullName, photoUrl: t.specialists.photoUrl })
  .from(t.specialists)
  .where(and(isNotNull(t.specialists.photoUrl)));

const hotlinked = specialists.filter((sp) => !looksLikeCloudinary(sp.photoUrl));
console.log(`${specialists.length} specialist(s) with a photoUrl, ${hotlinked.length} not already on Cloudinary.\n`);

const summary = { backfilled: 0, failed: 0, problems: [] };
let done = 0;

for (const sp of hotlinked) {
  if (done >= LIMIT) break;
  done += 1;

  try {
    await withRetry(sp.slug, async () => {
      const buffer = await fetchExternalImage(sp.photoUrl);
      console.log(`  ${WRITE ? "downloaded" : "would download"} ${sp.photoUrl} (${buffer.length} bytes) -- ${sp.slug} (${sp.fullName})`);
      if (!WRITE) return; // dry run: fetched (proves the URL still resolves to real bytes) but nothing is uploaded or written
      const saved = await saveImage({ buffer, kind: "profile-photo", origin: process.env.PUBLIC_API_URL ?? "" });
      await db.update(t.specialists).set({ photoUrl: saved.url }).where(eq(t.specialists.id, sp.id));
    });
    summary.backfilled += 1;
  } catch (err) {
    summary.failed += 1;
    summary.problems.push(`${sp.slug} (${sp.photoUrl}): ${err.message}`);
  }
}

console.log(`\nstorage provider: ${storageProviderName}\n`);
console.log(
  WRITE
    ? `Done. ${summary.backfilled} photo(s) downloaded and re-hosted on Cloudinary, ${summary.failed} problem(s).`
    : `Dry run -- nothing uploaded. Would mirror ${summary.backfilled} photo(s) (all fetched successfully); ` +
        `${summary.failed} problem(s). Drop --dry-run (pass --write) to apply.`
);
if (summary.problems.length) {
  console.log("\nProblems");
  for (const p of summary.problems) console.log(`  ${p}`);
}

await disconnectDb();
