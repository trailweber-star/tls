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
];
for (const [from, hit] of MANUAL_EXTRAS) {
  if (!MAP.has(from)) MAP.set(from, hit);
}

export function redirects(req, res, next) {
  /* A redirect answers a person following a link. Anything else —
     a POST, an API call, an uploaded image — is not that, and a 301
     on a POST is a good way to lose a form submission. */
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();

  const hit = MAP.get(normalise(req.path));
  if (!hit) return next();

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
