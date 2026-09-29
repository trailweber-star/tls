import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ *
 * The old site's URLs
 *
 * Top Local Specialists is replacing a Brilliant Directories site that
 * Google has been indexing for years. Every one of those URLs is a page
 * someone can still click on — from a search result, a backlink, a
 * bookmark — and on the day DNS moves, this process is what answers.
 *
 * data/redirects.csv is that answer, one row per old URL, built by
 * scripts/build-redirects.mjs from the harvest. Four columns:
 *
 *   from,to,status,reason
 *   /anaesthetist-orthopaedic-surgeon/dr-basil-almahdi,/specialists/dr-basil-almahdi,301,live listing
 *   /hong-kong/vet,,410,out of scope
 *
 * Only the first three are read here. `reason` is for a person reading
 * the file, and this middleware must never branch on it — the decision
 * it describes was already made when the row was written.
 *
 * Two shapes, and the difference matters to Google:
 *
 *   301 + a path   the page moved; send the ranking with it.
 *   410 + no path  the page is deliberately gone — it was never a UK
 *                  healthcare listing. A 301 to the homepage here would
 *                  be a soft 404: Google discounts it, and 17 junk URLs
 *                  would keep being re-crawled for months. 410 closes
 *                  the entry for good.
 *
 * The file is read once, at boot. It is ~2,750 rows and never changes
 * between deploys, so re-reading it per request would buy nothing and
 * put a synchronous disk read on the hot path.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(here, "../../data/redirects.csv");

/* Requests arrive with whatever casing and trailing slash the linking
   site chose, and the old directory was not fussy about either. The map
   is keyed on the normalised form and looked up the same way, so
   /Dr-Basil-Almahdi/ finds the row written as /dr-basil-almahdi. */
function normalise(urlPath) {
  let s = urlPath;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* A malformed escape is not worth a 500 — fall through with the raw
       string, which simply will not match anything. */
  }
  s = s.toLowerCase().replace(/\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s || "/";
}

function loadMap() {
  const map = new Map();
  let raw;
  try {
    raw = fs.readFileSync(CSV_PATH, "utf8");
  } catch (err) {
    /* Missing is survivable — the site still serves. It is not silent,
       because the symptom otherwise is "Google traffic 404s" a week
       later, with nothing in the logs pointing here. */
    console.warn(`[redirects] ${CSV_PATH} not readable (${err.code}); no old URLs will be redirected`);
    return map;
  }

  const lines = raw.split("\n");
  let gone = 0;
  let moved = 0;
  let collisions = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    /* Hand-sliced rather than split(","): the reason column is free text
       and may contain commas, and it is the one column we must not let
       corrupt the three that matter. */
    const a = line.indexOf(",");
    const b = line.indexOf(",", a + 1);
    if (a < 1 || b < 0) continue;

    const from = normalise(line.slice(0, a));
    const to = line.slice(a + 1, b);
    const c = line.indexOf(",", b + 1);
    const status = Number(line.slice(b + 1, c === -1 ? line.length : c));

    if (status !== 301 && status !== 410) continue;
    if (status === 301 && !to) continue; // a 301 with nowhere to go is a loop

    if (map.has(from)) {
      collisions++;
      continue; // first row wins; build-redirects.mjs writes them in priority order
    }

    map.set(from, status === 410 ? { status: 410 } : { status: 301, to });
    if (status === 410) gone++;
    else moved++;
  }

  console.log(`[redirects] ${moved} moved, ${gone} gone${collisions ? `, ${collisions} duplicate rows ignored` : ""}`);
  return map;
}

const MAP = loadMap();

/* ------------------------------------------------------------------ *
 * Hand-curated extras
 *
 * data/redirects.csv is generated wholesale by build-redirects.mjs from
 * data/harvest/profiles.ndjson, which only ever captured the old site's
 * two-segment listing URLs (/category/specialist-slug). The old
 * Brilliant Directories install also had single-segment category,
 * city and utility pages that harvest never saw, and Google has some
 * of them indexed regardless (found via a manual "site:" search, Sep
 * 2026). Re-running build-redirects.mjs overwrites the whole CSV from
 * that same harvest, so a row added there for one of these would be
 * silently deleted on the next regen. They live here instead, applied
 * on top of the generated map, so they survive it.
 * ------------------------------------------------------------------ */
const MANUAL_EXTRAS = [
  // BD's search page; the new one is at the same job, different name.
  ["/search_results", { status: 301, to: "/search" }],
  // No "electrotherapy" treatment exists in this taxonomy — physiotherapy
  // is the closest real category, and better than a dead end.
  ["/electrotherapy", { status: 301, to: "/search?specialty=physiotherapy" }],
  // Exact match: physiotherapy > general-physiotherapy > joint-injections.
  [
    "/joint-injection",
    { status: 301, to: "/search?specialty=physiotherapy&subspecialty=joint-injections" },
  ],
  // A delivery mode (video vs in-person), not a specialty or a filter
  // this site has — nothing to send it to.
  ["/video-consultation", { status: 410 }],
  // A demo/placeholder town from the Brilliant Directories template,
  // not a UK location this directory ever served.
  ["/plainville", { status: 410 }],
  // A sitewide reviews hub; this site's reviews live per-specialist now,
  // and there is no equivalent aggregate page to send it to.
  ["/reviews", { status: 410 }],
  // A Brilliant Directories feature not carried into the rebuild.
  ["/events-calendar", { status: 410 }],

  /* -------------------------------------------------------------- *
   * Round two: the 113 unique paths behind GSC's 416 "Soft 404"
   * rows (exported 2026-09-29), once the ~80 per-listing
   * "/.../writeareview" pages are pulled out below into a single
   * suffix check instead of ~80 near-identical rows here.
   * -------------------------------------------------------------- */

  // Bare specialty hub pages from the old site's single-segment
  // category URLs — build-redirects.mjs only ever harvested the
  // two-segment /category/specialist-slug listing pages, so these
  // never made it into the CSV. Real specialties in this taxonomy,
  // sent to the equivalent live search.
  ["/orthopaedics", { status: 301, to: "/search?specialty=orthopaedics" }],
  ["/dentistry", { status: 301, to: "/search?specialty=dentistry" }],
  ["/physiotherapist", { status: 301, to: "/search?specialty=physiotherapy" }],
  ["/ent-surgeon", { status: 301, to: "/search?specialty=ent" }],
  // Found in a later export (GSC "Blocked due to access forbidden",
  // 2026-09-29) — the bare version of the general-practioners hub
  // page, same fix as its country-prefixed sibling below.
  ["/general-practioners", { status: 301, to: "/search?specialty=general-practice" }],
  // Not its own top-level specialty here — "dermatologist" is a
  // subspecialty under Aesthetics.
  [
    "/dermatologist",
    {
      status: 301,
      to: "/search?specialty=aesthetics-specialists&subspecialty=aesthetics-specialists-dermatology",
    },
  ],

  // The same hub pages again under the old site's region/country
  // prefixes (England, Scotland, or the full ISO country name). This
  // directory is UK-only, so the region segment adds nothing a UK
  // search doesn't already assume — drop it and land on the same
  // specialty search as the bare version above.
  ["/england/orthopaedics", { status: 301, to: "/search?specialty=orthopaedics" }],
  ["/england/physiotherapist", { status: 301, to: "/search?specialty=physiotherapy" }],
  ["/scotland/orthopaedics", { status: 301, to: "/search?specialty=orthopaedics" }],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/orthopaedics",
    { status: 301, to: "/search?specialty=orthopaedics" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/physiotherapist",
    { status: 301, to: "/search?specialty=physiotherapy" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/dentistry",
    { status: 301, to: "/search?specialty=dentistry" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/aesthetic-doctors",
    { status: 301, to: "/search?specialty=aesthetics-specialists" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/general-practioners",
    { status: 301, to: "/search?specialty=general-practice" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/england/orthopaedics",
    { status: 301, to: "/search?specialty=orthopaedics" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/england/physiotherapist",
    { status: 301, to: "/search?specialty=physiotherapy" },
  ],
  [
    "/united-kingdom-of-great-britain-and-northern-ireland/england/general-physiotherapy",
    {
      status: 301,
      to: "/search?specialty=physiotherapy&subspecialty=physiotherapy-general-physiotherapy",
    },
  ],
  // The bare country hub, with no specialty at all — the closest live
  // equivalent is the unfiltered search, not the homepage.
  [
    "/united-kingdom-of-great-britain-and-northern-ireland",
    { status: 301, to: "/search" },
  ],

  // A location-only hub, and a specialty+city combination, from the
  // old site's flatter URL scheme.
  ["/england/london", { status: 301, to: "/search?location=london" }],
  [
    "/london/hip",
    {
      status: 301,
      to: "/search?specialty=orthopaedics&subspecialty=orthopaedics-hip&location=london",
    },
  ],

  // Brilliant Directories platform pages with no rebuilt equivalent —
  // not healthcare content, just the old CMS showing through.
  ["/products", { status: 410 }], // BD's directory-wide marketplace/listings feature
  ["/copy-7", { status: 410 }], // a duplicated template page, not real content
  ["/events", { status: 410 }],
  ["/event-calendar-json", { status: 410 }], // the JSON feed behind the old events widget
  ["/api/widget/html/summary/whmcs - adminauth", { status: 410 }], // a stray admin/billing widget endpoint, never public

  // A single old business listing with no healthcare specialty
  // attached and no owner-claimed profile to send it to.
  ["/united-kingdom/birmingham/dana-rusu", { status: 410 }],
];
for (const [from, hit] of MANUAL_EXTRAS) {
  if (!MAP.has(from)) MAP.set(from, hit);
}

export function redirects(req, res, next) {
  /* A redirect answers a person following a link. Anything else —
     a POST, an API call, an uploaded image — is not that, and a 301
     on a POST is a good way to lose a form submission. */
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const normalised = normalise(req.path);

  /* The old site's per-listing "write a review" pages — one per
     listing, for businesses this directory mostly never covered (a
     vape shop in Winnipeg, a criminal law firm, a pest control
     company), with no rebuilt equivalent for any of them. GSC's real
     Soft 404 export had ~80 of these as distinct rows; a suffix check
     here does that job instead of ~80 near-identical MANUAL_EXTRAS
     entries. */
  if (normalised.endsWith("/writeareview")) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(410).type("text/plain").send("This page is gone and will not be coming back.");
  }

  const hit = MAP.get(normalised);

  /* The /api and /uploads prefixes are skipped here rather than up
     front: real API calls and uploaded files never end up in MAP (it
     is built from the old BD harvest plus a short hand-curated list),
     so this only ever fires for the one legacy BD widget URL below
     that happens to look like an API path but is really an indexed,
     dead page someone can still click on. Checking the hit first
     keeps that one redirectable without opening the door to real
     /api traffic. */
  if (!hit) return next();
  if (req.path.startsWith("/api") && normalised !== "/api/widget/html/summary/whmcs - adminauth") return next();
  if (req.path.startsWith("/uploads")) return next();

  if (hit.status === 410) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(410).type("text/plain").send("This page is gone and will not be coming back.");
  }

  /* Query strings are carried across so that utm_ tags and the like
     survive the hop and the visit is still attributed to whatever sent
     it. The target may already carry a query of its own — the search
     pages do — so the join is ? or & depending. */
  const q = req.originalUrl.indexOf("?");
  const target = q === -1 ? hit.to : hit.to + (hit.to.includes("?") ? "&" : "?") + req.originalUrl.slice(q + 1);

  /* A browser caches a bare 301 forever, which means a row written
     wrongly today is stuck in that person's browser for good, no matter
     what we fix tomorrow. An hour is long enough to be worth having and
     short enough to be correctable. Google reads the status code, not
     this header, so nothing about the permanence is given away. */
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.redirect(301, target);
}

export default redirects;
