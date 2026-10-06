#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Clearing specialist and facility photos that point at nothing
 *
 * clear-dead-specialist-photos.mjs fixed one batch of this on
 * 2026-09-30: 11 slugs whose photoUrl was hand-picked out of a
 * backfill-hotlinked-photos.mjs dry run, because that script only
 * detects the shape of the bug (a photoUrl not yet on Cloudinary) --
 * it never clears one, it only tries to re-host it, and a URL that no
 * longer resolves to real bytes has nothing to re-host.
 *
 * The underlying cause is still live: a photo uploaded while this
 * service was serving off local disk (before CLOUDINARY_URL was set,
 * or during a deploy where it failed to initialise) is gone the next
 * time the service restarts -- the hardcoded 11-slug list only ever
 * covered the rows that were broken on the day it was written, not
 * every row that has since or will since end up the same way. This
 * script replaces the hand-picked list with a live check: it fetches
 * every specialist's and facility's current photoUrl, and only clears
 * the ones that no longer come back as real image bytes. Safe to
 * re-run whenever this recurs, with no list to maintain by hand.
 *
 * Like the script it replaces: these are named people and businesses,
 * so a cleared photo shows the site's normal initials/no-photo
 * placeholder, never a stand-in stock photo. The slug/name printed for
 * each clear is meant to be handed to whoever owns that listing so
 * they can re-upload through production -- Cloudinary-backed now, so
 * it will actually stick.
 *
 * One fetch per photo is not enough to condemn it: the first real run
 * of this script (2026-10-06) marked 20 Cloudinary URLs dead on one
 * pass, then found all 20 fine on the very next one -- almost
 * certainly Cloudinary rate-limiting, or a network blip, from hitting
 * it with ~2000 fetches in a row, not actually dead photos. That run
 * happened to land safely (the flaky pass was a --dry-run, the
 * --write a moment later re-checked clean), but a single bad fetch
 * during a --write could just as easily have wiped a real photo. Every
 * check below now retries a failure a few times, with a pause between
 * attempts, before it will call a photo dead -- a URL only gets
 * cleared if it fails consistently, not once.
 *
 *   node scripts/clear-dead-photos.mjs --dry-run
 *   DATABASE_URL="...?sslmode=require" \
 *     node scripts/clear-dead-photos.mjs --write
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, isNotNull } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const WRITE = flag("write");

const UA = "TopLocalSpecialists-maintenance/1.0 (dead photo check; contact site owner)";
const FETCH_TIMEOUT_MS = 20_000;
const CHECK_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Set it in backend/.env or on the command line.");
  process.exit(1);
}
if (/[<>]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL looks like the placeholder, not a real connection string.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "image/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    // A dead upload host still answers 200 with its SPA's index.html
    // for any unknown path -- content-type is the real tell, not status.
    const type = res.headers.get("content-type") ?? "";
    return type.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* Only a URL that fails every attempt counts as dead -- one bad fetch
   (a rate limit, a dropped connection) is noise, not evidence. */
async function isAlive(url) {
  for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt += 1) {
    if (await fetchOnce(url)) return true;
    if (attempt < CHECK_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  return false;
}

const db = getDb();

/* table: the drizzle table (for .from/.where/.update). nameColumn: that
   table's own column to print alongside the slug -- fullName for
   specialists, name for facilities; the two tables don't share a
   column name here, so this stays explicit rather than guessed. */
async function sweep(table, nameColumn, label) {
  const rows = await db
    .select({ id: table.id, slug: table.slug, name: nameColumn, photoUrl: table.photoUrl })
    .from(table)
    .where(isNotNull(table.photoUrl));

  console.log(`\n${label}: ${rows.length} row(s) with a photoUrl -- checking each...`);

  let dead = 0;
  for (const row of rows) {
    const alive = await isAlive(row.photoUrl);
    if (alive) continue;
    dead += 1;
    console.log(`  ${WRITE ? "clearing" : "would clear"} ${label} ${row.slug} (${row.name}): ${row.photoUrl}`);
    if (WRITE) {
      await db.update(table).set({ photoUrl: null }).where(eq(table.id, row.id));
    }
  }
  console.log(`${label}: ${dead} dead of ${rows.length}.`);
  return { total: rows.length, dead };
}

const specialistResult = await sweep(t.specialists, t.specialists.fullName, "specialist");
const facilityResult = await sweep(t.facilities, t.facilities.name, "facility");

console.log(
  WRITE
    ? `\nDone. Cleared ${specialistResult.dead + facilityResult.dead} dead photoUrl(s) -- these listings now show the normal placeholder.`
    : `\nDry run -- nothing changed. Would clear ${specialistResult.dead + facilityResult.dead} dead photoUrl(s). Drop --dry-run (pass --write) to apply.`
);
console.log(
  "\nThese are real named people/businesses -- pass the list above to whoever owns each listing so they can\n" +
    "re-upload their real photo through production (it's Cloudinary-backed, so it will stick this time)."
);

await disconnectDb();
