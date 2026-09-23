/* ------------------------------------------------------------------ *
 * build-redirects.mjs — where the old site's 2,750 URLs should land
 *
 * Kirti's Google traction lives on Brilliant Directories URLs. On the
 * day the domain moves, every one of them either lands somewhere
 * sensible or becomes a 404, and a 404 tells Google to drop the page
 * along with whatever ranking it held.
 *
 * This reads the harvest — which recorded, for every old URL, the slug
 * it became — and writes data/redirects.csv. Nothing here touches the
 * database; mapped.csv is the record of what was imported and
 * facility-moves.csv the record of what stopped being a person.
 *
 * The rules, in the order they are tried:
 *
 *   1. the listing became a FACILITY   -> /facilities/<facilitySlug>
 *      Checked first, deliberately. Fourteen of these slugs are still
 *      present in mapped.csv because they WERE imported as specialists,
 *      and were then merged into facilities and deleted. Test "was it
 *      imported" first and all fourteen redirect into a dead
 *      /specialists/ page — a 301 to a 404, which is worse than leaving
 *      the original 404 alone.
 *
 *   2. the listing is live             -> /specialists/<slug>
 *
 *   3. rejected as out of scope        -> 410 Gone
 *      Not a healthcare listing, or not in the UK. These should never
 *      have been in a UK healthcare directory. 410 tells Google the
 *      page is deliberately gone and to stop asking; a 301 to a search
 *      page would be a soft 404, which Google discounts anyway and
 *      which leaves a misleading link in the index meanwhile.
 *
 *   4. anything else                   -> the narrowest search page the
 *      old URL's own data supports: specialty + town, then specialty,
 *      then town. The listing is not in the directory, but somebody
 *      searching for a Birmingham physiotherapist should still arrive
 *      at Birmingham physiotherapists rather than the homepage.
 *
 *   5. nothing known at all            -> /
 *
 * Report by default. --write produces the CSV.
 * ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, "..", "data");
const write = process.argv.includes("--write");

/* -- the old site's category names, as it actually spelled them ----- *
 * Twelve distinct values across 2,750 listings, "General Practioners"
 * misspelled at source. Mapped onto real top-level slugs from
 * specialty-tree.json; anything not listed here resolves on town
 * alone rather than guessing a branch.                               */
const CATEGORY_TO_SPECIALTY = {
  "orthopaedics": "orthopaedics",
  "physiotherapist": "physiotherapy",
  "dentistry": "dentistry",
  "psychologist": "psychology",
  "aesthetic doctors": "aesthetics-specialists",
  "general practioners": "general-practice",
  "general practitioners": "general-practice",
  "gynaecology": "gynaecology",
  "ent surgeon": "ent",
  "ent specialist": "ent",
  "dermatologist": "aesthetics-specialists",
  "neurosurgery": "neurosurgery",
  "paediatrics": "paediatrics",
};

/* Rejection reasons that mean "this had no business being here",
   as opposed to "we ran out of time to check it". Only the first
   kind earns a 410. */
const OUT_OF_SCOPE = [/not a healthcare listing/i, /not in the uk/i];

const readCsv = (file) => {
  const path = join(data, file);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"));
  if (!lines.length) return [];
  const split = (line) => {
    const out = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
};

/* ---- what the harvest knows about every old URL ------------------- */
const records = readFileSync(join(data, "harvest", "profiles.ndjson"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((d) => d && d.url);

/* ---- what is actually in the directory ---------------------------- */
const imported = new Set(readCsv("harvest/mapped.csv").map((r) => r.slug).filter(Boolean));

const toFacility = new Map();
for (const r of readCsv("facility-moves.csv")) {
  if (r.slug && r.facilitySlug) toFacility.set(r.slug, r.facilitySlug);
}

/* Two rejection files, keyed differently — and the difference matters.
   listing-decisions.csv is keyed on SLUG and carries an `action`
   column: only `reject` is a rejection, `refile` means the listing is
   very much still here. harvest/rejected.csv is keyed on URL, because
   a row thrown out for having no name never got as far as a slug. */
const rejectedBySlug = new Map();
for (const r of readCsv("listing-decisions.csv")) {
  if (r.slug && (r.action || "").toLowerCase() === "reject") rejectedBySlug.set(r.slug, r.reason || "");
}
const rejectedByUrl = new Map();
for (const r of readCsv("harvest/rejected.csv")) {
  if (r.url) rejectedByUrl.set(r.url, r.reason || "");
}
const rejectionFor = (url, slug) =>
  (slug && rejectedBySlug.get(slug)) ?? rejectedByUrl.get(url) ?? null;

/* ---- valid specialty slugs, so a target cannot be invented --------- */
const tree = JSON.parse(readFileSync(join(here, "..", "src", "data", "taxonomy", "specialty-tree.json"), "utf8"));
const validSpecialties = new Set();
(function walk(nodes) {
  for (const n of nodes || []) {
    if (n.slug) validSpecialties.add(n.slug);
    walk(n.children);
  }
})(Array.isArray(tree) ? tree : tree.specialties || tree.tree || []);

/* ------------------------------------------------------------------ */
const rows = [];
const tally = {};
const count = (k) => (tally[k] = (tally[k] || 0) + 1);

for (const d of records) {
  const from = d.url;
  const slug = d.slug || "";
  const town = (d.townFromAddress || d.townFromSlug || "").trim();
  /* The category FIELD is empty on 158 records, but the old site put
     the category in the URL too ("/birmingham-uk/paediatrics/dr-x").
     Read the path when the field is blank rather than throwing away a
     specialty the URL is telling us plainly. */
  const fromField = (d.category || "").trim().toLowerCase();
  const fromPath = from.split("/").filter(Boolean).map((s) => s.replace(/-/g, " ").toLowerCase())
    .find((s) => CATEGORY_TO_SPECIALTY[s]) || "";
  const cat = fromField && CATEGORY_TO_SPECIALTY[fromField] ? fromField : fromPath || fromField;
  const specialty = CATEGORY_TO_SPECIALTY[cat];
  const spec = specialty && validSpecialties.has(specialty) ? specialty : "";

  let to, status = 301, why;

  if (slug && toFacility.has(slug)) {
    to = `/facilities/${toFacility.get(slug)}`;
    why = "became a facility";
  } else if (slug && imported.has(slug)) {
    to = `/specialists/${slug}`;
    why = "live listing";
  } else if (OUT_OF_SCOPE.some((re) => re.test(rejectionFor(from, slug) || ""))) {
    to = "";
    status = 410;
    why = "out of scope — deliberately gone";
  } else if (spec && town) {
    to = `/search?specialty=${spec}&location=${encodeURIComponent(town)}`;
    why = "not imported — specialty and town";
  } else if (spec) {
    to = `/search?specialty=${spec}`;
    why = "not imported — specialty only";
  } else if (town) {
    to = `/search?location=${encodeURIComponent(town)}`;
    why = "not imported — town only";
  } else {
    to = "/";
    why = "nothing known";
  }

  count(why);
  rows.push({ from, to, status, why });
}

/* ---- report ------------------------------------------------------- */
console.log(`\n${rows.length} old URL(s) from the harvest\n`);
const width = Math.max(...Object.keys(tally).map((k) => k.length));
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k.padEnd(width)}`);
}
const landing = rows.filter((r) => r.to.startsWith("/specialists/") || r.to.startsWith("/facilities/")).length;
const gone = rows.filter((r) => r.status === 410).length;
console.log(`\n  ${landing} land on the listing itself, ${gone} are 410 Gone, ${rows.length - landing - gone} on a search page or the homepage.`);

console.log("\n  a sample of each kind:");
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.why)) continue;
  seen.add(r.why);
  console.log(`    ${String(r.status)}  ${r.from}\n           -> ${r.to || "(gone)"}`);
}

if (!write) {
  console.log("\nReport only — nothing written. Pass --write to produce data/redirects.csv.\n");
} else {
  const esc = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const csv = ["from,to,status,reason", ...rows.map((r) => [r.from, r.to, r.status, r.why].map((v) => esc(String(v))).join(","))].join("\n");
  writeFileSync(join(data, "redirects.csv"), csv + "\n", "utf8");
  console.log(`\n  -> data/redirects.csv  (${rows.length} rows)\n`);
}
