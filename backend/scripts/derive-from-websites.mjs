#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Treatments from the practices' own websites
 *
 *   node scripts/derive-from-websites.mjs                  # report
 *   node scripts/derive-from-websites.mjs --write          # apply
 *   node scripts/derive-from-websites.mjs --max=20         # per listing
 *
 * The description pass reached 43% of listings, because that is how
 * many wrote anything specific about themselves on the old site. 679
 * gave a website instead, and a practice's own site is first-party
 * content -- they wrote it, they published it, and the migration
 * covers it. It is the only source left that is both reachable in bulk
 * and unambiguous about whose words it is.
 *
 * Three parts, and they are separate on purpose:
 *
 *   fetch-websites.mjs     asks the servers, politely, once
 *   lib/source-match.mjs   decides whether a page is about this listing
 *   lib/treatment-matcher  decides what the words name
 *
 * The middle one is the part that matters. 44 of the 679 listings give
 * a url another listing also gives -- Mr Amit Parmar and Mr Jonathan
 * Fussey both point at midlandhealth.co.uk/ent, which is their
 * department's page -- and a pass that read those and filed everything
 * on them under either man would be inventing a clinician's services.
 * Nothing is read here until the gate says the page is theirs, and the
 * report prints the refusals with the check each one failed.
 *
 * WHAT IT WILL NOT CLAIM. Nothing is marked verified. Verified means
 * somebody checked a register, and no register has been checked. This
 * says only: their own website says they do this.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { verdict } from "./lib/source-match.mjs";
import { leaves, matchers, matchIn } from "./lib/treatment-matcher.mjs";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES = path.join(BACKEND, "data", "harvest", "sites");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const a = args.find((x) => x.startsWith(`--${f}=`));
  return a ? Number(a.split("=")[1]) || d : d;
};
const WRITE = has("--write");
const VERBOSE = has("--verbose");
const MAX_PER_LISTING = num("max", 20);

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

if (!isDbConfigured()) { console.error(`\n${c.bad}No DATABASE_URL.${c.off}\n`); process.exit(1); }
const url = process.env.DATABASE_URL ?? "";
if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
  console.error(`\n${c.bad}That DATABASE_URL is Render's INTERNAL hostname.${c.off} Use dpg-xxxx-a.frankfurt-postgres.render.com\n`);
  process.exit(1);
}
const db = getDb();
let host = "(unparseable DATABASE_URL)";
try { host = new URL(url).hostname; } catch { /* keep the placeholder */ }

if (!fs.existsSync(SITES)) {
  console.error(`\n${c.bad}No data/harvest/sites/.${c.off} Run npm run sites:fetch first.\n`);
  process.exit(1);
}

/* ------------------------------------------------------- the listings */

const [specialists, specialties, locLinks, allLocations, cities] = await Promise.all([
  db.select({
    id: t.specialists.id, slug: t.specialists.slug, fullName: t.specialists.fullName,
    primarySpecialtyId: t.specialists.primarySpecialtyId, claimed: t.specialists.claimed,
  }).from(t.specialists),
  db.select({ id: t.specialties.id, parentId: t.specialties.parentId, slug: t.specialties.slug }).from(t.specialties),
  db.select().from(t.specialistClinicLocations),
  db.select().from(t.clinicLocations),
  db.select({ id: t.cities.id, name: t.cities.name }).from(t.cities),
]);

const specialtyById = new Map(specialties.map((s) => [s.id, s]));
const rootSlugOf = (specialtyId) => {
  let node = specialtyById.get(specialtyId);
  while (node?.parentId) node = specialtyById.get(node.parentId);
  return node?.slug ?? null;
};
const cityById = new Map(cities.map((x) => [x.id, x]));
const locationById = new Map(allLocations.map((l) => [l.id, l]));
const locationsOf = new Map();
for (const l of locLinks) {
  const loc = locationById.get(l.clinicLocationId);
  if (!loc) continue;
  if (!locationsOf.has(l.specialistId)) locationsOf.set(l.specialistId, []);
  locationsOf.get(l.specialistId).push(loc);
}
const bySlug = new Map(specialists.map((s) => [s.slug, s]));

/* Every leaf name in a branch, so the gate's discipline check can ask
   whether the page talks about this listing's field at all. Asking only
   about its own two tags would fail most pages -- nobody writes
   "General Physiotherapy" on their homepage. */
const leafNamesByRoot = new Map();
for (const l of leaves) {
  if (!leafNamesByRoot.has(l.root)) leafNamesByRoot.set(l.root, []);
  leafNamesByRoot.get(l.root).push(l.name);
}

/* What each listing already has, so the report can separate what the
   website adds from what the description already said. */
const [haveTreatments, haveConditions, allTreatments, allConditions] = await Promise.all([
  db.select().from(t.specialistTreatments),
  db.select().from(t.specialistConditions),
  db.select({ id: t.treatments.id, slug: t.treatments.slug }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug }).from(t.conditions),
]);
const treatmentSlugById = new Map(allTreatments.map((r) => [r.id, r.slug]));
const conditionSlugById = new Map(allConditions.map((r) => [r.id, r.slug]));
const alreadyHas = new Map();
const note = (specialistId, slug) => {
  if (!slug) return;
  if (!alreadyHas.has(specialistId)) alreadyHas.set(specialistId, new Set());
  alreadyHas.get(specialistId).add(slug);
};
for (const r of haveTreatments) note(r.specialistId, treatmentSlugById.get(r.treatmentId));
for (const r of haveConditions) note(r.specialistId, conditionSlugById.get(r.conditionId));

/* ---------------------------------------------------------- the pass */

const files = fs.readdirSync(SITES).filter((f) => f.endsWith(".json"));
console.log(`\n${c.dim}database  ${host}${c.off}`);
console.log(`${c.dim}${files.length} cached site(s), ${matchers.length} matchable leaves${c.off}\n`);

const results = [];
const refused = new Map();
let noListing = 0;
let unreadable = 0;
let cappedCount = 0;
const totals = { negated: 0, crossBranch: 0, redundant: 0, academicOnly: 0 };

for (const f of files) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(SITES, f), "utf8")); } catch { continue; }
  const s = bySlug.get(rec.slug);
  if (!s) { noListing += 1; continue; }

  const text = (rec.pages ?? []).map((p) => p.text ?? "").join("\n");
  if (!text.trim()) { unreadable += 1; continue; }

  const loc = (locationsOf.get(s.id) ?? [])[0] ?? null;
  const root = rootSlugOf(s.primarySpecialtyId);
  const v = verdict({
    listing: {
      fullName: s.fullName,
      town: loc ? cityById.get(loc.cityId)?.name : null,
      postcode: loc?.postcode ?? null,
      telephone: loc?.phone ?? null,
      branch: root,
      leafNames: leafNamesByRoot.get(root) ?? [],
    },
    source: { url: rec.url, text, claimedByOtherListings: rec.claimedByOtherListings ?? 0 },
  });

  if (!v.pass) {
    for (const check of v.checks) if (!check.pass) refused.set(check.name, (refused.get(check.name) ?? 0) + 1);
    results.push({ slug: rec.slug, name: s.fullName, pass: false, why: v.why, checks: v.checks });
    continue;
  }

  const m = matchIn(text, root);
  totals.negated += m.negated;
  totals.crossBranch += m.crossBranch.length;
  totals.redundant += m.redundant;
  totals.academicOnly += m.academicOnly;

  const known = alreadyHas.get(s.id) ?? new Set();
  let picks = m.picks.filter((x) => !known.has(x.leaf.slug));
  const before = picks.length;
  if (picks.length > MAX_PER_LISTING) {
    /* A page naming forty different procedures is a service directory,
       not a profile. Keep the longest names -- the specific ones -- and
       say how many were dropped rather than quietly filing all forty. */
    picks = [...picks].sort((a, b) => b.leaf.name.length - a.leaf.name.length).slice(0, MAX_PER_LISTING);
    cappedCount += 1;
  }

  results.push({
    slug: rec.slug, name: s.fullName, pass: true, url: rec.url,
    root, picks, alreadyKnew: m.picks.length - before, trimmed: before - picks.length,
    specialistId: s.id, claimed: s.claimed,
  });
}

/* -------------------------------------------------------- the report */

const passed = results.filter((r) => r.pass);
const withNew = passed.filter((r) => r.picks.length);
const allPicks = withNew.flatMap((r) => r.picks);
const asTreatment = allPicks.filter((x) => x.leaf.kind === "treatment");
const asCondition = allPicks.filter((x) => x.leaf.kind === "condition");

console.log(`  cached sites read                  ${files.length}`);
if (noListing) console.log(`  ${c.dim}cached but no longer a listing     ${noListing}${c.off}`);
if (unreadable) console.log(`  ${c.dim}cached with no text                ${unreadable}${c.off}`);
console.log(`  ${c.good}the gate allowed${c.off}                   ${passed.length}`);
console.log(`  ${c.warn}the gate refused${c.off}                   ${results.length - passed.length}`);
for (const [k, n] of [...refused].sort((a, b) => b[1] - a[1])) console.log(`${c.dim}      ${String(n).padStart(4)}  ${k}${c.off}`);
console.log("");
console.log(`  listings the website adds to       ${withNew.length}`);
console.log(`  new procedures to file             ${asTreatment.length}`);
console.log(`  new conditions to file             ${asCondition.length}`);
console.log(`  ${c.dim}named, but already on the listing  ${passed.reduce((n, r) => n + r.alreadyKnew, 0)}${c.off}`);
if (cappedCount) console.log(`  ${c.warn}trimmed to ${MAX_PER_LISTING} on ${cappedCount} listing(s)${c.off} ${c.dim}(${withNew.reduce((n, r) => n + r.trimmed, 0)} dropped — a page naming that many is a service list)${c.off}`);
console.log(`  ${c.dim}skipped, said NOT offered          ${totals.negated}${c.off}`);
console.log(`  ${c.dim}skipped, outside its own branch    ${totals.crossBranch}${c.off}`);
console.log(`  ${c.dim}dropped, a longer name covered it  ${totals.redundant}${c.off}`);
console.log(`  ${c.dim}dropped, only in a CV sentence     ${totals.academicOnly}${c.off}`);

const tally = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x.leaf.name, (m.get(x.leaf.name) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 10);
};
if (asTreatment.length) {
  console.log(`\n  most-named procedures:`);
  for (const [n, k] of tally(asTreatment)) console.log(`      ${String(k).padStart(3)}  ${n}`);
}
if (asCondition.length) {
  console.log(`\n  most-named conditions:`);
  for (const [n, k] of tally(asCondition)) console.log(`      ${String(k).padStart(3)}  ${n}`);
}

console.log(`\n  a sample, with the sentence each one came from:\n`);
for (const r of withNew.slice(0, VERBOSE ? withNew.length : 8)) {
  console.log(`    ${c.bold}${r.name}${c.off}  ${c.dim}${r.root}${c.off}`);
  dim(`      ${r.url}`);
  for (const p of r.picks.slice(0, VERBOSE ? 99 : 4)) {
    console.log(`      ${p.leaf.kind === "treatment" ? "procedure" : "condition"}  ${p.leaf.name}`);
    dim(`        “${p.sentence.replace(/\s+/g, " ").slice(0, 120)}…”`);
  }
  if (!VERBOSE && r.picks.length > 4) dim(`      …and ${r.picks.length - 4} more`);
  console.log("");
}

if (!WRITE) {
  console.log(`Report only — nothing was written. Pass ${c.warn}--write${c.off} to apply.`);
  console.log(`${c.dim}--verbose prints every listing and every sentence.${c.off}\n`);
  await disconnectDb();
  process.exit(0);
}

/* --------------------------------------------------------- the write */

const { newId } = t;
const specialtyRows = await db.select({ id: t.specialties.id, slug: t.specialties.slug }).from(t.specialties);
const specialtyBySlug = new Map(specialtyRows.map((s) => [s.slug, s]));

/* Resolve the distinct leaves once, then insert in batches. The same
   lesson as the description pass: one round trip per link to Frankfurt
   is twenty minutes of silence and a half-applied migration. */
const distinct = new Map();
for (const r of withNew) for (const p of r.picks) if (!distinct.has(p.leaf.slug)) distinct.set(p.leaf.slug, p.leaf);

const idBySlug = {
  treatment: new Map(allTreatments.map((r) => [r.slug, r.id])),
  condition: new Map(allConditions.map((r) => [r.slug, r.id])),
};
const toCreate = { treatment: [], condition: [] };
for (const leaf of distinct.values()) {
  if (idBySlug[leaf.kind].has(leaf.slug)) continue;
  toCreate[leaf.kind].push({
    id: newId(leaf.kind === "treatment" ? "trt" : "cnd"),
    slug: leaf.slug, name: leaf.name,
    specialtyId: specialtyBySlug.get(leaf.root)?.id ?? null,
  });
}
for (const [kind, table] of [["treatment", t.treatments], ["condition", t.conditions]]) {
  const rows = toCreate[kind];
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(table).values(rows.slice(i, i + 200)).onConflictDoNothing();
  }
}

/* Re-read rather than trusting .returning(), which gives nothing back
   for a row that conflicted. */
const [freshTreatments, freshConditions] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug }).from(t.conditions),
]);
idBySlug.treatment = new Map(freshTreatments.map((r) => [r.slug, r.id]));
idBySlug.condition = new Map(freshConditions.map((r) => [r.slug, r.id]));

const unresolved = [...distinct.values()].filter((l) => !idBySlug[l.kind].has(l.slug));
if (unresolved.length) {
  console.error(`\n${c.bad}${unresolved.length} leaf/leaves have no taxonomy row after the insert. Nothing was linked.${c.off}`);
  for (const l of unresolved) console.error(`  ${l.kind}  ${l.slug}`);
  await disconnectDb();
  process.exit(1);
}

const treatmentLinks = [];
const conditionLinks = [];
for (const r of withNew) {
  for (const p of r.picks) {
    const id = idBySlug[p.leaf.kind].get(p.leaf.slug);
    if (!id) continue;
    if (p.leaf.kind === "treatment") treatmentLinks.push({ specialistId: r.specialistId, treatmentId: id });
    else conditionLinks.push({ specialistId: r.specialistId, conditionId: id });
  }
}

/* These are additions, never a replacement: whatever the description
   pass found stays. onConflictDoNothing makes a re-run a no-op. */
for (const [label, table, rows] of [
  ["procedure", t.specialistTreatments, treatmentLinks],
  ["condition", t.specialistConditions, conditionLinks],
]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db.insert(table).values(chunk).onConflictDoNothing();
    console.log(`${c.dim}  ${label} links ${Math.min(i + chunk.length, rows.length)}/${rows.length}${c.off}`);
  }
}

console.log(
  `\n${c.good}Done.${c.off} ${treatmentLinks.length + conditionLinks.length} link(s) added across ${withNew.length} listing(s), ` +
    `from ${toCreate.treatment.length} new procedure and ${toCreate.condition.length} new condition row(s).\n` +
    `Every one came from a page the match gate confirmed belongs to that listing.\n` +
    `None of it is marked verified: verified means a register was checked, and none was.\n`
);

await disconnectDb();
