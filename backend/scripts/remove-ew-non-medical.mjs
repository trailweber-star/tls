#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Removes the non-medical practice-area categories that ended up as
 * children of Expert Witness > Medicolegal (they came in during the
 * McCollum Consultants import, alongside the genuinely medical ones,
 * and polluted the "Type of report" filter on the Expert Witnesses
 * search page with categories no medical expert witness actually
 * covers as their subject-matter: Product Liability, Housing
 * Disrepair, Family Law Reports, Employment & Occupational Health,
 * Immigration & Asylum Reports).
 *
 * Deliberately NOT touching Criminal Injuries Compensation or Fitness
 * to Practise & Regulatory -- those were the two categories originally
 * requested, and real doctors are tagged under both.
 *
 * For each target slug this:
 *   1. deletes every specialist_specialties row pointing at it (every
 *      specialist affected also carries Personal Injury / Clinical
 *      Negligence, so nobody drops out of search -- verified via the
 *      live API before writing this script)
 *   2. deletes the specialty row itself
 *
 *   node scripts/remove-ew-non-medical.mjs            # report only
 *   node scripts/remove-ew-non-medical.mjs --write     # apply
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

const TARGET_SLUGS = [
  "product-liability",
  "housing-disrepair",
  "family-law-reports",
  "employment-occupational-health",
  "immigration-asylum-reports",
];

if (!isDbConfigured()) {
  console.error("No database configured. Set DATABASE_URL.");
  process.exit(1);
}
const db = getDb();

const rows = await db.select().from(t.specialties);
const bySlug = new Map(rows.map((r) => [r.slug, r]));

console.log(`${c.bold}Removing non-medical Expert Witness practice areas${c.off}${WRITE ? "" : `  ${c.dim}(dry run -- pass --write to apply)${c.off}`}\n`);

let totalLinksDeleted = 0;
let totalNodesDeleted = 0;

for (const slug of TARGET_SLUGS) {
  const node = bySlug.get(slug);
  if (!node) {
    console.log(`${c.dim}${slug}: not found, skipping${c.off}`);
    continue;
  }

  const links = await db
    .select({ specialistId: t.specialistSpecialties.specialistId })
    .from(t.specialistSpecialties)
    .where(eq(t.specialistSpecialties.specialtyId, node.id));

  console.log(`${c.bold}${node.name}${c.off} [${slug}]  ->  ${links.length} specialist link(s)`);

  if (WRITE) {
    if (links.length) {
      await db.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialtyId, node.id));
    }
    await db.delete(t.specialties).where(eq(t.specialties.id, node.id));
    console.log(`  ${c.good}deleted.${c.off}`);
  }

  totalLinksDeleted += links.length;
  totalNodesDeleted += 1;
}

console.log(
  `\n${WRITE ? c.good : c.warn}${WRITE ? "Done" : "Would remove"}: ${totalNodesDeleted} taxonomy row(s), ${totalLinksDeleted} specialist link(s).${c.off}`
);
if (!WRITE) console.log(`${c.dim}Re-run with --write to apply.${c.off}`);

await disconnectDb();
