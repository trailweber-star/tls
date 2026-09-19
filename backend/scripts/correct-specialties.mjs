#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Re-filing listings the old site put in the wrong branch
 *
 *   node scripts/correct-specialties.mjs           # report only
 *   node scripts/correct-specialties.mjs --write   # apply
 *
 * map-taxonomy.mjs decides a listing's branch from the old site's own
 * category, which is the right thing for it to do: the category is the
 * only statement the source makes about what a listing is, and
 * second-guessing 2,400 of them from prose would invent more errors
 * than it fixed. But the old site's "Psychologist" category was used as
 * a catch-all, so a handful of listings arrived in a branch that has
 * nothing to do with them — three aesthetics clinics and two sports
 * massage businesses filed as psychology, and a dual dental-and-
 * aesthetics practice filed as dentistry alone.
 *
 * That is not a mapper bug to fix in code. It is six decisions, and
 * they live in data/specialty-corrections.csv with the reasoning
 * written next to each one, the same way facility-moves.csv holds the
 * listings that turned out to be places rather than people.
 *
 * WHY THE BRANCH MATTERS MORE THAN A LABEL. It decides which filters
 * find the listing, and it decides what derive-treatments.mjs will
 * match: the branch guard only credits a leaf from the listing's own
 * branch. An aesthetics clinic filed under psychology cannot match
 * microneedling however plainly it offers it, and can match Depression
 * from a sentence about how its facials make people feel. So a move
 * invalidates whatever was derived under the old branch, and this
 * script clears it rather than leaving answers to the wrong question on
 * the profile.
 *
 * WHAT IT REFUSES TO DO.
 *
 *   A claimed listing. Once a clinician owns the profile, what branch
 *   it sits in is a conversation with them, not a script.
 *
 *   A line whose from column no longer matches. That column records
 *   what the listing was when somebody read it. If the live row says
 *   something else, the decision was made against a state that has
 *   since changed and applying it would be acting on stale reading.
 *
 *   A hold. Two of these have nowhere correct to go — Physiotherapist
 *   is a protected title and a massage business is not entitled to it —
 *   so the decision recorded is that there is no decision yet. They are
 *   printed every run, unapplied, until the tree grows a home for them
 *   or they are rejected the way Harborne Chiropractic was.
 *
 *   Anything a person put on the profile. Links tagged source =
 *   'profile' survive the clear; only the derived ones go.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");

const c = {
  off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m",
  bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m",
};
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

/* The derivation passes' rows, and the ones from before provenance was
   recorded, which cannot be told apart from them. A person's own list
   is not in here and does not get cleared. */
const DERIVED = [t.LINK_SOURCES.description, t.LINK_SOURCES.website];

if (!isDbConfigured()) {
  console.error(`\n${c.bad}No DATABASE_URL.${c.off} This script only makes sense against a real database.\n`);
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? "";
if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
  console.error(
    `\n${c.bad}That DATABASE_URL is Render's INTERNAL hostname.${c.off}\n` +
      `It only resolves from inside Render. From your machine use the external one:\n` +
      `  dpg-xxxx-a.frankfurt-postgres.render.com\n`
  );
  process.exit(1);
}
const db = getDb();

/* ------------------------------------------------------- the decisions */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((x) => x.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const file = path.join(BACKEND, "data", "specialty-corrections.csv");
if (!fs.existsSync(file)) {
  console.error(`\nNo data/specialty-corrections.csv — nothing has been decided.\n`);
  process.exit(1);
}
const decisions = parseCsv(
  fs.readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
);
if (!decisions.length) {
  console.log("\nNo corrections in data/specialty-corrections.csv.\n");
  await disconnectDb();
  process.exit(0);
}

const bad = decisions.filter((d) => !["move", "hold"].includes(d.action));
if (bad.length) {
  console.error(`\n${c.bad}${bad.length} line(s) with an action that is neither move nor hold:${c.off}`);
  for (const d of bad) console.error(`  ${d.slug}  action="${d.action}"`);
  console.error("");
  process.exit(1);
}

/* ---------------------------------------------------------- the state */

/* SAY WHICH DATABASE THIS IS, before saying anything about it. The
   backend's .env points at localhost and the live data is on Render, so
   a shell where the external URL was never exported reads an
   eighteen-row local database, finds none of these six listings, and
   reports a clean bill of health for the wrong machine. */
const listings = await db
  .select({
    id: t.specialists.id,
    slug: t.specialists.slug,
    fullName: t.specialists.fullName,
    sourceUrl: t.specialists.sourceUrl,
    claimed: t.specialists.claimed,
    primarySpecialtyId: t.specialists.primarySpecialtyId,
  })
  .from(t.specialists);

let host = "(unparseable DATABASE_URL)";
try { host = new URL(url).hostname; } catch { /* keep the placeholder */ }
console.log(`\n${c.dim}database  ${host} — ${listings.length} listing(s)${c.off}`);
console.log(`${c.dim}${decisions.length} correction(s) in data/specialty-corrections.csv${c.off}\n`);

const specialties = await db
  .select({ id: t.specialties.id, slug: t.specialties.slug, name: t.specialties.name, parentId: t.specialties.parentId })
  .from(t.specialties);
const spBySlug = new Map(specialties.map((s) => [s.slug, s]));
const spById = new Map(specialties.map((s) => [s.id, s]));
/* Root first, then down to the node itself — the chain the importer
   tags, so a corrected listing is tagged exactly as a correctly
   imported one would have been. */
const chainOf = (slug) => {
  const out = [];
  let n = spBySlug.get(slug);
  while (n) { out.unshift(n); n = n.parentId ? spById.get(n.parentId) : null; }
  return out;
};
const slugOfId = (id) => (id ? spById.get(id)?.slug ?? null : null);

const bySlug = new Map(listings.map((r) => [r.slug, r]));

/* The slug in the decisions file is the harvest slug; the database
   makes its own from the listing's name, and the two agree for these
   six. When they ever stop agreeing, the source URL is the identity
   that does not change, so fall back to it rather than reporting a
   listing absent when it is only renamed. */
const mappedFile = path.join(BACKEND, "data", "harvest", "mapped.csv");
const urlByHarvestSlug = new Map();
if (fs.existsSync(mappedFile)) {
  for (const r of parseCsv(fs.readFileSync(mappedFile, "utf8"))) {
    if (r.slug && r.url) urlByHarvestSlug.set(r.slug, r.url);
  }
}
const bySourceUrl = new Map(listings.filter((r) => r.sourceUrl).map((r) => [r.sourceUrl, r]));
const findListing = (harvestSlug) => {
  const direct = bySlug.get(harvestSlug);
  if (direct) return direct;
  const u = urlByHarvestSlug.get(harvestSlug);
  for (const [k, v] of bySourceUrl) if (u && (k === u || k.endsWith(u))) return v;
  return null;
};

/* ------------------------------------------------ what each line does */

const ids = [];
for (const d of decisions) {
  const hit = findListing(d.slug);
  if (hit) ids.push(hit.id);
}
const [trLinks, cdLinks] = ids.length
  ? await Promise.all([
      db.select().from(t.specialistTreatments).where(inArray(t.specialistTreatments.specialistId, ids)),
      db.select().from(t.specialistConditions).where(inArray(t.specialistConditions.specialistId, ids)),
    ])
  : [[], []];
const derivedCount = new Map();
const ownCount = new Map();
for (const r of [...trLinks, ...cdLinks]) {
  const m = r.source && !DERIVED.includes(r.source) ? ownCount : derivedCount;
  m.set(r.specialistId, (m.get(r.specialistId) ?? 0) + 1);
}

const ready = [];
const held = [];
const absent = [];

for (const d of decisions) {
  const hit = findListing(d.slug);
  if (!hit) { absent.push(d); continue; }

  const isNow = slugOfId(hit.primarySpecialtyId);
  const reasons = [];
  if (d.action === "hold") reasons.push("the decision is that there is no decision yet");
  if (hit.claimed) reasons.push("the listing has been claimed");
  if (d.fromSpecialtySlug && isNow !== d.fromSpecialtySlug) {
    reasons.push(`its primary is "${isNow ?? "(none)"}", not the "${d.fromSpecialtySlug}" this line was written against`);
  }
  if (d.action === "move" && !spBySlug.has(d.toSpecialtySlug)) {
    reasons.push(`"${d.toSpecialtySlug}" is not a specialty in this database — run sync-taxonomy.mjs first`);
  }
  const alsoTag = d.alsoTag ? d.alsoTag.split(/\s+/).filter(Boolean) : [];
  const unknownTags = alsoTag.filter((s) => !spBySlug.has(s));
  if (unknownTags.length) reasons.push(`alsoTag names no such specialty: ${unknownTags.join(", ")}`);

  const row = { ...d, ...hit, isNow, alsoTag, derived: derivedCount.get(hit.id) ?? 0, own: ownCount.get(hit.id) ?? 0 };
  if (reasons.length) held.push({ ...row, reasons });
  else ready.push(row);
}

if (absent.length) {
  console.log(`${absent.length} not in the database — nothing to correct:`);
  for (const d of absent) dim(`  ${d.slug}`);
  console.log("");
}

for (const r of held) {
  console.log(`${c.warn}! ${r.fullName}${c.off} — NOT moved: ${r.reasons.join("; ")}`);
  dim(`    /specialists/${r.slug}`);
  dim(`    would be  ${r.isNow ?? "(none)"} → ${r.toSpecialtySlug}`);
  dim(`    ${r.reason}`);
}
if (held.length) console.log("");

if (ready.length) {
  console.log(`${c.bold}${ready.length} listing(s) to re-file:${c.off}\n`);
  for (const r of ready) {
    const chain = chainOf(r.toSpecialtySlug);
    console.log(`  ${r.fullName}`);
    dim(`    /specialists/${r.slug}`);
    console.log(`    ${c.dim}primary${c.off}  ${r.isNow ?? "(none)"} ${c.good}→${c.off} ${r.toSpecialtySlug}`);
    dim(`    tagged   ${[...chain.map((s) => s.slug), ...r.alsoTag].join(", ")}`);
    if (r.derived) {
      console.log(`    ${c.warn}clears${c.off}   ${r.derived} derived treatment/condition link(s) — matched against the old branch`);
    }
    if (r.own) dim(`    keeps    ${r.own} link(s) somebody put on the profile`);
    dim(`    ${r.reason}`);
    console.log("");
  }
}

if (!ready.length) {
  console.log(`${c.good}Nothing to apply.${c.off}\n`);
  await disconnectDb();
  process.exit(0);
}

if (!WRITE) {
  console.log(`Report only — nothing was changed. Pass ${c.warn}--write${c.off} to apply.\n`);
  await disconnectDb();
  process.exit(0);
}

/* ------------------------------------------------------------ the write */

let moved = 0;
let cleared = 0;
for (const r of ready) {
  const chain = chainOf(r.toSpecialtySlug);
  const target = chain[chain.length - 1];
  const tagIds = [...new Set([...chain.map((s) => s.id), ...r.alsoTag.map((s) => spBySlug.get(s).id)])];

  await db.transaction(async (tx) => {
    await tx
      .update(t.specialists)
      .set({ primarySpecialtyId: target.id, updatedAt: new Date() })
      .where(eq(t.specialists.id, r.id));

    /* The whole chain, because that is what the importer writes and
       what the facet filters read: a listing in a sub-specialty has to
       appear under its root too. */
    await tx.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialistId, r.id));
    await tx
      .insert(t.specialistSpecialties)
      .values(tagIds.map((specialtyId) => ({ specialistId: r.id, specialtyId })))
      .onConflictDoNothing();

    /* The derived links, and the ones from before provenance was
       recorded — which the derivation passes wrote, even though the
       rows cannot prove it. A person's own list is untouched. */
    const mine = (col) => or(inArray(col, DERIVED), isNull(col));
    for (const table of [t.specialistTreatments, t.specialistConditions]) {
      await tx.delete(table).where(and(eq(table.specialistId, r.id), mine(table.source)));
    }
  });

  cleared += r.derived;
  moved += 1;
  console.log(`${c.good}✓${c.off} ${r.fullName} → ${r.toSpecialtySlug}`);
}

console.log(
  `\n${c.good}${moved} listing(s) re-filed${c.off}` +
    (cleared ? `, ${cleared} link(s) derived under the old branch cleared` : "") +
    (held.length ? `. ${held.length} held back — see above.` : ".") +
    `\n\nThey now have no derived treatments, which is honest but empty. Re-derive, in\nthis order:\n` +
    `  npm run treatments:derive -- --write --replace\n` +
    `  npm run treatments:websites -- --write\n`
);

await disconnectDb();
