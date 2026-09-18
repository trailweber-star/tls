#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Harvesting the live Brilliant Directories site
 *
 *   node scripts/harvest-live.mjs --urls          # phase 1: enumerate
 *   node scripts/harvest-live.mjs --fetch         # phase 2: fetch pages
 *   node scripts/harvest-live.mjs --towns        # phase 3: repair the towns
 *   node scripts/harvest-live.mjs --photos       # phase 4: fetch the photos
 *   node scripts/harvest-live.mjs --csv           # phase 5: write the CSV
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
const TOWNS_PATH = path.join(OUT, "towns.json");
const PHOTOS_DIR = path.join(OUT, "photos");
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

/** "Showing 1 - 12 of 2,750 Results" — the directory's own total. */
function totalResultsIn(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const m = text.match(/of\s+([\d,]+)\s+Results/i);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

async function enumerate() {
  const seen = new Set();

  /* Page one does two jobs: it yields its own profiles, and it tells us
     how many there are in total. Knowing the page count up front turns
     this from an indeterminate wait — which looks identical to a hang,
     and gets killed — into a progress bar. */
  console.log("enumerating listing pages…");
  const firstPage = await get("/search_results?page=1");
  if (!firstPage.ok) {
    console.error(`  could not load page 1 (HTTP ${firstPage.status}). Nothing to enumerate.`);
    process.exit(1);
  }
  profileLinksIn(firstPage.html).forEach((u) => seen.add(u));

  const total = totalResultsIn(firstPage.html);
  const perPage = Math.max(seen.size, 1);
  const lastPage = total ? Math.ceil(total / perPage) : 500;
  console.log(
    total
      ? `  ${total.toLocaleString()} listings, ${perPage} per page — ${lastPage} pages to walk`
      : `  could not read a total; walking until the pages run dry`
  );

  /* Save whatever has been found so far, so a Ctrl-C at page 180 is not
     180 pages thrown away. */
  const save = () => {
    const urls = [...seen].sort();
    fs.writeFileSync(URLS_PATH, JSON.stringify(urls, null, 2));
    return urls;
  };
  let stopped = false;
  const onSigint = () => {
    stopped = true;
    console.log("\n  stopping — saving what has been found so far");
  };
  process.on("SIGINT", onSigint);

  let emptyRuns = 0;
  const line = (page) =>
    process.stdout.write(`\r  page ${page}/${lastPage} — ${seen.size} profiles      `);
  line(1);

  for (let page = 2; page <= lastPage && !stopped; page += CONCURRENCY) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY && page + i <= lastPage; i += 1) batch.push(page + i);

    const results = await Promise.all(batch.map((n) => get(`/search_results?page=${n}`)));
    const before = seen.size;
    for (const res of results) {
      if (res.ok) profileLinksIn(res.html).forEach((u) => seen.add(u));
    }

    // Stop once a whole batch adds nothing — past the end of the results.
    if (seen.size === before) {
      if (++emptyRuns >= 2) break;
    } else {
      emptyRuns = 0;
    }

    line(batch[batch.length - 1]);
    await sleep(BATCH_DELAY_MS);
  }

  process.off("SIGINT", onSigint);
  const urls = save();
  console.log(`\n  ${urls.length} profile URLs → ${path.relative(BACKEND, URLS_PATH)}`);
  if (total && urls.length < total * 0.9) {
    console.log(
      `  note: the directory claims ${total.toLocaleString()}. ${total - urls.length} were not reached —\n` +
      `  re-run --urls to try again, or carry on and accept the shortfall.`
    );
  }
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

/* Tails that are a country or a home nation, not a town. They arrive
   stuck on the end of the address line and have to come off before the
   remainder can be read as a place: "Birmingham, UK, England" is one
   town and two tails. */
const ADDRESS_TAIL = /^(uk|u\.k\.|gb|united kingdom|england|scotland|wales|northern ireland|great britain)$/i;

/* UK counties and the big metropolitan areas. An address line runs
   specific-to-general, so a county is the part just before the country
   and would otherwise be mistaken for the town — "Bushey,Hertfordshire"
   read as Hertfordshire, which is a county the size of a small nation.
   Pulled out into its own field rather than discarded, because
   geotag.mjs scores candidate places on county agreement and this is
   exactly the evidence it wants: it is what separates the Stanmore in
   Greater London from the Stanmore in Shropshire. */
const COUNTIES = new Set(
  [
    "Bedfordshire","Berkshire","Bristol","Buckinghamshire","Cambridgeshire","Cheshire",
    "Cornwall","Cumbria","Derbyshire","Devon","Dorset","Durham","County Durham",
    "East Riding of Yorkshire","East Sussex","Essex","Gloucestershire","Greater London",
    "Greater Manchester","Hampshire","Herefordshire","Hertfordshire","Isle of Wight",
    "Kent","Lancashire","Leicestershire","Lincolnshire","Merseyside","Norfolk",
    "North Yorkshire","Northamptonshire","Northumberland","Nottinghamshire",
    "Oxfordshire","Rutland","Shropshire","Somerset","South Yorkshire",
    "Staffordshire","Suffolk","Surrey","Tyne and Wear","Warwickshire","West Midlands",
    "West Sussex","West Yorkshire","Wiltshire","Worcestershire",
    "Aberdeenshire","Angus","Argyll and Bute","Ayrshire","Clackmannanshire",
    "Dumfries and Galloway","Dunbartonshire","Fife","Highland","Lanarkshire",
    "Lothian","Midlothian","Moray","Perth and Kinross","Renfrewshire",
    "Scottish Borders","Stirlingshire","West Lothian",
    "Anglesey","Carmarthenshire","Ceredigion","Conwy","Denbighshire","Flintshire",
    "Gwynedd","Monmouthshire","Pembrokeshire","Powys","Swansea","Wrexham",
    "Antrim","Armagh","Down","Fermanagh","Londonderry","Tyrone",
  ].map((c) => c.toLowerCase())
);

/* Things that appear in a street line but never in a town name, used to
   tell "Birmingham" from "23A Highfield Rd". */
const STREET_WORDS =
  /\b(road|rd|street|st|avenue|ave|lane|ln|close|drive|dr|way|court|ct|place|pl|square|sq|terrace|crescent|grove|park(?!\s*$)|hill|gardens?|walk|row|suite|unit|floor|house|clinic|hospital|centre|center|surgery|practice|building|wing)\b/i;

/**
 * The town, out of whatever the address line turned out to be.
 *
 * Four real shapes, all from the live site:
 *
 *   "Cambridge, CB24 9EL"                → Cambridge
 *   "Birmingham, UK, England"            → Birmingham
 *   "Bushey,Hertfordshire"               → Bushey
 *   "Highfield Clinic, 23A Highfield Rd, Birmingham , United Kingdom"
 *                                        → Birmingham
 *
 * The rule: drop the postcode, split on commas, throw away country and
 * home-nation tails, then take the LAST remaining part that does not
 * read like a street — because an address runs specific-to-general, so
 * the town is the last thing before the country. Taking the first part
 * instead yields "Highfield Clinic", which geocodes to nothing.
 */
function townFromAddressLine(line, postcode) {
  let s = String(line ?? "");
  if (postcode) s = s.replace(postcode, " ");

  let parts = s
    .split(",")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !ADDRESS_TAIL.test(p));

  // Lift out any county before looking for the town, so "Bushey,
  // Hertfordshire" resolves to Bushey-in-Hertfordshire and not to a
  // county of 1.2 million people.
  const county = parts.find((p) => COUNTIES.has(p.toLowerCase())) ?? "";
  if (county) parts = parts.filter((p) => p !== county);

  if (!parts.length) return { town: "", county };

  const town = [...parts].reverse().find((p) => !STREET_WORDS.test(p) && !/\d/.test(p));
  // Everything looks like a street line — better to hand back the last
  // part and let the geocoder refuse it than to invent a town.
  return { town: town ?? parts[parts.length - 1], county };
}

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

  /* --- the photo ---
   *
   * Four families of path turn up here, and only two of them are a
   * picture of anybody:
   *
   *   /pictures/profile/pimage-<id>-<n>-photo.webp   a real headshot
   *   /logos/profile/profile_<timestamp>.jpg         a real logo/photo
   *   /logos/profile/limage-<id>-<n>-photo.webp      ditto
   *   /images/profile-profile-holder.png             the empty-state icon
   *   /images/Generated-Image-September-17-2025…webp the site's own logo,
   *                                                  stood in for a member
   *                                                  who uploaded no photo
   *
   * The last two are the same thing — an empty state — and neither is a
   * picture of the member. The second one is not a fabricated portrait:
   * it is the Top Local Specialists mark, put in place on 17 September
   * 2025 across every profile that had no picture of its own. Those
   * records are perfectly good; they simply have no photo yet.
   *
   * It still must not come across as a photo. In the avatar slot on the
   * new site it would be indistinguishable from a picture the member
   * chose, so the claim flow could not ask for a real one and nobody
   * could count how many profiles are still waiting. Recorded as "none"
   * with the reason kept in imageRejected, and the new site's initials
   * tile fills the space until the member uploads something. */
  const imageCandidates = [
    real(biz?.image?.url),
    first(html, /<img[^>]+src="(\/(?:pictures|logos)\/profile\/[^"]+)"/),
    first(html, /<img[^>]+src="(\/images\/[^"]+)"/),
  ].filter(Boolean);

  const REAL_PHOTO = /^\/(?:pictures|logos)\/profile\//;
  const NOT_A_PHOTO = /profile-profile-holder|Generated-Image|placeholder|no-image|default/i;

  rec.image = imageCandidates.find((u) => REAL_PHOTO.test(u) && !NOT_A_PHOTO.test(u)) ?? "";
  rec.imageRejected = rec.image
    ? ""
    : imageCandidates.find((u) => NOT_A_PHOTO.test(u))
      ? /Generated-Image/i.test(imageCandidates.join(" "))
        ? "no photo uploaded — the old site stood its own logo in"
        : "no photo uploaded — placeholder avatar"
      : imageCandidates.length
        ? `unrecognised image path: ${imageCandidates[0]}`
        : "";
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
  const parsedTown = townFromAddressLine(rec.addressLine, pc?.[0]);
  rec.townFromAddress = parsedTown.town;
  rec.countyFromAddress = parsedTown.county;

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

/* A closed list of category slugs was the wrong shape for this. The live
   site has "orthopaedic-surgeon", "paediatric-surgeon",
   "anaesthetist-orthopaedic-surgeon" and no doubt more nobody has seen
   yet, and every one this list misses becomes a town: the first pass
   filed two consultants in a place called "Anaesthetist Orthopaedic
   Surgeon". So the test is what the words MEAN, not whether the exact
   string was predicted. */
const PROFESSION_WORDS =
  /(surgeon|surgery|surgical|specialist|consultant|doctor|physician|practitioner|dentist|dentistry|therapist|therapy|olog(y|ist)|iatric|iatry|medicine|medical|clinic|nurse|nursing|midwife|midwifery|aesthetic|cosmetic|orthodont|physio|osteopath|chiropract|podiatr|optometr|optician|counsell?or|counselling|psychiatr|anaesthe|radiograph|sonograph|dietit|nutrition)/i;

const CATEGORY_SLUGS = new Set([
  "psychologist", "physiotherapist", "orthopaedics", "neurosurgery", "gynaecology",
  "general-practioners", "ent-surgeon", "ent-specialist", "dermatologist",
  "dentistry", "aesthetic-doctors", "paediatrics",
]);

function slugTown(segs) {
  const body = segs.slice(0, -1);
  for (const s of body) {
    if (COUNTRY_SLUGS.has(s) || CATEGORY_SLUGS.has(s)) continue;
    // A profession, however it is spelled. This is what stops
    // "anaesthetist-orthopaedic-surgeon" becoming a town.
    if (PROFESSION_WORDS.test(s.replace(/-/g, " "))) continue;
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

/* ------------------------------------------------------------------ *
 * The two gates: is it in the UK, and is it a healthcare listing
 *
 * The live directory is not clean. Alongside 2,750 UK consultants and
 * clinics it carries hospitals in Patna, a skin clinic in Dubai, a
 * practice in Serbia — and a Finnish cryptocurrency site and a company
 * that sells puzzles. None of that belongs in a UK specialist
 * directory, so none of it crosses over.
 *
 * Nothing is deleted quietly. A row that fails either gate is written to
 * rejected.csv with the reason, and a row that cannot be judged either
 * way goes to review.csv. Three files, because "2,310 of 2,750 imported"
 * is only a useful sentence if the other 440 are somewhere you can look
 * at them.
 * ------------------------------------------------------------------ */

const UK_COUNTRY = /^(GB|GBR|UK|United Kingdom|England|Scotland|Wales|Northern Ireland)$/i;
const UK_SLUGS = new Set([
  "united-kingdom", "england", "scotland", "wales", "northern-ireland",
]);

/** A clear non-UK signal, or nothing at all. Absence is not a rejection. */
function ukVerdict(rec) {
  const segs = rec.url.replace(/^\//, "").split("/");
  const slugCountry = segs.find((s) => COUNTRY_SLUGS.has(s) && s !== "pro");

  if (slugCountry && !UK_SLUGS.has(slugCountry)) {
    return { uk: false, why: `URL says ${slugCountry}` };
  }
  if (rec.country && !UK_COUNTRY.test(rec.country.trim())) {
    return { uk: false, why: `country field says ${rec.country}` };
  }
  if (slugCountry || rec.country || rec.postcodeFromAddress) return { uk: true };
  return { uk: null, why: "nothing on the record says which country" };
}

/* Words that settle it on their own. A "clinic", a "dentist" or a
   "consultant" is in; crypto, gambling and puzzles are out whatever else
   the record claims. The out-list wins, so a fake listing that stuffs
   "clinic" into its name does not sneak through on the word alone. */
const HEALTH_WORDS = new RegExp(
  [
    "clinic", "hospital", "dental", "dentist", "orthodont", "endodont", "periodont",
    "doctor", "\\bdr\\b", "\\bmr\\b", "\\bmrs\\b", "\\bms\\b", "\\bmiss\\b", "surgeon", "surgery", "surgical",
    "medical", "medicine", "healthcare", "health", "wellness", "wellbeing",
    "physio", "physiotherap", "osteopath", "chiropract", "podiatr", "chiropod",
    "psycholog", "psychiatr", "psychotherap", "therapy", "therapist", "counsell", "counsel",
    "orthopaed", "orthoped", "gynaecolog", "gynecolog", "obstetric", "dermatolog",
    "neurosurg", "neurolog", "cardiolog", "oncolog", "urolog", "rheumatolog",
    "paediatric", "pediatric", "geriatric", "radiolog", "patholog", "anaesthe",
    "\\bent\\b", "audiolog", "optometr", "optician", "ophthalm", "optical",
    "aesthetic", "cosmetic", "botox", "dermal", "filler", "skin", "laser",
    "nurse", "nursing", "midwif", "fertility", "\\bivf\\b", "maternity",
    "practice", "consultant", "specialist", "diagnost", "pharmac", "\\bgp\\b",
    "acupunctur", "hypnotherap", "nutrition", "dietit", "podiatry", "sports injur",
    "rehabilitat", "pain", "smile", "teeth", "tooth", "vein", "hair transplant",
  ].join("|"),
  "i"
);

const NOT_HEALTH_WORDS = new RegExp(
  [
    "crypto", "bitcoin", "\\bnft\\b", "blockchain", "\\bforex\\b", "\\btrading\\b",
    "casino", "betting", "gambl", "\\bloan", "payday", "mortgage broker",
    "puzzle", "\\btoys?\\b", "\\bgames?\\b", "escort", "\\bvape\\b", "\\bcbd shop\\b",
    "plumb", "roofing", "scaffold", "locksmith", "removals", "\\btaxi\\b",
    "car hire", "car rental", "\\bcarpet", "\\blandscap", "\\bpaving\\b",
    "seo agency", "web design", "digital marketing", "\\bcourier\\b", "shipping",
    "\\btravel agen", "\\bholiday", "\\bcatering\\b", "\\bbakery\\b", "\\bcafe\\b",
    "\\brestaurant\\b", "\\bplc\\b investments", "\\bestate agen",
  ].join("|"),
  "i"
);

const HEALTH_CATEGORIES = new Set([
  "psychologist", "physiotherapist", "orthopaedics", "neurosurgery", "gynaecology",
  "general practioners", "general practitioners", "ent surgeon", "ent specialist",
  "dermatologist", "dentistry", "aesthetic doctors",
]);

/**
 * Is this a healthcare listing?
 *
 * The category is the strongest evidence there is: it is an admin-set
 * field from a fixed list, not something a member typed. A record with a
 * health category is a health record. Only after that does the wording
 * of the name and description get a say, and a hard out-word overrides
 * everything — a "clinic" in Helsinki selling cryptocurrency is still
 * selling cryptocurrency.
 */
function healthVerdict(rec) {
  const haystack = `${rec.name} ${rec.category} ${rec.description ?? ""}`;

  const bad = haystack.match(NOT_HEALTH_WORDS);
  if (bad) return { health: false, why: `"${bad[0]}" in the name or description` };

  if (rec.category && HEALTH_CATEGORIES.has(rec.category.trim().toLowerCase())) {
    return { health: true };
  }
  if (HEALTH_WORDS.test(haystack)) return { health: true };

  // No category, nothing that reads as healthcare, but nothing damning
  // either — e.g. an invented brand name like "Envigore". A person
  // decides these, not a regex.
  return { health: null, why: "no category and nothing healthcare-related in the name" };
}

/* ------------------------------------------------------------------ *
 * The fields a listing cannot go live without
 *
 * Named by the client: address, coordinates, town, category,
 * subcategory, name, profile photo, description, email. Photo,
 * description and email have each since come off the list for reasons
 * noted below; a row missing any of the rest is held in review.csv
 * rather than imported, and the
 * summary counts each field separately — because "412 rows held back"
 * is not actionable, and "412 held back, 400 of them for the same one
 * missing field" tells you exactly what to go and fix.
 *
 * EMAIL IS NOT ON THIS LIST, deliberately. It is not published on any
 * profile: Brilliant Directories routes member contact through /connect
 * precisely so that addresses cannot be harvested, and the only address
 * in the page source is the form's own "name@yoursite.com" placeholder.
 * No amount of parsing recovers it. It is not a loss, because nothing
 * downstream needs it — import-profile.mjs mints
 * <slug>@unclaimed.toplocalspecialists.com for an unclaimed listing and
 * sets no password on it, so the account exists, an admin can act as
 * them, nobody can sign in, and the real address arrives when the
 * clinician claims the listing. Which is the correct way for it to
 * arrive: an address scraped off a page is not consent to be emailed.
 *
 * SUBCATEGORY depends on the specialty tree in this database, which the
 * harvester deliberately knows nothing about. map-taxonomy.mjs fills it
 * in afterwards, resolving against the six predefined top-level
 * specialties and the 473 below them.
 * ------------------------------------------------------------------ */

const REQUIRED = [
  ["name", (r) => r.name],
  ["category", (r) => r.category],
  /* NOT subCategory. It is required before a listing goes live, but it
     cannot be required HERE: the harvester reads the old site and knows
     nothing about this database's specialty tree, so demanding it at
     this stage held every single row and let nothing through at all.
     map-taxonomy.mjs resolves it against the tree and holds whatever it
     cannot place. The gate belongs where the answer is. */
  /* NOT photo, for a reason particular to this directory. See the
     REPORTED_ONLY note below. */
  ["address", (r) => r.addressLine || r.postcodeFromAddress],
  /* townResolved only. settleTown() has already considered the address
     line and the slug, so falling back to them here would re-admit the
     street names it exists to keep out — five rows slipped through that
     way, each landing a city row called after a street. A row with no
     settled town is held until --towns has looked its postcode up. */
  ["town", (r) => r.townResolved],
  ["coordinates", (r) => r.lat && r.lng],
];

/* Fields worth counting but not worth blocking on.
 *
 * DESCRIPTION started out required and stopped being so once the
 * numbers were in: it is present on about two thirds of the directory,
 * so requiring it held back a third of every specialist on the old site
 * over text that its subject is better placed to write anyway. An
 * unclaimed listing with a name, a specialty, an address on the map and
 * a photograph is findable, which is the whole point of migrating it;
 * the biography arrives when the clinician claims the listing, and the
 * one they write themselves beats anything carried over. Still counted
 * in the report, because "how many profiles will look thin on day one"
 * is a number worth having before launch. */
const REPORTED_ONLY = [
  ["description", (r) => r.description],
  /* PHOTO followed description off the required list. 777 profiles on
     the old site share one file,
     /images/Generated-Image-September-17-2025---6_06PM.webp — the Top
     Local Specialists logo, stood in wherever a member had uploaded no
     picture, across 448 orthopaedic surgeons, 172 physiotherapists and
     11 GPs. So it is not a photograph, and the harvester is right not to
     treat it as one; but it is also not a flaw in those records. They
     are complete in every way that matters — a real name, a real GMC
     number, a real postcode, a point on the map — and requiring a photo
     held 587 of them back over a picture the old site never had either.
     Counted, not blocked. They import with no photo and the new site's
     initials tile fills the frame, which says the true thing: this
     clinician has not uploaded a picture yet, and the claim flow can ask
     for one. Importing the old logo instead would have said nothing at
     all, in a slot the new site could no longer tell from a real
     photograph. */
  ["photo", (r) => r.image],
  ["phone", (r) => r.telephone],
  ["website", (r) => r.website],
  ["postcode", (r) => r.postcodeFromAddress],
];

const missingFields = (rec) => REQUIRED.filter(([, get]) => !get(rec)).map(([name]) => name);

const COLUMNS = [
  "url", "slug", "name", "category", "subCategory", "claimed", "gmcId",
  "townFromAddress", "countyFromAddress", "postcodeFromAddress", "townFromSlug",
  /* The town everything downstream should use, and where it came from.
     townFromAddress and townFromSlug stay in the file beside it: when a
     town looks wrong on the live site, the first question is whether the
     repair did it or the old site did, and that is only answerable if
     both are still here. */
  "townResolved", "townSource",
  "photoFile",
  "addressLine", "lat", "lng", "region", "country", "locationSource",
  "telephone", "website", "image", "imageRejected", "yearsEstablished", "description",
  "bdLocality", "bdPostcode",
  "sourceRating_DO_NOT_IMPORT", "sourceReviewCount_DO_NOT_IMPORT",
];

const csvCell = (v) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (rec) => COLUMNS.map((c) => csvCell(rec[c])).join(",");

/* ------------------------------------------------------------------ *
 * Reasons written by an earlier run
 *
 * imageRejected is decided during --fetch and stored in the NDJSON, so
 * a record harvested before we understood what
 * Generated-Image-September-17-2025 actually was still carries the
 * wording from then — "AI-generated filler image". It is the site's own
 * logo, standing in where a member uploaded nothing, and calling those
 * 756 profiles filler misreads them. Re-fetching 2,700 pages to correct
 * a report label would be absurd, and the label is not data, so it is
 * restated on the way out.
 * ------------------------------------------------------------------ */
const WHY_NO_PHOTO_WAS_CALLED = new Map([
  ["AI-generated filler image, not a real photo", "no photo uploaded — the old site stood its own logo in"],
  ["placeholder avatar, no real photo", "no photo uploaded — placeholder avatar"],
]);
const restateWhyNoPhoto = (reason) => WHY_NO_PHOTO_WAS_CALLED.get(reason) ?? reason ?? "";

function writeCsv() {
  if (!fs.existsSync(PROFILES_PATH)) {
    console.error("No profiles.ndjson — run with --fetch first.");
    process.exit(1);
  }

  /* Read once, outside the loop. Both are optional: no towns.json means
     no repairs were run, no photos directory means the photos were not
     fetched, and in neither case is that a reason to refuse to write a
     CSV. */
  const towns = readTowns();
  const photoIndex = new Map();
  if (fs.existsSync(PHOTOS_DIR)) {
    for (const f of fs.readdirSync(PHOTOS_DIR)) photoIndex.set(f.replace(/\.[^.]+$/, ""), f);
  }
  const photoFor = (slug) => photoIndex.get(slug) ?? "";

  const keep = [];
  const review = [];
  const reject = [];
  let line = 0;

  for (const raw of fs.readFileSync(PROFILES_PATH, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    line += 1;
    let rec;
    try { rec = JSON.parse(raw); } catch { reject.push({ line, url: "", reason: "unreadable line" }); continue; }

    rec.imageRejected = restateWhyNoPhoto(rec.imageRejected);

    /* The town, settled by the one function that decides it, so the CSV
       and the --towns report can never disagree. addressLine is not
       touched: the street detail is the address, and it goes to the
       address field on the listing. */
    const settled = settleTown(rec, towns);
    rec.townResolved = settled.town;
    rec.townSource = settled.source;

    rec.photoFile = photoFor(rec.slug);

    if (rec.error) { reject.push({ line, url: rec.url, reason: rec.error }); continue; }
    if (!rec.name) { reject.push({ line, url: rec.url, reason: "no name on the record" }); continue; }
    if (rec.locationSource === "none") {
      reject.push({ line, url: rec.url, reason: "no location of any kind — not geo, not address, not slug" });
      continue;
    }

    // Outside the UK — out, and said plainly.
    const uk = ukVerdict(rec);
    if (uk.uk === false) {
      reject.push({ line, url: rec.url, reason: `not in the UK — ${uk.why}` });
      continue;
    }

    // Not a healthcare listing — out.
    const health = healthVerdict(rec);
    if (health.health === false) {
      reject.push({ line, url: rec.url, reason: `not a healthcare listing — ${health.why}` });
      continue;
    }

    // Either gate unsure. Held back rather than guessed at in either
    // direction, because both mistakes are expensive: importing a
    // puzzle shop is embarrassing, and dropping a real consultant
    // because his practice has an invented name loses a partner.
    if (uk.uk === null || health.health === null) {
      review.push({
        ...rec,
        reviewReason: [uk.uk === null ? uk.why : null, health.health === null ? health.why : null]
          .filter(Boolean)
          .join("; "),
      });
      continue;
    }

    // In the UK, plainly healthcare — but is it complete enough to go
    // live? A listing with no photo or no description is not a listing
    // anyone wants to land on.
    const missing = missingFields(rec);
    rec.missing = missing.join(" ");
    if (missing.length) {
      review.push({ ...rec, reviewReason: `missing: ${missing.join(", ")}` });
      continue;
    }

    keep.push(rec);
  }

  const REVIEW_PATH = path.join(OUT, "review.csv");
  fs.writeFileSync(CSV_PATH, [COLUMNS.join(","), ...keep.map(csvRow)].join("\n") + "\n");
  fs.writeFileSync(
    REVIEW_PATH,
    [
      ["reviewReason", ...COLUMNS].join(","),
      ...review.map((r) => [csvCell(r.reviewReason), csvRow(r)].join(",")),
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    REJECTS_PATH,
    ["line,url,reason", ...reject.map((r) => [r.line, r.url, r.reason].map(csvCell).join(","))].join("\n") + "\n"
  );

  // The census, because "2,750 rows exported" tells nobody whether the
  // filters will work on the other side.
  const tally = {};
  for (const r of keep) tally[r.locationSource] = (tally[r.locationSource] ?? 0) + 1;

  const pct = (n) => (keep.length ? `${Math.round((n / keep.length) * 100)}%` : "—");
  const withPostcode = keep.filter((r) => r.postcodeFromAddress).length;
  const withGeo = keep.filter((r) => r.lat).length;
  const withCategory = keep.filter((r) => r.category).length;
  const withImage = keep.filter((r) => r.image).length;
  const placeable = keep.filter((r) => r.lat || r.postcodeFromAddress).length;

  const reasons = {};
  for (const r of reject) {
    const k = /not in the UK/.test(r.reason)
      ? "not in the UK"
      : /not a healthcare listing/.test(r.reason)
      ? "not a healthcare listing"
      : /no location/.test(r.reason)
      ? "no location at all"
      : /no name/.test(r.reason)
      ? "no name"
      : "fetch or parse failure";
    reasons[k] = (reasons[k] ?? 0) + 1;
  }

  console.log(`\n  import   ${keep.length}   → ${path.relative(BACKEND, CSV_PATH)}`);
  console.log(`  review   ${review.length}   → ${path.relative(BACKEND, REVIEW_PATH)}`);
  console.log(`  rejected ${reject.length}   → ${path.relative(BACKEND, REJECTS_PATH)}`);

  if (reject.length) {
    console.log(`\n  why rejected:`);
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(5)}  ${k}`);
    }
  }

  /* Field completeness across everything that passed the UK and
     healthcare gates — the import-ready rows plus the ones held for a
     missing field. This is the table that decides whether the public
     site is a good enough source or whether the Members export is
     worth chasing: one field missing on nearly every row is a reason to
     go and get the export, not a reason to import 2,000 half-listings. */
  const gated = [...keep, ...review.filter((r) => /^missing:/.test(r.reviewReason))];
  if (gated.length) {
    const row = ([name, get], required) => {
      const have = gated.filter((r) => get(r)).length;
      const bar = "█".repeat(Math.round((have / gated.length) * 24)).padEnd(24, "·");
      const note = have === 0
        ? (required ? "   ← nothing has this" : "   ← nothing has this (not blocking)")
        : have < gated.length * 0.5
          ? (required ? "   ← mostly missing" : "   ← mostly missing (not blocking)")
          : "";
      console.log(`    ${name.padEnd(12)} ${bar} ${String(have).padStart(5)}/${gated.length}${note}`);
    };

    console.log(`\n  required — a row short of any of these is held:`);
    for (const f of REQUIRED) row(f, true);
    console.log(`\n  recorded but not required:`);
    for (const f of REPORTED_ONLY) row(f, false);
  }

  const noPhotoReason = {};
  for (const r of gated) if (!r.image && r.imageRejected) noPhotoReason[r.imageRejected] = (noPhotoReason[r.imageRejected] ?? 0) + 1;
  if (Object.keys(noPhotoReason).length) {
    console.log(`\n  why a photo is missing:`);
    for (const [k, v] of Object.entries(noPhotoReason).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(5)}  ${k}`);
    }
  }

  console.log(`\n  of the ${keep.length} to import:`);
  console.log(`    category present   ${withCategory}  ${pct(withCategory)}`);
  console.log(`    profile photo      ${withImage}  ${pct(withImage)}`);
  console.log(`    coordinates        ${withGeo}  ${pct(withGeo)}`);
  console.log(`    real postcode      ${withPostcode}  ${pct(withPostcode)}`);
  console.log(`    placeable exactly  ${placeable}  ${pct(placeable)}   (geo or postcode — the rest need the town geocoded)`);
  console.log(`\n  location provenance:`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
}

/* ------------------------------------------------------------------ *
 * Phase 3 — a town that is actually a town
 *
 * THE PROBLEM. The town is read off the old site's address line, and 295
 * times that line has no town in it. What lands in the column instead is
 * a street ("27 Tooley St", "114A Harley St", "Nottingham Pl") or
 * nothing at all. A directory whose location filter offers "27 Tooley
 * St" alongside "London" is broken in the way people actually notice.
 *
 * THE ADDRESS IS NOT THE CASUALTY. addressLine keeps every word of it —
 * "27 Tooley St" is a perfectly good address and it goes to the address
 * field on the listing. The town is a separate, coarser thing whose only
 * job is to be picked cleanly out of a filter, and these two were being
 * asked to be the same string.
 *
 * FOUR ANSWERS, IN ORDER OF HOW MUCH THEY COST:
 *
 *   1. The member's own wording, when it names a place. 2,048 rows. Free,
 *      and the most accurate: they chose it.
 *
 *   2. The URL slug. The old site's own profile paths carry the town —
 *      /england/london/ent-surgeon/alwyn-d-souza — and it is right 231
 *      times out of the 295, 154 of them saying London. This costs
 *      nothing and I very nearly wrote a 2,343-call crawl before
 *      noticing it was already in the file.
 *
 *   3. The postcode. Of the 64 the slug cannot fix, 63 have one, and
 *      they share just 14 distinct postcodes — "Essex, SS2 4XH" with the
 *      county lifted out leaves no town, and SS2 is Southend-on-Sea.
 *      Fourteen lookups.
 *
 *   4. The pin, reverse-geocoded. One row. Kept because the next harvest
 *      may need it more.
 *
 * THEN LONDON. A London postcode area — E, EC, N, NW, SE, SW, W, WC —
 * means the town is London, whatever else it said. That corrects
 * Belgravia, Marylebone, Putney and Canning Town, which are real places
 * but not ones a person filters by when they mean London. It stops at
 * the postcode area on purpose: Croydon and Kingston upon Thames are
 * CR and KT, Royal Mail does not call them London, and neither does
 * anybody searching for a surgeon in Croydon.
 *
 * WHAT IT WILL NOT DO is second-guess a town that is already a place.
 * Sutton Coldfield, Solihull and Headington are real, the member chose
 * them, and a lookup's preferred label for those coordinates would
 * overwrite 2,048 correct answers to fix 295 wrong ones — and would turn
 * every London address into its borough, which is the opposite of the
 * point.
 *
 * THE CACHE. towns.json holds every lookup, keyed on the postcode or the
 * rounded coordinate. Saved after every batch, so a Ctrl-C costs nothing
 * and a re-run is instant. Delete it to redo.
 * ------------------------------------------------------------------ */

/* A street, a building, a floor, a number — not a settlement. */
const NOT_A_PLACE =
  /(\b(road|rd|street|st|avenue|ave|lane|ln|close|drive|dr|way|place|pl|court|ct|crescent|terrace|square|sq|row|walk|parade|grove|mews|wharf|house|suite|floor|unit|wing|hospital|clinic|centre|center|surgery|practice)\b|\d)/i;

const isNotAPlace = (town) => {
  const t = String(town ?? "").trim();
  return !t || t.length < 3 || NOT_A_PLACE.test(t);
};

/* The eight London postcode areas. Not a list of boroughs: a borough
   list would drag in Croydon and Bromley, which nobody calls London. */
const LONDON_POSTCODE = /^(EC|WC|E|N|NW|SE|SW|W)\d/i;
const isLondonPostcode = (pc) => LONDON_POSTCODE.test(String(pc ?? "").trim());

const coordKey = (lat, lng) => `pin:${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
const postcodeKey = (pc) => `pc:${String(pc).trim().toUpperCase()}`;

const readTowns = () => {
  try { return JSON.parse(fs.readFileSync(TOWNS_PATH, "utf8")); } catch { return {}; }
};

/**
 * The town for one record, and where it came from.
 *
 * Pure, and used by --csv as well as by --towns, so the CSV and the
 * report can never disagree about what a listing's town is.
 */
function settleTown(rec, towns = {}) {
  const postcode = String(rec.postcodeFromAddress ?? "").trim();

  /* London first, because it outranks every other answer: a W1 address
     is in London whether the line said Marylebone, Harley St or nothing. */
  if (isLondonPostcode(postcode)) return { town: "London", source: "London postcode area" };

  const fromAddress = String(rec.townFromAddress ?? "").trim();
  if (!isNotAPlace(fromAddress)) return { town: fromAddress, source: "address line" };

  const fromSlug = String(rec.townFromSlug ?? "").trim();
  if (!isNotAPlace(fromSlug)) return { town: fromSlug, source: "url slug" };

  const byPostcode = postcode ? towns[postcodeKey(postcode)] : null;
  if (byPostcode?.town) {
    if (isLondonPostcode(byPostcode.postcode)) return { town: "London", source: "London postcode area" };
    return { town: byPostcode.town, source: "postcode lookup" };
  }

  const byPin = rec.lat && rec.lng ? towns[coordKey(rec.lat, rec.lng)] : null;
  if (byPin?.town) {
    if (isLondonPostcode(byPin.postcode)) return { town: "London", source: "London postcode area" };
    return { town: byPin.town, source: "reverse-geocoded from the pin" };
  }

  return { town: "", source: "" };
}

/** admin_district, then ward, then parish — the first that names a place. */
const placeName = (hit) =>
  hit ? { town: hit.admin_district || hit.admin_ward || hit.parish || "", postcode: hit.postcode ?? "", region: hit.region ?? "" } : null;

/** postcodes.io bulk postcode lookup: up to 100 per POST. */
async function lookupPostcodes(list) {
  const res = await fetch("https://api.postcodes.io/postcodes", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ postcodes: list }),
  });
  if (!res.ok) throw new Error(`postcodes.io HTTP ${res.status}`);
  const body = await res.json();
  return (body.result ?? []).map((row) => placeName(row?.result));
}

/** postcodes.io bulk reverse lookup: nearest postcode to each point. */
async function reverseGeocode(points) {
  const res = await fetch("https://api.postcodes.io/postcodes", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({
      geolocations: points.map(({ lat, lng }) => ({
        latitude: Number(lat), longitude: Number(lng), limit: 1, radius: 2000,
      })),
    }),
  });
  if (!res.ok) throw new Error(`postcodes.io HTTP ${res.status}`);
  const body = await res.json();
  return (body.result ?? []).map((row) => placeName(row?.result?.[0]));
}

async function repairTowns() {
  if (!fs.existsSync(PROFILES_PATH)) {
    console.error("No profiles.ndjson — run with --fetch first.");
    process.exit(1);
  }

  const cache = readTowns();
  const records = [];
  for (const raw of fs.readFileSync(PROFILES_PATH, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const rec = JSON.parse(raw);
      if (!rec.error) records.push(rec);
    } catch { /* torn line */ }
  }

  /* Settle everything with what is already on the record, then see what
     is actually left. This is the step that turned a 2,343-lookup crawl
     into fourteen. */
  const bySource = {};
  const stuck = [];
  for (const rec of records) {
    const { town, source } = settleTown(rec, cache);
    if (town) bySource[source] = (bySource[source] ?? 0) + 1;
    else stuck.push(rec);
  }

  console.log(`${records.length} records\n  settled with what is already on file:`);
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
  console.log(`    ${String(stuck.length).padStart(5)}  still without a town\n`);

  if (!stuck.length) {
    console.log("Nothing to look up. Re-run --csv and the towns are in the CSV.");
    return;
  }

  const postcodes = [...new Set(stuck.map((r) => String(r.postcodeFromAddress ?? "").trim()).filter(Boolean))]
    .filter((pc) => !(postcodeKey(pc) in cache));
  const pins = new Map();
  for (const r of stuck) {
    if (String(r.postcodeFromAddress ?? "").trim()) continue;
    if (!r.lat || !r.lng) continue;
    const key = coordKey(r.lat, r.lng);
    if (!(key in cache) && !pins.has(key)) pins.set(key, { lat: r.lat, lng: r.lng });
  }

  console.log(`  postcodes to look up  ${postcodes.length}`);
  console.log(`  pins to reverse       ${pins.size}\n`);

  const save = () => fs.writeFileSync(TOWNS_PATH, JSON.stringify(cache, null, 2));
  let named = 0;
  let missed = 0;

  try {
    for (let i = 0; i < postcodes.length; i += 100) {
      const slice = postcodes.slice(i, i + 100);
      const answers = await lookupPostcodes(slice);
      slice.forEach((pc, n) => {
        /* null is cached too: a postcode that is not on the register
           will not be next time either, and re-asking is just load on a
           free service. */
        cache[postcodeKey(pc)] = answers[n];
        answers[n] ? named++ : missed++;
      });
      save();
      await sleep(BATCH_DELAY_MS);
    }

    const points = [...pins.entries()];
    for (let i = 0; i < points.length; i += 100) {
      const slice = points.slice(i, i + 100);
      const answers = await reverseGeocode(slice.map(([, pt]) => pt));
      slice.forEach(([key], n) => {
        cache[key] = answers[n];
        answers[n] ? named++ : missed++;
      });
      save();
      await sleep(BATCH_DELAY_MS);
    }
  } catch (err) {
    save();
    console.error(`  ${String(err.message ?? err)} — saved ${named} lookups, re-run to continue`);
    process.exit(1);
  }

  console.log(`  ${named} named, ${missed} no match`);
  console.log(`  → ${path.relative(BACKEND, TOWNS_PATH)}`);

  /* Re-settle with the cache filled, so the closing report is the answer
     --csv will actually write rather than a promise about it. */
  const after = {};
  let stillStuck = 0;
  const towns = {};
  for (const rec of records) {
    const { town, source } = settleTown(rec, cache);
    if (!town) { stillStuck += 1; continue; }
    after[source] = (after[source] ?? 0) + 1;
    towns[town] = (towns[town] ?? 0) + 1;
  }
  console.log(`\n  where every town now comes from:`);
  for (const [k, v] of Object.entries(after).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
  if (stillStuck) console.log(`    ${String(stillStuck).padStart(5)}  still without a town — held by --csv`);
  console.log(`\n  the ten biggest towns:`);
  for (const [k, v] of Object.entries(towns).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
  console.log(`\n  ${Object.keys(towns).length} towns in total.`);
  console.log(`\n  Now re-run --csv, then map-taxonomy.mjs --write --default-sub.`);
}

/* ------------------------------------------------------------------ *
 * Phase 4 — the photographs
 *
 * The harvester records image PATHS, not images. This fetches them.
 *
 * It is deliberately a separate phase, and off by default, because
 * copying a photograph is the one part of this migration that carries
 * real exposure: copyright in a headshot belongs to the photographer or
 * the subject, and a directory republishing one it has no licence for is
 * considerably more exposed than it is over any of the text. The reason
 * it is defensible HERE and was not for Doctify is that these images sit
 * on the client's own Brilliant Directories install, uploaded by members
 * to the client's site under the client's own terms. That is a licence
 * question the client can answer; another platform's photo library is
 * not.
 *
 * What it will not save:
 *
 *   - anything the parser already rejected as not a photograph, which is
 *     the site's logo standing in for an empty profile, and the empty
 *     avatar icon
 *   - anything whose bytes are not actually an image, whatever the
 *     content-type header said. A 404 page saved as <slug>.webp is a
 *     broken image on a real consultant's profile, and it looks worse
 *     than no photograph at all.
 *
 * Resumable by file presence: a photo already on disk is skipped, so a
 * Ctrl-C at 1,200 costs nothing.
 * ------------------------------------------------------------------ */

/* Magic bytes. The header is a claim; these are the file. */
function imageKind(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "gif";
  return null;
}

async function fetchPhotos() {
  if (!fs.existsSync(PROFILES_PATH)) {
    console.error("No profiles.ndjson — run with --fetch first.");
    process.exit(1);
  }
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });

  const todo = [];
  let haveAlready = 0;
  let noPhoto = 0;

  const onDisk = new Set(fs.readdirSync(PHOTOS_DIR).map((f) => f.replace(/\.[^.]+$/, "")));

  for (const raw of fs.readFileSync(PROFILES_PATH, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let rec;
    try { rec = JSON.parse(raw); } catch { continue; }
    if (rec.error) continue;
    if (!rec.image) { noPhoto += 1; continue; }
    if (onDisk.has(rec.slug)) { haveAlready += 1; continue; }
    todo.push({ slug: rec.slug, url: rec.image });
  }

  console.log(`${todo.length + haveAlready} listings with a real photo`);
  console.log(`  already downloaded  ${haveAlready}`);
  console.log(`  no photo to fetch   ${noPhoto}  (the logo placeholder — see the note in the source)`);
  console.log(`  to fetch now        ${todo.length}\n`);
  if (!todo.length) return;

  const LIMIT = Number(val("--limit", 0)) || todo.length;
  const queue = todo.slice(0, LIMIT);
  let saved = 0;
  let notAnImage = 0;
  let failed = 0;
  const problems = [];

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ slug, url }) => {
        try {
          const res = await fetch(url.startsWith("http") ? url : ORIGIN + url, {
            headers: { "user-agent": UA, accept: "image/*" },
            redirect: "follow",
          });
          if (!res.ok) { failed += 1; problems.push(`${slug}: HTTP ${res.status}`); return; }
          const buf = Buffer.from(await res.arrayBuffer());
          const kind = imageKind(buf);
          if (!kind) {
            notAnImage += 1;
            problems.push(`${slug}: ${buf.length} bytes that are not an image — not saved`);
            return;
          }
          fs.writeFileSync(path.join(PHOTOS_DIR, `${slug}.${kind}`), buf);
          saved += 1;
        } catch (err) {
          failed += 1;
          problems.push(`${slug}: ${String(err.message ?? err)}`);
        }
      })
    );
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, queue.length)}/${queue.length} — ${saved} saved, ${notAnImage} not an image, ${failed} failed   `);
    await sleep(BATCH_DELAY_MS);
  }

  console.log(`\n  → ${path.relative(BACKEND, PHOTOS_DIR)}/`);
  if (problems.length) {
    console.log(`\n  ${problems.length} did not save:`);
    for (const line of problems.slice(0, 20)) console.log(`    ${line}`);
    if (problems.length > 20) console.log(`    …and ${problems.length - 20} more`);
  }
  console.log(`\n  Re-run --csv so the CSV names the files, then import with --photos.`);
}

/* ------------------------------------------------------------------ */

const run = async () => {
  if (has("--urls") || has("--all")) await enumerate();
  if (has("--fetch") || has("--all")) await fetchAll();
  if (has("--towns") || has("--all")) await repairTowns();
  /* NOT in --all. Fetching 1,812 photographs is a licensing decision,
     not a step in a pipeline, and it should be typed out deliberately
     every time. */
  if (has("--photos")) await fetchPhotos();
  if (has("--csv") || has("--all")) writeCsv();
  if (!has("--urls") && !has("--fetch") && !has("--towns") && !has("--photos") && !has("--csv") && !has("--all")) {
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
