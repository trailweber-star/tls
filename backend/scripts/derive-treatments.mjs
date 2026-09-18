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

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const FROM_CSV = has("--from-csv");
const WRITE = has("--write");
const WRITE_KINDS = has("--kinds");
const LIMIT = (() => {
  const hit = args.find((a) => a.startsWith("--sample="));
  return hit ? Number(hit.split("=")[1]) : 12;
})();

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m" };
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

/* ----------------------------------------------------------- the tree */

const tree = JSON.parse(fs.readFileSync(path.join(BACKEND, "src/data/taxonomy/specialty-tree.json"), "utf8"));
const leaves = [];
(function walk(nodes, rootSlug) {
  for (const n of nodes) {
    const root = rootSlug ?? n.slug;
    const kids = n.children ?? [];
    if (kids.length) walk(kids, root);
    else leaves.push({ name: n.name, slug: n.slug, root });
  }
})(Array.isArray(tree) ? tree : tree.children ?? [], null);

/* Is a leaf something you HAVE, or something somebody DOES to you?
 *
 * The tree does not say, because it did not need to: it exists to file
 * people, and "Knee Replacement" files a surgeon whichever it is. The
 * profile page has two homes for them, so they have to be told apart.
 *
 * The rule below is a first pass and it is wrong in places -- "Painful
 * Knee Replacement" is a complication, not an operation, and the word
 * "replacement" does not know that. So the answers are written to
 * data/taxonomy-kinds.csv, which is in git, and anything corrected
 * there wins. Correct it once and it stays corrected. */
const PROCEDURE = /(replacement|reconstruction|arthroscopy|repair|surgery|surgical|fusion|release|injection|removal|graft|implant|filler|whitening|transplant|augmentation|reduction|decompression|fixation|osteotomy|excision|biopsy|screening|assessment|therapy|therapies|counselling|rehabilitation|revision|plasty\b|ectomy|otomy|oscopy|scopy\b|\blift\b|bracing|orthotics|veneers|crowns|bonding|dentures|braces|aligners|scan\b|ultrasound|vaccination|fitting|treatment|enhancement|contouring|needling|peel\b|sculpt|lipo|extraction|splint|prosthes)/i;
/* A complication of an operation is a condition, whatever words it
   borrows from the operation. These qualifiers say so. */
const COMPLICATION = /^(painful|infected|loose|loosening|stiff|failed|problem)/i;

const kindOf = (name) => {
  if (COMPLICATION.test(name)) return "condition";
  return PROCEDURE.test(name) ? "treatment" : "condition";
};

/* Eighteen leaves carry a slash, and the two sides are not two names.
 * "PCL Injury / Reconstruction" is PCL Injury and PCL RECONSTRUCTION --
 * the right-hand word inherits the qualifier from the left. Splitting
 * naively gives "Reconstruction" as a name of its own, which then
 * matches every bio containing the word, and it did: it came top of the
 * first run with 355 hits, ahead of Knee Replacement. Same for "Repair"
 * out of "Root Meniscus Tear / Repair" and "Arthritis" out of "AC Joint
 * Injury / Arthritis".
 *
 * So a bare word after the slash is grafted onto the qualifier, and a
 * bare word BEFORE it is a standalone synonym -- "Bunion / Hallux
 * Valgus", "Unicompartmental / Partial Knee Replacement" -- which is
 * kept only when the word is distinctive enough to stand alone.
 * Grafting those the same way produces "Hallux Bunion". */
const GENERIC = new Set([
  "balance", "repair", "reconstruction", "arthritis", "injury", "injuries", "surgery",
  "therapy", "treatment", "assessment", "recovery", "mobility", "strength", "posture",
  "wellbeing", "screening", "restoration", "dislocation", "instability", "syndrome",
]);

function aliasesFor(name) {
  const parts = name.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [name];
  const longest = parts.reduce((a, b) => (b.split(/\s+/).length > a.split(/\s+/).length ? b : a));
  const out = [];
  parts.forEach((p, i) => {
    const words = p.split(/\s+/);
    if (words.length >= 2) { out.push(p); return; }
    if (i === 0) {
      // A standalone synonym, kept only if it can carry a sentence alone.
      if (p.length >= 6 && !GENERIC.has(p.toLowerCase())) out.push(p);
      return;
    }
    const grafted = [...longest.split(/\s+/).slice(0, -1), p].join(" ");
    if (grafted.split(/\s+/).length >= 2) out.push(grafted);
  });
  const seen = new Set();
  return out.filter((a) => a.length >= 6 && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
}

function readCsvText(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
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
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* Corrections win over the rule. */
const kindsFile = path.join(BACKEND, "data", "taxonomy-kinds.csv");
const override = new Map();
if (fs.existsSync(kindsFile)) {
  const text = fs.readFileSync(kindsFile, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const r of readCsvText(text)) {
    const k = String(r.kind ?? "").trim().toLowerCase();
    if (r.slug && (k === "treatment" || k === "condition" || k === "skip")) override.set(r.slug.trim(), k);
  }
}
for (const l of leaves) l.kind = override.get(l.slug) ?? kindOf(l.name);

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

/* Short names match too much. "Knee" appears in every knee bio and says
   nothing a patient can act on; the leaf that matters is "Knee
   Replacement". Six characters is where the noise stops. */
const matchers = leaves
  .filter((l) => l.kind !== "skip" && l.name.length >= 6)
  .map((l) => ({ ...l, aliases: aliasesFor(l.name) }))
  .filter((l) => l.aliases.length)
  .map((l) => {
    const rx = l.aliases.map((a) => a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    return { ...l, rx: new RegExp(`\\b(?:${rx.join("|")})\\b`, "i") };
  });

/* A procedure named in order to say it is NOT on offer. */
const NEGATED = /\b(do(es)? not|don'?t|no longer|never|cannot|can'?t|unable to|refer(red|s|ral)? (on|out|elsewhere)|does not (perform|offer|treat)|not (perform|offer|treat|available))\b/i;

const sentencesOf = (text) => String(text ?? "").split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

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
    .select({ id: t.specialists.id, name: t.specialists.fullName, bio: t.specialists.bio, primarySpecialtyId: t.specialists.primarySpecialtyId })
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
let negatedHits = 0;
let redundant = 0;
let withBio = 0;

for (const p of people) {
  if (!String(p.bio ?? "").trim()) continue;
  withBio += 1;
  const picks = new Map();
  for (const s of sentencesOf(p.bio)) {
    const negated = NEGATED.test(s);
    for (const m of matchers) {
      if (!m.rx.test(s)) continue;
      if (negated) { negatedHits += 1; continue; }
      if (m.root !== p.root) { crossBranch.push({ person: p.name, leaf: m.name, theirs: p.root, its: m.root }); continue; }
      if (!picks.has(m.slug)) picks.set(m.slug, { leaf: m, sentence: s.trim() });
    }
  }

  /* One sentence can satisfy two leaves where one contains the other.
     "chronic pelvic pain" matches Pelvic Pain AND Chronic Pelvic Pain,
     and listing both says the same thing twice while making the profile
     look padded. Keep the more specific one. */
  for (const [slugA, a] of [...picks]) {
    for (const [slugB, b] of [...picks]) {
      if (slugA === slugB || !picks.has(slugA)) continue;
      const shorter = a.leaf.aliases.some((x) => b.leaf.aliases.some((y) => y.length > x.length && y.toLowerCase().includes(x.toLowerCase())));
      if (shorter) { picks.delete(slugA); redundant += 1; }
    }
  }

  if (picks.size) found.set(p.id, [...picks.values()]);
}

const all = [...found.values()].flat();
const asTreatment = all.filter((x) => x.leaf.kind === "treatment");
const asCondition = all.filter((x) => x.leaf.kind === "condition");

console.log(`${c.dim}leaves    ${matchers.length} matchable of ${leaves.length}${c.off}\n`);
console.log(`  listings with a description        ${withBio}`);
console.log(`  listings that named something      ${found.size}  (${Math.round((100 * found.size) / people.length)}% of all)`);
console.log(`  procedures to file                 ${asTreatment.length}`);
console.log(`  conditions to file                 ${asCondition.length}`);
console.log(`  mean per listing                   ${(all.length / Math.max(found.size, 1)).toFixed(1)}`);
if (negatedHits) console.log(`  ${c.warn}skipped, named to say it is NOT offered   ${negatedHits}${c.off}`);
if (crossBranch.length) console.log(`  ${c.warn}skipped, outside the listing's own branch ${crossBranch.length}${c.off}`);
if (redundant) console.log(`  ${c.dim}dropped, a more specific name covered it     ${redundant}${c.off}`);

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
const { eq, and } = await import("drizzle-orm");
const { newId } = t;

const specialties = await db.select().from(t.specialties);
const specialtyBySlug = new Map(specialties.map((s) => [s.slug, s]));

/* The taxonomy rows themselves, created on demand. conditions.slug and
   treatments.slug are unique, so this is idempotent: run it twice and
   the second run inserts nothing. */
const ensure = async (table, leaf) => {
  const [existing] = await db.select().from(table).where(eq(table.slug, leaf.slug)).limit(1);
  if (existing) return existing;
  const [made] = await db
    .insert(table)
    .values({ id: newId(table === t.treatments ? "trt" : "cnd"), slug: leaf.slug, name: leaf.name, specialtyId: specialtyBySlug.get(leaf.root)?.id ?? null })
    .returning();
  return made;
};

let madeTreatments = 0, madeConditions = 0, links = 0;
for (const [personId, picks] of found) {
  for (const { leaf } of picks) {
    if (leaf.kind === "treatment") {
      const row = await ensure(t.treatments, leaf);
      madeTreatments += 1;
      await db.insert(t.specialistTreatments).values({ specialistId: personId, treatmentId: row.id }).onConflictDoNothing();
    } else {
      const row = await ensure(t.conditions, leaf);
      madeConditions += 1;
      await db.insert(t.specialistConditions).values({ specialistId: personId, conditionId: row.id }).onConflictDoNothing();
    }
    links += 1;
  }
}

console.log(
  `\n${c.good}Done.${c.off} ${links} link(s) across ${found.size} listing(s) — ` +
    `${madeTreatments} procedure and ${madeConditions} condition link(s).\n` +
    `Every one came from the listing's own description, verbatim. None of it is\n` +
    `marked verified: verified means somebody checked a register, and none was.\n`
);
await disconnectDb();
