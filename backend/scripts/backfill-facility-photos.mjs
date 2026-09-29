#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Backfilling facility photos onto Cloudinary
 *
 * The same bug backfill-photos.mjs fixed for specialists was never
 * fixed for facilities: move-to-facilities.mjs carries a facility's
 * photoUrl straight over from the specialist/department row it was
 * grouped from (`photoUrl: s.photoUrl ?? null`), and those rows never
 * had a real photoUrl to carry -- so every facility's photoUrl is
 * null, and the frontend falls back to the one house image for its
 * type (placeHeroFor() in lib/specialtyHeroes.ts). That's why every
 * hospital on /search?type=hospital shows the same stock photo.
 *
 * This does for facilities exactly what backfill-photos.mjs does for
 * specialists: for every facility matched to a harvest row that has a
 * real photo cached on disk (harvest-live.mjs --photos), and whose
 * current photoUrl is empty or doesn't already point at Cloudinary,
 * upload that photo and update ONLY facilities.photoUrl.
 *
 * A handful of facilities were grouped from several department-page
 * rows during move-to-facilities.mjs and don't carry the bare
 * building slug in mapped.csv themselves (e.g. facility slug
 * "new-cross-hospital" vs. csv rows "new-cross-hospital-ent" /
 * "-gynaecology"). FACILITY_SLUG_ALIASES below maps those by hand to
 * the best real harvested photo for the same building -- reviewed
 * once, not derived automatically, since a wrong guess here would be
 * a wrong hospital's photo on a real listing.
 *
 *   node scripts/backfill-facility-photos.mjs --dry-run
 *   CLOUDINARY_URL="cloudinary://..." DATABASE_URL="...?sslmode=require" \
 *     node scripts/backfill-facility-photos.mjs --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { registerStorageProvider, saveImage } from "../src/lib/storage.js";
import { readCsvText } from "./lib/treatment-matcher.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const WRITE = flag("write");
const CSV = path.resolve(process.cwd(), option("csv", "data/harvest/mapped.csv"));
const PHOTOS_DIR = path.resolve(process.cwd(), "data", "harvest", "photos");
const LIMIT = Number(option("limit", "0")) || Infinity;

/* A facility slug -> harvest CSV slug, for the buildings whose facility
   record doesn't carry the bare slug in mapped.csv (it was grouped from
   department-page rows instead). Picked by hand against the live site's
   own address for each -- not a fuzzy match.

     new-cross-hospital                    -> new-cross-hospital-ent
       (Wolverhampton, WV10 0QP -- same building as the ENT and
       gynaecology department rows; ENT's photo picked arbitrarily,
       both are the same source site)
     dudley-group-nhs-foundation-trust     -> (no harvest row at all --
       Russells Hall Hospital is this Trust's acute hospital and has a
       cached photo, but nothing in the harvest ties the two slugs
       together, so it's left for a human to confirm before using)
     warwick-hospital                      -> warwick-hospital-dermatology
     university-hospital-coventry-and-warwickshire
                                            -> university-hospital-coventry-warwickshire
       (harvest slug is missing "and") */
const FACILITY_SLUG_ALIASES = {
  "new-cross-hospital": "new-cross-hospital-ent",
  "warwick-hospital": "warwick-hospital-dermatology",
  "university-hospital-coventry-and-warwickshire": "university-hospital-coventry-warwickshire",
};

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Set it in backend/.env or on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}
if (!fs.existsSync(CSV)) {
  console.error(`No such file: ${CSV}`);
  process.exit(1);
}

/* Cloudinary or refuse -- same rule as backfill-photos.mjs. A dry run
   is allowed to proceed without it so the counts can be checked
   before anything is configured for real. */
let storageProviderName = "(not checked -- dry run)";
if (WRITE) {
  const storage = await registerStorageProvider();
  storageProviderName = storage.provider;
  if (storage.provider !== "cloudinary") {
    console.error(
      `\nSTOPPING: photos would go to "${storage.provider}", not Cloudinary.\n` +
        `CLOUDINARY_URL is not set (or failed to initialise) in this shell. Set it and run again:\n` +
        `  CLOUDINARY_URL="cloudinary://<key>:<secret>@<cloud name>" DATABASE_URL="..." \\\n` +
        `    node scripts/backfill-facility-photos.mjs --write\n`
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------- the csv */

const rows = readCsvText(fs.readFileSync(CSV, "utf8"));
const bySlug = new Map();
let onDisk = 0;
for (const row of rows) {
  const file = String(row.photoFile ?? "").trim();
  if (!file) continue;
  if (!fs.existsSync(path.join(PHOTOS_DIR, file))) continue;
  onDisk += 1;
  const slug = String(row.slug ?? "").trim();
  if (slug) bySlug.set(slug, file);
}
console.log(`${rows.length} harvest rows, ${onDisk} with a real photo cached on disk.\n`);

/* ------------------------------------------------------------ retrying
   Same reasoning as backfill-photos.mjs: a managed Postgres connection
   can drop mid-run for reasons that have nothing to do with the row
   being written, and every write here is keyed on the facility's id,
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

/* --------------------------------------------------------- the facilities */

const db = getDb();
const facilities = await db
  .select({ id: t.facilities.id, slug: t.facilities.slug, name: t.facilities.name, photoUrl: t.facilities.photoUrl })
  .from(t.facilities);

const looksLikeCloudinary = (url) => /res\.cloudinary\.com/.test(String(url ?? ""));

const summary = { alreadyCloudinary: 0, backfilled: 0, noPhotoOnFile: 0, notMatched: 0, problems: [] };
let done = 0;

for (const f of facilities) {
  if (done >= LIMIT) break;

  const csvSlug = FACILITY_SLUG_ALIASES[f.slug] ?? f.slug;
  const file = bySlug.get(csvSlug) ?? null;
  if (!file) {
    summary.notMatched += 1;
    console.log(`  no harvest photo for ${f.slug} (${f.name})`);
    continue;
  }
  if (looksLikeCloudinary(f.photoUrl)) {
    summary.alreadyCloudinary += 1;
    continue;
  }

  done += 1;
  const local = path.join(PHOTOS_DIR, file);
  try {
    await withRetry(f.slug, async () => {
      const buffer = fs.readFileSync(local);
      if (!WRITE) return; // dry run: file is read (proves it decodes) but nothing is uploaded or written
      const saved = await saveImage({ buffer, kind: "facility-photo", origin: process.env.PUBLIC_API_URL ?? "" });
      await db.update(t.facilities).set({ photoUrl: saved.url }).where(eq(t.facilities.id, f.id));
    });
    summary.backfilled += 1;
    console.log(`  ${WRITE ? "uploaded" : "would upload"} ${file} -> ${f.slug} (${f.name})`);
  } catch (err) {
    summary.problems.push(`${f.slug}: ${err.message}`);
  }
}

console.log(`\nstorage provider: ${storageProviderName}\n`);
console.log(
  WRITE
    ? `Done. ${summary.backfilled} photo(s) uploaded and saved, ${summary.alreadyCloudinary} already on Cloudinary (skipped), ` +
        `${summary.notMatched} facility(ies) with no matching harvest row, ${summary.problems.length} problem(s).`
    : `Dry run -- nothing uploaded. Would backfill ${summary.backfilled} photo(s); ${summary.alreadyCloudinary} already on Cloudinary; ` +
        `${summary.notMatched} facility(ies) with no matching harvest row. Drop --dry-run (pass --write) to apply.`
);
if (summary.problems.length) {
  console.log("\nProblems");
  for (const p of summary.problems) console.log(`  ${p}`);
}

await disconnectDb();
