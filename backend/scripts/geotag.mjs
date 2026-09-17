#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Geotagging — putting coordinates on the rows that have none
 *
 *   node scripts/geotag.mjs --dry-run
 *   node scripts/geotag.mjs
 *   node scripts/geotag.mjs --all        # re-do rows that already have them
 *
 * WHY THIS IS A SEPARATE SCRIPT. The importers geocode as they go, and
 * when they can reach postcodes.io that is the end of it. But a geocoder
 * is a network call in the middle of a database write, and the one thing
 * an import must never do is fail halfway because a third party was
 * having a bad afternoon. So they skip the lookup, leave lat/lng null,
 * and say so. This picks up after them.
 *
 * What null lat/lng actually costs: radius search. "Consultants within
 * 10 miles of WR9" works off the coordinates on the location row, so a
 * listing without them is invisible to every distance search — present
 * on the site, unfindable the way most people look. It is not a cosmetic
 * gap.
 *
 * TWO TABLES, TWO DIFFERENT JOBS:
 *
 *   clinic_locations — a real address with a real postcode. The postcode
 *     centroid IS the answer, to about the width of a street. No
 *     judgement needed.
 *
 *   cities — a town, and towns share names. postcodes.io knows four
 *     Stanmores (Shropshire, Hampshire, Berkshire, Greater London) and
 *     picking the first would have filed the Royal National Orthopaedic
 *     Hospital in a Shropshire village, 120 miles from the building.
 *     So a city is only matched against places in the region its OWN
 *     locations' postcodes report, and when nothing matches we use the
 *     mean of those postcodes rather than guess. A town centroid that
 *     is a few streets off is fine; one in the wrong county is not.
 *
 * THE CACHE. data/geocache.json holds every postcode this has ever
 * looked up. It is read before the network and written after, which
 * makes a re-run instant, keeps the load off a free service, and means
 * the backfill can be prepared somewhere with network access and
 * applied somewhere without it. Delete the file to force fresh lookups.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(here, "..");

/* `import "dotenv/config"` reads .env from the CURRENT directory, so
   `node backend/scripts/geotag.mjs` from the repo root finds nothing,
   decides there is no DATABASE_URL and reports demo mode — which is
   true of the shell, not of the project. Point it at backend/.env and
   the script works from wherever it is run. A DATABASE_URL already in
   the environment still wins, which is how it is pointed at a
   deployed database. */
dotenv.config({ path: path.join(BACKEND, ".env") });

const { isNull, or, sql } = await import("drizzle-orm");
const { getDb, disconnectDb, isDbConfigured } = await import("../src/db/client.js");
const t = await import("../src/db/schema.js");
const { bulkPostcodes, lookupPlaces } = await import("../src/lib/geocoders.js");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");
const OFFLINE = args.includes("--offline");

const CACHE_PATH = path.join(BACKEND, "data", "geocache.json");

const c = { ok: "\x1b[32m", warn: "\x1b[33m", bad: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };
const say = (s = "") => console.log(s);
const good = (s) => say(`${c.ok}✓${c.off} ${s}`);
const warn = (s) => say(`${c.warn}!${c.off} ${s}`);
const bad = (s) => say(`${c.bad}✗${c.off} ${s}`);
const dim = (s) => say(`${c.dim}${s}${c.off}`);

/* Postcodes are stored however somebody typed them. "B31 2AP",
   "b312ap" and "B312AP" are one postcode and must be one cache key. */
const key = (pc) => String(pc ?? "").toUpperCase().replace(/\s+/g, "");

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return {
      postcodes: new Map(Object.entries(raw.postcodes ?? {})),
      places: new Map(Object.entries(raw.places ?? {})),
    };
  } catch {
    return { postcodes: new Map(), places: new Map() };
  }
}

function writeCache(cache) {
  const sorted = (m) => {
    const o = {};
    for (const k of [...m.keys()].sort()) o[k] = m.get(k);
    return o;
  };
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(
    CACHE_PATH,
    `${JSON.stringify(
      {
        $comment:
          "Postcode centroids and place centroids from postcodes.io (Ordnance Survey / ONS " +
          "open data, Open Government Licence v3). Written by scripts/geotag.mjs; safe to " +
          "delete — it will be refetched. `places` keeps EVERY town of a given name, because " +
          "which one a listing means is decided from its postcodes, not from this file.",
        source: "https://api.postcodes.io",
        postcodes: sorted(cache.postcodes),
        places: sorted(cache.places),
      },
      null,
      2
    )}\n`
  );
}

/** Places of that name, from the cache when we have them. */
async function placesFor(name, cache) {
  const k = name.trim().toLowerCase();
  if (cache.places.has(k)) return cache.places.get(k);
  if (OFFLINE) return [];
  const hits = await lookupPlaces(name, 10);
  cache.places.set(k, hits);
  return hits;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* A region column holding a postcode. An earlier import bug wrote the
   postcode there instead of the county, and a wrong region is worse
   than an empty one: it shows in every list of towns and it is what an
   SEO location page puts in its title. Matches an outward code with or
   without the inward half, so "B60 2JL" and "B60" both count. */
const looksLikePostcode = (v) =>
  typeof v === "string" && /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i.test(v.trim());

async function main() {
  if (!isDbConfigured()) {
    bad("No DATABASE_URL, so there is no database to geotag.");
    say(
      `  Looked for it in the environment and in ${path.join(BACKEND, ".env")}.\n` +
        `  To geotag a deployed database, pass its URL for this one command:\n` +
        `    DATABASE_URL="postgres://…" node backend/scripts/geotag.mjs --dry-run`
    );
    process.exit(1);
  }
  const db = getDb();
  const cache = readCache();
  dim(
    `cache: ${cache.postcodes.size} postcode(s), ` +
      `${cache.places.size} place name(s) on file`
  );

  /* ---------------------------------------------------------------- *
   * 1. Every location that needs coordinates
   * ---------------------------------------------------------------- */
  const cities = await db
    .select({
      id: t.cities.id,
      slug: t.cities.slug,
      name: t.cities.name,
      region: t.cities.region,
      lat: t.cities.lat,
      lng: t.cities.lng,
    })
    .from(t.cities);

  const locations = await db
    .select({
      id: t.clinicLocations.id,
      postcode: t.clinicLocations.postcode,
      address: t.clinicLocations.address,
      cityId: t.clinicLocations.cityId,
      lat: t.clinicLocations.lat,
      lng: t.clinicLocations.lng,
    })
    .from(t.clinicLocations);

  /* A location sitting EXACTLY on its city's centroid did not get there
     by being geocoded — that is the importers' fallback when the
     geocoder was unreachable, and it is a real error, not a rounding
     one. The Royal Orthopaedic Hospital is in Northfield; inheriting
     Birmingham's centre put its pin four miles north, in the Jewellery
     Quarter. So these count as needing coordinates too, and a postcode
     centroid replaces the inherited one. */
  const cityPoint = new Map(cities.map((x) => [x.id, x]));
  const inherited = (l) => {
    const cp = cityPoint.get(l.cityId);
    return cp?.lat != null && l.lat === cp.lat && l.lng === cp.lng;
  };

  const needLoc = locations.filter(
    (l) => l.postcode && (ALL || l.lat == null || l.lng == null || inherited(l))
  );
  const noPostcode = locations.filter((l) => !l.postcode && (l.lat == null || l.lng == null));

  /* ---------------------------------------------------------------- *
   * 2. The cities that need them, and the facilities table too —
   *    it carries its own addresses.
   * ---------------------------------------------------------------- */
  const needCity = cities.filter((x) => ALL || x.lat == null || x.lng == null);

  let facilities = [];
  try {
    facilities = await db
      .select({
        id: t.facilities.id,
        postcode: t.facilities.postcode,
        name: t.facilities.name,
        lat: t.facilities.lat,
        lng: t.facilities.lng,
      })
      .from(t.facilities);
  } catch {
    /* Older schema without the columns — nothing to do. */
  }
  const needFac = facilities.filter(
    (f) => f.postcode && (ALL || f.lat == null || f.lng == null)
  );

  say();
  say(`locations needing coordinates: ${needLoc.length} of ${locations.length}`);
  say(`facilities needing coordinates: ${needFac.length} of ${facilities.length}`);
  say(`cities needing coordinates:    ${needCity.length} of ${cities.length}`);
  if (noPostcode.length) {
    warn(
      `${noPostcode.length} location${noPostcode.length === 1 ? " has" : "s have"} no postcode — ` +
        `nothing to geocode from. They will keep falling back to their city.`
    );
    for (const l of noPostcode.slice(0, 5)) dim(`    ${l.id}  ${l.address}`);
  }

  /* ---------------------------------------------------------------- *
   * 3. One network round trip for everything not already cached
   * ---------------------------------------------------------------- */
  const wanted = [...new Set([...needLoc, ...needFac].map((r) => key(r.postcode)))];
  const missing = wanted.filter((k) => !cache.postcodes.has(k));

  if (missing.length && OFFLINE) {
    warn(`${missing.length} postcode(s) are not in the cache and --offline was passed — skipping them.`);
  } else if (missing.length) {
    say();
    dim(`looking up ${missing.length} postcode(s) at postcodes.io…`);
    /* Spaced form: postcodes.io echoes the query back as the key, so we
       ask in the form we want to match on. */
    const spaced = missing.map((k) => `${k.slice(0, -3)} ${k.slice(-3)}`);
    let found;
    try {
      found = await bulkPostcodes(spaced);
    } catch (err) {
      bad(`postcodes.io could not be reached: ${err.message}`);
      warn(
        "Nothing has been written. Run this again from somewhere that can reach " +
          "api.postcodes.io, or run it there with --dry-run and copy data/geocache.json across."
      );
      await disconnectDb();
      process.exit(1);
    }
    let hits = 0;
    for (const [q, row] of found) {
      cache.postcodes.set(key(q), row);
      if (row) hits += 1;
    }
    good(`${hits} of ${missing.length} resolved`);
    const dud = missing.filter((k) => !cache.postcodes.get(k));
    for (const k of dud) warn(`postcodes.io does not know ${k} — is it a typo?`);
    if (!DRY) writeCache(cache);
  }

  /* ---------------------------------------------------------------- *
   * 4. Write the location and facility coordinates
   * ---------------------------------------------------------------- */
  say();
  /* A postcode the service has never heard of is a typo in our data, and
     it stays a typo across runs — the cache remembers the miss, so say
     so every time rather than only on the run that discovered it. */
  const unresolvable = [...new Set(needLoc.concat(needFac).map((r) => key(r.postcode)))].filter(
    (k) => cache.postcodes.has(k) && !cache.postcodes.get(k)
  );
  for (const k of unresolvable) {
    const rows = needLoc.filter((l) => key(l.postcode) === k);
    warn(`postcodes.io does not recognise ${k} — looks like a typo. Left alone:`);
    for (const r of rows) dim(`    ${r.address}`);
  }

  let wroteLoc = 0;
  for (const l of needLoc) {
    const hit = cache.postcodes.get(key(l.postcode));
    if (!hit) continue;
    dim(`  ${l.postcode.padEnd(9)} → ${hit.lat}, ${hit.lng}   ${hit.district ?? ""}`);
    if (!DRY) {
      await db
        .update(t.clinicLocations)
        .set({ lat: hit.lat, lng: hit.lng })
        .where(sql`${t.clinicLocations.id} = ${l.id}`);
    }
    wroteLoc += 1;
  }
  good(`${wroteLoc} location${wroteLoc === 1 ? "" : "s"} geotagged`);

  let wroteFac = 0;
  for (const f of needFac) {
    const hit = cache.postcodes.get(key(f.postcode));
    if (!hit) continue;
    if (!DRY) {
      await db
        .update(t.facilities)
        .set({ lat: hit.lat, lng: hit.lng })
        .where(sql`${t.facilities.id} = ${f.id}`);
    }
    wroteFac += 1;
  }
  if (facilities.length) good(`${wroteFac} facilit${wroteFac === 1 ? "y" : "ies"} geotagged`);

  /* ---------------------------------------------------------------- *
   * 5. City centroids — the part that needs care
   * ---------------------------------------------------------------- */
  say();
  /* What each city's own postcodes say about where it is. This is the
     evidence a place-name match has to agree with. */
  const evidence = new Map(); // cityId -> { points:[{lat,lng}], regions:Set, districts:Set, counties:Set }
  for (const l of locations) {
    const hit = l.postcode ? cache.postcodes.get(key(l.postcode)) : null;
    const known = hit ?? (l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);
    if (!known) continue;
    let e = evidence.get(l.cityId);
    if (!e) evidence.set(l.cityId, (e = { points: [], regions: new Set(), districts: new Set(), counties: new Set() }));
    e.points.push({ lat: known.lat, lng: known.lng });
    if (hit?.region) e.regions.add(hit.region);
    if (hit?.district) e.districts.add(hit.district);
    if (hit?.county) e.counties.add(hit.county);
  }

  let wroteCity = 0;
  const stuck = [];
  for (const city of needCity) {
    const e = evidence.get(city.id);
    if (!e?.points.length) {
      stuck.push(city);
      continue;
    }

    const fallback = { lat: mean(e.points.map((p) => p.lat)), lng: mean(e.points.map((p) => p.lng)) };

    let chosen = null;
    let how = "the mean of its own locations";
    {
      let places = [];
      try {
        places = await placesFor(city.name, cache);
      } catch {
        /* Place index unreachable — the mean is a perfectly good answer. */
      }
      /* Agreement with the postcodes decides it, in that order of
         strength: same county, then same region. A hit that agrees with
         neither is a different town of the same name, and is ignored. */
      const agrees = (p, field, set) => set.size > 0 && p[field] && set.has(p[field]);
      const ranked = places
        .map((p) => ({
          p,
          score:
            (agrees(p, "county", e.counties) ? 4 : 0) +
            (agrees(p, "region", e.regions) ? 2 : 0) +
            /* "Stanmore" and "Little Stanmore" are both real places in
               Greater London and both agree with HA7's region. The one
               actually called Stanmore is the one we mean. */
            (p.name?.trim().toLowerCase() === city.name.trim().toLowerCase() ? 2 : 0) +
            (["City", "Town", "Suburban Area", "Other Settlement"].includes(p.type) ? 1 : 0),
        }))
        .filter((x) => x.score >= 2)
        .sort((a, b) => b.score - a.score);
      if (ranked.length) {
        chosen = { lat: ranked[0].p.lat, lng: ranked[0].p.lng };
        how = `postcodes.io place index (${ranked[0].p.type}, ${ranked[0].p.county ?? ranked[0].p.region})`;
        if (places.length > 1) {
          dim(`    ${city.name}: ${places.length} places of that name, took the one in ${ranked[0].p.county ?? ranked[0].p.region}`);
        }
      }
    }

    const point = chosen ?? fallback;
    /* Fill in the region while we are here: a city row with no region
       reads as "Stanmore" in a list of towns that all say their county. */
    const stated = looksLikePostcode(city.region) ? null : city.region;
    const region = stated ?? [...e.counties][0] ?? [...e.regions][0] ?? null;

    dim(`  ${city.name.padEnd(16)} → ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}   ${c.dim}${how}${c.off}`);
    if (!DRY) {
      await db
        .update(t.cities)
        .set({ lat: point.lat, lng: point.lng, region })
        .where(sql`${t.cities.id} = ${city.id}`);
    }
    wroteCity += 1;
  }
  if (!DRY) writeCache(cache);
  good(`${wroteCity} cit${wroteCity === 1 ? "y" : "ies"} geotagged`);

  /* Regions, separately. A city can have perfect coordinates and still
     say its region is "B60 2JL", so this pass looks at every row rather
     than only the ones the geotagging touched. */
  let wroteRegion = 0;
  for (const city of cities) {
    if (!looksLikePostcode(city.region)) continue;
    const e = evidence.get(city.id);
    const better = [...(e?.counties ?? [])][0] ?? [...(e?.regions ?? [])][0] ?? null;
    if (!better) {
      warn(`${city.slug}: region is "${city.region}", which is a postcode, and nothing says what it should be`);
      continue;
    }
    dim(`  ${city.name.padEnd(16)} region "${city.region}" → "${better}"`);
    if (!DRY) {
      await db.update(t.cities).set({ region: better }).where(sql`${t.cities.id} = ${city.id}`);
    }
    wroteRegion += 1;
  }
  if (wroteRegion) good(`${wroteRegion} region(s) corrected`);
  if (stuck.length) {
    warn(
      `${stuck.length} cit${stuck.length === 1 ? "y has" : "ies have"} no located address to work from — ` +
        `left alone rather than guessed at:`
    );
    for (const x of stuck) dim(`    ${x.slug}`);
  }

  /* ---------------------------------------------------------------- *
   * 6. What is left
   * ---------------------------------------------------------------- */
  say();
  const [{ locLeft }] = await db
    .select({ locLeft: sql`count(*)::int` })
    .from(t.clinicLocations)
    .where(or(isNull(t.clinicLocations.lat), isNull(t.clinicLocations.lng)));
  const [{ cityLeft }] = await db
    .select({ cityLeft: sql`count(*)::int` })
    .from(t.cities)
    .where(or(isNull(t.cities.lat), isNull(t.cities.lng)));

  if (DRY) {
    warn("--dry-run: nothing was written, and the cache was not updated either.");
  } else {
    say(`${locLeft} location(s) and ${cityLeft} cit(ies) still without coordinates.`);
    if (locLeft === 0 && cityLeft === 0) good("Every row on the map. Radius search now reaches all of them.");
  }

  await disconnectDb();
}

main().catch(async (err) => {
  bad(err.stack ?? String(err));
  await disconnectDb().catch(() => {});
  process.exit(1);
});
