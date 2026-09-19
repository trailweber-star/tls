#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Moving listings that are places out of the members table
 *
 *   node scripts/move-to-facilities.mjs            # report only
 *   node scripts/move-to-facilities.mjs --write    # do it
 *
 * The old site had one kind of listing, so University Hospital Coventry
 * & Warwickshire is currently a member of this directory: it has a
 * biography field, specialty tags and a "claim this profile" button
 * meant for a clinician. This site has a second kind of listing built
 * for places -- opening hours, a regulator, a team of members -- and
 * these belong in it.
 *
 * WHICH ONES, AND AS WHAT, IS NOT DECIDED HERE. data/facility-moves.csv
 * is, and it is in git while data/harvest/ is not. The word "Hospital"
 * in a name does not say whether a place is NHS or private, and a
 * script that guessed would be wrong quietly. Two or more rows sharing
 * a facilitySlug are a merge, because the old site listed some
 * hospitals once per department.
 *
 * WHAT IT REFUSES TO DO. A group where any member is claimed by a real
 * account, or carries an enquiry, an article or a review, is named and
 * skipped whole. Half a merge is worse than none.
 *
 * WHAT IS NOT CARRIED ACROSS. Facilities hold facility categories, not
 * specialty tags, and they have no treatments or conditions -- so the
 * script refuses to move any listing that has treatments or conditions
 * on it, rather than dropping them silently. At the time the csv was
 * written not one of the fourteen had any; the website pass has since
 * read the hospitals' own sites and given five of them some, which is
 * what the refusal is for.
 *
 *   --drop-derived   move them anyway, naming every link discarded
 *
 * That flag is safe on these fourteen and would not be safe in general.
 * Nothing in the join tables records where a link came from, so the
 * script cannot tell a derived link from one a clinician typed. What it
 * can tell is whether a real person owns the listing, and it still
 * refuses a claimed one whatever flags you pass. For an unclaimed
 * hospital the links can only have come from a derivation pass, and a
 * hospital does not perform an operation: the facility's categories say
 * what it is, and the surgeons who work there carry their own lists.
 * The pass no longer reads these fourteen at all, so a re-run will not
 * put the links back -- see scripts/lib/place-listings.mjs.
 *
 * The regulator fields are left empty on purpose. A CQC reference is a
 * fact to look up, and this repository already contains one worked
 * example of what invented regulator data does to a listing.
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
const DROP_DERIVED = args.includes("--drop-derived");

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };
const dim = (s) => console.log(`${c.dim}${s}${c.off}`);
const die = (msg) => { console.error(`\n${c.bad}${msg}${c.off}\n`); process.exit(1); };

if (!isDbConfigured()) die("No DATABASE_URL.");
const url = process.env.DATABASE_URL ?? "";
if (/^postgres(ql)?:\/\/[^@]*@dpg-[a-z0-9-]+-a(\/|:|$)/.test(url)) {
  die("That DATABASE_URL is Render's INTERNAL hostname. From your machine use dpg-xxxx-a.frankfurt-postgres.render.com");
}
const db = getDb();
let host = "(unparseable DATABASE_URL)";
try { host = new URL(url).hostname; } catch { /* keep the placeholder */ }

/* --------------------------------------------------------------- csv */

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
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const file = path.join(BACKEND, "data", "facility-moves.csv");
if (!fs.existsSync(file)) die("No data/facility-moves.csv — nothing has been decided.");
const decisions = parseCsv(
  fs.readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
);
if (!decisions.length) die("data/facility-moves.csv has no rows.");

/* --------------------------------------------------------- the groups */

const groups = new Map();
for (const d of decisions) {
  if (!d.slug || !d.facilitySlug) die(`A row is missing slug or facilitySlug: ${JSON.stringify(d)}`);
  if (!groups.has(d.facilitySlug)) groups.set(d.facilitySlug, []);
  groups.get(d.facilitySlug).push(d);
}
for (const [facilitySlug, rows] of groups) {
  const primaries = rows.filter((r) => r.primary?.toLowerCase() === "yes");
  if (primaries.length !== 1) {
    die(`${facilitySlug} has ${primaries.length} rows marked primary=yes. Exactly one row must say which listing the facility takes its details from.`);
  }
}

console.log(`\n${c.dim}database  ${host}${c.off}`);
console.log(`${decisions.length} listing(s) → ${groups.size} facility/ies\n`);

/* --------------------------------------------------------- the lookup */

const wantedSlugs = decisions.map((d) => d.slug);
const specialists = await db
  .select()
  .from(t.specialists)
  .where(inArray(t.specialists.slug, wantedSlugs));
const bySlug = new Map(specialists.map((s) => [s.slug, s]));

const missing = wantedSlugs.filter((s) => !bySlug.has(s));
if (missing.length) {
  console.log(`${c.warn}! ${missing.length} slug(s) in the csv match no listing — check the spelling:${c.off}`);
  for (const s of missing) console.log(`    ${s}`);
  console.log("");
}

const existingFacilities = await db.select({ slug: t.facilities.slug }).from(t.facilities);
const takenFacilitySlugs = new Set(existingFacilities.map((f) => f.slug));
const collisions = [...groups.keys()].filter((s) => takenFacilitySlugs.has(s));
if (collisions.length) die(`These facility slugs already exist: ${collisions.join(", ")}`);

const categories = await db
  .select({ id: t.facilityCategories.id, slug: t.facilityCategories.slug, name: t.facilityCategories.name })
  .from(t.facilityCategories);
const categoryBySlug = new Map(categories.map((x) => [x.slug, x]));
const badCategories = [
  ...new Set(decisions.flatMap((d) => (d.categories ?? "").split(/\s+/).filter(Boolean))),
].filter((s) => !categoryBySlug.has(s));
if (badCategories.length) die(`Unknown facility category slug(s): ${badCategories.join(", ")}`);

const ids = specialists.map((s) => s.id);

const [locLinks, leads, articles, reviews, treatmentLinks, conditionLinks] = await Promise.all([
  ids.length ? db.select().from(t.specialistClinicLocations).where(inArray(t.specialistClinicLocations.specialistId, ids)) : [],
  ids.length ? db.select({ k: t.leads.specialistId }).from(t.leads).where(inArray(t.leads.specialistId, ids)) : [],
  ids.length ? db.select({ k: t.articles.authorSpecialistId }).from(t.articles).where(inArray(t.articles.authorSpecialistId, ids)) : [],
  ids.length ? db.select({ k: t.reviews.subjectId }).from(t.reviews).where(inArray(t.reviews.subjectId, ids)) : [],
  /* The names, not just a count. A refusal that says "has 4
     treatment(s)" cannot be judged; one that names them can. */
  ids.length ? db.select({ k: t.specialistTreatments.specialistId, name: t.treatments.name })
    .from(t.specialistTreatments)
    .innerJoin(t.treatments, eq(t.treatments.id, t.specialistTreatments.treatmentId))
    .where(inArray(t.specialistTreatments.specialistId, ids)) : [],
  ids.length ? db.select({ k: t.specialistConditions.specialistId, name: t.conditions.name })
    .from(t.specialistConditions)
    .innerJoin(t.conditions, eq(t.conditions.id, t.specialistConditions.conditionId))
    .where(inArray(t.specialistConditions.specialistId, ids)) : [],
]);

const tally = (rows) => { const m = new Map(); for (const r of rows) m.set(r.k, (m.get(r.k) ?? 0) + 1); return m; };
const leadCount = tally(leads);
const articleCount = tally(articles);
const reviewCount = tally(reviews);
const treatmentCount = tally(treatmentLinks);
const conditionCount = tally(conditionLinks);

const namesOf = (rows, kind) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.k)) m.set(r.k, []);
    m.get(r.k).push({ kind, name: r.name });
  }
  return m;
};
const treatmentNames = namesOf(treatmentLinks, "procedure");
const conditionNames = namesOf(conditionLinks, "condition");
const linksOf = (id) => [...(treatmentNames.get(id) ?? []), ...(conditionNames.get(id) ?? [])];

const locationIds = [...new Set(locLinks.map((l) => l.clinicLocationId))];
const locations = locationIds.length
  ? await db.select().from(t.clinicLocations).where(inArray(t.clinicLocations.id, locationIds))
  : [];
const locationById = new Map(locations.map((l) => [l.id, l]));
const locationsOf = (specialistId) =>
  locLinks.filter((l) => l.specialistId === specialistId).map((l) => locationById.get(l.clinicLocationId)).filter(Boolean);

const userIds = specialists.map((s) => s.userId).filter(Boolean);
const users = userIds.length
  ? await db.select({ id: t.users.id, email: t.users.email }).from(t.users).where(inArray(t.users.id, userIds))
  : [];
const userById = new Map(users.map((u) => [u.id, u]));
const isShellAccount = (email) => /@unclaimed\.toplocalspecialists\.com$/i.test(email ?? "");

/* ------------------------------------------------------- the verdicts */

const ready = [];
const held = [];

for (const [facilitySlug, rows] of groups) {
  const members = rows.map((r) => ({ decision: r, specialist: bySlug.get(r.slug) })).filter((m) => m.specialist);
  if (!members.length) continue;

  const reasons = [];
  const discards = [];
  for (const m of members) {
    const s = m.specialist;
    const user = s.userId ? userById.get(s.userId) : null;
    if (s.claimed && user && !isShellAccount(user.email)) reasons.push(`${s.fullName} is claimed by ${user.email}`);
    const l = leadCount.get(s.id) ?? 0;
    const a = articleCount.get(s.id) ?? 0;
    const v = reviewCount.get(s.id) ?? 0;
    const tr = treatmentCount.get(s.id) ?? 0;
    const cd = conditionCount.get(s.id) ?? 0;
    if (l) reasons.push(`${s.fullName} has ${l} patient enquir${l === 1 ? "y" : "ies"}`);
    if (a) reasons.push(`${s.fullName} has ${a} article(s)`);
    if (v) reasons.push(`${s.fullName} has ${v} review(s)`);
    if (tr || cd) {
      /* A facility has nowhere to put these. Either that stops the
         move, or --drop-derived says to lose them on purpose -- in
         which case every one is named below, and deleting the listing
         takes the link rows with it (the join tables cascade). */
      if (DROP_DERIVED) discards.push({ specialist: s, links: linksOf(s.id) });
      else reasons.push(`${s.fullName} has ${tr} treatment(s) and ${cd} condition(s), which a facility cannot hold — see --drop-derived`);
    }
  }

  const primary = members.find((m) => m.decision.primary?.toLowerCase() === "yes");
  if (!primary) reasons.push("its primary row matches no listing in the database");
  const primaryLocation = primary ? locationsOf(primary.specialist.id)[0] : null;
  if (primary && !primaryLocation) reasons.push(`${primary.specialist.fullName} has no address, and a facility needs a city`);

  const entry = { facilitySlug, rows, members, primary, primaryLocation, reasons, discards };
  if (reasons.length) held.push(entry); else ready.push(entry);
}

/* --------------------------------------------------------- the report */

for (const g of held) {
  console.log(`${c.warn}! ${g.rows[0].facilityName || g.facilitySlug}${c.off} — NOT moved:`);
  for (const r of g.reasons) dim(`    ${r}`);
}
if (held.length) console.log("");

for (const g of ready) {
  const d = g.primary.decision;
  const cats = (d.categories ?? "").split(/\s+/).filter(Boolean).map((s) => categoryBySlug.get(s).name);
  console.log(`${c.bold}${d.facilityName}${c.off}  ${c.dim}${d.facilityType} · ${cats.join(", ")}${c.off}`);
  dim(`    /organisations/${g.facilitySlug}`);
  dim(`    ${g.primaryLocation.address}${g.primaryLocation.postcode ? ` · ${g.primaryLocation.postcode}` : ""}`);
  if (g.primary.specialist.websiteUrl) dim(`    ${g.primary.specialist.websiteUrl}`);
  for (const m of g.members) {
    const mark = m === g.primary ? `${c.good}keeps its details${c.off}` : `${c.dim}merged in${c.off}`;
    console.log(`      ${m.specialist.fullName.slice(0, 54).padEnd(54)} ${mark}`);
  }
  for (const d of g.discards) {
    console.log(`      ${c.warn}discards ${d.links.length} link(s) from ${d.specialist.fullName}${c.off}`);
    for (const l of d.links) dim(`        ${l.kind.padEnd(9)} ${l.name}`);
  }
  console.log("");
}

const discardTotal = ready.reduce((n, g) => n + g.discards.reduce((k, d) => k + d.links.length, 0), 0);

console.log(
  `${c.bold}${ready.length} facility/ies${c.off} from ${ready.reduce((n, g) => n + g.members.length, 0)} listing(s)` +
    (held.length ? `, ${held.length} held back` : "") +
    (discardTotal ? `, ${c.warn}${discardTotal} derived link(s) discarded${c.off}` : "") + "\n"
);

if (!WRITE) {
  console.log(`Report only — nothing was changed. Pass ${c.warn}--write${c.off} to apply.\n`);
  await disconnectDb();
  process.exit(0);
}

/* ------------------------------------------------------------ the move */

const { newId } = t;
let made = 0;
let removed = 0;

for (const g of ready) {
  const d = g.primary.decision;
  const s = g.primary.specialist;
  const loc = g.primaryLocation;

  const facilityId = newId("fac");
  await db.insert(t.facilities).values({
    id: facilityId,
    facilityType: d.facilityType,
    slug: g.facilitySlug,
    name: d.facilityName || s.fullName,
    tagline: s.title ?? null,
    description: null,
    about: s.bio ?? null,
    photoUrl: s.photoUrl ?? null,
    coverImageUrl: s.coverImageUrl ?? null,
    gallery: s.gallery ?? [],
    websiteUrl: s.websiteUrl ?? null,
    bookingUrl: s.bookingUrl ?? null,
    socials: s.socials ?? {},
    phone: loc.phone ?? null,
    cityId: loc.cityId,
    address: loc.address ?? null,
    postcode: loc.postcode ?? null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    /* regulator, regulatorRef, regulatorRating and regulatorUrl stay
       null. See the header. */
  });

  const catSlugs = (d.categories ?? "").split(/\s+/).filter(Boolean);
  if (catSlugs.length) {
    await db
      .insert(t.facilityCategoryLinks)
      .values(catSlugs.map((slug) => ({ facilityId, categoryId: categoryBySlug.get(slug).id })))
      .onConflictDoNothing();
  }
  made += 1;
  console.log(`${c.good}✓${c.off} created /organisations/${g.facilitySlug}`);

  for (const m of g.members) {
    const sp = m.specialist;
    /* Addresses this listing owns outright are not a foreign key on
       specialists, so nothing cascades them. Read them before the row
       goes. A merged hospital's own address has just been copied onto
       the facility, so the old row is no longer anybody's. */
    const own = locationsOf(sp.id).filter((l) => l.ownedBySpecialistId === sp.id).map((l) => l.id);
    await db.delete(t.specialists).where(eq(t.specialists.id, sp.id));
    if (own.length) await db.delete(t.clinicLocations).where(inArray(t.clinicLocations.id, own));

    if (sp.userId) {
      const user = userById.get(sp.userId);
      if (user && isShellAccount(user.email)) await db.delete(t.users).where(eq(t.users.id, user.id));
      else if (user) dim(`    kept the account ${user.email}`);
    }
    removed += 1;
    dim(`    removed the member listing ${sp.slug}`);
  }
}

console.log(
  `\n${c.good}${made} facility/ies created, ${removed} member listing(s) removed.${c.off}` +
    (held.length ? ` ${held.length} group(s) held back — see above.` : "") +
    (discardTotal ? ` ${discardTotal} derived treatment/condition link(s) went with them, named above.` : "") +
    `\nThe regulator fields are empty on all of them, deliberately.\n`
);

await disconnectDb();
