#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Importing one full profile
 *
 *   node scripts/import-profile.mjs data/imports/mr-kirti-moholkar.json --dry-run
 *   node scripts/import-profile.mjs data/imports/mr-kirti-moholkar.json
 *
 * scripts/import-specialists.mjs takes a spreadsheet: one row, one
 * address, one specialty. A real consultant's profile is not that
 * shape — nine locations, forty specialties, fees, insurers, a
 * registration number — so this takes a curated JSON file instead, one
 * profile per file, kept under data/imports/ where a person can read
 * and correct it without reading a script.
 *
 * THE SAME THREE RULES. They are not negotiable here either, and they
 * are the reason this is a separate tool rather than a hand-written
 * INSERT:
 *
 *  1. No ratings, and no reviews. A star rating on this site means
 *     reviews this site holds and has moderated. Copying a source's
 *     4.95 publishes a score for reviews we cannot show and could not
 *     stand behind the first time anybody asked; copying the review
 *     texts republishes other people's patients on a site they never
 *     wrote to. Both stay in import_source, visible to an admin and to
 *     nobody else.
 *
 *  2. Nobody arrives verified. The badge means somebody here checked
 *     the registration number against the regulator's register. Another
 *     site's tick is not that check. Everything lands `unverified` and
 *     unclaimed — which is a real state in this codebase, not a
 *     placeholder: an unclaimed listing is public precisely so the
 *     person it names can find it and claim it.
 *
 *  3. It never invents. Every field written here is in the JSON file.
 *     A field that is not there stays empty.
 *
 * Re-running is safe. Rows are keyed on the source URL, so a second run
 * updates what the first one made.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/* backend/.env by its own path, not by the current directory, so this
   works whether it is run from backend/ or from the repo root. A
   DATABASE_URL already in the environment still wins. */
const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const { eq, inArray } = await import("drizzle-orm");
const { getDb, disconnectDb, isDbConfigured } = await import("../src/db/client.js");
const t = await import("../src/db/schema.js");
const { newId } = t;
const { registerGeocoder } = await import("../src/lib/geocoders.js");
const { geocode, hasGeocoder } = await import("../src/lib/geo.js");
const { UNUSABLE_PASSWORD } = await import("../src/lib/auth.js");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));

const c = {
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  bad: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  off: "\x1b[0m",
};
const say = (msg) => console.log(msg);
const dim = (msg) => console.log(`${c.dim}${msg}${c.off}`);

if (!file) {
  say(`${c.bad}Which file?${c.off}`);
  dim("  node scripts/import-profile.mjs data/imports/mr-kirti-moholkar.json [--dry-run]");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  say(`${c.bad}No such file: ${file}${c.off}`);
  process.exit(1);
}
if (!isDbConfigured()) {
  say(`${c.bad}No DATABASE_URL — there is nothing to import into.${c.off}`);
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const db = getDb();
registerGeocoder();

/* Every city belongs to a country, and the column is NOT NULL. One
   country in this database today; picked up rather than assumed, so the
   day there are two this fails loudly instead of filing a Birmingham in
   the wrong one. */
const countryRows = await db.select().from(t.countries);
const country = countryRows.find((row) => row.isoCode === "GB") ?? countryRows[0];
if (!country) {
  say(`${c.bad}No countries in the database — run \`npm run seed\` first.${c.off}`);
  process.exit(1);
}

/* ------------------------------------------------------------ helpers */

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A city row for a postcode, created if we have never seen the district.
 *
 * The postcode is the authority, not the town in the address: "Priory
 * Road, Edgbaston, B5 7UG" says Edgbaston, and only the lookup knows
 * that Edgbaston is a district of Birmingham. The lookup also returns
 * the coordinates, which is what makes a radius search mean the address
 * rather than the town.
 */
let geocoderWarned = false;
async function cityFor(postcode, fallbackName, fallbackRegion) {
  let name = fallbackName ?? null;
  let coords = null;
  let region = fallbackRegion ?? null;

  if (postcode && hasGeocoder()) {
    try {
      const hit = await geocode(postcode);
      if (hit) {
        /* COORDINATES ONLY. The town and region in the file are what a
           person curated, and they win.

           An earlier version of this took the name from the geocoder
           too, on a wrong guess about its shape: postcodes.io answers
           "WR9 8DN · Wychavon" — the postcode and the ADMINISTRATIVE
           DISTRICT, not "town · area". So it filed Kirti's Droitwich
           clinic under "Wychavon", his Halesowen one under "Dudley" and
           the Stanmore hospital under "Harrow", and wrote the postcode
           itself into the region column. Every one of those is a name no
           patient would search for, on a page whose whole job is to be
           found by the town it names. */
        coords = { lat: hit.lat, lng: hit.lng };
        /* Only when the file named no town at all is the district
           better than nothing. */
        if (!name) {
          const parts = String(hit.name ?? "").split("·").map((s) => s.trim()).filter(Boolean);
          if (parts.length > 1) name = parts[parts.length - 1];
        }
      }
      if (!hit && !geocoderWarned) {
        geocoderWarned = true;
        say(
          `  ${c.warn}the postcode lookup is not answering — using the towns named in the file.${c.off}`
        );
        dim("  Those cities get no coordinates, so radius search will not find these");
        dim("  locations until this is re-run somewhere the lookup is reachable; it");
        dim("  backfills the coordinates on a city that already exists.");
      }
    } catch {
      /* An unreachable lookup is not a reason to lose a location. The
         town in the file is what carries it. */
    }
  }
  if (!name) return null;

  const slug = slugify(name);
  const [existing] = await db.select().from(t.cities).where(eq(t.cities.slug, slug)).limit(1);
  if (existing) {
    /* Fill in coordinates on a city that was created without them —
       an unpinned city is a listing that cannot be found by radius. */
    if (coords && (existing.lat == null || existing.lng == null)) {
      if (!DRY) {
        await db.update(t.cities).set({ lat: coords.lat, lng: coords.lng }).where(eq(t.cities.id, existing.id));
      }
      return { ...existing, ...coords, __pinned: true };
    }
    return existing;
  }

  const row = {
    id: newId("cty"),
    countryId: country.id,
    name,
    slug,
    region,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  };
  if (!DRY) await db.insert(t.cities).values(row);
  return { ...row, __new: true };
}

/** A clinic row, created if this is the first specialist to list it. */
async function clinicFor(location) {
  const slug = location.clinicSlug || slugify(location.clinicName);
  const [existing] = await db.select().from(t.clinics).where(eq(t.clinics.slug, slug)).limit(1);
  if (existing) return existing;

  const row = { id: newId("cln"), slug, name: location.clinicName };
  if (!DRY) await db.insert(t.clinics).values(row);
  return { ...row, __new: true };
}

/* --------------------------------------------------------- the write */

async function run() {
  const sourceUrl = profile.sourceUrl ?? null;
  const sourceName = profile.sourceName ?? "manual";

  /* ------------------------------------------------------ taxonomy
     Resolved before anything is written, and a slug that does not exist
     stops the import. A listing tagged with a specialty that is not in
     the tree is a profile that quietly fails to appear in the one search
     it should top. */
  const wanted = [
    ...(profile.subspecialtySlugs ?? []),
    ...(profile.specialtySlugs ?? []),
    profile.primarySpecialtySlug,
  ].filter(Boolean);
  const unique = [...new Set(wanted)];

  const found = unique.length
    ? await db.select().from(t.specialties).where(inArray(t.specialties.slug, unique))
    : [];
  const bySlug = new Map(found.map((s) => [s.slug, s]));
  const missing = unique.filter((s) => !bySlug.has(s));
  if (missing.length) {
    say(`${c.bad}These specialty slugs are not in the taxonomy:${c.off}`);
    for (const m of missing) dim(`  - ${m}`);
    dim("  Fix the file, or add them to backend/src/data/taxonomy — but do not");
    dim("  map them onto a near-neighbour: a knee surgeon listed under hand");
    dim("  arthritis is worse than one listed under nothing.");
    process.exit(1);
  }

  const primary = profile.primarySpecialtySlug ? bySlug.get(profile.primarySpecialtySlug) : null;

  /* ----------------------------------------------------- regulator */
  let regulator = null;
  if (profile.regulatorCode) {
    const [row] = await db
      .select()
      .from(t.regulators)
      .where(eq(t.regulators.code, String(profile.regulatorCode).toUpperCase()))
      .limit(1);
    regulator = row ?? null;
    if (!regulator) dim(`  note: no regulator with code ${profile.regulatorCode} — the register line will be omitted`);
  }

  /* ------------------------------------------------- the specialist */
  const importSource = {
    source: sourceName,
    url: sourceUrl,
    importedAt: new Date().toISOString(),
    file: path.basename(file),
    /* Kept verbatim, shown to nobody but an admin. The rating and the
       reviews are in here precisely BECAUSE they are not imported: when
       the person whose name is on this listing asks where it came from,
       this is the answer, and it should be the whole answer. */
    notImported: {
      ...(profile.notImported ?? {}),
      why:
        (profile.notImported?.why ?? "") ||
        "Another platform's figures and another platform's patients. Not this site's ratings, and not this site's verification.",
    },
    /* Everything the file offered that this schema has no column for.
       Recorded rather than dropped, so nobody has to go back to the
       source to find out what was known at import time. */
    alsoRecorded: {
      fees: profile.fees ?? null,
      insurers: profile.insurers ?? null,
      subspecialties: profile.subspecialtySlugs ?? null,
      bioNeedsApproval: profile.bioNeedsApproval === true,
    },
  };

  const values = {
    slug: profile.slug || slugify(profile.fullName),
    fullName: profile.fullName,
    title: profile.title ?? null,
    qualifications: profile.qualifications ?? null,
    bio: profile.bio ?? null,
    yearsExperience: Number.isFinite(profile.yearsExperience) ? profile.yearsExperience : null,
    languages: profile.languages ?? [],
    primarySpecialtyId: primary?.id ?? null,
    regulatorId: regulator?.id ?? null,
    registrationNumber: profile.registrationNumber ?? null,
    consultationPriceMinor: Number.isFinite(profile.consultationPriceMinor)
      ? profile.consultationPriceMinor
      : null,
    currency: profile.currency ?? "GBP",
    websiteUrl: profile.websiteUrl ?? null,
    bookingUrl: profile.bookingUrl ?? null,

    /* Rule 2. Both of these, together — `unverified` is the public
       unclaimed state, and `claimed: false` is what the claim flow
       looks for. */
    verificationStatus: "unverified",
    claimed: false,

    plan: "basic",
    planStatus: "active",

    sourceName,
    sourceUrl,
    sourceImportedAt: new Date(),
    importSource,
  };

  const [existing] = sourceUrl
    ? await db.select().from(t.specialists).where(eq(t.specialists.sourceUrl, sourceUrl)).limit(1)
    : [];

  say("");
  say(`${c.bold}${profile.fullName}${c.off}  ${c.dim}${values.slug}${c.off}`);
  dim(`  ${existing ? "updating the listing a previous run created" : "creating a new listing"}`);
  dim(`  primary specialty   ${primary ? primary.name : "(none)"}`);
  dim(`  tagged with         ${unique.length} specialties`);
  dim(`  locations           ${(profile.locations ?? []).length}`);
  dim(`  register            ${regulator ? `${regulator.code} ${values.registrationNumber}` : "(none)"}`);
  dim(`  status              unverified, unclaimed`);
  if (profile.notImported?.rating) {
    dim(`  NOT imported        rating ${profile.notImported.rating}, ${profile.notImported.reviewCount ?? "?"} reviews`);
  }
  if (profile.bioNeedsApproval) {
    say(`  ${c.warn}the biography in this file is new prose, not the source's — it needs his sign-off${c.off}`);
  }

  if (DRY) {
    say("");
    dim("  --dry-run: nothing written.");
    return;
  }

  let specialistId;
  if (existing) {
    specialistId = existing.id;
    await db.update(t.specialists).set({ ...values, updatedAt: new Date() }).where(eq(t.specialists.id, existing.id));
  } else {
    specialistId = newId("spc");
    await db.insert(t.specialists).values({ id: specialistId, ...values });
  }

  /* ------------------------------------------------ specialty links
     Replaced rather than merged: the file is the statement of what this
     person does, so a slug removed from it should disappear from the
     listing rather than linger from an earlier run. */
  await db.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialistId, specialistId));
  const links = unique.map((slug) => ({ specialistId, specialtyId: bySlug.get(slug).id }));
  if (links.length) await db.insert(t.specialistSpecialties).values(links);

  /* ---------------------------------------------------- locations */
  await db
    .delete(t.specialistClinicLocations)
    .where(eq(t.specialistClinicLocations.specialistId, specialistId));

  const notes = [];
  let order = 0;
  for (const location of profile.locations ?? []) {
    const clinic = await clinicFor(location);
    const city = await cityFor(location.postcode, location.city, location.region);

    /* A location row must belong to a city — the column is NOT NULL, and
       for good reason: a location with no town is a location no search
       can reach. Said plainly and skipped, rather than failing the whole
       import on one address. */
    if (!city) {
      notes.push(
        `${location.clinicName} skipped — no town. Add "city" to this location in the file.`
      );
      continue;
    }
    if (city && (city.lat == null || city.lng == null)) {
      notes.push(`${city.name} has no coordinates — radius search will miss this location`);
    }

    /* One clinic can hold several addresses, and two specialists can
       share one. Keyed on clinic + postcode + street so a second run
       reuses the row rather than stacking another copy of the same
       address under the same hospital. */
    /* Every address this clinic already holds, not just the first one.
       An earlier version selected one row and compared against it, so a
       hospital with two addresses matched neither on the second and
       stacked a duplicate row on every run. */
    const rows = await db
      .select()
      .from(t.clinicLocations)
      .where(eq(t.clinicLocations.clinicId, clinic.id));

    const norm = (v) => String(v ?? "").replace(/\s/g, "").toUpperCase();
    const existingLocation = rows.find(
      (r) =>
        norm(r.postcode) === norm(location.postcode) &&
        String(r.address ?? "") === String(location.address ?? "")
    );

    let locationId = null;

    if (existingLocation) {
      locationId = existingLocation.id;
      /* RECONCILE, don't just backfill. The city is the field that
         drifts: a row created by a run that named the town wrongly
         keeps that town forever if we only ever write cityId while
         filling in missing coordinates — which is exactly what
         happened here. Kirti's Droitwich, Halesowen and Stanmore rows
         had coordinates already, so the correcting branch never ran
         and all nine locations stayed pointed at the districts.

         The file is the statement of where these clinics are, so on
         every run the row is brought back into line with it. */
      const patch = {};
      if (city && existingLocation.cityId !== city.id) patch.cityId = city.id;
      if (city?.lat != null && (existingLocation.lat == null || existingLocation.lng == null)) {
        patch.lat = city.lat;
        patch.lng = city.lng;
      }
      if (Object.keys(patch).length) {
        await db.update(t.clinicLocations).set(patch).where(eq(t.clinicLocations.id, locationId));
        if (patch.cityId) notes.push(`${location.clinicName} moved to ${city.name}`);
      }
    } else {
      locationId = newId("loc");
      await db.insert(t.clinicLocations).values({
        id: locationId,
        clinicId: clinic.id,
        cityId: city?.id ?? null,
        address: location.address ?? null,
        postcode: location.postcode ?? null,
        lat: city?.lat ?? null,
        lng: city?.lng ?? null,
        phone: location.phone ?? null,
      });
    }

    await db.insert(t.specialistClinicLocations).values({ specialistId, clinicLocationId: locationId });
    order += 1;
    dim(`  ${String(order).padStart(2)}. ${location.clinicName}${city ? ` — ${city.name}` : ""}${clinic.__new ? " (new clinic)" : ""}${city?.__new ? " (new city)" : ""}`);
  }

  /* ------------------------------------------------- the shell account

     An imported listing with no account behind it is a listing an
     administrator cannot open: impersonation borrows a member's session,
     and there is no session to borrow. So every import gets an account —
     but one with no password anybody has ever chosen.

     UNUSABLE_PASSWORD is not a hash, and verifyPassword only accepts a
     scrypt string, so no password on earth signs in to it. The
     forgot-password route refuses it for the same reason, which is the
     part that matters: without that, anybody who could receive mail at
     this address could reset their way into a listing and skip the claim
     review against the regulator's register.

     The address is the one on the source profile where there is one.
     Kirti's is not published, so the account is keyed on the slug at a
     domain that goes nowhere — it exists to be borrowed, not written to.  */
  const accountEmail =
    profile.accountEmail ?? profile.contactEmail ?? `${values.slug}@unclaimed.toplocalspecialists.com`;

  const [existingUser] = await db.select().from(t.users).where(eq(t.users.email, accountEmail)).limit(1);
  let userId = existingUser?.id ?? null;

  if (!userId) {
    userId = newId("usr");
    await db.insert(t.users).values({
      id: userId,
      email: accountEmail,
      passwordHash: UNUSABLE_PASSWORD,
      fullName: profile.fullName,
      role: "specialist",
      active: true,
      adminNotes: `Unclaimed listing imported from ${sourceName}. No password has been set; an admin can sign in as them from the members list, and claiming goes through /claims.`,
    });
  }
  await db.update(t.specialists).set({ userId }).where(eq(t.specialists.id, specialistId));

  say("");
  say(`${c.ok}  imported${c.off}  /specialists/${values.slug}`);
  dim(`  account             ${accountEmail}${existingUser ? " (already existed)" : ""}`);
  dim(`  no password is set on it: an admin can sign in as them from the members`);
  dim(`  list, nobody can sign in to it directly, and no reset link will be sent.`);
  for (const note of notes) say(`  ${c.warn}note${c.off} ${note}`);
  dim(`  unverified and unclaimed: no badge, and the claim flow can find it.`);
}

try {
  await run();
} catch (err) {
  say(`${c.bad}failed: ${err.message}${c.off}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
