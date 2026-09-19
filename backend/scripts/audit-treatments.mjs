#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * What is actually on the listings, and is any of it wrong twice?
 *
 *   node scripts/audit-treatments.mjs
 *
 * Read-only. Three questions, each of which has already been answered
 * wrongly once in this project:
 *
 *   1. HOW MUCH IS THERE. A pass that reports 1,787 links and writes
 *      none looks identical from the terminal, so the count comes back
 *      out of the database rather than out of the script that put it in.
 *
 *   2. DOES ANY LISTING SAY THE SAME THING TWICE. Fourteen names sit in
 *      two places in the specialty tree and both copies were being
 *      filed, so profiles printed "Root Canal Treatment" twice. The
 *      matcher now keeps one, but a name can also be duplicated by two
 *      taxonomy ROWS sharing a slug, which the matcher cannot see.
 *
 *   3. ARE THERE TWO ROWS FOR ONE SLUG. The demo directory seeded its
 *      own taxonomy — dental-implants-treatment beside the tree's
 *      dental-implants — and where the slugs collided the links all
 *      attached to one row and left the other orphaned. Pruning the
 *      orphan is right; pruning a row that still has listings on it
 *      would not be, so the two cases are told apart here.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };
if (!isDbConfigured()) { console.error(`\n${c.bad}No DATABASE_URL.${c.off}\n`); process.exit(1); }
const db = getDb();
let host = "(unparseable DATABASE_URL)";
try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { /* keep it */ }
console.log(`\n${c.dim}database  ${host}${c.off}\n`);

const [treatments, conditions, trLinks, cdLinks, specialists] = await Promise.all([
  db.select({ id: t.treatments.id, slug: t.treatments.slug, name: t.treatments.name }).from(t.treatments),
  db.select({ id: t.conditions.id, slug: t.conditions.slug, name: t.conditions.name }).from(t.conditions),
  db.select().from(t.specialistTreatments),
  db.select().from(t.specialistConditions),
  db.select({ id: t.specialists.id, fullName: t.specialists.fullName, slug: t.specialists.slug }).from(t.specialists),
]);

const trById = new Map(treatments.map((r) => [r.id, r]));
const cdById = new Map(conditions.map((r) => [r.id, r]));
const who = new Map(specialists.map((s) => [s.id, s]));

/* 1. how much is there */
const listings = new Set([...trLinks.map((r) => r.specialistId), ...cdLinks.map((r) => r.specialistId)]);
console.log(`  ${c.bold}on the listings${c.off}`);
console.log(`    procedure links   ${trLinks.length}`);
console.log(`    condition links   ${cdLinks.length}`);
console.log(`    listings with any ${listings.size} of ${specialists.length}`);

/* WHO PUT THEM THERE. The number that matters here is the last one: a
   link with no source is one no script can clear without clearing
   everything, which is how the website pass's work got destroyed once.
   The description pass adopts them, so this should reach zero after one
   description-then-website cycle and stay there. */
const bySource = new Map();
for (const r of [...trLinks, ...cdLinks]) {
  const k = r.source ?? "(none recorded)";
  bySource.set(k, (bySource.get(k) ?? 0) + 1);
}
const label = {
  description: "the listing's own description",
  website: "the practice's own website",
  profile: "somebody edited the profile",
  seed: "the demo directory",
  "(none recorded)": "written before source was recorded",
};
console.log(`\n  ${c.bold}where each link came from${c.off}`);
for (const [k, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
  const line = `    ${String(n).padStart(5)}  ${k.padEnd(16)} ${c.dim}${label[k] ?? ""}${c.off}`;
  console.log(k === "(none recorded)" ? `${c.warn}${line}` : line);
}
if (bySource.get("(none recorded)")) {
  console.log(
    `${c.dim}    Those cannot be attributed to either derivation pass, so --replace on\n` +
      `    treatments:derive clears them with its own. Re-run treatments:websites\n` +
      `    once afterwards and the column is complete.${c.off}`
  );
}

const tally = (rows, byId) => {
  const m = new Map();
  for (const r of rows) {
    const row = byId.get(r.treatmentId ?? r.conditionId);
    if (row) m.set(row.name, (m.get(row.name) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
console.log(`\n  ${c.dim}most-filed procedures:${c.off}`);
for (const [n, k] of tally(trLinks, trById).slice(0, 8)) console.log(`${c.dim}      ${String(k).padStart(4)}  ${n}${c.off}`);
console.log(`  ${c.dim}most-filed conditions:${c.off}`);
for (const [n, k] of tally(cdLinks, cdById).slice(0, 8)) console.log(`${c.dim}      ${String(k).padStart(4)}  ${n}${c.off}`);

/* 2. does any listing say the same thing twice */
const namesOn = new Map();
const note = (specialistId, name) => {
  if (!name) return;
  if (!namesOn.has(specialistId)) namesOn.set(specialistId, new Map());
  const m = namesOn.get(specialistId);
  m.set(name, (m.get(name) ?? 0) + 1);
};
for (const r of trLinks) note(r.specialistId, trById.get(r.treatmentId)?.name);
for (const r of cdLinks) note(r.specialistId, cdById.get(r.conditionId)?.name);
const doubled = [];
for (const [id, m] of namesOn) for (const [name, n] of m) if (n > 1) doubled.push({ id, name, n });
console.log(`\n  ${c.bold}listings printing one name twice${c.off}`);
if (!doubled.length) console.log(`    ${c.good}none${c.off}`);
else {
  console.log(`    ${c.bad}${doubled.length}${c.off}`);
  for (const d of doubled.slice(0, 12)) console.log(`      ${who.get(d.id)?.fullName ?? d.id} — ${d.name} ×${d.n}`);
}

/* 3. two rows for one slug */
console.log(`\n  ${c.bold}taxonomy rows sharing a slug${c.off}`);
for (const [label, rows, links, key] of [
  ["procedure", treatments, trLinks, "treatmentId"],
  ["condition", conditions, cdLinks, "conditionId"],
]) {
  const used = new Set(links.map((r) => r[key]));
  const bySlug = new Map();
  for (const r of rows) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
    bySlug.get(r.slug).push(r);
  }
  const dupes = [...bySlug].filter(([, v]) => v.length > 1);
  const bothUsed = dupes.filter(([, v]) => v.filter((r) => used.has(r.id)).length > 1);
  console.log(`    ${label}s: ${dupes.length} slug(s) on more than one row` +
    (bothUsed.length ? `, ${c.bad}${bothUsed.length} with listings on both${c.off}` : `, ${c.good}none with listings on both${c.off}`));
  for (const [slug, v] of dupes.slice(0, 8)) {
    console.log(`${c.dim}      ${slug}  ${v.map((r) => `${r.id}${used.has(r.id) ? " (in use)" : " (empty)"}`).join("  ")}${c.off}`);
  }
}

/* and the rows nothing points at, which is what --prune removes */
const usedTr = new Set(trLinks.map((r) => r.treatmentId));
const usedCd = new Set(cdLinks.map((r) => r.conditionId));
console.log(`\n  ${c.dim}taxonomy rows with no listing on them: ${treatments.filter((r) => !usedTr.has(r.id)).length} procedure(s), ${conditions.filter((r) => !usedCd.has(r.id)).length} condition(s)${c.off}`);

await disconnectDb();
