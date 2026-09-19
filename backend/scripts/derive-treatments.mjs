#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Filling the Treatments tab from what each listing already says
 *
 *   node scripts/derive-treatments.mjs --from-csv     # offline report
 *   node scripts/derive-treatments.mjs                # report, live db
 *   node scripts/derive-treatments.mjs --write        # apply
 *   node scripts/derive-treatments.mjs --kinds        # write the review file
 *
 * Every listing imported from the old site landed with an empty
 * Treatments tab, because the importer had nothing to put in it: the
 * old site records a category and a paragraph of prose, not a
 * structured list of procedures. 2,400 profiles reading "hasn't listed
 * individual treatments yet" is a directory that cannot answer the
 * question people come to it with.
 *
 * WHERE THE DATA COMES FROM, AND WHERE IT DOES NOT.
 *
 * It comes from the listing's own description — the clinician's or the
 * practice's own words, on the client's own site, which is why the
 * harvest was legitimate in the first place. A match is verbatim: the
 * procedure's name appears in the prose, at a word boundary. Nothing is
 * inferred from a related word, nothing is inferred from the specialty,
 * and nothing is inferred from another listing that looks similar.
 *
 * It does NOT come from a search engine. Attributing a procedure to a
 * named, registered clinician because a search result mentioned them
 * near it is how a directory ends up telling a patient that a hip
 * surgeon does shoulders. This site already carries one example of what
 * invented credentials cost — the GMC numbers on the old site — and a
 * treatment list is read the same way a badge is: as something somebody
 * checked.
 *
 * THE BRANCH GUARD. A match only counts if the procedure sits under the
 * listing's own primary specialty. "Back pain" in an orthopaedic
 * surgeon's bio is his work; the same words in a dentist's bio are
 * almost certainly a sentence about posture at the chair. Cross-branch
 * hits are counted and reported but never written.
 *
 * NEGATION. "We do not treat children", "no longer performs knee
 * replacement", "referred on for hip replacement" — a procedure named
 * in order to say it is not offered is worse than no data at all, so
 * the sentence around each hit is checked before it counts.
 *
 * PROVENANCE. Every link records the sentence it came from, so any
 * entry on any profile can be traced back to the words that produced
 * it. Nothing here is marked verified: verified means a person checked
 * a register, and no register was consulted.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* The matcher, and every guard inside it, lives in one module so that
   the website pass uses exactly these rules rather than a copy that
   drifts the first time somebody fixes one of them. */
import { leaves, matchers, aliasesFor, readCsvText, matchIn } from "./lib/treatment-matcher.mjs";
import { placeListingSlugs } from "./lib/place-listings.mjs";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const FROM_CSV = has("--from-csv");
const WRITE = has("--write");
const WRITE_KINDS = has("--kinds");

/* --replace: clear what a previous run of THIS script put on a listing
   before writing again.

   Without it the write only adds, so a guard added after the fact --
   like the CV-sentence one below -- cannot take anything back, and a
   correction is invisible. With it, a re-run is the state the current
   rules produce rather than the union of every run ever made.

   It only ever clears UNCLAIMED listings. Once a clinician has taken
   ownership, what is on their profile may be theirs rather than
   derived, and no script should quietly delete it.

   AND IT ONLY EVER CLEARS ITS OWN ROWS. That took a column to make
   true. The delete here used to be "every link on this listing", which
   is the only thing a bare join table lets you say, and on the run of
   17 September it destroyed the 1,787 links the website pass had
   written on every listing the two passes had in common. They came back
   because that pass is deterministic and could be run again; nothing
   about the delete made that certain. specialist_treatments.source now
   records which writer produced each row, so this clears
   source = 'description' and leaves every other writer alone.

   The exception is the rows written before that column existed, which
   are null and cannot be attributed to either pass. This script adopts
   them — it clears them too, exactly as it did before, and says how
   many. After one description-then-website cycle there are none left
   and the order of the two passes stops mattering. */
const REPLACE = has("--replace");
const LIMIT = (() => {
  const hit = args.find((a) => a.startsWith("--sample="));
  return hit ? Number(hit.split("=")[1]) : 12;
})();

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m" };
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

/* ------------------------------------------------- the kinds file */

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const kindsFile = path.join(BACKEND, "data", "taxonomy-kinds.csv");

if (WRITE_KINDS) {
  const lines = [
    "# How each leaf of the specialty tree is treated by",
    "# scripts/derive-treatments.mjs: is it something a patient HAS, or",
    "# something a clinician DOES?",
    "#",
    "# The kinds below were produced by a keyword rule and it is wrong in",
    "# places. Correct a row here and the correction wins, permanently.",
    "# kind: treatment | condition | skip",
    "#",
    "# matchesOn is what the scanner actually looks for in a description.",
    "#",
    "slug,kind,name,branch,matchesOn",
    ...leaves.map((l) => [l.slug, l.kind, l.name, l.root, aliasesFor(l.name).join(" | ")].map(cell).join(",")),
  ];
  fs.writeFileSync(kindsFile, lines.join("\n") + "\n");
  console.log(`\n→ ${path.relative(BACKEND, kindsFile)}  (${leaves.length} leaves)\n`);
  process.exit(0);
}


/* --------------------------------------------------------- the people */

let people = [];
if (FROM_CSV) {
  const file = path.join(BACKEND, "data", "harvest", "mapped.csv");
  if (!fs.existsSync(file)) {
    console.error(`\nNo ${path.relative(BACKEND, file)} — run map-taxonomy.mjs --write first.\n`);
    process.exit(1);
  }
  people = readCsvText(fs.readFileSync(file, "utf8")).map((r) => ({
    id: r.slug,
    slug: r.slug,
    name: r.name,
    bio: r.description,
    root: r.primarySpecialtySlug,
  }));
  console.log(`\n${c.dim}source    data/harvest/mapped.csv — ${people.length} listing(s), nothing will be written${c.off}`);
} else {
  const { getDb, disconnectDb, isDbConfigured } = await import("../src/db/client.js");
  if (!isDbConfigured()) {
    console.error(`\n${c.bad}No DATABASE_URL.${c.off} Use --from-csv for an offline report.\n`);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? "";
  if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
    console.error(`\n${c.bad}That DATABASE_URL is Render's INTERNAL hostname${c.off} — use the .frankfurt-postgres.render.com one.\n`);
    process.exit(1);
  }
  const t = await import("../src/db/schema.js");
  const db = getDb();
  const rows = await db
    .select({ id: t.specialists.id, slug: t.specialists.slug, name: t.specialists.fullName, bio: t.specialists.bio, primarySpecialtyId: t.specialists.primarySpecialtyId })
    .from(t.specialists);
  const specialties = await db.select().from(t.specialties);
  const byId = new Map(specialties.map((s) => [s.id, s]));
  const rootOf = (id) => {
    let n = byId.get(id);
    while (n?.parentId) n = byId.get(n.parentId);
    return n?.slug ?? null;
  };
  people = rows.map((r) => ({ ...r, root: rootOf(r.primarySpecialtyId) }));
  let host = "(unparseable)";
  try { host = new URL(url).hostname; } catch { /* keep it */ }
  console.log(`\n${c.dim}database  ${host} — ${people.length} listing(s)${c.off}`);
  globalThis.__db = { db, t, disconnectDb };
}

/* ---------------------------------------------------------- the match */

const found = new Map();      // person id -> [{ leaf, sentence }]
const crossBranch = [];
const borrowed = [];
let negatedHits = 0;
let redundant = 0;
let academicOnly = 0;
let alsoNamedHere = 0;
let withBio = 0;
let places = 0;

/* A hospital is not a clinician. See scripts/lib/place-listings.mjs. */
const PLACES = placeListingSlugs();

for (const p of people) {
  if (PLACES.has(p.slug)) { places += 1; continue; }
  if (!String(p.bio ?? "").trim()) continue;
  withBio += 1;
  const r = matchIn(p.bio, p.root);
  negatedHits += r.negated;
  redundant += r.redundant;
  academicOnly += r.academicOnly;
  alsoNamedHere += r.alsoNamedHere;
  for (const x of r.crossBranch) crossBranch.push({ person: p.name, leaf: x.leaf, theirs: p.root, its: x.root });
  for (const x of r.borrowed) borrowed.push({ person: p.name, leaf: x.leaf, theirs: p.root, its: x.root });
  if (r.picks.length) found.set(p.id, r.picks);
}

const all = [...found.values()].flat();
const asTreatment = all.filter((x) => x.leaf.kind === "treatment");
const asCondition = all.filter((x) => x.leaf.kind === "condition");

console.log(`${c.dim}leaves    ${matchers.length} matchable of ${leaves.length}${c.off}\n`);
console.log(`  listings with a description        ${withBio}`);
if (places) console.log(`  ${c.dim}a place, not a person — skipped    ${places}${c.off}`);
console.log(`  listings that named something      ${found.size}  (${Math.round((100 * found.size) / people.length)}% of all)`);
console.log(`  procedures to file                 ${asTreatment.length}`);
console.log(`  conditions to file                 ${asCondition.length}`);
console.log(`  mean per listing                   ${(all.length / Math.max(found.size, 1)).toFixed(1)}`);
if (negatedHits) console.log(`  ${c.warn}skipped, named to say it is NOT offered   ${negatedHits}${c.off}`);
if (crossBranch.length) console.log(`  ${c.warn}skipped, a procedure from another branch  ${crossBranch.length}${c.off}`);
if (borrowed.length) console.log(`  ${c.dim}a condition filed under another branch    ${borrowed.length}${c.off}`);
if (alsoNamedHere) console.log(`  ${c.dim}another profession's name for the same     ${alsoNamedHere}${c.off}`);
if (redundant) console.log(`  ${c.dim}dropped, a more specific name covered it     ${redundant}${c.off}`);
if (academicOnly) console.log(`  ${c.warn}dropped, only named in a sentence about their CV  ${academicOnly}${c.off}`);

const tally = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x.leaf.name, (m.get(x.leaf.name) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
for (const [label, set] of [["procedures", asTreatment], ["conditions", asCondition]]) {
  if (!set.length) continue;
  console.log(`\n  most-named ${label}:`);
  for (const [n, v] of tally(set).slice(0, 10)) console.log(`    ${String(v).padStart(5)}  ${n}`);
}

if (LIMIT > 0 && found.size) {
  console.log(`\n  a sample, with the sentence each one came from:`);
  let shown = 0;
  for (const [id, picks] of found) {
    if (shown >= LIMIT) break;
    const p = people.find((x) => x.id === id);
    console.log(`\n    ${p.name}  ${c.dim}(${p.root})${c.off}`);
    for (const { leaf, sentence } of picks.slice(0, 4)) {
      console.log(`      ${leaf.kind === "treatment" ? "procedure" : "condition"}  ${leaf.name}`);
      dim(`        “${sentence.slice(0, 150)}${sentence.length > 150 ? "…" : ""}”`);
    }
    shown += 1;
  }
}

/* WHY THERE IS NO "THIS LISTING IS MISFILED" REPORT HERE.
 *
 * There was, twice. The branch guard looked like a free diagnostic:
 * when a listing keeps naming procedures from one other branch, surely
 * the listing is the thing that is wrong? Mr Benjamin Davis is filed
 * under Gynaecology and opens "I am a Consultant in Trauma,
 * Orthopaedics and Limb Reconstruction", and he named six orthopaedic
 * procedures before anything noticed.
 *
 * The first version flagged 41 listings, of which about one was wrong.
 * A physiotherapist naming knee replacement, ACL reconstruction and
 * rotator cuff repair is not misfiled: that is what they rehabilitate.
 * An ENT surgeon naming rhinoplasty is not misfiled either.
 *
 * The second version added "and named nothing from their own branch",
 * on the theory that a real physio's bio would name physiotherapy. It
 * flagged 25, still mostly physiotherapists -- because the
 * Physiotherapy branch's leaves are named "General Physiotherapy" and
 * "Musculoskeletal Physiotherapy", which is not how anybody writes
 * about themselves. The absence proved something about the taxonomy,
 * not about the listing.
 *
 * The signal that does work is the one map-taxonomy.mjs already has:
 * the prose STATES a profession. Saying "I am a Consultant in
 * Orthopaedics" is evidence; naming an operation is not. That check
 * belongs there, next to the category it contradicts, and a report
 * that is wrong 24 times out of 25 is worse than no report, because
 * the next person stops reading it. Hence: none here. */

if (borrowed.length) {
  /* Applied, not skipped -- see the note in lib/treatment-matcher.mjs.
     Printed so the borrowing is visible rather than silent. */
  console.log(`\n  ${c.dim}conditions taken from another branch (a complaint is the patient's):${c.off}`);
  const seen = new Set();
  for (const x of borrowed) {
    const k = `${x.leaf}|${x.theirs}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > 8) break;
    dim(`    ${x.person.slice(0, 34).padEnd(36)} ${x.leaf} (${x.its}) on a ${x.theirs} listing`);
  }
}

if (crossBranch.length) {
  console.log(`\n  ${c.warn}not applied — named a procedure from another branch:${c.off}`);
  const seen = new Set();
  for (const x of crossBranch) {
    const k = `${x.leaf}|${x.theirs}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > 8) break;
    dim(`    ${x.person.slice(0, 34).padEnd(36)} ${x.leaf} (${x.its}) in a ${x.theirs} listing`);
  }
}

if (FROM_CSV || !WRITE) {
  console.log(`\n${FROM_CSV ? "Offline report" : "Report only"} — nothing was written.` + (FROM_CSV ? "" : ` Pass ${c.warn}--write${c.off} to apply.`) + "\n");
  if (globalThis.__db) await globalThis.__db.disconnectDb();
  process.exit(0);
}

/* ---------------------------------------------------------- the write */

const { db, t, disconnectDb } = globalThis.__db;
const { eq, and, or, inArray, isNull, sql } = await import("drizzle-orm");
const { newId } = t;

/* What this pass signs its work with. Taken from the schema, not
   spelled out here, so the writer below and the delete above can never
   drift apart — a typo in one of two string literals is a pass that
   writes rows it can no longer find. */
const MY_SOURCE = t.LINK_SOURCES.description;

const specialties = await db.select().from(t.specialties);
const specialtyBySlug = new Map(specialties.map((s) => [s.slug, s]));

/* ONE ROUND TRIP PER LEAF, NOT PER LINK.
 *
 * The first version of this did a SELECT and an INSERT for every one of
 * the 3,500 links, serially, against a database in Frankfurt. At the
 * ~200ms a round trip actually costs from a laptop that is about twenty
 * minutes of silence with no progress output, which is indistinguishable
 * from a hang -- and the first real run was cut short partway, leaving
 * the treatments and conditions tables populated and not one link
 * written. A half-applied migration is the worst outcome available here,
 * because everything looks like it worked until you open a profile.
 *
 * So: resolve the distinct leaves once (a few hundred, not 3,500), then
 * insert the links in batches. Roughly 7,000 round trips becomes a few
 * dozen, and the whole thing finishes while you are still looking at it. */

const distinctLeaves = new Map();
for (const picks of found.values()) {
  for (const { leaf } of picks) if (!distinctLeaves.has(leaf.slug)) distinctLeaves.set(leaf.slug, leaf);
}

const [existingTreatments, existingConditions] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug }).from(t.conditions),
]);
const idBySlug = {
  treatment: new Map(existingTreatments.map((r) => [r.slug, r.id])),
  condition: new Map(existingConditions.map((r) => [r.slug, r.id])),
};

const toCreate = { treatment: [], condition: [] };
for (const leaf of distinctLeaves.values()) {
  if (idBySlug[leaf.kind].has(leaf.slug)) continue;
  toCreate[leaf.kind].push({
    id: newId(leaf.kind === "treatment" ? "trt" : "cnd"),
    slug: leaf.slug,
    name: leaf.name,
    specialtyId: specialtyBySlug.get(leaf.root)?.id ?? null,
  });
}
for (const [kind, table] of [["treatment", t.treatments], ["condition", t.conditions]]) {
  const rows = toCreate[kind];
  if (!rows.length) continue;
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(table).values(rows.slice(i, i + 200)).onConflictDoNothing();
  }
}

/* Re-read rather than trusting .returning(). onConflictDoNothing()
   returns nothing for a row that conflicted, so a slug that already
   existed under a different id would be missing from the map and its
   links would be dropped without a word. Two round trips buys the
   guarantee that every leaf we are about to link has an id. */
const [allTreatments, allConditions] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug }).from(t.conditions),
]);
idBySlug.treatment = new Map(allTreatments.map((r) => [r.slug, r.id]));
idBySlug.condition = new Map(allConditions.map((r) => [r.slug, r.id]));

const unresolved = [...distinctLeaves.values()].filter((l) => !idBySlug[l.kind].has(l.slug));
if (unresolved.length) {
  console.error(
    `\n${c.bad}${unresolved.length} leaf/leaves have no taxonomy row after the insert.${c.off}\n` +
      `Nothing has been linked. This is a bug, not a data problem — the slugs are:\n` +
      unresolved.map((l) => `  ${l.kind}  ${l.slug}`).join("\n") +
      `\n`
  );
  await disconnectDb();
  process.exit(1);
}

let cleared = 0;

if (REPLACE) {
  /* Every unclaimed listing that carries a row this pass owns — not
     just the ones it matched something on today. A listing whose bio
     stopped naming anything, or that a guard has since decided against,
     is exactly the case a re-do needs to reach, and scoping the clear
     to today's matches would leave it holding what a looser rule gave
     it. Broad is safe here only because the delete is scoped by source.

     The null rows go with them, everywhere, for the same reason: leave
     any behind and the audit's "(none recorded)" never reaches zero, so
     the ambiguity outlives the migration that was meant to end it. */
  const claimed = new Set(
    (await db.select({ id: t.specialists.id }).from(t.specialists).where(eq(t.specialists.claimed, true))).map((r) => r.id)
  );
  const owned = await Promise.all([
    db.select({ id: t.specialistTreatments.specialistId }).from(t.specialistTreatments)
      .where(or(eq(t.specialistTreatments.source, MY_SOURCE), isNull(t.specialistTreatments.source))),
    db.select({ id: t.specialistConditions.specialistId }).from(t.specialistConditions)
      .where(or(eq(t.specialistConditions.source, MY_SOURCE), isNull(t.specialistConditions.source))),
  ]);
  const ids = [...new Set(owned.flat().map((r) => r.id))];
  const clearable = ids.filter((id) => !claimed.has(id));

  /* Count the unattributed rows before touching them, so the one run
     that adopts them says so out loud instead of after the fact. */
  const legacy = clearable.length
    ? (
        await Promise.all([
          db.select({ n: sql`count(*)::int` }).from(t.specialistTreatments)
            .where(and(inArray(t.specialistTreatments.specialistId, clearable), isNull(t.specialistTreatments.source))),
          db.select({ n: sql`count(*)::int` }).from(t.specialistConditions)
            .where(and(inArray(t.specialistConditions.specialistId, clearable), isNull(t.specialistConditions.source))),
        ])
      ).reduce((a, r) => a + (r[0]?.n ?? 0), 0)
    : 0;

  /* Mine, plus the ones nobody signed for. Everything else — a claimed
     clinician's own list, an admin's edit, the website pass's finds —
     is somebody else's row and stays where it is. */
  const mine = (col) => or(eq(col, MY_SOURCE), isNull(col));
  for (let i = 0; i < clearable.length; i += 200) {
    const chunk = clearable.slice(i, i + 200);
    await db.delete(t.specialistTreatments).where(
      and(inArray(t.specialistTreatments.specialistId, chunk), mine(t.specialistTreatments.source))
    );
    await db.delete(t.specialistConditions).where(
      and(inArray(t.specialistConditions.specialistId, chunk), mine(t.specialistConditions.source))
    );
    cleared += chunk.length;
  }
  const skipped = ids.length - clearable.length;
  console.log(`${c.dim}cleared this pass's own links on ${cleared} unclaimed listing(s)` +
    (skipped ? `, left ${skipped} claimed one(s) alone` : "") + `${c.off}`);
  if (legacy) {
    console.log(
      `${c.warn}! ${legacy} of those had no source recorded${c.off} — written before the column existed,\n` +
        `  so unattributable to either pass. This pass adopts them, which is the only\n` +
        `  way to end the ambiguity, and it means this one run clears the website pass's\n` +
        `  earlier work along with its own.\n` +
        `  ${c.dim}Re-run ${c.off}npm run treatments:websites -- --write${c.dim} after this, once, to put it back.\n` +
        `  From then on every row is signed, each pass deletes only what it wrote, and\n` +
        `  the order of the two stops mattering.${c.off}`
    );
  }
}

const treatmentLinks = [];
const conditionLinks = [];
for (const [personId, picks] of found) {
  for (const { leaf } of picks) {
    const id = idBySlug[leaf.kind].get(leaf.slug);
    if (!id) continue;
    if (leaf.kind === "treatment") treatmentLinks.push({ specialistId: personId, treatmentId: id, source: MY_SOURCE });
    else conditionLinks.push({ specialistId: personId, conditionId: id, source: MY_SOURCE });
  }
}
/* Say something on every batch. The previous run's silence is the whole
   reason it got killed halfway. */
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

const madeTreatments = treatmentLinks.length;
const madeConditions = conditionLinks.length;
const links = madeTreatments + madeConditions;
console.log(
  `${c.dim}created ${toCreate.treatment.length} new procedure and ${toCreate.condition.length} new condition row(s) in the taxonomy${c.off}`
);

console.log(
  `\n${c.good}Done.${c.off} ${links} link(s) across ${found.size} listing(s) — ` +
    `${madeTreatments} procedure and ${madeConditions} condition link(s).\n` +
    `Every one came from the listing's own description, verbatim. None of it is\n` +
    `marked verified: verified means somebody checked a register, and none was.\n`
);
await disconnectDb();
