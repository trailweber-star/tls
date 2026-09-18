#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * How accurate is every pin on the map?
 *
 *   node scripts/audit-pins.mjs              # read-only report
 *   node scripts/audit-pins.mjs --offline    # cache only, no network
 *   node scripts/audit-pins.mjs --csv        # also write the outliers
 *
 * WHY THIS EXISTS. geotag.mjs finishes by saying "every row on the map",
 * which is true and not the whole story. A pin can be on the map and
 * still be wrong by four miles, and the person who notices will be the
 * clinician whose listing it is. This measures the thing geotag does not
 * claim: how close each pin is to the address it belongs to.
 *
 * WHAT "ACCURATE" MEANS HERE. The yardstick is the postcode centroid
 * from postcodes.io — Ordnance Survey and ONS open data. A UK postcode
 * unit covers around fifteen addresses, usually one side of one street,
 * so a pin within ~100m of that centroid is street-accurate. That is the
 * best this build can do without a paid rooftop geocoder, and it is
 * enough for radius search and for a map that looks right. It is NOT the
 * front door, and this script does not pretend otherwise.
 *
 * FOUR THINGS IT SEPARATES:
 *
 *   street level   within 150m of its own postcode's centroid
 *   nearby         150m–1km — same area, probably a large site or a
 *                  postcode that covers a campus
 *   wrong area     1km–5km — the old site's town-centre fallback, most
 *                  likely, and worth fixing
 *   badly wrong    over 5km — the pin is in a different place entirely
 *
 *   unmeasurable   no postcode on the location, so there is nothing to
 *                  measure it against. These are not necessarily wrong;
 *                  they are unverifiable, which is a different problem
 *                  and needs the postcode chasing rather than the pin.
 *
 * READ-ONLY. It writes nothing to the database. --csv writes one file of
 * outliers so somebody can work through them.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const WRITE_CSV = args.includes("--csv");

const CACHE_PATH = path.join(BACKEND, "data", "geocache.json");
const OUT_PATH = path.join(BACKEND, "data", "pin-audit.csv");

const c = { ok: "\x1b[32m", warn: "\x1b[33m", bad: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };
const say = (s = "") => console.log(s);

/* Same normalisation as geotag.mjs: "B31 2AP", "b312ap" and "B312AP"
   are one postcode and must be one cache key. */
const key = (pc) => String(pc ?? "").toUpperCase().replace(/\s+/g, "");

/** Great-circle distance in metres. */
function metres(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return new Map(Object.entries(raw.postcodes ?? {}));
  } catch {
    return new Map();
  }
}

const BUCKETS = [
  ["street level", 0, 150],
  ["nearby", 150, 1000],
  ["wrong area", 1000, 5000],
  ["badly wrong", 5000, Infinity],
];
const bucketFor = (m) => BUCKETS.find(([, lo, hi]) => m >= lo && m < hi)?.[0] ?? "badly wrong";

async function main() {
  const { getDb, disconnectDb, isDbConfigured } = await import("../src/db/client.js");
  if (!isDbConfigured()) {
    console.error("DATABASE_URL is not set. Point it at the database you want to audit.");
    process.exit(1);
  }
  const t = await import("../src/db/schema.js");
  const { bulkPostcodes } = await import("../src/lib/geocoders.js");
  const db = getDb();

  const [locations, cities, specialists] = await Promise.all([
    db
      .select({
        id: t.clinicLocations.id,
        address: t.clinicLocations.address,
        postcode: t.clinicLocations.postcode,
        cityId: t.clinicLocations.cityId,
        lat: t.clinicLocations.lat,
        lng: t.clinicLocations.lng,
        ownedBySpecialistId: t.clinicLocations.ownedBySpecialistId,
      })
      .from(t.clinicLocations),
    db.select({ id: t.cities.id, name: t.cities.name, lat: t.cities.lat, lng: t.cities.lng }).from(t.cities),
    db.select({ id: t.specialists.id, slug: t.specialists.slug, fullName: t.specialists.fullName }).from(t.specialists),
  ]);

  const cityById = new Map(cities.map((x) => [x.id, x]));
  const specById = new Map(specialists.map((x) => [x.id, x]));

  /* Every postcode we need a centroid for, looked up once. */
  const cache = readCache();
  const wanted = [...new Set(locations.map((l) => key(l.postcode)).filter(Boolean))];
  const missing = wanted.filter((k) => !cache.has(k));

  say(`${locations.length} clinic location(s), ${wanted.length} distinct postcode(s)`);
  say(`  centroids already cached  ${wanted.length - missing.length}`);
  say(`  to look up                ${missing.length}${OFFLINE ? "  (skipped: --offline)" : ""}`);

  if (missing.length && !OFFLINE) {
    try {
      const fetched = await bulkPostcodes(missing);
      for (const [k, v] of fetched) if (v) cache.set(key(k), v);
    } catch (err) {
      say(`\n${c.warn}!${c.off} postcodes.io unreachable (${err.message}) — reporting from the cache only.`);
      say(`${c.dim}  Run with --offline to skip the attempt, or run this where the API is reachable.${c.off}`);
    }
  }

  /* -------------------------------------------------------- measuring */

  const tally = { "street level": 0, nearby: 0, "wrong area": 0, "badly wrong": 0 };
  let noPostcode = 0;
  let noCentroid = 0;
  let noPin = 0;
  let onCityCentroid = 0;
  const outliers = [];

  for (const l of locations) {
    if (l.lat == null || l.lng == null) { noPin += 1; continue; }

    const city = cityById.get(l.cityId);
    if (city?.lat != null && l.lat === city.lat && l.lng === city.lng) onCityCentroid += 1;

    const k = key(l.postcode);
    if (!k) { noPostcode += 1; continue; }
    const centroid = cache.get(k);
    if (!centroid) { noCentroid += 1; continue; }

    const d = metres({ lat: Number(l.lat), lng: Number(l.lng) }, centroid);
    const bucket = bucketFor(d);
    tally[bucket] += 1;
    if (d >= 1000) {
      const owner = l.ownedBySpecialistId ? specById.get(l.ownedBySpecialistId) : null;
      outliers.push({
        metres: d,
        bucket,
        slug: owner?.slug ?? "",
        name: owner?.fullName ?? "",
        address: l.address ?? "",
        postcode: l.postcode ?? "",
        town: city?.name ?? "",
        storedLat: l.lat,
        storedLng: l.lng,
        postcodeLat: centroid.lat,
        postcodeLng: centroid.lng,
      });
    }
  }

  const measured = Object.values(tally).reduce((a, b) => a + b, 0);
  const pct = (n) => (measured ? `${Math.round((n / measured) * 100)}%` : "—");

  say(`\nhow close each pin is to its own postcode  (${measured} measurable)`);
  for (const [label] of BUCKETS) {
    const n = tally[label];
    const bar = "█".repeat(Math.round((n / Math.max(measured, 1)) * 30)).padEnd(30, "·");
    const mark = label === "street level" ? c.ok : label === "nearby" ? c.dim : c.warn;
    say(`  ${mark}${label.padEnd(13)}${c.off} ${bar} ${String(n).padStart(5)}  ${pct(n)}`);
  }

  say(`\nnot measurable`);
  say(`  no postcode on the location  ${noPostcode}   ${c.dim}unverifiable, not necessarily wrong${c.off}`);
  if (noCentroid) say(`  postcode not on the register ${noCentroid}   ${c.dim}a typo, or not cached and no network${c.off}`);
  if (noPin) say(`  ${c.bad}no coordinates at all       ${noPin}${c.off}   ${c.dim}invisible to radius search — run geotag.mjs${c.off}`);

  if (onCityCentroid) {
    say(`\n${c.warn}!${c.off} ${onCityCentroid} location(s) sit exactly on their town's centroid.`);
    say(`${c.dim}  That is the importer's fallback rather than a geocoded pin. geotag.mjs`);
    say(`  refines these from the postcode; if the count is not zero after a geotag`);
    say(`  run, those listings have no postcode to refine from.${c.off}`);
  }

  if (outliers.length) {
    outliers.sort((a, b) => b.metres - a.metres);
    say(`\nthe ten furthest from their own postcode`);
    for (const o of outliers.slice(0, 10)) {
      const km = (o.metres / 1000).toFixed(1);
      say(`  ${String(km + "km").padStart(7)}  ${(o.name || o.address).slice(0, 34).padEnd(36)}${o.postcode.padEnd(10)}${o.town}`);
    }
    if (WRITE_CSV) {
      const header = Object.keys(outliers[0]);
      const cell = (v) => {
        const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
        return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      fs.writeFileSync(
        OUT_PATH,
        [header.join(","), ...outliers.map((o) => header.map((h) => cell(o[h])).join(","))].join("\n") + "\n"
      );
      say(`\n  → ${path.relative(BACKEND, OUT_PATH)}  (${outliers.length} rows over 1km)`);
    } else {
      say(`\n${c.dim}  ${outliers.length} are over 1km out. Pass --csv to write them to a file.${c.off}`);
    }
  }

  const verdict =
    measured && tally["street level"] / measured >= 0.9
      ? `${c.ok}✓${c.off} ${pct(tally["street level"])} of measurable pins are street-accurate.`
      : `${c.warn}!${c.off} only ${pct(tally["street level"])} of measurable pins are street-accurate.`;
  say(`\n${verdict}`);
  say(`${c.dim}Street level means within 150m of the postcode centroid — about one side of`);
  say(`one street. Not the front door: that needs a paid rooftop geocoder.${c.off}\n`);

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
