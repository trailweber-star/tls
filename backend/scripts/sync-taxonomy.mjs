#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Bringing an existing database up to date with the taxonomy file
 *
 *   node scripts/sync-taxonomy.mjs              # show what would change
 *   node scripts/sync-taxonomy.mjs --write      # insert the missing nodes
 *
 * WHY THIS EXISTS. src/data/taxonomy/specialty-tree.json is the single
 * source of truth for the specialty tree, and seed.js inserts it — with
 * a plain INSERT, once, into an empty database. prepare.mjs then refuses
 * to seed anything that already has listings in it, which is correct:
 * re-running a seed over live data is how you get duplicate taxonomies
 * and orphaned tags.
 *
 * So editing the JSON does nothing to a database that has already been
 * seeded, which is every database that matters — the preview, and
 * eventually production. This closes that gap.
 *
 * ADDITIVE, AND ONLY ADDITIVE. It inserts nodes the file has and the
 * database does not, and it renames a node whose slug matches but whose
 * name has changed. It NEVER deletes and never re-parents. A specialty
 * row that has gone missing from the file is not evidence that it should
 * be removed — specialists are tagged against these rows, and deleting
 * one silently untags however many people were filed under it. If
 * something really does need removing, it needs a migration written by
 * a person who has looked at what is tagged to it first, and this script
 * lists those rows rather than touching them.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const WRITE = process.argv.includes("--write");

/* ------------------------------------------------------------------ *
 * A connection string that is obviously a placeholder
 *
 * Pasting the instructions rather than the value is an easy mistake and
 * a cheap one to catch. Left alone it surfaces as
 * "getaddrinfo ENOTFOUND base" from deep inside the Postgres driver,
 * which names neither the real problem nor the fix and has now cost
 * three separate debugging detours.
 * ------------------------------------------------------------------ */
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
    "It should start with postgresql:// and contain no angle brackets.\n" +
    "Copy the External Database URL from the Render dashboard, then:\n\n" +
    '  export DATABASE_URL="<paste it here>?sslmode=require"\n\n' +
    "replacing the whole of <paste it here> — brackets included — with the URL."
  );
  process.exit(1);
}
refusePlaceholderUrl();


/** Depth-first, parents before children — the order rows must be inserted in. */
function* walk(nodes, parentSlug = null, depth = 0) {
  for (const n of nodes) {
    yield { slug: n.slug, name: n.name, parentSlug, depth };
    yield* walk(n.children ?? [], n.slug, depth + 1);
  }
}

async function main() {
  const { getDb, isDbConfigured } = await import("../src/db/client.js");
  if (!isDbConfigured()) {
    console.error("No database configured. Set DATABASE_URL to the database you want to update.");
    process.exit(1);
  }
  const db = getDb();
  const t = await import("../src/db/schema.js");
  const { eq } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  const trees = [
    { label: "specialties", table: t.specialties, file: "specialty-tree.json" },
    { label: "facility categories", table: t.facilityCategories, file: "facility-tree.json" },
  ];

  let totalNew = 0;
  let totalRenamed = 0;

  for (const { label, table, file } of trees) {
    const full = path.join(BACKEND, "src", "data", "taxonomy", file);
    if (!fs.existsSync(full)) {
      console.log(`${label}: no ${file} — skipped`);
      continue;
    }

    const tree = JSON.parse(fs.readFileSync(full, "utf8"));
    const wanted = [...walk(tree)];
    const rows = await db.select().from(table);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));

    const missing = wanted.filter((w) => !bySlug.has(w.slug));
    const renamed = wanted.filter((w) => bySlug.has(w.slug) && bySlug.get(w.slug).name !== w.name);
    const orphaned = rows.filter((r) => !wanted.some((w) => w.slug === r.slug));

    console.log(`\n${label}: ${rows.length} in the database, ${wanted.length} in the file`);
    console.log(`  to insert  ${missing.length}`);
    console.log(`  to rename  ${renamed.length}`);
    console.log(`  in the database but not the file  ${orphaned.length}  (left alone — see the header)`);

    if (missing.length) {
      const tops = missing.filter((m) => m.depth === 0);
      if (tops.length) console.log(`\n  new top level: ${tops.map((x) => x.name).join(", ")}`);
      const byTop = {};
      for (const m of missing) {
        // Walk up to the root so the summary reads by top-level branch.
        let cur = m;
        const wantedBySlug = new Map(wanted.map((w) => [w.slug, w]));
        while (cur.parentSlug) cur = wantedBySlug.get(cur.parentSlug) ?? cur;
        byTop[cur.name] = (byTop[cur.name] ?? 0) + 1;
      }
      console.log("\n  new nodes by branch:");
      for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(v).padStart(4)}  ${k}`);
      }
    }
    for (const r of renamed) {
      console.log(`  rename  ${r.slug}: "${bySlug.get(r.slug).name}" → "${r.name}"`);
    }
    if (orphaned.length) {
      console.log("\n  not in the file (NOT removed — specialists may be tagged to these):");
      for (const o of orphaned.slice(0, 20)) console.log(`    ${o.slug}  "${o.name}"`);
      if (orphaned.length > 20) console.log(`    …and ${orphaned.length - 20} more`);
    }

    if (!WRITE) {
      totalNew += missing.length;
      totalRenamed += renamed.length;
      continue;
    }

    /* Insert depth by depth, so a child never goes in before the parent
       whose id it needs. `wanted` is already depth-first, but a level-2
       node whose parent is brand new has to wait for that parent's
       generated id, and inserting strictly by depth is the simplest
       thing that guarantees it. */
    const maxDepth = Math.max(0, ...wanted.map((w) => w.depth));
    for (let d = 0; d <= maxDepth; d += 1) {
      const batch = missing.filter((m) => m.depth === d);
      if (!batch.length) continue;

      // Re-read so ids inserted at the previous depth are available.
      const current = new Map((await db.select().from(table)).map((r) => [r.slug, r]));
      const values = [];
      for (const m of batch) {
        const parentId = m.parentSlug ? current.get(m.parentSlug)?.id ?? null : null;
        if (m.parentSlug && !parentId) {
          console.error(`  ! ${m.slug} wants parent ${m.parentSlug}, which is not there — skipped`);
          continue;
        }
        values.push({ id: randomUUID(), parentId, slug: m.slug, name: m.name });
      }
      if (values.length) {
        await db.insert(table).values(values);
        console.log(`  inserted ${values.length} at depth ${d}`);
      }
    }

    for (const r of renamed) {
      await db.update(table).set({ name: r.name }).where(eq(table.slug, r.slug));
    }
    if (renamed.length) console.log(`  renamed ${renamed.length}`);

    totalNew += missing.length;
    totalRenamed += renamed.length;
  }

  console.log(
    WRITE
      ? `\ndone — ${totalNew} inserted, ${totalRenamed} renamed.`
      : `\n${totalNew} would be inserted, ${totalRenamed} renamed. Pass --write to apply.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
