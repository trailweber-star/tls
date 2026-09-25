#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Finds and merges duplicate-NAME specialty rows anywhere in the tree
 * (same "name", different "id"/"slug") and reports/repairs them.
 *
 * WHY THIS EXISTS. The search page's "Sub-specialty" filter under
 * Expert Witness shows "Medicolegal" twice, both with the same count
 * (362). specialties.slug is UNIQUE in the schema; specialties.name is
 * NOT. So two rows can share a name while having different slugs/ids
 * -- and the facet builder that turns "every child row of a parent"
 * into a checkbox list has no reason to know they're "the same thing"
 * to a human, so it renders one checkbox per row, not per name. Two
 * identical counts is exactly what you get when a taxonomy node was
 * re-inserted with a new slug at some point (sync-taxonomy.mjs matches
 * existing rows BY SLUG, so a JSON edit that changed a node's slug
 * without also fixing the old row would insert a second, orphaned
 * "Medicolegal" rather than renaming the first) and specialists kept
 * getting tagged against both because nothing was there to catch it.
 *
 * THIS SCRIPT NEVER GUESSES WHICH NAME IS RIGHT -- it only finds rows
 * where the name collides, and merges every specialist_specialties
 * link (and primary_specialty_id reference) from the "loser" row onto
 * a single canonical "winner" row before deleting the loser:
 *
 *   winner = the row whose slug currently exists in
 *            src/data/taxonomy/specialty-tree.json (the source of
 *            truth going forward); if neither or both slugs are in
 *            the file, the row with more specialist links wins, and a
 *            tie falls back to the lower id (the one that has existed
 *            longest).
 *
 * No specialist loses a tag: if a specialist was linked to both the
 * winner and the loser, the loser's link is just dropped (it would be
 * a duplicate link to the merged node); if only to the loser, that
 * link is repointed to the winner's id.
 *
 *   node scripts/fix-duplicate-specialties.mjs             # report only
 *   node scripts/fix-duplicate-specialties.mjs --write      # merge + delete
 *   node scripts/fix-duplicate-specialties.mjs --scope "Expert Witness"
 *                                                            # only consider
 *                                                            # rows whose
 *                                                            # ancestor chain
 *                                                            # includes this
 *                                                            # name (default:
 *                                                            # whole tree)
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const scopeIdx = args.indexOf("--scope");
const SCOPE_NAME = scopeIdx >= 0 ? args[scopeIdx + 1] : null;

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
    "Paste the actual value from Render (or wherever the DB is hosted), not a placeholder."
  );
  process.exit(1);
}
refusePlaceholderUrl();

if (!isDbConfigured()) {
  console.error("No database configured. Set DATABASE_URL.");
  process.exit(1);
}
const db = getDb();

// ---- current source-of-truth slugs, from the JSON file (best-effort; a
// missing/unreadable file just means the tie-break below falls through
// to "more links, then lower id" instead of "matches the JSON").
let jsonSlugs = new Set();
try {
  const treePath = path.join(BACKEND, "src", "data", "taxonomy", "specialty-tree.json");
  const tree = JSON.parse(fs.readFileSync(treePath, "utf8"));
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node && typeof node === "object") {
      if (node.slug) jsonSlugs.add(node.slug);
      if (node.children) collect(node.children);
    }
  };
  collect(tree);
} catch {
  console.log(`${c.dim}(couldn't read specialty-tree.json for the tie-break -- falling back to link-count / id)${c.off}`);
}

const rows = await db.select().from(t.specialties);
const byId = new Map(rows.map((r) => [r.id, r]));

// Optional scope: only consider rows that descend from a node with this name.
let scopeIds = null;
if (SCOPE_NAME) {
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parentId)) byParent.set(r.parentId, []);
    byParent.get(r.parentId).push(r);
  }
  const roots = rows.filter((r) => r.name === SCOPE_NAME);
  if (!roots.length) {
    console.error(`No specialty named "${SCOPE_NAME}" found. Nothing to scope to.`);
    process.exit(1);
  }
  scopeIds = new Set();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    scopeIds.add(n.id);
    for (const child of byParent.get(n.id) ?? []) stack.push(child);
  }
}

const inScope = (r) => !scopeIds || scopeIds.has(r.id);

// Group by (parentId, normalized name) -- duplicates are only a problem
// as siblings; two different branches legitimately having a leaf with
// the same name (e.g. "Ophthalmology" under two different parents) is
// not this bug and must NOT be merged.
const groups = new Map();
for (const r of rows) {
  if (!inScope(r)) continue;
  const key = `${r.parentId}::${r.name.trim().toLowerCase()}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const dupGroups = [...groups.values()].filter((g) => g.length > 1);

if (!dupGroups.length) {
  console.log(`${c.good}No duplicate-name sibling specialties found${SCOPE_NAME ? ` under "${SCOPE_NAME}"` : ""}.${c.off}`);
  await disconnectDb();
  process.exit(0);
}

console.log(`${c.bold}${dupGroups.length} duplicate-name group(s) found${WRITE ? "" : `  ${c.dim}(dry run -- pass --write to apply)${c.off}`}\n`);

let totalMerged = 0;

for (const group of dupGroups) {
  const parent = byId.get(group[0].parentId);
  console.log(`${c.bold}"${group[0].name}"${c.off}  (parent: ${parent ? parent.name : "— top level —"})`);

  // Count links per row so ties can be broken sensibly and so the report
  // is honest about what's about to move.
  const withLinks = [];
  for (const row of group) {
    const links = await db
      .select({ specialistId: t.specialistSpecialties.specialistId })
      .from(t.specialistSpecialties)
      .where(eq(t.specialistSpecialties.specialtyId, row.id));
    withLinks.push({ row, linkIds: new Set(links.map((l) => l.specialistId)) });
    console.log(`  [${row.slug}]  id=${row.id}  ${links.length} specialist link(s)${jsonSlugs.has(row.slug) ? `  ${c.good}<- matches specialty-tree.json${c.off}` : ""}`);
  }

  // Pick the winner: prefer the slug that's in the JSON file; else the
  // row with the most links; else the lowest id (oldest).
  const inJson = withLinks.filter((w) => jsonSlugs.has(w.row.slug));
  let winner;
  if (inJson.length === 1) {
    winner = inJson[0];
  } else {
    winner = [...withLinks].sort((a, b) => b.linkIds.size - a.linkIds.size || a.row.id - b.row.id)[0];
  }
  const losers = withLinks.filter((w) => w.row.id !== winner.row.id);

  console.log(`  ${c.good}winner: [${winner.row.slug}] id=${winner.row.id}${c.off}`);

  for (const loser of losers) {
    const onlyOnLoser = [...loser.linkIds].filter((sid) => !winner.linkIds.has(sid));
    console.log(`  ${c.warn}loser:  [${loser.row.slug}] id=${loser.row.id}${c.off}  -- ${onlyOnLoser.length} link(s) to repoint, ${loser.linkIds.size - onlyOnLoser.length} duplicate link(s) to drop`);

    if (WRITE) {
      if (onlyOnLoser.length) {
        await db
          .update(t.specialistSpecialties)
          .set({ specialtyId: winner.row.id })
          .where(
            and(
              inArray(t.specialistSpecialties.specialistId, onlyOnLoser),
              eq(t.specialistSpecialties.specialtyId, loser.row.id)
            )
          );
      }
      // Anything left pointing at the loser now is a duplicate of a link
      // that already exists on the winner -- just remove it.
      await db.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialtyId, loser.row.id));

      // A specialist's single primary_specialty_id, if it pointed at the
      // loser, has to move too or it'll dangle after the row is deleted.
      await db
        .update(t.specialists)
        .set({ primarySpecialtyId: winner.row.id })
        .where(eq(t.specialists.primarySpecialtyId, loser.row.id));

      await db.delete(t.specialties).where(eq(t.specialties.id, loser.row.id));
      console.log(`    ${c.good}merged and deleted.${c.off}`);
    }
  }
  totalMerged += losers.length;
  console.log();
}

console.log(`${WRITE ? c.good : c.warn}${WRITE ? "Done" : "Would merge"}: ${totalMerged} duplicate row(s) across ${dupGroups.length} group(s).${c.off}`);
if (!WRITE) console.log(`${c.dim}Re-run with --write to apply.${c.off}`);

await disconnectDb();
