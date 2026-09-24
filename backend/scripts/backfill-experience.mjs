#!/usr/bin/env node
import pg from "pg";

/* ------------------------------------------------------------------ *
 * Backfill years_experience from evidence in the listing's own
 * description -- never invents a number. Only touches rows where
 * years_experience = 0 (the set list-zero-experience.mjs reports).
 *
 * Usage:
 *   DATABASE_URL="postgres://...?sslmode=require" node scripts/backfill-experience.mjs
 *   DATABASE_URL="..." node scripts/backfill-experience.mjs --write
 * ------------------------------------------------------------------ */

const WRITE = process.argv.includes("--write");

const PATTERNS = [
  /\b(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:clinical\s+|professional\s+|medical\s+|surgical\s+)?experience\b/i,
  /\bover\s+(\d{1,2})\s*years?\b/i,
  /\bwith\s+(\d{1,2})\+?\s*years?\b/i,
  /\b(\d{1,2})\+?\s*years?\s+(?:in\s+practice|as\s+a|as\s+an|of\s+practice)\b/i,
];

function extractYears(text) {
  if (!text) return null;
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 60) {
        return { years: n, snippet: m[0], index: m.index };
      }
    }
  }
  return null;
}

function context(text, index, matchLength) {
  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, index + matchLength + 25);
  return `…${text.slice(start, end).trim()}…`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL first.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT id, full_name, slug, bio
     FROM specialists
     WHERE years_experience = 0`
  );

  console.log(`Checking ${rows.length} listing(s) at 0 years' experience...\n`);

  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const hit = extractYears(row.bio);
    if (hit) {
      matched++;
      console.log(
        `[MATCH] ${row.full_name} (${row.slug}) -> ${hit.years} years\n        ${context(row.bio, hit.index, hit.snippet.length)}`
      );
      if (WRITE) {
        await client.query(
          `UPDATE specialists SET years_experience = $1 WHERE id = $2`,
          [hit.years, row.id]
        );
      }
    } else {
      unmatched++;
    }
  }

  console.log(`\n${matched} matched with cited evidence, ${unmatched} left unset (no explicit mention found).`);
  console.log(WRITE ? "Written." : "Dry run only -- re-run with --write to apply.");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
