#!/usr/bin/env node
import fs from "node:fs";
import pg from "pg";

/* ------------------------------------------------------------------ *
 * Enriching the 362 already-imported Expert Witness listings with the
 * 9 narrative CV sections + areas-of-expertise tags scraped from their
 * own source pages (McCollum Consultants / ExpertWitness.co.uk).
 *
 * These 362 people are already specialists rows -- imported earlier via
 * the generic `import-specialists.mjs` from expert-witness-import.csv,
 * keyed on source_url. This script does NOT create anyone; it only
 * UPDATEs an existing row matched by source_url, filling in the columns
 * added in drizzle/0017_expert_witness_profile_fields.sql. A row with
 * no matching specialist is reported and skipped, never inserted.
 *
 * Never invents, never destroys: a null in the source JSON leaves the
 * existing column value alone (COALESCE), it never blanks out something
 * already there.
 *
 * personalEmail / personalPhone / personalWebsite / fullAddress from the
 * source data are deliberately NOT written here -- roughly a third of
 * rows are flagged isSharedAgencyContact (a shared switchboard number
 * for the whole practice, not the individual's own line), and telling
 * those apart from a real personal contact needs a human decision, not
 * a heuristic baked into an import script. Left for a follow-up.
 *
 * Usage:
 *   DATABASE_URL="postgres://...?sslmode=require" node scripts/enrich-expert-witnesses.mjs
 *   DATABASE_URL="..." node scripts/enrich-expert-witnesses.mjs --write
 * ------------------------------------------------------------------ */

const WRITE = process.argv.includes("--write");
const FILE = process.argv.find((a) => !a.startsWith("--") && !a.endsWith("enrich-expert-witnesses.mjs") && !a.includes("/node"))
  || new URL("../../imports/expert-witness-enriched.jsonl", import.meta.url).pathname;

const FIELD_MAP = {
  medicoLegalExperience: "medico_legal_experience",
  clinicalPracticeExperience: "clinical_practice_experience",
  clinicalInterests: "clinical_interests",
  managementExperience: "management_experience",
  researchInterests: "research_interests",
  publicationsSummary: "summary_of_publications",
  memberships: "memberships",
  awardsRecognition: "prizes_and_awards",
};

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL first.");
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) {
    console.error(`Can't find ${FILE}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim());
  const rows = lines.map((l) => JSON.parse(l));
  console.log(`Read ${rows.length} enriched record(s) from ${FILE}\n`);

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: existing } = await client.query(
    `SELECT id, full_name, slug, source_url FROM specialists WHERE source_url IS NOT NULL`
  );
  const bySourceUrl = new Map(existing.map((r) => [r.source_url, r]));

  let matched = 0;
  let unmatched = 0;
  let noNewData = 0;
  const unmatchedList = [];

  for (const row of rows) {
    const specialist = bySourceUrl.get(row.sourceUrl);
    if (!specialist) {
      unmatched++;
      unmatchedList.push(row.sourceUrl);
      continue;
    }

    const values = {};
    for (const [jsonKey, column] of Object.entries(FIELD_MAP)) {
      values[column] = clean(row[jsonKey]);
    }
    const tags = Array.isArray(row.clinicalAreasOfExpertise)
      ? row.clinicalAreasOfExpertise.map((s) => String(s).trim()).filter(Boolean)
      : null;

    const hasAnything = Object.values(values).some((v) => v !== null) || (tags && tags.length);
    if (!hasAnything) {
      noNewData++;
      continue;
    }

    matched++;
    console.log(`[MATCH] ${specialist.full_name} (${specialist.slug})`);

    if (WRITE) {
      await client.query(
        `UPDATE specialists SET
           medico_legal_experience = COALESCE($1, medico_legal_experience),
           clinical_practice_experience = COALESCE($2, clinical_practice_experience),
           clinical_interests = COALESCE($3, clinical_interests),
           management_experience = COALESCE($4, management_experience),
           research_interests = COALESCE($5, research_interests),
           summary_of_publications = COALESCE($6, summary_of_publications),
           memberships = COALESCE($7, memberships),
           prizes_and_awards = COALESCE($8, prizes_and_awards),
           areas_of_expertise = COALESCE($9, areas_of_expertise)
         WHERE id = $10`,
        [
          values.medico_legal_experience,
          values.clinical_practice_experience,
          values.clinical_interests,
          values.management_experience,
          values.research_interests,
          values.summary_of_publications,
          values.memberships,
          values.prizes_and_awards,
          tags && tags.length ? tags : null,
          specialist.id,
        ]
      );
    }
  }

  console.log(`\n${matched} matched with new data, ${noNewData} matched but had nothing new, ${unmatched} had no specialist row (never imported).`);
  if (unmatchedList.length) {
    console.log("Unmatched source URLs:");
    for (const u of unmatchedList) console.log(`  ${u}`);
  }
  console.log(WRITE ? "Written." : "Dry run only -- re-run with --write to apply.");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
