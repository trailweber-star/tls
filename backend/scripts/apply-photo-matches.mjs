#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Apply reviewed photo matches
 *
 * Reads data/photo-hunt/matches.csv, one row per specialist:
 *
 *   slug,photoUrl,sourcePage,approved
 *
 * and, for every row where approved is "yes", downloads photoUrl,
 * re-hosts it through saveImage() (Cloudinary) and sets the specialist's
 * photoUrl. Nothing is applied until a person has typed "yes" in the
 * approved column: the search that produced the row can be wrong about
 * whose face it is, and this script is the one place that decides.
 *
 * It only ever fills an EMPTY photoUrl. A listing that already has a
 * photo (or was claimed and uploaded one since) is skipped, never
 * overwritten. Safe to re-run.
 *
 *   node scripts/apply-photo-matches.mjs --dry-run
 *   node scripts/apply-photo-matches.mjs --write
 *   (--file=path/to/other.csv to use a different file)
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { registerStorageProvider, saveImage } from "../src/lib/storage.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const fileArg = args.find((a) => a.startsWith("--file="));
const FILE = fileArg ? fileArg.slice(7) : "data/photo-hunt/matches.csv";
const UA = "TopLocalSpecialists-migration/1.0 (first-party data export; contact site owner)";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (WRITE) {
  const storage = await registerStorageProvider();
  if (storage.provider !== "cloudinary") {
    console.error(`STOPPING: photos would go to "${storage.provider}", not Cloudinary. Set CLOUDINARY_URL.`);
    process.exit(1);
  }
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
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
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((k, i) => [k.trim(), (r[i] ?? "").trim()])));
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" }, redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`not an image (${type || "no content type"})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`too large (${buffer.length} bytes)`);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

const rows = parseCsv(fs.readFileSync(FILE, "utf8"));
const approved = rows.filter((r) => r.approved.toLowerCase() === "yes" && r.slug && r.photoUrl);
console.log(`${rows.length} row(s) in ${FILE}, ${approved.length} approved.\n`);

const db = getDb();
const summary = { applied: 0, skipped: 0, failed: 0, problems: [] };

for (const r of approved) {
  try {
    const [sp] = await db
      .select({ id: t.specialists.id, fullName: t.specialists.fullName, photoUrl: t.specialists.photoUrl })
      .from(t.specialists)
      .where(eq(t.specialists.slug, r.slug));
    if (!sp) throw new Error("no specialist with that slug");
    if (sp.photoUrl) { summary.skipped += 1; console.log(`  skip ${r.slug}: already has a photo`); continue; }
    const buffer = await download(r.photoUrl);
    console.log(`  ${WRITE ? "applying" : "would apply"} ${r.slug} (${sp.fullName}) <- ${r.photoUrl} (${buffer.length} bytes)`);
    if (WRITE) {
      const saved = await saveImage({ buffer, kind: "profile-photo", origin: process.env.PUBLIC_API_URL ?? "" });
      await db.update(t.specialists).set({ photoUrl: saved.url }).where(eq(t.specialists.id, sp.id));
    }
    summary.applied += 1;
  } catch (err) {
    summary.failed += 1;
    summary.problems.push(`${r.slug}: ${err.message}`);
  }
}

console.log(`\n${WRITE ? "Applied" : "Dry run, would apply"} ${summary.applied}, skipped ${summary.skipped}, failed ${summary.failed}.`);
for (const p of summary.problems) console.log(`  ${p}`);
await disconnectDb();
