#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Removing the demo directory from a real database
 *
 *   node scripts/retire-seed.mjs            # report only
 *   node scripts/retire-seed.mjs --write    # remove them
 *
 * src/data/mock.js exists so the site can be run and shown with nothing
 * in the database. On an empty database prepare.mjs seeds from it; on a
 * database that already has rows it does not. Ours filled up from the
 * migration afterwards, so a handful of demo records were left sitting
 * among two and a half thousand real ones.
 *
 * They are not harmless placeholders. Every one of them carries an
 * invented regulator record:
 *
 *   Queen's Cross Private Hospital   CQC 1-101234567   rated Outstanding
 *   Northgate General Hospital       CQC 1-102345678   rated Good
 *   ... six of the eight facilities, numbered sequentially
 *
 *   Dr Amara Chukwu                  GMC 7012345
 *   Mr James Whitfield               GMC 7023456
 *   ... and so on, also sequentially
 *
 * A made-up GMC number on a made-up doctor is bad. A made-up CQC
 * *rating* on a hospital is worse, because "Outstanding" is a specific
 * published finding that a patient would reasonably choose a hospital
 * on, and it links to cqc.org.uk as though it could be checked.
 *
 * WHAT IT REFUSES TO DO. The seed marks its own listings claimed, so
 * `claimed` cannot be the test for whether a real person has taken one
 * over -- the test is whether there is any real activity against it: an
 * enquiry, an article, a review the seed did not itself write, or a
 * linked account that is not a demo
 * one. Anything with those is named and skipped, because at that point
 * something happened there that is not ours to throw away.
 *
 * It also refuses to delete a record that no longer looks like the
 * seed. If somebody has edited Queen's Cross into a real hospital, its
 * example.org website and .example email will be gone, and so is this
 * script's licence to remove it.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import * as mock from "../src/data/mock.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);

if (!isDbConfigured()) {
  console.error(`\n${c.bad}No DATABASE_URL.${c.off}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? "";
if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
  console.error(
    `\n${c.bad}That DATABASE_URL is Render's INTERNAL hostname.${c.off}\n` +
      `From your machine use dpg-xxxx-a.frankfurt-postgres.render.com\n`
  );
  process.exit(1);
}

const db = getDb();
let host = "(unparseable DATABASE_URL)";
try { host = new URL(url).hostname; } catch { /* keep the placeholder */ }

/* ------------------------------------------------- what the seed is */

/* The demo records identify themselves. example.com / example.org are
   reserved by the IETF precisely so nobody's real site is at them, and
   .example is a reserved TLD -- a real practice cannot have either. */
const DEMO_MARK = /(^|\/\/|@|\.)example\.(com|org|net)(\/|$)|\.example$/i;

const marksOf = (row) =>
  [row?.websiteUrl, row?.contactEmail, row?.bookingUrl]
    .filter((v) => typeof v === "string" && DEMO_MARK.test(v));

const seedSpecialists = new Map((mock.specialists ?? []).map((s) => [s.slug, s]));
const seedFacilities = new Map((mock.facilities ?? []).map((f) => [f.slug, f]));

console.log(`\n${c.dim}database  ${host}${c.off}`);
console.log(
  `${c.dim}the demo directory defines ${seedSpecialists.size} specialist(s) and ${seedFacilities.size} facility/ies${c.off}\n`
);

/* ------------------------------------------------------- the lookup */

const [liveSpecialists, liveFacilities] = await Promise.all([
  db
    .select({
      id: t.specialists.id, slug: t.specialists.slug, fullName: t.specialists.fullName,
      registrationNumber: t.specialists.registrationNumber, websiteUrl: t.specialists.websiteUrl,
      userId: t.specialists.userId, claimed: t.specialists.claimed,
    })
    .from(t.specialists),
  db
    .select({
      id: t.facilities.id, slug: t.facilities.slug, name: t.facilities.name,
      websiteUrl: t.facilities.websiteUrl, contactEmail: t.facilities.contactEmail,
      regulator: t.facilities.regulator, regulatorRef: t.facilities.regulatorRef,
      regulatorRating: t.facilities.regulatorRating,
      userId: t.facilities.userId, claimed: t.facilities.claimed,
    })
    .from(t.facilities),
]);

const found = [];

for (const row of liveSpecialists) {
  const seed = seedSpecialists.get(row.slug);
  if (!seed) continue;
  const marks = marksOf(row);
  const sameName = String(row.fullName ?? "").trim() === String(seed.fullName ?? "").trim();
  const sameReg =
    seed.registrationNumber != null &&
    String(row.registrationNumber ?? "") === String(seed.registrationNumber);
  found.push({
    kind: "specialist", ...row, name: row.fullName,
    stillSeed: sameName && (marks.length > 0 || sameReg),
    evidence: [...marks, sameReg ? `registration ${row.registrationNumber}` : null].filter(Boolean),
    invented: sameReg ? `GMC ${row.registrationNumber}` : null,
  });
}

for (const row of liveFacilities) {
  const seed = seedFacilities.get(row.slug);
  if (!seed) continue;
  const marks = marksOf(row);
  const sameName = String(row.name ?? "").trim() === String(seed.name ?? "").trim();
  found.push({
    kind: "facility", ...row,
    stillSeed: sameName && marks.length > 0,
    evidence: marks,
    invented: row.regulatorRef
      ? `${String(row.regulator ?? "").toUpperCase()} ${row.regulatorRef}` +
        (row.regulatorRating ? ` rated ${String(row.regulatorRating).replace(/_/g, " ")}` : "")
      : null,
  });
}

if (!found.length) {
  console.log(`${c.good}No demo records in this database.${c.off}\n`);
  await disconnectDb();
  process.exit(0);
}

/* ----------------------------------------------------- the activity */

const specialistIds = found.filter((r) => r.kind === "specialist").map((r) => r.id);
const facilityIds = found.filter((r) => r.kind === "facility").map((r) => r.id);

const count = (rows, key) => {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return m;
};

const allIds = found.map((r) => r.id);
const [leadsSp, leadsFac, articlesSp, articlesFac, reviewsAny] = await Promise.all([
  specialistIds.length
    ? db.select({ k: t.leads.specialistId }).from(t.leads).where(inArray(t.leads.specialistId, specialistIds))
    : [],
  facilityIds.length
    ? db.select({ k: t.leads.facilityId }).from(t.leads).where(inArray(t.leads.facilityId, facilityIds))
    : [],
  specialistIds.length
    ? db.select({ k: t.articles.authorSpecialistId }).from(t.articles).where(inArray(t.articles.authorSpecialistId, specialistIds))
    : [],
  facilityIds.length
    ? db.select({ k: t.articles.authorFacilityId }).from(t.articles).where(inArray(t.articles.authorFacilityId, facilityIds))
    : [],
  /* Reviews are polymorphic -- subjectType plus subjectId -- so one
     query covers both kinds of demo record. */
  allIds.length
    ? db
        .select({
          id: t.reviews.id, k: t.reviews.subjectId, rating: t.reviews.rating,
          comment: t.reviews.comment, patientName: t.reviews.patientName,
        })
        .from(t.reviews)
        .where(inArray(t.reviews.subjectId, allIds))
    : [],
]);

/* A REVIEW ON A DEMO RECORD IS USUALLY ALSO DEMO DATA.
 *
 * The first run of this script removed nothing: all fifteen records
 * were held back, every one of them for "2-4 review(s) left on it", and
 * every one of those reviews was written by the same seed that wrote
 * the record. The check was firing on its own evidence, and a rule that
 * protects fabricated CQC ratings from removal because the fabrication
 * came with fabricated praise is not protecting anybody.
 *
 * So a review is matched against the seed the same way the record is:
 * src/data/mock.js contains the exact text, and a live review whose
 * rating, patient name and comment are word for word one of the seed's
 * own reviews of that same record is part of the seed. Anything else --
 * a real patient who found a demo listing and left a real review -- is
 * not, and still holds the record back. */
const mockSlugById = new Map([
  ...(mock.specialists ?? []).map((x) => [x.id, x.slug]),
  ...(mock.facilities ?? []).map((x) => [x.id, x.slug]),
]);
const fingerprint = (r) =>
  [r.rating, String(r.patientName ?? "").trim(), String(r.comment ?? "").replace(/\s+/g, " ").trim()].join("\u0000");
const seedReviewsBySlug = new Map();
/* The seed keeps the two kinds in two arrays -- mock.reviews is
   specialists only, mock.facilityReviews is the places -- and reading
   only the first one held back every facility, which is how Queen's
   Cross survived the last run. */
for (const r of [...(mock.reviews ?? []), ...(mock.facilityReviews ?? [])]) {
  const slug = mockSlugById.get(r.subjectId);
  if (!slug) continue;
  if (!seedReviewsBySlug.has(slug)) seedReviewsBySlug.set(slug, new Set());
  seedReviewsBySlug.get(slug).add(fingerprint(r));
}
const slugById = new Map(found.map((r) => [r.id, r.slug]));
const seededReviewIds = [];
const realReviews = [];
for (const rv of reviewsAny) {
  const slug = slugById.get(rv.k);
  const seeded = slug && seedReviewsBySlug.get(slug)?.has(fingerprint(rv));
  if (seeded) seededReviewIds.push(rv);
  else realReviews.push(rv);
}

const leadCount = new Map([...count(leadsSp, "k"), ...count(leadsFac, "k")]);
const articleCount = new Map([...count(articlesSp, "k"), ...count(articlesFac, "k")]);
const reviewCount = count(realReviews, "k");
const seededReviewCount = count(seededReviewIds, "k");

/* A linked account only blocks removal if it is somebody's real login.
   The unclaimed shells the importer creates, and any demo address, are
   not. */
const userIds = found.map((r) => r.userId).filter(Boolean);
const users = userIds.length
  ? await db.select({ id: t.users.id, email: t.users.email }).from(t.users).where(inArray(t.users.id, userIds))
  : [];
const userById = new Map(users.map((u) => [u.id, u]));
const isDisposableAccount = (email) =>
  /@unclaimed\.toplocalspecialists\.com$/i.test(email ?? "") || DEMO_MARK.test(email ?? "");

const removable = [];
const held = [];
for (const r of found) {
  const reasons = [];
  if (!r.stillSeed) reasons.push("it no longer matches the demo record — somebody has edited it");
  const l = leadCount.get(r.id) ?? 0;
  const a = articleCount.get(r.id) ?? 0;
  const v = reviewCount.get(r.id) ?? 0;
  if (l) reasons.push(`${l} patient enquir${l === 1 ? "y" : "ies"} against it`);
  if (a) reasons.push(`${a} article(s) written under it`);
  if (v) reasons.push(`${v} review(s) left on it that the seed did not write`);
  const user = r.userId ? userById.get(r.userId) : null;
  if (user && !isDisposableAccount(user.email)) reasons.push(`a real account is attached: ${user.email}`);
  if (reasons.length) held.push({ ...r, reasons });
  else removable.push(r);
}

/* --------------------------------------------------------- the report */

const invented = found.filter((r) => r.invented);
if (invented.length) {
  console.log(`${c.bad}${invented.length} of them publish an invented regulator record:${c.off}`);
  for (const r of invented) console.log(`    ${r.name.slice(0, 42).padEnd(42)} ${r.invented}`);
  console.log("");
}

for (const r of held) {
  console.log(`${c.warn}! ${r.name}${c.off} — NOT removed: ${r.reasons.join("; ")}`);
  dim(`    ${r.kind} /${r.kind === "facility" ? "organisations" : "specialists"}/${r.slug}`);
}
if (held.length) console.log("");

if (removable.length) {
  console.log(`${removable.length} demo record(s) to remove:`);
  for (const r of removable) {
    console.log(`  ${r.name}`);
    dim(`    ${r.kind} /${r.kind === "facility" ? "organisations" : "specialists"}/${r.slug}`);
    dim(`    demo because: ${r.evidence.join(", ")}`);
    const sv = seededReviewCount.get(r.id) ?? 0;
    if (sv) dim(`    and ${sv} seeded review(s) of it, which go with it`);
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
  if (r.kind === "specialist") {
    /* Addresses this listing owns outright are not a foreign key on
       specialists, so nothing cascades them. Read the links before the
       specialist goes and takes them with it. */
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
  } else {
    await db.delete(t.facilities).where(eq(t.facilities.id, r.id));
  }

  /* Reviews are polymorphic, so nothing cascades them. Only the ones
     the seed itself wrote — anything a real patient left has already
     held the whole record back, so there is none here. */
  const mine = seededReviewIds.filter((rv) => rv.k === r.id).map((rv) => rv.id);
  if (mine.length) {
    await db.delete(t.reviews).where(inArray(t.reviews.id, mine));
    dim(`  and ${mine.length} seeded review(s) of it`);
  }

  if (r.userId) {
    const user = userById.get(r.userId);
    if (user && isDisposableAccount(user.email)) {
      await db.delete(t.users).where(eq(t.users.id, user.id));
    } else if (user) {
      dim(`  kept the account ${user.email}`);
    }
  }

  gone += 1;
  console.log(`${c.good}✓${c.off} removed ${r.name} ${c.dim}(${r.kind})${c.off}`);
}

console.log(
  `\n${c.good}${gone} demo record(s) removed.${c.off}` +
    (held.length ? ` ${held.length} held back — see above.` : "") +
    `\nSEED_ON_BOOT only seeds an empty database, so they will not come back.\n`
);

await disconnectDb();
