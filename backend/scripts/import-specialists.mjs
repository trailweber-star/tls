#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Importing specialist listings from a spreadsheet
 *
 *   npm run import -- ./file.xlsx --source Doctify --dry-run
 *   npm run import -- ./file.xlsx --source Doctify
 *
 * A directory has a chicken-and-egg problem: nobody claims a listing on
 * a site with no listings. So it is seeded from public professional
 * listings, and each one sits there unclaimed until the person it
 * describes comes and takes it over. This is the tool that does the
 * seeding.
 *
 * Three rules it will not break, because each of them is the difference
 * between a directory and a liability:
 *
 *  1. It imports no ratings. A star rating on this site means "reviews
 *     this site holds, moderated by this site". Copying another
 *     platform's 4.99 would be publishing a score for reviews we do not
 *     have, cannot show, and could not stand behind if challenged. The
 *     source figures are kept verbatim in import_source, where the
 *     admin can see them and the public cannot.
 *
 *  2. It imports nobody as verified. The badge means somebody here
 *     checked the registrant against the regulator's register. Another
 *     site's tick is not that check. Everything lands `unverified`.
 *
 *  3. It never invents. A field that is not in the file stays empty —
 *     no placeholder bios, no guessed prices, no made-up availability.
 *     An empty profile is honest; a furnished one is fiction.
 *
 * Re-running is safe: rows are keyed on their source URL, so a second
 * run updates the listings it made the first time rather than creating
 * a second copy of everybody.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { newId } from "../src/db/schema.js";
import { registerGeocoder } from "../src/lib/geocoders.js";
import { geocode, hasGeocoder } from "../src/lib/geo.js";

/* ----------------------------------------------------------- the file */

/**
 * Read an .xlsx or .csv into rows of { header: value }.
 *
 * xlsx is parsed here rather than with a library because the sheet
 * format is, underneath, a zip of XML and the part we need — a grid of
 * strings — is a very small slice of it. One less dependency in a
 * backend that runs in production.
 */
async function readRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") return readSeparated(file, ext === ".tsv" ? "\t" : ",");
  if (ext !== ".xlsx") throw new Error(`Unsupported file type: ${ext}. Use .xlsx or .csv.`);

  const zip = readZip(fs.readFileSync(file));
  const strings = [
    ...(zip("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, si]) =>
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, txt]) => unescapeXml(txt)).join("")
  );

  // The first worksheet. A file of scraped listings has exactly one.
  const sheetXml = zip("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("No sheet1 in that workbook.");

  const grid = [];
  for (const [, rowXml] of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const [, attrs, body] of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = ref ? colIndex(ref) : cells.length;
      const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, x]) => unescapeXml(x)).join("");
      const isShared = /t="s"/.test(attrs);
      cells[index] = isShared ? (strings[Number(raw)] ?? "") : inline || unescapeXml(raw ?? "");
    }
    grid.push(cells);
  }

  const [headers = [], ...body] = grid;
  return body
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [String(h ?? "").trim(), r[i] ?? ""])));
}


/**
 * Just enough of the zip format to read a .xlsx.
 *
 * An .xlsx is a zip of XML, and the two parts needed here are the
 * shared-string table and the first worksheet. Written out rather than
 * pulling in a zip library because a production backend should not
 * carry a dependency for a script that runs by hand once a week — and
 * this is thirty lines of the format's central directory.
 *
 * Returns a lookup: name → the entry's text, or null.
 */
function readZip(buffer) {
  // The end-of-central-directory record is the last thing in the file,
  // scanned for backwards because it carries an optional comment.
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("That file is not a valid .xlsx (no zip directory).");

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const headerOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);

    // The local header repeats the name and extra fields, and its own
    // lengths are the ones that say where the data actually starts.
    const localNameLength = buffer.readUInt16LE(headerOffset + 26);
    const localExtraLength = buffer.readUInt16LE(headerOffset + 28);
    const dataStart = headerOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === 0 ? data : zlib.inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }

  return (name) => (entries.has(name) ? entries.get(name).toString("utf8") : null);
}

function readSeparated(file, sep) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers = [], ...body] = rows;
  return body
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [String(h ?? "").trim(), r[i] ?? ""])));
}

const unescapeXml = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* -------------------------------------------------- column matching */

/**
 * Which spreadsheet column feeds which field.
 *
 * Matching is loose on purpose — headers are typed by hand and the next
 * export will say "Full name" or "full_name" or "Name". Everything is
 * lowercased with punctuation stripped before comparison, and each
 * field accepts several spellings.
 */
const COLUMNS = {
  fullName: ["full name", "name", "specialist", "specialist name"],
  qualifications: ["qualifications", "quals", "post nominals", "letters"],
  title: ["specialty keyword", "specialty", "speciality", "job title", "title", "role"],
  specialtyName: ["primary category extra tags", "primary category", "category", "primary specialty"],
  yearsExperience: ["years experience", "years of experience", "experience"],
  address: ["address", "practice address", "location"],
  photoUrl: ["photo url", "photo", "image url", "image", "headshot", "picture"],
  sourceUrl: ["profile url", "url", "source url", "link", "profile link"],
  // Read, recorded, and deliberately not turned into site figures.
  rating: ["rating out of 5", "rating"],
  reviewCount: ["review count", "reviews"],
  endorsements: ["skill endorsements", "endorsements"],
  distance: ["distance miles", "distance"],
  liveBooking: ["live booking available", "live booking", "bookable"],
  sourceVerified: ["verified profile", "verified"],
};

/**
 * Columns that are read and recorded but never become site figures.
 * Printed beside the mapping so the behaviour is visible before
 * anything is written rather than discovered afterwards.
 */
const NOT_IMPORTED = {
  rating: "recorded, not imported: another platform's rating is not this site's",
  reviewCount: "recorded, not imported",
  endorsements: "recorded, not imported",
  distance: "a search artefact, not a fact about the person",
  liveBooking: "recorded, not imported: no booking link to send anyone to",
  sourceVerified: "recorded, not imported: their check, not ours",
};

const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function buildMapping(headers) {
  const seen = headers.map((h) => ({ raw: h, key: normalise(h) }));
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const hit = seen.find((h) => !used.has(h.raw) && aliases.includes(h.key));
    if (hit) {
      mapping[field] = hit.raw;
      used.add(hit.raw);
    }
  }
  const unmatched = seen.filter((h) => !used.has(h.raw) && h.raw).map((h) => h.raw);
  return { mapping, unmatched };
}

/* ------------------------------------------------------- value shaping */

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s && s !== "-" && s.toLowerCase() !== "n/a" ? s : null;
};

const asInt = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/**
 * Split "The Bromsgrove Hospital, Stoney Lane, Bromsgrove, B60 1LY".
 *
 * The postcode is found by shape rather than by position, because it is
 * not always last and is the only part of a UK address with a reliable
 * pattern. Whatever segment it was in is removed, the segment before it
 * is the town, and everything before that is the street address.
 *
 * The town is a starting guess only: where a postcode lookup is
 * available the town it returns wins, because "Priory Rd, Edgbaston,
 * B5 7UG" names a district rather than a city and only the postcode
 * knows that B5 is Birmingham.
 */
function splitAddress(raw) {
  const text = clean(raw);
  if (!text) return { address: null, town: null, postcode: null };

  const match = UK_POSTCODE.exec(text);
  const postcode = match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : null;

  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (match ? p.replace(UK_POSTCODE, "").trim() : p))
    .filter(Boolean);

  const town = parts.length > 1 ? parts[parts.length - 1] : null;
  const address = (parts.length > 1 ? parts.slice(0, -1) : parts).join(", ") || null;
  return { address, town, postcode };
}

/* ------------------------------------------------------------- the run */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

/**
 * Find the file the person meant.
 *
 * npm scripts run from the package directory, so `./imports/file.xlsx`
 * typed at a backend/ prompt means backend/imports/file.xlsx — and the
 * file is very often one level up, in the project root, because that is
 * where you drop things. Rather than make somebody count directories,
 * look in the obvious places and say which ones were tried.
 */
function locate(given) {
  const candidates = [
    path.resolve(process.cwd(), given),
    path.resolve(process.cwd(), "..", given),
    path.resolve(process.cwd(), "imports", path.basename(given)),
    path.resolve(process.cwd(), "..", "imports", path.basename(given)),
  ];
  const tried = [...new Set(candidates)];
  const hit = tried.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  return { file: hit ?? null, tried };
}

const DRY = flag("dry-run");
const SOURCE = option("source", "import");
const WITH_PHOTOS = flag("photos");

if (!file) {
  console.error(`
Import specialist listings from a spreadsheet.

  npm run import -- <file.xlsx|file.csv> [options]

  --source <name>   Where the rows came from, e.g. Doctify. Recorded on
                    every listing and shown to the admin deciding a claim.
  --dry-run         Show exactly what would happen and write nothing.
  --photos          Also fetch photo URLs and store them locally.
                    OFF by default — read the note it prints first.
`);
  process.exit(1);
}
if (!isDbConfigured()) {
  console.error("DATABASE_URL is not set. Start Postgres and set it in backend/.env, then run again.");
  process.exit(1);
}

/* A file that is not where you said is a typo, not a crash. It used to
   come back as a raw ENOENT stack trace, which is a wall of Node
   internals over a one-line problem. */
const found = locate(file);
if (!found.file) {
  console.error(`\nCan't find ${file}\n\nLooked in:`);
  for (const c of found.tried) console.error(`  ${c}`);
  /* If there are importable files nearby, print the command that would
     actually work rather than leaving somebody to guess the path. */
  for (const dir of ["imports", "../imports"]) {
    const abs = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(abs)) continue;
    const names = fs.readdirSync(abs).filter((n) => /\.(xlsx|csv|tsv)$/i.test(n));
    if (!names.length) continue;
    console.error(`\nDid you mean:`);
    for (const n of names) console.error(`  npm run import -- ${dir}/${n} --source <name>`);
    break;
  }
  console.error("");
  process.exit(1);
}

registerGeocoder();
const db = getDb();

const rows = await readRows(found.file);
if (rows.length === 0) {
  console.error("That file has no data rows.");
  process.exit(1);
}

const { mapping, unmatched } = buildMapping(Object.keys(rows[0]));

console.log(`\n${rows.length} row${rows.length === 1 ? "" : "s"} in ${path.relative(process.cwd(), found.file)}\n`);
console.log("Column mapping");
for (const [field, header] of Object.entries(mapping)) {
  const note = NOT_IMPORTED[field] ? `  ← ${NOT_IMPORTED[field]}` : "";
  console.log(`  ${header.padEnd(32)} → ${field}${note}`);
}
for (const field of Object.keys(COLUMNS)) {
  if (!mapping[field]) console.log(`  ${"(no column)".padEnd(32)} → ${field}`);
}
if (unmatched.length) console.log(`\nColumns with nowhere to go: ${unmatched.join(", ")}`);

if (!hasGeocoder()) {
  console.log("\nNo geocoder configured — addresses will be placed on their town rather than pinned.");
}

/* ---------------------------------------------------- reference data */

const countryRows = await db.select().from(t.countries);
const gb = countryRows.find((c) => c.isoCode === "GB") ?? countryRows[0];
if (!gb) {
  console.error("No countries in the database. Run `npm run seed` first.");
  process.exit(1);
}

let cities = await db.select().from(t.cities);
const specialties = await db.select().from(t.specialties);

const specialtyBySlug = new Map(specialties.map((s) => [s.slug, s]));
const specialtyByName = new Map(specialties.map((s) => [normalise(s.name), s]));

/** "Orthopaedic Surgery +36" → the taxonomy node for orthopaedics. */
function matchSpecialty(...candidates) {
  for (const candidate of candidates) {
    const text = clean(candidate);
    if (!text) continue;
    const bare = text.replace(/\s*\+\s*\d+\s*$/, "").trim();
    const key = normalise(bare);
    const direct = specialtyByName.get(key) ?? specialtyBySlug.get(slugify(bare));
    if (direct) return direct;
    // "Orthopaedic Surgery" / "Orthopaedic Surgeon" → "Orthopaedics".
    const stem = key.replace(/\b(surgery|surgeon|specialist|consultant)\b/g, "").trim();
    if (stem) {
      const loose = specialties.find((s) => {
        const n = normalise(s.name);
        return n === stem || n.startsWith(stem) || stem.startsWith(n);
      });
      if (loose) return loose;
    }
  }
  return null;
}

/** A city row for this town, creating one the first time it is seen. */
async function cityFor(town, postcode, coords) {
  const name = clean(town);
  if (!name) return null;
  const slug = slugify(name);
  const existing = cities.find((c) => c.slug === slug || normalise(c.name) === normalise(name));
  if (existing) return existing;
  if (DRY) return { id: `(new) ${slug}`, name, slug, lat: coords?.lat ?? null, lng: coords?.lng ?? null, __new: true };

  const [created] = await db
    .insert(t.cities)
    .values({
      id: newId("city"),
      countryId: gb.id,
      name,
      slug,
      region: null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    })
    .returning();
  cities.push(created);
  return created;
}

/* -------------------------------------------------------------- photos */

if (WITH_PHOTOS) {
  console.log(`
  A note on photographs, because this is the part of an import that
  actually carries risk. Copyright in a headshot belongs to the
  photographer or the subject — not to the site you took it from, and
  not to you. Republishing one on a commercial directory without
  permission is the most exposed thing this script can do, and it is
  considerably more exposed than any of the text.

  The safe default is what the site already does with no photo: draw the
  person's initials, and let them upload their own when they claim the
  listing.
`);
}

async function fetchPhoto(url, slug) {
  const { saveImage } = await import("../src/lib/storage.js");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const saved = await saveImage({
    buffer,
    kind: "profile-photo",
    origin: process.env.PUBLIC_API_URL ?? "",
  });
  return saved.url;
}

/* ------------------------------------------------------------ importing */

const summary = { created: 0, updated: 0, skipped: 0, cities: 0, photos: 0, problems: [] };
const preview = [];

for (const [index, row] of rows.entries()) {
  const at = (field) => (mapping[field] ? row[mapping[field]] : null);
  const line = index + 2; // +1 for the header, +1 because humans count from one

  const fullName = clean(at("fullName"));
  if (!fullName) {
    summary.skipped += 1;
    summary.problems.push(`row ${line}: no name — skipped`);
    continue;
  }

  const sourceUrl = clean(at("sourceUrl"));
  const { address, town, postcode } = splitAddress(at("address"));

  /* The postcode is the authority on the town. "Priory Rd, Edgbaston,
     B5 7UG" says Edgbaston, which is a district of Birmingham, and only
     the lookup knows that. It also returns the coordinates, which is
     what makes "within 5km" mean the address rather than the town. */
  let coords = null;
  let resolvedTown = town;
  if (postcode && hasGeocoder()) {
    try {
      const hit = await geocode(postcode);
      if (hit) {
        coords = { lat: hit.lat, lng: hit.lng };
        const district = String(hit.name ?? "").split("·").pop()?.trim();
        if (district) resolvedTown = district;
      }
    } catch {
      /* An unreachable geocoder is not a reason to lose the listing. */
    }
  }

  const city = await cityFor(resolvedTown, postcode, coords);
  const specialty = matchSpecialty(at("specialtyName"), at("title"));

  /* Kept verbatim, shown to nobody but an admin. The rating and review
     count are in here precisely BECAUSE they are not imported: when the
     person whose name is on this listing asks where it came from, this
     is the answer, and it should be the whole answer. */
  const importSource = {
    source: SOURCE,
    url: sourceUrl,
    importedAt: new Date().toISOString(),
    file: path.basename(found.file),
    row: line,
    raw: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, clean(v)])),
    notImported: {
      rating: clean(at("rating")),
      reviewCount: clean(at("reviewCount")),
      endorsements: clean(at("endorsements")),
      distanceMiles: clean(at("distance")),
      liveBooking: clean(at("liveBooking")),
      verifiedOnSource: clean(at("sourceVerified")),
      why: "Another platform's figures. Not this site's ratings, and not this site's verification.",
    },
  };

  const values = {
    fullName,
    title: clean(at("title")),
    qualifications: clean(at("qualifications")),
    yearsExperience: asInt(at("yearsExperience")),
    primarySpecialtyId: specialty?.id ?? null,
    // Rule 2: nobody arrives verified, and nobody arrives claimed.
    verificationStatus: "unverified",
    claimed: false,
    plan: "basic",
    planStatus: "active",
    // Rule 1: no ratings. These stay at the column defaults until this
    // site holds reviews of its own.
    sourceName: SOURCE,
    sourceUrl,
    sourceImportedAt: new Date(),
    importSource,
  };

  const existing = sourceUrl
    ? (await db.select().from(t.specialists).where(eq(t.specialists.sourceUrl, sourceUrl)))[0]
    : null;

  preview.push({
    line,
    name: fullName,
    action: existing ? "update" : "create",
    specialty: specialty?.name ?? "(unmatched)",
    town: city?.name ?? "(none)",
    pinned: coords ? "yes" : "no",
    newCity: city?.__new ? "new" : "",
  });

  if (DRY) continue;

  let specialistId = existing?.id ?? null;
  if (existing) {
    await db.update(t.specialists).set(values).where(eq(t.specialists.id, existing.id));
    summary.updated += 1;
  } else {
    const base = slugify(fullName);
    let slug = base;
    for (let n = 2; ; n += 1) {
      const clash = await db.select().from(t.specialists).where(eq(t.specialists.slug, slug));
      if (clash.length === 0) break;
      slug = `${base}-${n}`;
    }
    const [created] = await db
      .insert(t.specialists)
      .values({ id: newId("sp"), slug, ...values })
      .returning();
    specialistId = created.id;
    summary.created += 1;
  }

  if (city?.__new === undefined && city && !cities.some((c) => c.id === city.id)) summary.cities += 1;

  // The specialty link table, so search facets and filters see them.
  if (specialty) {
    await db.delete(t.specialistSpecialties).where(eq(t.specialistSpecialties.specialistId, specialistId));
    await db
      .insert(t.specialistSpecialties)
      .values({ specialistId, specialtyId: specialty.id })
      .onConflictDoNothing();
  }

  /* The address. Owned by the specialist rather than attached to a
     clinic: we know where they practise, not which organisation runs
     the building, and inventing a clinic to hang it on would be
     inventing a fact. */
  if (address && city) {
    const links = await db
      .select()
      .from(t.specialistClinicLocations)
      .where(eq(t.specialistClinicLocations.specialistId, specialistId));
    if (links.length) {
      await db.delete(t.specialistClinicLocations).where(eq(t.specialistClinicLocations.specialistId, specialistId));
      const owned = await db
        .select()
        .from(t.clinicLocations)
        .where(inArray(t.clinicLocations.id, links.map((l) => l.clinicLocationId)));
      const mine = owned.filter((l) => l.ownedBySpecialistId === specialistId).map((l) => l.id);
      if (mine.length) await db.delete(t.clinicLocations).where(inArray(t.clinicLocations.id, mine));
    }
    const [location] = await db
      .insert(t.clinicLocations)
      .values({
        id: newId("loc"),
        clinicId: null,
        ownedBySpecialistId: specialistId,
        cityId: city.id,
        address,
        postcode,
        phone: null,
        lat: coords?.lat ?? city.lat,
        lng: coords?.lng ?? city.lng,
      })
      .returning();
    await db
      .insert(t.specialistClinicLocations)
      .values({ specialistId, clinicLocationId: location.id })
      .onConflictDoNothing();
  }

  if (WITH_PHOTOS) {
    const photo = clean(at("photoUrl"));
    if (photo) {
      try {
        const stored = await fetchPhoto(photo, slugify(fullName));
        await db.update(t.specialists).set({ photoUrl: stored }).where(eq(t.specialists.id, specialistId));
        summary.photos += 1;
      } catch (err) {
        summary.problems.push(`row ${line}: photo could not be fetched — ${err.message}`);
      }
    }
  }
}

/* ---------------------------------------------------------- the report */

console.log("\nWhat this does\n");
const width = Math.max(...preview.map((p) => p.name.length), 4);
for (const p of preview) {
  console.log(
    `  ${String(p.line).padStart(3)}  ${p.action.padEnd(6)}  ${p.name.padEnd(width)}  ` +
      `${p.specialty.padEnd(24)}  ${p.town}${p.newCity ? " (new city)" : ""}  ${p.pinned === "yes" ? "pinned" : "town centre"}`
  );
}

if (summary.problems.length) {
  console.log("\nProblems");
  for (const p of summary.problems) console.log(`  ${p}`);
}

console.log(
  DRY
    ? "\nDry run — nothing was written. Drop --dry-run to apply.\n"
    : `\nDone. ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped` +
        (summary.photos ? `, ${summary.photos} photos stored` : "") +
        ".\n" +
        "Every listing is unclaimed, unverified and carries no rating. They are\n" +
        "live in search and each one shows a Claim this profile button.\n"
);

await disconnectDb();
