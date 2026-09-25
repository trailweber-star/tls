#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Inserts the 10 new Expert Witness profile columns into
 * backend/src/db/schema.js, right after the `qualifications:` field
 * in the `specialists` table -- the same block described earlier in
 * schema-patch.js, applied programmatically instead of by hand so
 * there's no risk of mis-pasting a ~300-line file through a terminal
 * that has already choked twice on long pastes this session, and no
 * risk of me guessing wrong about a table I haven't seen in full.
 *
 * Idempotent: if the new columns are already present, it no-ops.
 * Refuses outright (no changes made) if it can't find exactly one
 * `qualifications:` field line to anchor on, rather than guessing at
 * the wrong spot.
 *
 *   node scripts/apply-ew-schema-patch.mjs            # dry run
 *   node scripts/apply-ew-schema-patch.mjs --write    # apply
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.join(HERE, "..", "src", "db", "schema.js"),
  path.join(process.cwd(), "backend", "src", "db", "schema.js"),
  path.join(process.cwd(), "src", "db", "schema.js"),
];
const SCHEMA_PATH = CANDIDATES.find((p) => fs.existsSync(p));

const WRITE = process.argv.includes("--write");
const c = { off: "\x1b[0m", dim: "\x1b[2m", warn: "\x1b[33m", bad: "\x1b[31m", good: "\x1b[32m", bold: "\x1b[1m" };

if (!SCHEMA_PATH) {
  console.error(`${c.bad}Couldn't find backend/src/db/schema.js. Run this from backend/scripts/ or the repo root.${c.off}`);
  process.exit(1);
}

const src = fs.readFileSync(SCHEMA_PATH, "utf8");

if (src.includes("medicoLegalExperience")) {
  console.log(`${c.warn}${SCHEMA_PATH} already has the Expert Witness columns -- nothing to do.${c.off}`);
  process.exit(0);
}

const anchorRe = /^([ \t]*)qualifications\s*:\s*.*,\s*$/m;
const allMatches = src.match(new RegExp(anchorRe.source, "gm"));

if (!allMatches || allMatches.length !== 1) {
  console.error(
    `${c.bad}Refusing to touch the file: expected exactly one "qualifications:" field line to anchor on, found ${
      allMatches ? allMatches.length : 0
    }.${c.off}`
  );
  console.error(`${c.dim}Nothing was changed. Paste the specialists table block from schema.js and this gets done by hand instead.${c.off}`);
  process.exit(1);
}

const BLOCK = `
    /* ------------------------------------------- Expert Witness profile
       Structured sections particular to a medico-legal CV, imported from
       McCollum Consultants et al. (see scripts/import-expert-witnesses.mjs)
       and rendered as their own labelled sections on the profile page --
       the same shape the source sites use, rather than folded into the
       one generic \`bio\` field above. Null for every specialist outside
       Expert Witness; nothing here is required or invented on import,
       only what the source page actually stated (see rule 3 in
       import-expert-witnesses.mjs). */
    medicoLegalExperience: text("medico_legal_experience"),
    clinicalPracticeExperience: text("clinical_practice_experience"),
    clinicalInterests: text("clinical_interests"),
    managementExperience: text("management_experience"),
    researchInterests: text("research_interests"),
    summaryOfPublications: text("summary_of_publications"),
    teachingTraining: text("teaching_training"),
    prizesAndAwards: text("prizes_and_awards"),
    memberships: text("memberships"),
    /* Fine-grained self-described tags -- "Breast Implants", "Mastopexy",
       "Skin Graft/Flap" -- one level more specific than the specialty
       taxonomy and too numerous per person (20-30 each) to make filterable
       nodes of without drowning the "Type of report" filter. Shown as
       tag pills on the profile instead; the taxonomy link
       (specialistSpecialties) is what search actually filters on. */
    areasOfExpertise: text("areas_of_expertise").array(),`;

if (!WRITE) {
  const line = allMatches[0].trim();
  console.log(`${c.dim}Dry run -- found the anchor line:${c.off}`);
  console.log(`  ${line}`);
  console.log(`${c.dim}Would insert 10 new columns right after it. Pass --write to apply.${c.off}`);
  process.exit(0);
}

const updated = src.replace(anchorRe, (line) => `${line}${BLOCK}`);
fs.writeFileSync(SCHEMA_PATH, updated);

console.log(`${c.bold}${c.good}Inserted 10 Expert Witness columns into specialists, right after qualifications:.${c.off}`);
console.log(`  ${SCHEMA_PATH}`);
console.log(`${c.dim}Review with: git diff -- '**/schema.js'${c.off}`);
console.log(`${c.dim}Then: npm run db:generate && npm run db:migrate${c.off}`);
