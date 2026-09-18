#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Removing listings a decision has rejected
 *
 *   node scripts/retire-listings.mjs            # report only
 *   node scripts/retire-listings.mjs --write    # remove them
 *
 * data/listing-decisions.csv is the record of individual listings a
 * person has read and settled. map-taxonomy.mjs reads it and keeps the
 * rejected ones out of mapped.csv, which stops them being imported
 * again — but a listing rejected AFTER it was already imported is
 * sitting on the live site, and no amount of re-mapping removes it.
 * That is this script.
 *
 * It exists as its own step rather than a flag on the importer because
 * deleting a published listing is not a side effect of an import. It
 * should be something somebody ran on purpose, with the rows named
 * first.
 *
 * WHAT IT REFUSES TO DO. A listing with a patient enquiry against it,
 * or an article written under it, is not a stray harvest row any more —
 * something happened there that is not ours to throw away. Those are
 * named and skipped, and the reason is printed. Same for a claimed
 * listing: once a clinician has taken ownership, the decision to remove
 * it is a conversation, not a script.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");

const c = {
  off: "\u001b[0m",
  dim: "\u001b[2m",
  warn: "\u001b[33m",
  bad: "\u001b[31m",
  good: "\u001b[32m",
};
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

if (!isDbConfigured()) {
  console.error(`\n${c.bad}No DATABASE_URL.${c.off} This script only makes sense against a real database.\n`);
  process.exit(1);
}

/* Render's internal hostname resolves only inside Render, and the
   failure it produces (ENOTFOUND dpg-xxxx-a) reads like a dead database
   rather than a copied-from-the-wrong-box URL. Say which it is. */
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
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const decisionsFile = path.join(BACKEND, "data", "listing-decisions.csv");
if (!fs.existsSync(decisionsFile)) {
  console.error(`\nNo data/listing-decisions.csv — nothing has been decided.\n`);
  process.exit(1);
}
const decisions = parseCsv(
  fs.readFileSync(decisionsFile, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
).filter((r) => String(r.action ?? "").trim().toLowerCase() === "reject");

if (!decisions.length) {
  console.log("\nNo rejected listings in data/listing-decisions.csv.\n");
  await disconnectDb();
  process.exit(0);
}

/* The decisions file is keyed on the harvest slug; the database knows a
   listing by the source URL it was imported from. listings.csv is where
   the two meet. */
const listingsFile = path.join(BACKEND, "data", "harvest", "listings.csv");
const urlBySlug = new Map();
if (fs.existsSync(listingsFile)) {
  for (const r of parseCsv(fs.readFileSync(listingsFile, "utf8"))) {
    if (r.slug && r.url) urlBySlug.set(r.slug, r.url);
  }
}

console.log(`\n${decisions.length} rejected listing(s) in data/listing-decisions.csv\n`);

/* --------------------------------------------------------- the lookup */

const rows = await db
  .select({
    id: t.specialists.id,
    slug: t.specialists.slug,
    fullName: t.specialists.fullName,
    sourceUrl: t.specialists.sourceUrl,
    userId: t.specialists.userId,
    claimed: t.specialists.claimed,
  })
  .from(t.specialists);

const bySourceUrl = new Map(rows.filter((r) => r.sourceUrl).map((r) => [r.sourceUrl, r]));

const found = [];
const absent = [];
for (const d of decisions) {
  const sourceUrl = urlBySlug.get(d.slug) ?? null;
  const hit = sourceUrl ? bySourceUrl.get(sourceUrl) : null;
  if (hit) found.push({ ...d, ...hit });
  else absent.push(d);
}

if (absent.length) {
  console.log(`${absent.length} were never imported — nothing to remove:`);
  for (const d of absent) dim(`  ${d.slug}`);
  console.log("");
}

if (!found.length) {
  console.log(`${c.good}Nothing rejected is in the database.${c.off}\n`);
  await disconnectDb();
  process.exit(0);
}

/* ------------------------------------------------------ the safeguards */

const ids = found.map((r) => r.id);
const leads = ids.length
  ? await db.select({ specialistId: t.leads.specialistId }).from(t.leads).where(inArray(t.leads.specialistId, ids))
  : [];
const articles = ids.length
  ? await db
      .select({ authorSpecialistId: t.articles.authorSpecialistId })
      .from(t.articles)
      .where(inArray(t.articles.authorSpecialistId, ids))
  : [];
const leadCount = new Map();
for (const l of leads) leadCount.set(l.specialistId, (leadCount.get(l.specialistId) ?? 0) + 1);
const articleCount = new Map();
for (const a of articles) articleCount.set(a.authorSpecialistId, (articleCount.get(a.authorSpecialistId) ?? 0) + 1);

const removable = [];
const held = [];
for (const r of found) {
  const reasons = [];
  if (r.claimed) reasons.push("the listing has been claimed");
  if (leadCount.get(r.id)) reasons.push(`${leadCount.get(r.id)} patient enquir${leadCount.get(r.id) === 1 ? "y" : "ies"} against it`);
  if (articleCount.get(r.id)) reasons.push(`${articleCount.get(r.id)} article(s) written under it`);
  if (reasons.length) held.push({ ...r, reasons });
  else removable.push(r);
}

for (const r of held) {
  console.log(`${c.warn}! ${r.fullName}${c.off} — NOT removed: ${r.reasons.join("; ")}`);
  dim(`    /specialists/${r.slug}`);
  dim(`    decision: ${r.reason}`);
}
if (held.length) console.log("");

if (removable.length) {
  console.log(`${removable.length} listing(s) to remove:`);
  for (const r of removable) {
    console.log(`  ${r.fullName}`);
    dim(`    /specialists/${r.slug}`);
    dim(`    ${r.reason}`);
  }
  console.log("");
}

if (!WRITE) {
  console.log(`Report only — nothing was removed. Pass ${c.warn}--write${c.off} to apply.\n`);
  await disconnectDb();
  process.exit(0);
}

/* ------------------------------------------------------------ removal */

let gone = 0;
for (const r of removable) {
  /* Addresses this listing owns outright. They are not a foreign key on
     specialists, so nothing cascades them — deleting the specialist
     without them leaves an address on the map with nobody at it. The
     link rows DO cascade, so read them before the specialist goes. */
  const links = await db
    .select({ clinicLocationId: t.specialistClinicLocations.clinicLocationId })
    .from(t.specialistClinicLocations)
    .where(eq(t.specialistClinicLocations.specialistId, r.id));

  let ownAddresses = [];
  if (links.length) {
    const locations = await db
      .select({ id: t.clinicLocations.id, ownedBySpecialistId: t.clinicLocations.ownedBySpecialistId })
      .from(t.clinicLocations)
      .where(inArray(t.clinicLocations.id, links.map((l) => l.clinicLocationId)));
    ownAddresses = locations.filter((l) => l.ownedBySpecialistId === r.id).map((l) => l.id);
  }

  await db.delete(t.specialists).where(eq(t.specialists.id, r.id));
  if (ownAddresses.length) {
    await db.delete(t.clinicLocations).where(inArray(t.clinicLocations.id, ownAddresses));
  }

  /* The shell account exists only to be borrowed by an admin looking at
     this listing. With the listing gone it is an unreachable login with
     a real person's name on it, so it goes too — but only if it is
     still the unclaimed shell and not an account somebody now uses. */
  if (r.userId) {
    const [user] = await db
      .select({ id: t.users.id, email: t.users.email })
      .from(t.users)
      .where(eq(t.users.id, r.userId));
    if (user && /@unclaimed\.toplocalspecialists\.com$/i.test(user.email)) {
      await db.delete(t.users).where(eq(t.users.id, user.id));
    } else if (user) {
      dim(`  kept the account ${user.email} — it is not an unclaimed shell`);
    }
  }

  gone += 1;
  console.log(`${c.good}✓${c.off} removed ${r.fullName}`);
}

console.log(
  `\n${c.good}${gone} listing(s) removed.${c.off}` +
    (held.length ? ` ${held.length} held back — see above.` : "") +
    `\nThey are also rejected in data/listing-decisions.csv, so an import will not bring them back.\n`
);

await disconnectDb();
