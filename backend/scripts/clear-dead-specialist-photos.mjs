#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Clearing specialist photos that point at nothing
 *
 * backfill-hotlinked-photos.mjs correctly fixed the 4 real McCollum
 * Consultants expert-witness photos (they downloaded fine and are now
 * on Cloudinary) -- but its broad "any photoUrl not already on
 * Cloudinary" check also caught 11 specialists whose photoUrl points at
 * the same dead tls-preview-jmp0.onrender.com host that broke the blog
 * articles' hero images: uploaded through a preview deploy that never
 * had CLOUDINARY_URL set, stored on that deploy's local disk, gone the
 * next time it redeployed. That host now redirects to production,
 * which 404s the path -- so re-fetching returns an HTML error page, not
 * image bytes, and saveImage() correctly refuses to save that as a
 * photo (confirmed by hand, 2026-09-30).
 *
 * Unlike the blog articles, there is no safe stand-in here: these rows
 * are named, real people and businesses (including the client's own
 * listing, mr-kirti-moholkar), and publishing a stock photo of a
 * stranger under a real name is misrepresentation, not a fix. The
 * right fix is that person/business re-uploading their own photo
 * through production (Cloudinary-backed now, so it will actually
 * persist) -- this script only clears the dead URL so the listing
 * shows the site's normal "no photo" placeholder instead of a broken
 * image icon in the meantime.
 *
 * The 11 slugs below are exactly the "problem" rows from running
 * backfill-hotlinked-photos.mjs --write on 2026-09-30 -- hand-picked,
 * not re-derived, so this can't accidentally sweep up something else.
 *
 *   node scripts/clear-dead-specialist-photos.mjs --dry-run
 *   DATABASE_URL="...?sslmode=require" \
 *     node scripts/clear-dead-specialist-photos.mjs --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const WRITE = flag("write");

const DEAD_SLUGS = [
  "mr-kirti-moholkar",
  "wonder-tree-developmental-psychology",
  "dr-bruno-silva-neuropsychiatrist-brain-matters",
  "rosie-s-space",
  "suncoast-medical-supply-co",
  "christian-baker",
  "amit-rao",
  "brandon-ortega",
  "dr-r-kyle-gazdeck",
  "kathleen-hughes-aesthetics",
  "suncoast-medical-supply-co-2",
];

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Set it in backend/.env or on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}

const db = getDb();

const rows = await db
  .select({ id: t.specialists.id, slug: t.specialists.slug, fullName: t.specialists.fullName, photoUrl: t.specialists.photoUrl })
  .from(t.specialists)
  .where(inArray(t.specialists.slug, DEAD_SLUGS));

console.log(`${rows.length} of ${DEAD_SLUGS.length} known-dead slugs found in the database.\n`);

const foundSlugs = new Set(rows.map((r) => r.slug));
for (const slug of DEAD_SLUGS) {
  if (!foundSlugs.has(slug)) console.log(`  not found (already fixed, renamed, or removed?): ${slug}`);
}

for (const row of rows) {
  console.log(`  ${WRITE ? "clearing" : "would clear"} photoUrl for ${row.slug} (${row.fullName})`);
  if (WRITE) {
    await db.update(t.specialists).set({ photoUrl: null }).where(eq(t.specialists.id, row.id));
  }
}

console.log(
  WRITE
    ? `\nDone. Cleared ${rows.length} dead photoUrl(s) -- these listings now show the normal "no photo" placeholder.`
    : `\nDry run -- nothing changed. Would clear ${rows.length} dead photoUrl(s). Drop --dry-run (pass --write) to apply.`
);
console.log(
  "\nThese are real named people/businesses, not stock-photo candidates -- pass this list to whoever owns each\n" +
    "listing so they can re-upload their real photo through production (it's Cloudinary-backed now, so it'll stick)."
);

await disconnectDb();
