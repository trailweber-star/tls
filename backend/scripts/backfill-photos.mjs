#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Backfilling specialist photos onto Cloudinary
 *
 * import-specialists.mjs --photos, until it was fixed alongside this
 * script, never called registerStorageProvider(). That call is what
 * actually points saveImage() at Cloudinary; without it, every photo
 * "stored" during an import run was silently written to local disk on
 * whichever machine the import ran from (backend/uploads/) and given a
 * URL built from PUBLIC_API_URL, which is not set in a laptop's shell.
 * The run reported "N photos stored" and every one of them is a
 * broken image on the live site -- the file never left the laptop.
 *
 * This script repairs that without touching anything else. For every
 * specialist matched to a harvest row that has a real photo cached on
 * disk (harvest-live.mjs --photos), and whose current photoUrl is
 * empty or does not already point at Cloudinary, it uploads that photo
 * and updates ONLY specialists.photoUrl.
 *
 * Deliberately not a re-run of import-specialists.mjs: that script,
 * without --only-new, rewrites every specialist's clinic location from
 * the CSV on every run, which throws away whatever geotag.mjs has since
 * refined (97% street-accurate back down to the old site's town-centre
 * pins). Fixing a photo is not a reason to also undo that.
 *
 *   node scripts/backfill-photos.mjs --dry-run
 *   CLOUDINARY_URL="cloudinary://..." DATABASE_URL="...?sslmode=require" \
 *     node scripts/backfill-photos.mjs --write
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

/* Cloudinary or refuse -- the whole point of this script is to stop
   photos landing on local disk a second time. A dry run is allowed to
   proceed without it, so the counts can be checked before anything is
   configured for real. */
let storageProviderName = "(not checked -- dry run)";
if (WRITE) {
  const storage = await registerStorageProvider();
  storageProviderName = storage.provider;
  if (storage.provider !== "cloudinary") {
    console.error(
      `\nSTOPPING: photos would go to "${storage.provider}", not Cloudinary.\n` +
        `CLOUDINARY_URL is not set (or failed to initialise) in this shell. Set it and run again:\n` +
        `  CLOUDINARY_URL="cloudinary://<key>:<secret>@<cloud name>" DATABASE_URL="..." \\\n` +
        `    node scripts/backfill-photos.mjs --write\n`
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------- the csv */

const rows = readCsvText(fs.readFileSync(CSV, "utf8"));
const byUrl = new Map();
const bySlug = new Map();
let onDisk = 0;
for (const row of rows) {
  const file = String(row.photoFile ?? "").trim();
  if (!file) continue;
  if (!fs.existsSync(path.join(PHOTOS_DIR, file))) continue; // reported by import-specialists.mjs already
  onDisk += 1;
  const url = String(row.url ?? "").trim();
  const slug = String(row.slug ?? "").trim();
  if (url) byUrl.set(url, file);
  if (slug) bySlug.set(slug, file);
}
console.log(`${rows.length} harvest rows, ${onDisk} with a real photo cached on disk.\n`);

/* ------------------------------------------------------------ retrying
   Same reasoning as import-specialists.mjs: a managed Postgres
   connection can drop mid-run for reasons that have nothing to do with
   the row being written, and every write here is keyed on the
   specialist's id, so retrying from scratch just reaches the same row
   again rather than duplicating anything. */
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

/* --------------------------------------------------------- the specialists */

const db = getDb();
const specialists = await db
  .select({ id: t.specialists.id, slug: t.specialists.slug, sourceUrl: t.specialists.sourceUrl, photoUrl: t.specialists.photoUrl })
  .from(t.specialists);

const looksLikeCloudinary = (url) => /res\.cloudinary\.com/.test(String(url ?? ""));

const summary = { alreadyCloudinary: 0, backfilled: 0, noPhotoOnFile: 0, notMatched: 0, problems: [] };
let done = 0;

for (const sp of specialists) {
  if (done >= LIMIT) break;

  const file = (sp.sourceUrl && byUrl.get(sp.sourceUrl)) ?? (sp.slug && bySlug.get(sp.slug)) ?? null;
  if (!file) {
    summary.notMatched += 1;
    continue;
  }
  if (looksLikeCloudinary(sp.photoUrl)) {
    summary.alreadyCloudinary += 1;
    continue;
  }

  done += 1;
  const local = path.join(PHOTOS_DIR, file);
  try {
    await withRetry(sp.slug, async () => {
      const buffer = fs.readFileSync(local);
      if (!WRITE) return; // dry run: file is read (proves it decodes) but nothing is uploaded or written
      const saved = await saveImage({ buffer, kind: "profile-photo", origin: process.env.PUBLIC_API_URL ?? "" });
      await db.update(t.specialists).set({ photoUrl: saved.url }).where(eq(t.specialists.id, sp.id));
    });
    summary.backfilled += 1;
  } catch (err) {
    summary.problems.push(`${sp.slug}: ${err.message}`);
  }
}

console.log(`storage provider: ${storageProviderName}\n`);
console.log(
  WRITE
    ? `Done. ${summary.backfilled} photo(s) uploaded and saved, ${summary.alreadyCloudinary} already on Cloudinary (skipped), ` +
        `${summary.notMatched} specialist(s) with no matching harvest row, ${summary.problems.length} problem(s).`
    : `Dry run -- nothing uploaded. Would backfill ${summary.backfilled} photo(s); ${summary.alreadyCloudinary} already on Cloudinary; ` +
        `${summary.notMatched} specialist(s) with no matching harvest row. Drop --dry-run (pass --write) to apply.`
);
if (summary.problems.length) {
  console.log("\nProblems");
  for (const p of summary.problems) console.log(`  ${p}`);
}

await disconnectDb();
