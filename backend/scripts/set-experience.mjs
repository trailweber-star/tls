#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Write a researched years-of-experience figure onto one specialist
 *
 * Pairs with list-zero-experience.mjs. One specialist per run, by
 * design -- each figure comes from a source checked by hand (a
 * register, a hospital bio, a clinic page), never a guess, so there is
 * no batch/bulk mode here to accidentally run ahead of that checking.
 *
 *   DATABASE_URL="...?sslmode=require" \
 *     node scripts/set-experience.mjs --slug=mr-kirti-moholkar --years=22 --source="https://www.phin.org.uk/..."
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SLUG = option("slug");
const YEARS = option("years");
const SOURCE = option("source");

if (!SLUG || YEARS === null) {
  console.error('Usage: node scripts/set-experience.mjs --slug=<slug> --years=<n> [--source="<url>"]');
  process.exit(1);
}
const years = Number(YEARS);
if (!Number.isInteger(years) || years < 0 || years > 80) {
  console.error("--years must be a whole number between 0 and 80");
  process.exit(1);
}
if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = getDb();
const specialist = await db.query.specialists.findFirst({ where: eq(t.specialists.slug, SLUG) });

if (!specialist) {
  console.error(`No specialist with slug "${SLUG}"`);
  await disconnectDb();
  process.exit(1);
}

await db.update(t.specialists).set({ yearsExperience: years }).where(eq(t.specialists.id, specialist.id));
console.log(
  `Updated ${specialist.fullName} (${SLUG}): years_experience ${specialist.yearsExperience} -> ${years}` +
    (SOURCE ? `  [source: ${SOURCE}]` : "")
);
await disconnectDb();
