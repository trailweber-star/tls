#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Importing McCollum Consultants Expert Witness profiles
 *
 *   node scripts/import-expert-witnesses.mjs <file.csv>              # dry run
 *   node scripts/import-expert-witnesses.mjs <file.csv> --write
 *
 * WHY NOT `npm run import` (scripts/import-specialists.mjs). That
 * script is for a hand-made spreadsheet: it fuzzy-matches a loose
 * "category" column against the taxonomy, splits one free-text address
 * into street/town/postcode, and geocodes it for a pin. Every one of
 * those is a guess appropriate to a sheet that has not already answered
 * the question -- and this file HAS already answered it.
 * all-expert-witnesses-mapped.csv is the direct output of a careful,
 * per-profile extraction pass: `specialty_slugs` already names the exact
 * taxonomy leaves (see scripts/add-ew-medical-specialty.mjs), and there
 * is no address at all to guess at -- Expert Witness listings use a
 * regions-covered model, not a clinic pin (see migration
 * 0013_covered_regions.sql). Running it through the fuzzy importer
 * would silently downgrade a resolved slug to a guess and try to
 * geocode a field that was never a street address in the first place.
 * So this is a dedicated importer, built the same way as the generic
 * one (same id prefixes, same unclaimed-account shell, same
 * verification rules) but reading exactly the columns this CSV has.
 *
 * SAME THREE RULES AS THE GENERIC IMPORTER, because they are not
 * specific to that script, they are how this site imports anybody:
 *  1. No ratings -- there are none in this data anyway.
 *  2. Nobody arrives verified. Every row lands `unverified`, `claimed: false`.
 *  3. Nothing is invented. A blank cell stays a blank column. This CSV
 *     was built specifically to leave a field blank rather than guess
 *     (see the *-notes.md files beside it) -- this script honours that
 *     rather than papering over it.
 *
 * WHAT GETS TAGGED. Every row gets the taxonomy leaves in its own
 * `specialty_slugs` column (the clinical specialty -- Breast Surgery,
 * Cardiology, ...) PLUS "Personal Injury" and "Clinical Negligence"
 * under Medicolegal by default, matching the convention the original
 * 362-row McCollum import already established (every medico-legal
 * expert covers those two case types; a more specific case type is
 * added by hand later where known, not guessed here).
 *
 * IDEMPOTENT. Rows are keyed on source_url, same as the generic
 * importer -- a second run updates rather than duplicates.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { newId } from "../src/db/schema.js";
import { UNUSABLE_PASSWORD } from "../src/lib/auth.js";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const file = args.find((a) => !a.startsWith("--"));
const SOURCE = "McCollum Consultants";

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

function refusePlaceholderUrl() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return;
  const looksLikeAPlaceholder =
    /[<>]/.test(url) ||
    /paste|your[-_ ]?(render|db|database)|PASTE_URL|example\.com|localhost:0/i.test(url) ||
    !/^postgres(ql)?:\/\//i.test(url);
  if (!looksLikeAPlaceholder) return;
  console.error(
    "DATABASE_URL does not look like a real connection string:\n" +
    `  ${url.slice(0, 60)}${url.length > 60 ? "…" : ""}\n\n` +
    "Paste the actual value, not a placeholder."
  );
  process.exit(1);
}
refusePlaceholderUrl();

if (!file) {
  console.error(`
Import Expert Witness profiles from all-expert-witnesses-mapped.csv.

  node scripts/import-expert-witnesses.mjs <file.csv>          Report only
  node scripts/import-expert-witnesses.mjs <file.csv> --write  Apply

Requires the new columns from schema.js (medicoLegalExperience etc.) to
already exist -- run 'npm run db:generate' + 'npm run db:migrate' first --
and the Medical Specialty taxonomy leaves to already exist -- run
'node scripts/add-ew-medical-specialty.mjs' + 'node scripts/sync-taxonomy.mjs --write'
first. This script checks both and refuses cleanly if either is missing.
`);
  process.exit(1);
}
if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Can't find ${file}`);
  process.exit(1);
}

/* ------------------------------------------------------------- CSV read */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const rows = parseCsv(fs.readFileSync(file, "utf8"));
if (!rows.length) { console.error("No data rows in that file."); process.exit(1); }

const REQUIRED_COLS = ["full_name", "source_url", "specialty_slugs"];
const missingCols = REQUIRED_COLS.filter((c) => !(c in rows[0]));
if (missingCols.length) {
  console.error(`This doesn't look like all-expert-witnesses-mapped.csv -- missing column(s): ${missingCols.join(", ")}`);
  process.exit(1);
}

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
/* "Consultant Plastic Surgeon; MB ChB, ..." -> title / qualifications.
   The extraction notes documented this as job-title and post-nominal
   lines joined with "; " -- split on the first one only, so a
   qualifications string that itself contains "; " stays whole. */
function splitTitle(raw) {
  const s = clean(raw);
  if (!s) return { title: null, qualifications: null };
  const i = s.indexOf("; ");
  if (i === -1) return { title: s, qualifications: null };
  return { title: s.slice(0, i).trim(), qualifications: s.slice(i + 2).trim() || null };
}

const db = getDb();

/* -------------------------------------------------------- preflight */

const specialtyRows = await db.select().from(t.specialties);
const specialtyBySlug = new Map(specialtyRows.map((s) => [s.slug, s]));

const missingSlugTable = new Set();
for (const row of rows) {
  for (const slug of (row.specialty_slugs || "").split(";").map((s) => s.trim()).filter(Boolean)) {
    if (!specialtyBySlug.has(slug)) missingSlugTable.add(slug);
  }
}
const DEFAULT_CASE_TYPE_SLUGS = ["personal-injury", "clinical-negligence"];
const missingDefaults = DEFAULT_CASE_TYPE_SLUGS.filter((s) => !specialtyBySlug.has(s));

if (missingSlugTable.size || missingDefaults.length) {
  console.error(`${c.bad}Refusing to import: these taxonomy slugs don't exist in the database yet:${c.off}`);
  for (const s of [...missingDefaults, ...missingSlugTable]) console.error(`  ${s}`);
  console.error(
    `${c.dim}Run 'node scripts/add-ew-medical-specialty.mjs' then ` +
    `'node scripts/sync-taxonomy.mjs --write' first.${c.off}`
  );
  await disconnectDb();
  process.exit(1);
}

// Confirm the new columns exist before writing anything -- a clear
// refusal here beats a half-imported run failing on row 140 of 218.
try {
  await db.select({ x: t.specialists.medicoLegalExperience }).from(t.specialists).limit(1);
} catch (err) {
  console.error(`${c.bad}Refusing to import: the new Expert Witness profile columns aren't in the database yet.${c.off}`);
  console.error(`${c.dim}Run 'npm run db:generate' then 'npm run db:migrate' first (after pulling in the schema.js changes).${c.off}`);
  console.error(`${c.dim}(${err.message})${c.off}`);
  await disconnectDb();
  process.exit(1);
}

const existingSpecialists = await db.select().from(t.specialists);
const bySourceUrl = new Map(existingSpecialists.filter((s) => s.sourceUrl).map((s) => [s.sourceUrl, s]));
const takenSlugs = new Set(existingSpecialists.map((s) => s.slug));

const existingUserRows = await db.select({ id: t.users.id, email: t.users.email }).from(t.users);
const userIdByEmail = new Map(existingUserRows.map((u) => [u.email.toLowerCase(), u.id]));

/* -------------------------------------------------------------- run */

console.log(
  `${c.bold}${rows.length} row(s) in ${path.basename(file)}${c.off}` +
  `${WRITE ? "" : `  ${c.dim}(dry run -- pass --write to apply)${c.off}`}\n`
);

const summary = { created: 0, updated: 0, accounts: 0, skippedNoName: 0, tagLinks: 0 };
const preview = [];

for (const [line, row] of rows.entries()) {
  const fullName = clean(row.full_name);
  if (!fullName) { summary.skippedNoName += 1; continue; }

  const sourceUrl = clean(row.source_url);
  const { title, qualifications } = splitTitle(row.title_credentials);

  const tagSlugs = [
    ...DEFAULT_CASE_TYPE_SLUGS,
    ...(row.specialty_slugs || "").split(";").map((s) => s.trim()).filter(Boolean),
  ];
  const tagIds = [...new Set(tagSlugs.map((s) => specialtyBySlug.get(s)?.id).filter(Boolean))];
  const primarySpecialtyId = specialtyBySlug.get("personal-injury")?.id ?? null;

  const areasOfExpertise = (row.areas_of_expertise || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const values = {
    fullName,
    title,
    qualifications,
    photoUrl: clean(row.photo_url),
    medicoLegalExperience: clean(row.medico_legal_experience),
    clinicalPracticeExperience: clean(row.clinical_practice_experience),
    clinicalInterests: clean(row.clinical_interests),
    managementExperience: clean(row.management_experience),
    researchInterests: clean(row.research_interests),
    summaryOfPublications: clean(row.summary_of_publications),
    teachingTraining: clean(row.teaching_training),
    prizesAndAwards: clean(row.prizes_and_awards),
    memberships: clean(row.memberships),
    areasOfExpertise: areasOfExpertise.length ? areasOfExpertise : null,
    primarySpecialtyId,
    verificationStatus: "unverified",
    claimed: false,
    plan: "basic",
    planStatus: "active",
    sourceName: SOURCE,
    sourceUrl,
    sourceImportedAt: new Date(),
    importSource: {
      contact_email: clean(row.contact_email),
      contact_phone: clean(row.contact_phone),
      base_location: clean(row.base_location),
      categories: row.categories || null,
    },
  };

  const existing = sourceUrl ? bySourceUrl.get(sourceUrl) : null;

  preview.push({
    line: line + 2, // +1 header, +1 1-indexed
    name: fullName,
    action: existing ? "update" : "create",
    tags: tagSlugs.length,
    photo: values.photoUrl ? "yes" : "no",
  });

  if (!WRITE) continue;

  let specialistId = existing?.id ?? null;
  let specialistSlug = existing?.slug ?? null;

  if (existing) {
    await db.update(t.specialists).set(values).where(eq(t.specialists.id, existing.id));
    summary.updated += 1;
  } else {
    const base = slugify(fullName);
    let slug = base;
    for (let n = 2; takenSlugs.has(slug); n += 1) slug = `${base}-${n}`;
    takenSlugs.add(slug);
    specialistSlug = slug;
    const [created] = await db
      .insert(t.specialists)
      .values({ id: newId("sp"), slug, ...values })
      .returning();
    specialistId = created.id;
    if (sourceUrl) bySourceUrl.set(sourceUrl, { id: specialistId, slug, sourceUrl });
    summary.created += 1;
  }

  if (tagIds.length) {
    await db.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialistId, specialistId));
    await db
      .insert(t.specialistSpecialties)
      .values(tagIds.map((specialtyId) => ({ specialistId, specialtyId })))
      .onConflictDoNothing();
    summary.tagLinks += tagIds.length;
  }

  // Same unclaimed-shell-account convention as scripts/import-specialists.mjs.
  const accountEmail = `${specialistSlug}@unclaimed.toplocalspecialists.com`;
  let userId = userIdByEmail.get(accountEmail.toLowerCase()) ?? null;
  if (!userId) {
    userId = newId("usr");
    await db.insert(t.users).values({
      id: userId,
      email: accountEmail,
      passwordHash: UNUSABLE_PASSWORD,
      fullName,
      role: "specialist",
      active: true,
      adminNotes:
        `Unclaimed listing imported from ${SOURCE}. No password has been set; an admin ` +
        `can sign in as them from the members list, and claiming goes through /claims.`,
    });
    userIdByEmail.set(accountEmail.toLowerCase(), userId);
    summary.accounts += 1;
  }
  await db.update(t.specialists).set({ userId }).where(eq(t.specialists.id, specialistId));
}

console.log("line  action  tags  photo  name");
for (const p of preview) {
  console.log(`${String(p.line).padStart(4)}  ${p.action.padEnd(6)}  ${String(p.tags).padStart(4)}  ${p.photo.padEnd(5)}  ${p.name}`);
}

console.log(
  `\n${WRITE ? c.good : c.warn}${WRITE ? "Done" : "Would"}: ` +
  `${summary.created || preview.filter((p) => p.action === "create").length} created, ` +
  `${summary.updated || preview.filter((p) => p.action === "update").length} updated` +
  `${WRITE ? `, ${summary.accounts} new account(s), ${summary.tagLinks} tag link(s)` : ""}.${c.off}`
);
if (summary.skippedNoName) console.log(`${c.warn}${summary.skippedNoName} row(s) skipped -- no name.${c.off}`);
if (!WRITE) console.log(`${c.dim}Re-run with --write to apply.${c.off}`);

await disconnectDb();
