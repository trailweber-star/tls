#!/usr/bin/env node
// One-off diagnostic: where do the Expert Witness rows we care about
// currently sit in this database? Read-only -- no writes.
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const { getDb, isDbConfigured } = await import("../src/db/client.js");
if (!isDbConfigured()) {
  console.error("No database configured. Set DATABASE_URL.");
  process.exit(1);
}
const db = getDb();
const t = await import("../src/db/schema.js");

const rows = await db.select().from(t.specialties);
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const bySlugFromId = new Map(rows.map((r) => [r.id, r.slug]));

const watch = [
  "expert-witness",
  "expert-witness-medicolegal",
  "criminal-injuries-compensation",
  "fitness-to-practise-regulatory",
];

console.log(`(${rows.length} specialty rows total in this database)\n`);
for (const slug of watch) {
  const r = bySlug.get(slug);
  if (!r) {
    console.log(`${slug}: NOT FOUND`);
    continue;
  }
  const parentSlug = r.parentId ? bySlugFromId.get(r.parentId) ?? `(unknown id ${r.parentId})` : "(top level)";
  console.log(`${slug}  ->  parent: ${parentSlug}   name: "${r.name}"`);
}

console.log("\nchildren of expert-witness right now:");
const ew = bySlug.get("expert-witness");
if (ew) {
  for (const r of rows.filter((r) => r.parentId === ew.id)) {
    console.log(`  ${r.slug}  "${r.name}"`);
  }
}
process.exit(0);
