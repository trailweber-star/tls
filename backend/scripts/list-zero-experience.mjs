#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * List every specialist recorded with 0 years of experience
 *
 * Read-only -- prints a de-duplicated worksheet so a real figure can be
 * researched and written back with a follow-up script, rather than
 * guessed. sourceUrl/sourceName (where the BD import scraped this
 * listing from originally) is included because it is usually the
 * fastest, most reliable way to confirm who someone actually is before
 * trusting a Google result for a common name.
 *
 *   DATABASE_URL="...?sslmode=require" node scripts/list-zero-experience.mjs
 *   DATABASE_URL="...?sslmode=require" node scripts/list-zero-experience.mjs --json
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const asJson = process.argv.includes("--json");

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set -- point it at the database you want to read.");
  process.exit(1);
}

const db = getDb();

const rows = await db.query.specialists.findMany({
  where: eq(t.specialists.yearsExperience, 0),
  columns: {
    id: true,
    slug: true,
    fullName: true,
    title: true,
    qualifications: true,
    claimed: true,
    verificationStatus: true,
    sourceName: true,
    sourceUrl: true,
  },
  with: {
    primarySpecialty: { columns: { name: true } },
  },
  orderBy: (s, { desc }) => [desc(s.claimed), desc(s.ratingCount)],
});

await disconnectDb();

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`${rows.length} specialist(s) with years_experience = 0\n`);
  for (const r of rows) {
    console.log(
      [
        r.claimed ? "[claimed]  " : "[unclaimed]",
        r.fullName,
        r.title ? `— ${r.title}` : "",
        r.primarySpecialty?.name ? `(${r.primarySpecialty.name})` : "",
        `| /specialists/${r.slug}`,
        r.sourceUrl ? `| source: ${r.sourceUrl}` : "| source: none on file",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}
