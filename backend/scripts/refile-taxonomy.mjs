#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Bringing what is already filed into line with the corrected taxonomy
 *
 *   node scripts/refile-taxonomy.mjs            # report
 *   node scripts/refile-taxonomy.mjs --write    # apply
 *   node scripts/refile-taxonomy.mjs --write --prune   # and tidy up
 *
 * data/taxonomy-kinds.csv is the record of which leaves are something a
 * patient HAS and which are something a clinician DOES. Two corrections
 * were made to it after the description pass had already written 3,427
 * links, and neither is retrospective on its own:
 *
 *   1. SEVENTY-FIVE LEAVES WERE ON THE WRONG SIDE. The keyword rule had
 *      no word for a service, so "Fillings", "Dental Hygiene", "Repeat
 *      Prescriptions" and "Well Woman Check" were all filed as things a
 *      patient has. They appeared on profiles under "Conditions
 *      treated", which reads as though the dentist treats fillings.
 *
 *   2. FOURTEEN NAMES ARE FILED TWICE IN THE TREE. "Root Canal
 *      Treatment" sits under both General Dentistry and Endodontics,
 *      "Knee Fracture" under both Knee and Trauma & Fractures. Both
 *      copies matched every time, so both were filed, and the profile
 *      printed the name twice. One of each pair is now skipped.
 *
 * This moves the links that are already there. It creates nothing that
 * was not already claimed about somebody and removes nothing except a
 * second copy of a name they already have.
 *
 * --prune additionally deletes taxonomy rows left with no listings on
 * them, but only where nothing else in the database points at the row.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { leaves } from "./lib/treatment-matcher.mjs";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const PRUNE = args.includes("--prune");

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

if (!isDbConfigured()) { console.error(`\n${c.bad}No DATABASE_URL.${c.off}\n`); process.exit(1); }
const url = process.env.DATABASE_URL ?? "";
if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
  console.error(`\n${c.bad}That DATABASE_URL is Render's INTERNAL hostname.${c.off} Use dpg-xxxx-a.frankfurt-postgres.render.com\n`);
  process.exit(1);
}
const db = getDb();
let host = "(unparseable DATABASE_URL)";
try { host = new URL(url).hostname; } catch { /* keep the placeholder */ }
console.log(`\n${c.dim}database  ${host}${c.off}\n`);

/* ------------------------------------------------------- what is right */

/* The keeper of a duplicated name is the copy that was not skipped.
   Derived rather than written down twice: the csv is the only record. */
const keptByName = new Map();
for (const l of leaves) if (l.kind !== "skip") keptByName.set(l.name.toLowerCase(), l);
const retired = [];
for (const l of leaves) {
  if (l.kind !== "skip") continue;
  const keeper = keptByName.get(l.name.toLowerCase());
  if (keeper && keeper.slug !== l.slug) retired.push({ from: l, to: keeper });
}
const wantKind = new Map();
for (const l of leaves) if (l.kind === "treatment" || l.kind === "condition") wantKind.set(l.slug, l.kind);

/* -------------------------------------------------------- what is there */

const [treatments, conditions, trLinks, cdLinks, specialists] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug, name: t.treatments.name, specialtyId: t.treatments.specialtyId }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug, name: t.conditions.name, specialtyId: t.conditions.specialtyId }).from(t.conditions),
  db.select().from(t.specialistTreatments),
  db.select().from(t.specialistConditions),
  db.select({ id: t.specialists.id, fullName: t.specialists.fullName }).from(t.specialists),
]);
const nameOf = new Map(specialists.map((s) => [s.id, s.fullName]));
const trBySlug = new Map(treatments.map((r) => [r.slug, r]));
const cdBySlug = new Map(conditions.map((r) => [r.slug, r]));
const trById = new Map(treatments.map((r) => [r.id, r]));
const cdById = new Map(conditions.map((r) => [r.id, r]));

const holdsTreatment = new Set(trLinks.map((r) => `${r.specialistId}\u0000${trById.get(r.treatmentId)?.slug}`));
const holdsCondition = new Set(cdLinks.map((r) => `${r.specialistId}\u0000${cdById.get(r.conditionId)?.slug}`));

/* ------------------------------------------ 1. the duplicated names */

const dupMoves = [];   // { specialistId, fromKind, fromSlug, toKind, toSlug, alreadyHadIt }
for (const { from, to } of retired) {
  for (const [kind, links, byId] of [["treatment", trLinks, trById], ["condition", cdLinks, cdById]]) {
    for (const link of links) {
      const id = kind === "treatment" ? link.treatmentId : link.conditionId;
      if (byId.get(id)?.slug !== from.slug) continue;
      const key = `${link.specialistId}\u0000${to.slug}`;
      const already = to.kind === "treatment" ? holdsTreatment.has(key) : holdsCondition.has(key);
      dupMoves.push({ specialistId: link.specialistId, fromKind: kind, fromSlug: from.slug, toKind: to.kind, toSlug: to.slug, name: to.name, already, source: link.source ?? null });
    }
  }
}

/* -------------------------------------------- 2. the wrong-side leaves */

const kindMoves = [];  // { specialistId, from: "condition", to: "treatment", slug }
for (const link of cdLinks) {
  const row = cdById.get(link.conditionId);
  if (!row) continue;
  if (wantKind.get(row.slug) !== "treatment") continue;
  kindMoves.push({ specialistId: link.specialistId, from: "condition", to: "treatment", slug: row.slug, name: row.name, source: link.source ?? null });
}
for (const link of trLinks) {
  const row = trById.get(link.treatmentId);
  if (!row) continue;
  if (wantKind.get(row.slug) !== "condition") continue;
  kindMoves.push({ specialistId: link.specialistId, from: "treatment", to: "condition", slug: row.slug, name: row.name, source: link.source ?? null });
}

/* ------------------------------------------------------------ report */

const countBy = (xs, f) => {
  const m = new Map();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

console.log(`  ${c.bold}names filed twice in the tree${c.off}`);
console.log(`    pairs collapsed to one leaf        ${retired.length}`);
console.log(`    links pointing at the retired copy ${dupMoves.length}`);
console.log(`    ${c.dim}of those, the listing already has the kept copy — so the link is simply removed: ${dupMoves.filter((m) => m.already).length}${c.off}`);
for (const [n, k] of countBy(dupMoves, (m) => m.name).slice(0, 8)) console.log(`${c.dim}      ${String(k).padStart(4)}  ${n}${c.off}`);

console.log(`\n  ${c.bold}leaves on the wrong side of the line${c.off}`);
console.log(`    links to move                      ${kindMoves.length}`);
console.log(`    ${c.dim}listings affected                  ${new Set(kindMoves.map((m) => m.specialistId)).size}${c.off}`);
for (const [n, k] of countBy(kindMoves, (m) => m.name).slice(0, 12)) console.log(`${c.dim}      ${String(k).padStart(4)}  ${n}${c.off}`);

if (kindMoves.length) {
  console.log(`\n  ${c.dim}a sample, in full:${c.off}`);
  for (const m of kindMoves.slice(0, 5)) {
    console.log(`      ${nameOf.get(m.specialistId) ?? m.specialistId}`);
    console.log(`${c.dim}        "${m.name}" moves from ${m.from}s to ${m.to}s${c.off}`);
  }
}

if (!WRITE) {
  console.log(`\nReport only — nothing was written. Pass ${c.warn}--write${c.off} to apply.`);
  console.log(`${c.dim}Add --prune to also delete taxonomy rows left with nothing on them.${c.off}\n`);
  await disconnectDb();
  process.exit(0);
}

/* ------------------------------------------------------------- write */

const { newId } = t;

/* Anything that has to exist on the other side before a link can point
   at it. Created from the leaf, not from the row being vacated, so the
   name and branch come from the tree rather than from a stale copy. */
const specialtyRows = await db.select({ id: t.specialties.id, slug: t.specialties.slug }).from(t.specialties);
const specialtyBySlug = new Map(specialtyRows.map((s) => [s.slug, s]));
const leafBySlug = new Map(leaves.map((l) => [l.slug, l]));

const needed = { treatment: new Set(), condition: new Set() };
for (const m of [...kindMoves]) needed[m.to].add(m.slug);
for (const m of dupMoves) if (!m.already) needed[m.toKind].add(m.toSlug);

const toCreate = { treatment: [], condition: [] };
for (const kind of ["treatment", "condition"]) {
  const have = kind === "treatment" ? trBySlug : cdBySlug;
  for (const slug of needed[kind]) {
    if (have.has(slug)) continue;
    const leaf = leafBySlug.get(slug);
    if (!leaf) continue;
    toCreate[kind].push({
      id: newId(kind === "treatment" ? "trt" : "cnd"),
      slug, name: leaf.name,
      specialtyId: specialtyBySlug.get(leaf.root)?.id ?? null,
    });
  }
}
for (const [kind, table] of [["treatment", t.treatments], ["condition", t.conditions]]) {
  for (let i = 0; i < toCreate[kind].length; i += 200) {
    await db.insert(table).values(toCreate[kind].slice(i, i + 200)).onConflictDoNothing();
  }
}

const [freshTr, freshCd] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug }).from(t.conditions),
]);
const idBySlug = {
  treatment: new Map(freshTr.map((r) => [r.slug, r.id])),
  condition: new Map(freshCd.map((r) => [r.slug, r.id])),
};
const missing = [...needed.treatment].filter((s) => !idBySlug.treatment.has(s))
  .concat([...needed.condition].filter((s) => !idBySlug.condition.has(s)));
if (missing.length) {
  console.error(`\n${c.bad}${missing.length} taxonomy row(s) still missing after the insert. Nothing was moved.${c.off}`);
  for (const s of missing) console.error(`  ${s}`);
  await disconnectDb();
  process.exit(1);
}

/* Add first, then remove. A crash between the two leaves a duplicate,
   which is visible and fixable; the other order loses the claim. */
/* THE SOURCE TRAVELS WITH THE LINK. This script moves a claim from one
   side of the treatment/condition line to the other; it does not
   originate one. So the row it writes keeps whatever provenance the row
   it replaces had — drop it and a derived link becomes unattributed,
   which quietly takes it out of reach of the pass that produced it and
   puts it back in the pile the description pass adopts. */
const adds = { treatment: [], condition: [] };
for (const m of kindMoves) adds[m.to].push({ specialistId: m.specialistId, slug: m.slug, source: m.source });
for (const m of dupMoves) if (!m.already) adds[m.toKind].push({ specialistId: m.specialistId, slug: m.toSlug, source: m.source });

for (const [kind, table, col] of [["treatment", t.specialistTreatments, "treatmentId"], ["condition", t.specialistConditions, "conditionId"]]) {
  const rows = adds[kind].map((a) => ({ specialistId: a.specialistId, [col]: idBySlug[kind].get(a.slug), source: a.source }));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(table).values(rows.slice(i, i + 500)).onConflictDoNothing();
    console.log(`${c.dim}  added ${kind} links ${Math.min(i + 500, rows.length)}/${rows.length}${c.off}`);
  }
}

const removes = { treatment: new Map(), condition: new Map() };
for (const m of kindMoves) {
  if (!removes[m.from].has(m.slug)) removes[m.from].set(m.slug, []);
  removes[m.from].get(m.slug).push(m.specialistId);
}
for (const m of dupMoves) {
  if (!removes[m.fromKind].has(m.fromSlug)) removes[m.fromKind].set(m.fromSlug, []);
  removes[m.fromKind].get(m.fromSlug).push(m.specialistId);
}
let removed = 0;
for (const [kind, table, col, byS] of [
  ["treatment", t.specialistTreatments, t.specialistTreatments.treatmentId, trBySlug],
  ["condition", t.specialistConditions, t.specialistConditions.conditionId, cdBySlug],
]) {
  for (const [slug, ids] of removes[kind]) {
    const rowId = byS.get(slug)?.id;
    if (!rowId) continue;
    for (let i = 0; i < ids.length; i += 500) {
      await db.delete(table).where(and(eq(col, rowId), inArray(table.specialistId, ids.slice(i, i + 500))));
    }
    removed += ids.length;
  }
}
console.log(`${c.dim}  removed ${removed} link(s) from the side they were on${c.off}`);

console.log(
  `\n${c.good}Done.${c.off} ${kindMoves.length} link(s) moved to the right side of the line, ` +
    `${dupMoves.length} second cop${dupMoves.length === 1 ? "y" : "ies"} of a duplicated name cleared, ` +
    `${toCreate.treatment.length + toCreate.condition.length} taxonomy row(s) created.\n` +
    `No claim was added or removed — every one of these was already on the listing, filed in the wrong place.\n`
);

/* ------------------------------------------------------------- prune */

if (!PRUNE) { await disconnectDb(); process.exit(0); }

const [afterTrLinks, afterCdLinks, reviewRows, leadRows, trWithCondition] = await Promise.all([
  db.select({ id: t.specialistTreatments.treatmentId }).from(t.specialistTreatments),
  db.select({ id: t.specialistConditions.conditionId }).from(t.specialistConditions),
  db.select({ conditionId: t.reviews.conditionId }).from(t.reviews),
  db.select({ conditionId: t.leads.conditionId }).from(t.leads),
  db.select({ conditionId: t.treatments.conditionId }).from(t.treatments),
]);
const usedTr = new Set(afterTrLinks.map((r) => r.id));
const usedCd = new Set([
  ...afterCdLinks.map((r) => r.id),
  ...reviewRows.map((r) => r.conditionId),
  ...leadRows.map((r) => r.conditionId),
  ...trWithCondition.map((r) => r.conditionId),
].filter(Boolean));

const deadTr = treatments.filter((r) => !usedTr.has(r.id));
const deadCd = conditions.filter((r) => !usedCd.has(r.id));
console.log(`  ${c.bold}taxonomy rows with nothing on them${c.off}`);
console.log(`    procedures ${deadTr.length}   conditions ${deadCd.length}`);
console.log(`${c.dim}    ${[...deadTr, ...deadCd].slice(0, 12).map((r) => r.name).join(", ")}${c.off}`);
for (const [rows, table, col] of [[deadTr, t.treatments, t.treatments.id], [deadCd, t.conditions, t.conditions.id]]) {
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) await db.delete(table).where(inArray(col, ids.slice(i, i + 500)));
}
console.log(`  ${c.good}pruned ${deadTr.length + deadCd.length} row(s).${c.off}\n`);

await disconnectDb();
