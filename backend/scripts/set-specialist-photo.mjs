#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Set one specialist's photo directly
 *
 * backfill-photos.mjs only matches specialists to a photo already
 * cached from the harvest (by slug/url). This is the other case: a
 * brand new image for one named person, dropped in by hand. It goes
 * through the exact same saveImage()/Cloudinary seam and touches only
 * that one row's photoUrl.
 *
 *   node scripts/set-specialist-photo.mjs --match="Kirti Moholkar" --file=/path/to/photo.jpg --dry-run
 *   CLOUDINARY_URL="cloudinary://..." DATABASE_URL="...?sslmode=require" \
 *     node scripts/set-specialist-photo.mjs --match="Kirti Moholkar" --file=/path/to/photo.jpg --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import { eq, ilike } from "drizzle-orm";
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
const MATCH = option("match");
const FILE = option("file");

if (!MATCH || !FILE) {
  console.error(
    'Usage: node scripts/set-specialist-photo.mjs --match="Full Name" --file=/path/to/photo.jpg [--write]'
  );
  process.exit(1);
}
if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Pass it on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}
if (!fs.existsSync(FILE)) {
  console.error(`No such file: ${FILE}`);
  process.exit(1);
}

let storageProviderName = "(not checked -- dry run)";
if (WRITE) {
  const storage = await registerStorageProvider();
  storageProviderName = storage.provider;
  if (storage.provider !== "cloudinary") {
    console.error(
      `\nSTOPPING: photo would go to "${storage.provider}", not Cloudinary.\n` +
        `Set CLOUDINARY_URL and run again with --write.\n`
    );
    process.exit(1);
  }
}

const db = getDb();
const rows = await db
  .select()
  .from(t.specialists)
  .where(ilike(t.specialists.fullName, `%${MATCH}%`));

if (rows.length === 0) {
  console.error(`No specialist matched "${MATCH}".`);
  process.exit(1);
}
if (rows.length > 1) {
  console.error(`Multiple specialists matched "${MATCH}":`);
  for (const r of rows) console.error(`  - ${r.slug}: ${r.fullName}`);
  console.error("Tighten --match so it names exactly one person.");
  process.exit(1);
}

const sp = rows[0];
console.log(`Matched: ${sp.fullName} (slug ${sp.slug})`);
console.log(`Current photoUrl: ${sp.photoUrl || "(none)"}`);

if (!WRITE) {
  console.log("\nDry run -- nothing uploaded. Pass --write (with CLOUDINARY_URL set) to apply.");
  await disconnectDb();
  process.exit(0);
}

const buffer = fs.readFileSync(FILE);
const saved = await saveImage({ buffer, kind: "profile-photo", origin: process.env.PUBLIC_API_URL ?? "" });
await db.update(t.specialists).set({ photoUrl: saved.url }).where(eq(t.specialists.id, sp.id));

console.log(`\nstorage provider: ${storageProviderName}`);
console.log(`Done. New photoUrl: ${saved.url}`);

await disconnectDb();
