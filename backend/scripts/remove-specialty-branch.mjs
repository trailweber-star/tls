#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Removes one or more specialty BRANCHES (the named row and every
 * descendant under it) from both the live database and
 * specialty-tree.json, in one pass -- so the two never drift out of
 * sync the way they did for the "Medicolegal" child nodes.
 *
 * WHY A GENERIC SCRIPT. remove-ew-non-medical.mjs already did this once
 * for 5 hardcoded Expert Witness categories. This is the same job --
 * "these categories aren't medical specialties, take them out" -- for
 * whichever slugs come next, without editing a hardcoded list and
 * without leaving specialty-tree.json holding nodes the DB no longer
 * has (that's exactly what happened with the 6 Medicolegal children:
 * deleted from the DB by hand, never removed from the JSON, so the
 * next `sync-taxonomy.mjs --write` would silently re-insert them).
 *
 * WHAT IT DOES, per slug:
 *   1. Finds the specialty row and every descendant beneath it.
 *   2. Clears every specialist_specialties link and every
 *      specialists.primary_specialty_id reference into that subtree
 *      (a specialist doesn't lose their OTHER tags, just this one).
 *   3. Deletes the subtree's rows, children first (bottom-up), so no
 *      delete ever trips specialties_parent_fk.
 *   4. Removes the matching node(s) from specialty-tree.json (by slug,
 *      recursively), so a future sync-taxonomy.mjs --write can't bring
 *      any of it back.
 *
 *   node scripts/remove-specialty-branch.mjs <slug> [<slug> ...]
 *   node scripts/remove-specialty-branch.mjs --write <slug> [<slug> ...]
 *
 * Dry run by default -- reports what would move/delete, touches
 * nothing. Pass --write to actually apply it (DB + JSON, same run).
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TREE_PATH = path.join(BACKEND, "src", "data", "taxonomy", "specialty-tree.json");

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const slugs = argv.filter((a) => a !== "--write");

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

if (!slugs.length) {
  console.error("Usage: node scripts/remove-specialty-branch.mjs [--write] <slug> [<slug> ...]");
  process.exit(1);
}

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

const rows = await db.select().from(t.specialties);
const byId = new Map(rows.map((r) => [r.id, r]));
const childrenOf = new Map();
for (const r of rows) {
  if (!childrenOf.has(r.parentId)) childrenOf.set(r.parentId, []);
  childrenOf.get(r.parentId).push(r);
}

function subtreeOf(rootRow) {
  const out = [];
  const stack = [rootRow];
  while (stack.length) {
    const n = stack.pop();
    out.push(n);
    for (const child of childrenOf.get(n.id) ?? []) stack.push(child);
  }
  return out;
}

let anyMissing = false;
const plans = [];

for (const slug of slugs) {
  const root = rows.find((r) => r.slug === slug);
  if (!root) {
    console.log(`${c.bad}"${slug}" -- no specialty row with this slug. Skipping.${c.off}`);
    anyMissing = true;
    continue;
  }
  const subtree = subtreeOf(root);
  const subtreeIds = subtree.map((r) => r.id);

  const links = await db
    .select({ specialistId: t.specialistSpecialties.specialistId, specialtyId: t.specialistSpecialties.specialtyId })
    .from(t.specialistSpecialties)
    .where(inArray(t.specialistSpecialties.specialtyId, subtreeIds));

  const primaryHits = await db
    .select({ id: t.specialists.id })
    .from(t.specialists)
    .where(inArray(t.specialists.primarySpecialtyId, subtreeIds));

  console.log(`${c.bold}"${root.name}" [${root.slug}]${c.off}  id=${root.id}`);
  console.log(`  ${subtree.length} row(s) in the subtree: ${subtree.map((r) => r.slug).join(", ")}`);
  console.log(`  ${links.length} specialist_specialties link(s) to drop`);
  console.log(`  ${primaryHits.length} specialist(s) with this as their primary specialty (will be cleared, not reassigned)`);

  plans.push({ root, subtree, subtreeIds });
}

if (anyMissing && !WRITE) {
  console.log(`\n${c.warn}One or more slugs weren't found -- fix the slug(s) before running --write.${c.off}`);
}

if (!WRITE) {
  console.log(`\n${c.dim}Dry run -- pass --write to delete these from the DB and prune them from specialty-tree.json.${c.off}`);
  await disconnectDb();
  process.exit(anyMissing ? 1 : 0);
}

if (anyMissing) {
  console.error(`\n${c.bad}Refusing to write: at least one slug didn't match a row. Nothing was changed.${c.off}`);
  await disconnectDb();
  process.exit(1);
}

// ---- apply to the DB ----
for (const { root, subtree, subtreeIds } of plans) {
  await db.delete(t.specialistSpecialties).where(inArray(t.specialistSpecialties.specialtyId, subtreeIds));
  await db
    .update(t.specialists)
    .set({ primarySpecialtyId: null })
    .where(inArray(t.specialists.primarySpecialtyId, subtreeIds));

  // Delete leaves-up so nothing still has a child pointing at it via
  // parent_id when its own delete runs.
  const depthOf = (row) => {
    let d = 0;
    let cur = row;
    while (cur.parentId != null && byId.has(cur.parentId)) {
      cur = byId.get(cur.parentId);
      d++;
    }
    return d;
  };
  const deleteOrder = [...subtree].sort((a, b) => depthOf(b) - depthOf(a));
  for (const row of deleteOrder) {
    await db.delete(t.specialties).where(eq(t.specialties.id, row.id));
  }
  console.log(`${c.good}Deleted "${root.name}" and ${subtree.length - 1} descendant(s) from the database.${c.off}`);
}

// ---- prune specialty-tree.json to match ----
try {
  const tree = JSON.parse(fs.readFileSync(TREE_PATH, "utf8"));
  const targetSlugs = new Set(slugs);
  let prunedCount = 0;

  function prune(node) {
    if (Array.isArray(node)) {
      const kept = [];
      for (const child of node) {
        if (child && typeof child === "object" && targetSlugs.has(child.slug)) {
          prunedCount++;
          continue;
        }
        if (child && typeof child === "object" && Array.isArray(child.children)) {
          child.children = prune(child.children);
        }
        kept.push(child);
      }
      return kept;
    }
    return node;
  }

  if (Array.isArray(tree)) {
    const pruned = prune(tree);
    fs.writeFileSync(TREE_PATH, JSON.stringify(pruned, null, 2) + "\n");
  } else if (tree && typeof tree === "object" && Array.isArray(tree.children)) {
    tree.children = prune(tree.children);
    fs.writeFileSync(TREE_PATH, JSON.stringify(tree, null, 2) + "\n");
  } else {
    throw new Error("unrecognized specialty-tree.json shape");
  }

  console.log(`${c.good}Pruned ${prunedCount} node(s) from specialty-tree.json.${c.off}`);
} catch (err) {
  console.error(
    `${c.warn}DB rows were deleted, but specialty-tree.json could NOT be auto-pruned (${err.message}).\n` +
    `Remove the matching node(s) from that file by hand, or the next "sync-taxonomy.mjs --write" will re-insert them.${c.off}`
  );
}

await disconnectDb();
