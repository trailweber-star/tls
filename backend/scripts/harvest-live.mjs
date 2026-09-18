#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Harvesting the live Brilliant Directories site
 *
 *   node scripts/harvest-live.mjs --urls          # phase 1: enumerate
 *   node scripts/harvest-live.mjs --fetch         # phase 2: fetch pages
 *   node scripts/harvest-live.mjs --csv           # phase 3: write the CSV
 *   node scripts/harvest-live.mjs --all           # all three, in order
 *
 *   --limit N     stop after N profiles (phase 2) — use this first
 *   --force       re-fetch profiles already on disk
 *
 * WHY THIS EXISTS. The plan was a Members → Export out of Brilliant
 * Directories, and that is still the better source: it carries
 * unpublished rows and admin-only columns that never reach a public
 * page. This is the fallback for when that export cannot be got, and it
 * works because every profile on the live site ships a complete
 * schema.org LocalBusiness block — name, description, phone, address,
 * coordinates, image — in a <script type="application/ld+json">.
 *
 * WHAT IS WRONG WITH THE LIVE DATA, because this script exists to work
 * around it. On every record examined, the city and postcode columns
 * hold the literal string "N/A". Brilliant Directories matches location
 * searches against city and postcode, which is the entire reason search
 * on that site returns nothing for London, Birmingham, Manchester or a
 * postcode. It is not a stale index — the columns are full of "N/A".
 *
 * The real values were not lost, they were misfiled, and there are three
 * surviving copies of varying quality:
 *
 *   1. lat/lng on the record. Populated and correct on the consultant
 *      rows (52.24476430, 0.11336390 really is Cambridge). Best source
 *      there is, because it cannot be ambiguous the way a town name can.
 *
 *   2. The address line — "Cambridge, CB24 9EL", "London, W1U 5NY",
 *      "Belgravia, SW1X 7HY". Town and postcode concatenated into one
 *      field. A postcode regex gets the postcode back exactly; what is
 *      left over is the town.
 *
 *   3. The URL slug — /united-kingdom/glasgow/dentistry/<name>. Present
 *      on the clinic rows, which are the ones with no coordinates and no
 *      address line at all. Weakest of the three: it is a slug, so
 *      "coventry-warwickshire" and "lanark-lanarkshire" are towns with
 *      counties welded on, and some records have no city segment.
 *
 * This script does NOT guess and does NOT geocode. It extracts all three
 * copies, writes each into its own column, and stamps every row with
 * locationSource saying which ones were actually found. Turning that
 * into a town and a postcode is geotag.mjs's job, which already knows
 * how to ask postcodes.io and how to disambiguate the four Stanmores.
 * Two scripts, because a harvester that silently invents a city is worse
 * than no harvester.
 *
 * ON BEING A POLITE CLIENT. This is the client's own site and his own
 * records, but it is a live production server: CONCURRENCY is 3, there
 * is a delay between batches, the User-Agent says who is calling, and
 * the whole thing is resumable so a failed run never means starting
 * over. Do not raise the concurrency to make it finish sooner.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(BACKEND, "data", "harvest");
fs.mkdirSync(OUT, { recursive: true });

const URLS_PATH = path.join(OUT, "urls.json");
const PROFILES_PATH = path.join(OUT, "profiles.ndjson");
const CSV_PATH = path.join(OUT, "listings.csv");
const REJECTS_PATH = path.join(OUT, "rejected.csv");

const ORIGIN = "https://www.toplocalspecialists.com";
const CONCURRENCY = 3;
const BATCH_DELAY_MS = 400;
const UA = "TopLocalSpecialists-migration/1.0 (first-party data export; contact site owner)";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Fetching, with the retry that a 2,750-page crawl will definitely need
 * ------------------------------------------------------------------ */

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url.startsWith("http") ? url : ORIGIN + url, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return { ok: false, status: res.status, html: "" };
    return { ok: true, status: res.status, html: await res.text() };
  } catch (err) {
    if (attempt >= 4) return { ok: false, status: 0, html: "", error: String(err.message ?? err) };
    // Back off properly rather than hammering a server that just told us to stop.
    await sleep(attempt * 1500);
    return get(url, attempt + 1);
  }
}

/* ------------------------------------------------------------------ *
 * Phase 1 — every profile URL in the directory
 *
 * The listing pages are server-rendered, and each card links to both the
 * profile and its /connect page. The /connect links are the reliable
 * marker: a profile URL on its own is indistinguishable from a category
 * page, but nothing except a member card links to <something>/connect.
 * ------------------------------------------------------------------ */

function profileLinksIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"]+?)\/connect"/g)) {
    let href = m[1];
    if (href.startsWith(ORIGIN)) href = href.slice(ORIGIN.length);
    if (!href.startsWith("/")) continue;
    out.add(href);
  }
  return [...out];
}

async function enumerate() {
  const seen = new Set();
  let page = 1;
  let emptyRuns = 0;

  process.stdout.write("enumerating listing pages");
  while (page <= 500) {
    const res = await get(`/search_results?page=${page}`);
    const found = res.ok ? profileLinksIn(res.html) : [];
    const before = seen.size;
    found.forEach((u) => seen.add(u));

    // Stop on two consecutive pages that added nothing new, not one — a
    // single page can legitimately be all duplicates of a featured row.
    if (seen.size === before) {
      if (++emptyRuns >= 2) break;
    } else {
      emptyRuns = 0;
    }

    if (page % 10 === 0) process.stdout.write(`\r  page ${page} — ${seen.size} profiles   `);
    page += 1;
    await sleep(BATCH_DELAY_MS);
  }

  const urls = [...seen].sort();
  fs.writeFileSync(URLS_PATH, JSON.stringify(urls, null, 2));
  console.log(`\n  ${urls.length} profile URLs → ${path.relative(BACKEND, URLS_PATH)}`);
  return urls;
}

/* ------------------------------------------------------------------ *
 * Phase 2 — the profiles themselves
 *
 * Deliberately no HTML parser dependency. The pages are generated by a
 * template, so the handful of fields worth having sit in markup that is
 * byte-identical from one record to the next, and the substantial part
 * of the record is a JSON blob that needs no parsing at all. Adding
 * cheerio to the project to read six <span>s would be a poor trade.
 * ------------------------------------------------------------------ */

const decode = (s) =>
  String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

/** Brilliant Directories writes "N/A" where a field is empty. Treat it as empty. */
const real = (v) => {
  const s = String(v ?? "").trim();
  return s && s !== "N/A" && s !== "n/a" ? s : "";
};

const first = (html, re, group = 1) => {
  const m = html.match(re);
  return m ? decode(m[group]) : "";
};

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function parseProfile(url, html) {
  const rec = { url, harvestedAt: new Date().toISOString() };

  /* The LocalBusiness block. There are two ld+json scripts on the page —
     the member and the site-wide Organization — and the member's is the
     one whose @id ends in #entity. */
  let biz = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      const node = (parsed["@graph"] ?? [parsed]).find(
        (n) => n?.["@type"] === "LocalBusiness" || String(n?.["@id"] ?? "").endsWith("#entity")
      );
      if (node) { biz = node; break; }
    } catch { /* a malformed block is not a reason to lose the whole record */ }
  }

  rec.name = real(biz?.name) || first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/);
  rec.description = real(biz?.description);
  rec.telephone =
    real(biz?.telephone) ||
    first(html, /table-display-phone">[\s\S]*?col-sm-8">\s*([\s\S]*?)<\/div>/);
  rec.website = first(html, /class="weblink"[^>]*href="([^"]+)"/);

  /* The image: taken from the <img>, not from the JSON-LD. They disagree,
     and on the records where they disagree it is the JSON-LD path that
     404s while the <img> path serves a real file. */
  rec.image = first(html, /<img[^>]+src="(\/pictures\/profile\/[^"]+)"/);
  rec.imageJsonLd = real(biz?.image?.url);

  rec.category = first(html, /<span class="category category-profession_id">([\s\S]*?)<\/span>/);
  rec.yearsEstablished = first(html, /<span class="years years-experience">([\s\S]*?)<\/span>/);
  rec.gmcId = first(html, /GMC ID:\s*([0-9]{5,9})/);
  rec.claimed = /Unclaimed Profile/.test(html) ? "unclaimed" : "claimed";

  /* --- the three surviving copies of the location --- */

  // (1) coordinates
  const lat = parseFloat(biz?.geo?.latitude);
  const lng = parseFloat(biz?.geo?.longitude);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  rec.lat = hasGeo ? lat.toFixed(7) : "";
  rec.lng = hasGeo ? lng.toFixed(7) : "";

  // (2) the address line, town and postcode welded together
  const addrBlock = first(
    html,
    /overview-tab-the-member-address[\s\S]*?col-sm-8"?>([\s\S]*?)<\/div>/
  );
  const addrLines = addrBlock.split("\n").map((s) => s.trim()).filter(Boolean);
  rec.addressLine = real(biz?.address?.streetAddress) || addrLines[0] || "";
  rec.region = real(biz?.address?.addressRegion) || addrLines[1] || "";
  rec.country = real(biz?.address?.addressCountry) || addrLines[2] || "";

  const pc = rec.addressLine.match(UK_POSTCODE);
  rec.postcodeFromAddress = pc ? `${pc[1].toUpperCase()} ${pc[2].toUpperCase()}` : "";
  rec.townFromAddress = pc
    ? rec.addressLine.replace(pc[0], "").replace(/[,\s]+$/, "").trim()
    : rec.addressLine;

  // What Brilliant Directories itself thinks the city and postcode are —
  // captured so the damage is visible in the output rather than implied.
  rec.bdLocality = real(biz?.address?.addressLocality);
  rec.bdPostcode = real(biz?.address?.postalCode);

  // (3) the slug
  const segs = url.replace(/^\//, "").split("/");
  rec.slug = segs[segs.length - 1] ?? "";
  rec.slugPath = segs.slice(0, -1).join("/");
  rec.townFromSlug = slugTown(segs);

  rec.locationSource = [
    hasGeo ? "geo" : null,
    rec.postcodeFromAddress ? "postcode" : null,
    rec.townFromAddress && !rec.postcodeFromAddress ? "town" : null,
    rec.townFromSlug ? "slug" : null,
  ]
    .filter(Boolean)
    .join("+") || "none";

  /* Ratings. Captured so it is auditable which records carried a score
     over from Doctify — NOT to be imported. Doctify's reviews are
     Doctify's, the partnership does not reach them, and a rating that
     arrives on the new site without the reviews behind it is a number
     nobody can check. The importer must ignore this column. */
  rec.sourceRating_DO_NOT_IMPORT = biz?.aggregateRating?.ratingValue ?? "";
  rec.sourceReviewCount_DO_NOT_IMPORT = biz?.aggregateRating?.reviewCount ?? "";

  return rec;
}

/**
 * The town segment of a profile URL, where there is one.
 *
 * The shapes in the wild, all real:
 *   /united-kingdom/glasgow/dentistry/<name>     country/city/category
 *   /united-kingdom/<name>                       country only
 *   /orthopaedic-surgeon/<name>                  specialty only, no place
 *   /solihull-uk/dentistry/<name>                city with "-uk" welded on
 *   /pro/20260310052642                          no name at all
 *
 * So: a segment is a town if it is not the last one, not a country, and
 * not one of the category slugs. Anything less careful files 908
 * orthopaedic surgeons in a town called Orthopaedic Surgeon.
 */
const COUNTRY_SLUGS = new Set([
  "united-kingdom", "england", "scotland", "wales", "northern-ireland", "ireland",
  "india", "serbia", "finland", "united-arab-emirates", "hong-kong", "montenegro",
  "usa", "united-states", "spain", "turkey", "poland", "germany", "france", "italy",
  "australia", "canada", "pakistan", "nigeria", "south-africa", "malaysia",
  "singapore", "thailand", "mexico", "brazil", "greece", "portugal", "netherlands",
  "belgium", "switzerland", "austria", "sweden", "norway", "denmark", "pro",
]);

const CATEGORY_SLUGS = new Set([
  "psychologist", "physiotherapist", "orthopaedics", "neurosurgery", "gynaecology",
  "general-practioners", "ent-surgeon", "ent-specialist", "dermatologist",
  "dentistry", "aesthetic-doctors", "orthopaedic-surgeon", "orthopaedic-surgery",
  "paediatric-surgeon",
]);

function slugTown(segs) {
  const body = segs.slice(0, -1);
  for (const s of body) {
    if (COUNTRY_SLUGS.has(s) || CATEGORY_SLUGS.has(s)) continue;
    // "solihull-uk" → "Solihull". A country welded onto a town name is
    // noise; left in, it reaches the geocoder as a town called
    // "Solihull Uk" and resolves to nothing.
    const cleaned = s.replace(/-(uk|gb|england|scotland|wales|ireland)$/i, "");
    return cleaned
      .split("-")
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }
  return "";
}

async function fetchAll() {
  if (!fs.existsSync(URLS_PATH)) {
    console.error("No urls.json — run with --urls first.");
    process.exit(1);
  }
  const urls = JSON.parse(fs.readFileSync(URLS_PATH, "utf8"));

  // Resume: anything already in the NDJSON is done.
  const done = new Set();
  if (fs.existsSync(PROFILES_PATH) && !has("--force")) {
    for (const line of fs.readFileSync(PROFILES_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).url); } catch { /* skip a torn line */ }
    }
  } else if (has("--force")) {
    fs.rmSync(PROFILES_PATH, { force: true });
  }

  const limit = parseInt(val("--limit", "0"), 10);
  let todo = urls.filter((u) => !done.has(u));
  if (limit > 0) todo = todo.slice(0, limit);

  console.log(`${urls.length} known, ${done.size} already fetched, ${todo.length} to go`);
  const out = fs.createWriteStream(PROFILES_PATH, { flags: "a" });
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (u) => {
        const res = await get(u);
        if (!res.ok) return { url: u, error: `HTTP ${res.status}${res.error ? " " + res.error : ""}` };
        try {
          return parseProfile(u, res.html);
        } catch (err) {
          return { url: u, error: "parse: " + String(err.message ?? err) };
        }
      })
    );
    for (const r of results) {
      out.write(JSON.stringify(r) + "\n");
      r.error ? failed++ : ok++;
    }
    process.stdout.write(`\r  ${ok + failed}/${todo.length} — ${ok} ok, ${failed} failed   `);
    await sleep(BATCH_DELAY_MS);
  }

  out.end();
  console.log(`\n  → ${path.relative(BACKEND, PROFILES_PATH)}`);
}

/* ------------------------------------------------------------------ *
 * Phase 3 — the CSV
 *
 * Two files. listings.csv is what the importer reads; rejected.csv is
 * every row that could not be made safe, with the reason and its line
 * number, so a person can look at 40 bad rows instead of wondering
 * which 40 of 2,750 went missing.
 * ------------------------------------------------------------------ */

const COLUMNS = [
  "url", "slug", "name", "category", "claimed", "gmcId",
  "townFromAddress", "postcodeFromAddress", "townFromSlug",
  "lat", "lng", "region", "country", "locationSource",
  "telephone", "website", "image", "yearsEstablished", "description",
  "bdLocality", "bdPostcode",
  "sourceRating_DO_NOT_IMPORT", "sourceReviewCount_DO_NOT_IMPORT",
];

const csvCell = (v) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (rec) => COLUMNS.map((c) => csvCell(rec[c])).join(",");

function writeCsv() {
  if (!fs.existsSync(PROFILES_PATH)) {
    console.error("No profiles.ndjson — run with --fetch first.");
    process.exit(1);
  }

  const keep = [];
  const reject = [];
  let line = 0;

  for (const raw of fs.readFileSync(PROFILES_PATH, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    line += 1;
    let rec;
    try { rec = JSON.parse(raw); } catch { reject.push({ line, url: "", reason: "unreadable line" }); continue; }

    if (rec.error) { reject.push({ line, url: rec.url, reason: rec.error }); continue; }
    if (!rec.name) { reject.push({ line, url: rec.url, reason: "no name on the record" }); continue; }
    if (rec.locationSource === "none") {
      reject.push({ line, url: rec.url, reason: "no location of any kind — not geo, not address, not slug" });
      continue;
    }
    keep.push(rec);
  }

  fs.writeFileSync(CSV_PATH, [COLUMNS.join(","), ...keep.map(csvRow)].join("\n") + "\n");
  fs.writeFileSync(
    REJECTS_PATH,
    ["line,url,reason", ...reject.map((r) => [r.line, r.url, r.reason].map(csvCell).join(","))].join("\n") + "\n"
  );

  // The census, because "2,750 rows exported" tells nobody whether the
  // filters will work on the other side.
  const tally = {};
  for (const r of keep) tally[r.locationSource] = (tally[r.locationSource] ?? 0) + 1;

  const withPostcode = keep.filter((r) => r.postcodeFromAddress).length;
  const withGeo = keep.filter((r) => r.lat).length;
  const withCategory = keep.filter((r) => r.category).length;
  const withImage = keep.filter((r) => r.image).length;
  const nonUk = keep.filter((r) => r.country && !/^(GB|United Kingdom)$/i.test(r.country)).length;

  console.log(`\n  kept     ${keep.length}`);
  console.log(`  rejected ${reject.length}  → ${path.relative(BACKEND, REJECTS_PATH)}`);
  console.log(`\n  category present   ${withCategory}/${keep.length}`);
  console.log(`  coordinates        ${withGeo}/${keep.length}`);
  console.log(`  real postcode      ${withPostcode}/${keep.length}`);
  console.log(`  profile photo      ${withImage}/${keep.length}`);
  console.log(`  outside the UK     ${nonUk}  (review before importing)`);
  console.log(`\n  location provenance:`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
  console.log(`\n  → ${path.relative(BACKEND, CSV_PATH)}`);
}

/* ------------------------------------------------------------------ */

const run = async () => {
  if (has("--urls") || has("--all")) await enumerate();
  if (has("--fetch") || has("--all")) await fetchAll();
  if (has("--csv") || has("--all")) writeCsv();
  if (!has("--urls") && !has("--fetch") && !has("--csv") && !has("--all")) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("* ---")[1]);
  }
};

/* Only run the CLI when this file IS the command. Importing it — which is
   how the parser gets tested against saved fixtures without touching the
   network — must not start a crawl. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseProfile, slugTown, profileLinksIn };
