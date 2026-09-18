#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Mapping harvested listings onto this site's specialty tree
 *
 *   node scripts/map-taxonomy.mjs                 # report only
 *   node scripts/map-taxonomy.mjs --write         # write the CSVs
 *   node scripts/map-taxonomy.mjs --default-sub   # fall back to General
 *   node scripts/map-taxonomy.mjs --explain knee  # show how one matched
 *
 * Reads  data/harvest/listings.csv  and  data/harvest/review.csv
 * Writes data/harvest/mapped.csv    and  data/harvest/unmapped.csv
 *
 * WHY THIS IS NOT IN THE HARVESTER. The harvester's job is to get what
 * the old site says, faithfully, over the network. This one's job is to
 * decide what that means in terms of a taxonomy that lives in this
 * database. Different inputs, different failure modes, and only this
 * half needs DATABASE_URL. Keeping them apart means a taxonomy rethink
 * never costs another 2,750 HTTP requests.
 *
 * THE TOP LEVEL IS PREDEFINED and this script never adds to it. It
 * resolves a live category to one of the roots in the database or it
 * holds the row; it does not force a listing into the nearest plausible
 * branch.
 *
 * That list started at six, and the first pass showed what six cost:
 * Psychologist (190 listings on the live site), General Practitioners
 * (85), Dermatologist (46) and Neurosurgery (3) had nowhere to go — 324
 * listings held back. So the taxonomy was extended rather than the
 * listings dropped: Psychology, General Practice, Neurosurgery and
 * Paediatrics are now roots of their own, and Dermatology sits under
 * Aesthetics Specialists rather than becoming an eleventh root, because
 * a private dermatologist and an aesthetic doctor are treating the same
 * patient about the same skin and that branch already had Skin
 * Treatments next door. Ten roots, 679 nodes. sync-taxonomy.mjs is what
 * gets them into a database that has already been seeded.
 *
 * SUB- AND SUB-SUB-CATEGORIES are matched against what is already
 * there, never invented. Matching runs at two levels, because a listing
 * almost never names its own subcategory — it names what the person
 * does. "Botox, dermal fillers and lip fillers" says nothing about
 * "Facial Aesthetics", but Dermal Fillers is a leaf under it. So the
 * second level is tried first and the 426 leaves second, taking the
 * parent of whatever wins.
 *
 * ON NOT GUESSING. A confident wrong subcategory is the worst outcome
 * here, worse than no subcategory: a hip surgeon filed under Knee is
 * invisible to the patients looking for a hip. So a match has to be
 * earned — the specialty's own distinctive words have to appear — a
 * near-miss is a question rather than a decision, and a genuine tie is
 * neither. "Hip and knee arthroplasty" names two subspecialties because
 * the surgeon does two, and the schema already allows for it: one
 * primary_specialty_id beside a many-to-many specialty_links table. Ties
 * are returned in full and marked "multiple".
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const OUT = path.join(BACKEND, "data", "harvest");

/* ------------------------------------------------------------------ *
 * A connection string that is obviously a placeholder
 *
 * Pasting the instructions rather than the value is an easy mistake and
 * a cheap one to catch. Left alone it surfaces as
 * "getaddrinfo ENOTFOUND base" from deep inside the Postgres driver,
 * which names neither the real problem nor the fix and has now cost
 * three separate debugging detours.
 * ------------------------------------------------------------------ */
function refusePlaceholderUrl() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return;
  const looksLikeAPlaceholder =
    /[<>]/.test(url) ||
    /paste|your[-_ ]?(render|db|database)|PASTE_URL|example\.com|localhost:0/i.test(url) ||
    !/^postgres(ql)?:\/\//i.test(url);
  if (!looksLikeAPlaceholder) return;

  console.error(
    "DATABASE_URL does not look like a real connection string:\n" +
    `  ${url.slice(0, 60)}${url.length > 60 ? "…" : ""}\n\n` +
    "It should start with postgresql:// and contain no angle brackets.\n" +
    "Copy the External Database URL from the Render dashboard, then:\n\n" +
    '  export DATABASE_URL="<paste it here>?sslmode=require"\n\n' +
    "replacing the whole of <paste it here> — brackets included — with the URL."
  );
  process.exit(1);
}
refusePlaceholderUrl();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};

/* ------------------------------------------------------------------ *
 * The live site's categories, mapped to the roots that exist here
 *
 * A category absent from this table is not guessed at — it is reported
 * by name, so the next unknown one is a decision rather than a default.
 * ------------------------------------------------------------------ */

const PRIMARY_ALIASES = new Map(
  Object.entries({
    // live category (lowercased)      → predefined top-level slug
    "orthopaedics": "orthopaedics",
    "orthopaedic surgeon": "orthopaedics",
    "orthopaedic surgery": "orthopaedics",
    "anaesthetist orthopaedic surgeon": "orthopaedics",
    "paediatric surgeon": "orthopaedics",
    "dentistry": "dentistry",
    "dentist": "dentistry",
    "ent surgeon": "ent",
    "ent specialist": "ent",
    "ent": "ent",
    "gynaecology": "gynaecology",
    "gynaecologist": "gynaecology",
    "physiotherapist": "physiotherapy",
    "physiotherapy": "physiotherapy",
    "aesthetic doctors": "aesthetics-specialists",
    "aesthetic doctor": "aesthetics-specialists",
    "aesthetics": "aesthetics-specialists",

    /* Added after the first pass, when holding 324 listings back turned
       out to cost more than extending the taxonomy. Four new top-level
       specialties, and Dermatology as a subcategory of Aesthetics
       Specialists rather than a tenth root — a private dermatologist and
       an aesthetic doctor are treating the same patient about the same
       skin, and the branch already had Skin Treatments next door. */
    "psychologist": "psychology",
    "psychology": "psychology",
    "psychotherapist": "psychology",
    "psychotherapy": "psychology",
    "counsellor": "psychology",
    "counselling": "psychology",
    "clinical psychologist": "psychology",
    "general practioners": "general-practice", // the live site's own spelling
    "general practitioners": "general-practice",
    "general practitioner": "general-practice",
    "private gp": "general-practice",
    "gp": "general-practice",
    "neurosurgery": "neurosurgery",
    "neurosurgeon": "neurosurgery",
    "paediatrics": "paediatrics",
    "paediatrician": "paediatrics",
    "paediatric": "paediatrics",
    "dermatologist": "aesthetics-specialists",
    "dermatology": "aesthetics-specialists",
  })
);

/* Categories that would map to a root that does not exist. Empty now
   that the taxonomy has been extended — kept because the next unknown
   category from the live site lands here rather than in the nearest
   plausible branch, and the report names it. */
const NO_HOME = new Set([]);

/* A live category whose listings should land in a particular
   subcategory regardless of what the description says, because the
   category IS the subcategory. Without this a dermatologist whose blurb
   says "acne" would match the Dermatology branch correctly, but one
   whose blurb says nothing would be held for review. */
const FORCED_SUB = new Map(
  Object.entries({
    "dermatologist": "aesthetics-specialists-dermatology",
    "dermatology": "aesthetics-specialists-dermatology",
  })
);

/* ------------------------------------------------------------------ *
 * Matching
 *
 * A specialty is matched on its own distinctive words. "Shoulder &
 * Elbow" contributes "shoulder" and "elbow"; both are specific enough
 * that finding one in a listing means something. Words that appear all
 * over a medical directory carry no signal and are dropped, or every
 * orthopaedic listing would match "Paediatric Orthopaedics" on the word
 * "orthopaedics" alone.
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "and", "the", "of", "or", "general", "other", "surgery", "surgeon", "surgical",
  "medicine", "medical", "clinic", "specialist", "consultant", "treatment",
  "treatments", "conditions", "health", "care", "service", "services",
  // the root names themselves: present on every child, so useless
  // for telling one child from another
  "orthopaedics", "dentistry", "ent", "gynaecology", "physiotherapy",
  "aesthetics", "aesthetic", "dental", "physio",
  "psychology", "paediatrics", "paediatric", "neurosurgery", "practice",
]);

const tokens = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[&/,()'’-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** Singular/plural and the -ic/-ics wobble, so "fibroid" matches "Fibroids". */
const stem = (w) =>
  w
    .replace(/ies$/, "y")
    .replace(/ics$/, "ic")
    .replace(/s$/, "");

const stemSet = (s) => new Set(tokens(s).map(stem));

/**
 * Score one candidate specialty against a listing.
 *
 * Verbatim name in the text is as good as it gets. Failing that, the
 * proportion of the specialty's distinctive words that appear — all of
 * them is strong, some of them is weak. A specialty whose words are all
 * stopwords ("General Dentistry" → nothing) can only ever match
 * verbatim, which is correct: there is nothing distinctive to match on.
 */
/* Escape a specialty name for use in a regex, and allow the separators
   to drift: "Shoulder & Elbow" should still match "shoulder and elbow"
   and "Hand & Wrist" should match "hand/wrist". */
const nameToRegex = (name) => {
  const body = name
    .toLowerCase()
    .split(/\s*[&/]\s*|\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(?:\\s*(?:&|and|/)\\s*|\\s+)");
  return new RegExp(`(?<![a-z])${body}(?![a-z])`, "i");
};

function score(candidate, haystack, haystackStems) {
  /* Word boundaries, not substring. "ENT" is three letters that sit
     inside treatment, dental, patient, centre, independent and
     assessment, so a plain includes() check filed a dermatologist and a
     private GP practice under Ear, Nose and Throat. Short specialty
     names make this failure mode certain rather than unlucky. */
  if (nameToRegex(candidate.name).test(haystack)) return { score: 100, how: "exact name in text" };

  const want = stemSet(candidate.name);
  if (!want.size) return { score: 0, how: "no distinctive words" };

  const hit = [...want].filter((w) => haystackStems.has(w));
  if (!hit.length) return { score: 0, how: "no overlap" };

  const ratio = hit.length / want.size;
  /* One word is not a match, however complete a fraction of the name it
     is. Adding the root names to STOPWORDS left some specialties with a
     single distinctive word — "Sports Psychology" reduces to "sports" —
     and a lone common word then scored as highly as a full name. That
     filed Livewell Health, a sports massage and physiotherapy business,
     under Psychology > Workplace & Performance on the word "Sports".
     A verbatim name still scores 100 above, so "Knee" and "Hip" are
     unaffected; this only caps what ONE partial word can earn. */
  const capped = hit.length === 1 && want.size <= 2;
  const raw = Math.round(ratio * 60) + hit.length * 4;
  return {
    score: capped ? Math.min(raw, 40) : raw,
    how: `matched ${hit.join(", ")} (${hit.length}/${want.size} of its words)` +
      (capped ? " — one word only, not enough on its own" : ""),
  };
}

/** Best candidate, and whether it is clearly ahead of the runner-up. */
function best(candidates, haystack, haystackStems) {
  const ranked = candidates
    .map((c) => ({ c, ...score(c, haystack, haystackStems) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;
  const [first, second] = ranked;

  /* A tie is not one answer, and it is not a failure either.
     "Hip and knee arthroplasty" names two subspecialties because the
     surgeon does two, and the schema already says so: specialists have
     a many-to-many specialty_links table alongside one
     primary_specialty_id. So every candidate that scores as highly as
     the winner is returned, the winner leads, and the row is marked
     "multiple" so nobody reads it as a confident single answer.

     What must never happen is the first draft's behaviour: Hip and Knee
     both scoring 100 and Knee winning because it sorted first. A
     hip-and-knee surgeon filed under Knee alone is invisible to the
     patients looking for a hip. */
  const tied = ranked.filter((r) => r.score >= first.score - 4);
  const clear = tied.length === 1;

  return {
    pick: first.c,
    all: tied.map((r) => r.c),
    score: first.score,
    how:
      tied.length > 1
        ? `${tied.map((r) => r.c.name).join(" + ")} all match — tagged with each`
        : first.how,
    runnerUp: clear ? "" : (second?.c.name ?? ""),
    confidence: !clear
      ? "multiple"
      : first.score >= 100
        ? "exact"
        : first.score >= 60
          ? "strong"
          : "weak",
  };
}

/* ------------------------------------------------------------------ *
 * CSV in, CSV out. Minimal reader — the files are ours and well-formed,
 * but quoted commas are everywhere in the description column so this
 * still has to be a real parser rather than a split(",").
 * ------------------------------------------------------------------ */

function readCsv(file) {
  if (!fs.existsSync(file)) return { header: [], rows: [] };
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

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
  return {
    header,
    rows: rows
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))),
  };
}

const csvCell = (v) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const writeCsv = (file, header, rows) =>
  fs.writeFileSync(
    file,
    [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n"
  );

/* ------------------------------------------------------------------ */

async function main() {
  const all = await loadTaxonomy();
  const byId = new Map(all.map((s) => [s.id, s]));
  const bySlug = new Map(all.map((s) => [s.slug, s]));
  const childrenOf = (id) => all.filter((s) => s.parentId === id);
  const tops = all.filter((s) => !s.parentId);

  console.log(`taxonomy: ${all.length} specialties — ${tops.length} top level`);
  console.log(`  ${tops.map((s) => s.name).join(", ")}\n`);

  if (val("--explain")) return explain(val("--explain"), all, childrenOf, tops);

  /* listings.csv only. The harvester passes a row when everything it
     can know about is present; the subcategory is the one required
     field it cannot supply, and supplying it is this script's entire
     job. Rows the harvester held for a missing photo or description are
     in review.csv and stay there — a subcategory does not fix a missing
     photo. */
  const listings = readCsv(path.join(OUT, "listings.csv"));
  const input = listings.rows;

  if (!input.length) {
    const held = readCsv(path.join(OUT, "review.csv"));
    console.log("Nothing in listings.csv to map.");
    if (held.rows.length) {
      console.log(`review.csv holds ${held.rows.length} row(s) the harvester would not pass. Why:`);
      const tally = {};
      for (const r of held.rows) tally[r.reviewReason ?? "(no reason)"] = (tally[r.reviewReason ?? "(no reason)"] ?? 0) + 1;
      for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        console.log(`  ${String(v).padStart(5)}  ${k}`);
      }
    } else {
      console.log("Run the harvester first: --urls, then --fetch, then --csv.");
    }
    process.exit(0);
  }
  console.log(`${input.length} listings to map\n`);

  const mapped = [];
  const unmapped = [];
  let conflicts = 0;
  const primaryTally = {};
  const noHomeTally = {};
  const confTally = {};

  for (const row of input) {
    const liveCategory = String(row.category ?? "").trim();
    const key = liveCategory.toLowerCase();

    // The specialty words in the URL are often more precise than the
    // category — "/orthopaedic-surgeon/" and "/birmingham-uk/ent-specialist/".
    const slugWords = String(row.url ?? "").replace(/^\//, "").split("/").slice(0, -1).join(" ").replace(/-/g, " ");
    const haystack = `${row.name} ${liveCategory} ${slugWords} ${row.description ?? ""}`.toLowerCase();
    const haystackStems = new Set(tokens(haystack).map(stem));

    // --- primary: one of the six, or held ---
    let topSlug = PRIMARY_ALIASES.get(key);
    if (!topSlug) {
      // The category may not be in the alias table but its words may
      // still name one of the six outright.
      const t2 = best(tops, haystack, haystackStems);
      if (t2 && t2.confidence === "exact") topSlug = t2.pick.slug;
    }

    if (!topSlug) {
      const reason = NO_HOME.has(key)
        ? `"${liveCategory}" has no predefined top-level specialty on this site`
        : liveCategory
          ? `"${liveCategory}" does not map to any of the six predefined specialties`
          : "no category on the record";
      noHomeTally[liveCategory || "(blank)"] = (noHomeTally[liveCategory || "(blank)"] ?? 0) + 1;
      unmapped.push({ ...row, unmappedReason: reason, suggestedPrimary: "", suggestedSub: "" });
      continue;
    }

    /* The live category is admin-set and usually right, but it is not
     * always right, and it had been treated as beyond question.
     * "Livewell" is filed on the old site under Psychologist and its own
     * description says "Sports Massage, Soft Tissue Services and
     * Physiotherapy… Team GB". Trusting the category there produces a
     * physiotherapy business in the psychology directory — and on 2,750
     * records off a directory this untidy, that will not be the only one.
     *
     * So: after the category picks a root, check whether the listing's
     * own words name a DIFFERENT root outright. If they do, that is a
     * contradiction between two sources of evidence and a person should
     * settle it. Neither side is overridden silently. */
    const rootByText = best(tops, haystack, haystackStems);
    if (
      rootByText &&
      rootByText.confidence === "exact" &&
      rootByText.pick.slug !== topSlug &&
      !PRIMARY_ALIASES.get(key)?.includes(rootByText.pick.slug)
    ) {
      unmapped.push({
        ...row,
        unmappedReason:
          `category says ${liveCategory} but the listing reads as ${rootByText.pick.name}` +
          ` — the old site may have it filed wrong`,
        suggestedPrimary: rootByText.pick.slug,
        suggestedSub: "",
      });
      conflicts += 1;
      continue;
    }

    const top = bySlug.get(topSlug);
    if (!top) {
      unmapped.push({ ...row, unmappedReason: `alias points at "${topSlug}", which is not in the taxonomy`, suggestedPrimary: "", suggestedSub: "" });
      continue;
    }
    primaryTally[top.name] = (primaryTally[top.name] ?? 0) + 1;

    // --- sub: the second level under that parent, only ---
    const subs = childrenOf(top.id);
    const forced = FORCED_SUB.get(key);
    let sub = forced && bySlug.has(forced)
      ? { pick: bySlug.get(forced), all: [bySlug.get(forced)], score: 100, how: `"${liveCategory}" maps straight to this subcategory`, runnerUp: "", confidence: "exact" }
      : best(subs, haystack, haystackStems);

    /* Second attempt, through the leaves.
     *
     * A listing rarely names its subcategory. It names what the person
     * actually does: "Botox, dermal fillers and lip fillers" says
     * nothing about "Facial Aesthetics", and "individual therapy and
     * counselling" says nothing about "Talking Therapies" — but Botox,
     * Dermal Fillers and Person-centred Counselling are all leaves in
     * this tree. So when the second level does not produce a confident
     * answer, search the 426 leaves instead and take the parent of
     * whatever wins. The leaves are where the vocabulary people
     * actually write in lives. */
    if (!sub || sub.confidence === "weak" || sub.confidence === "multiple") {
      const leaves = subs.flatMap((s) => childrenOf(s.id));
      const viaLeaf = best(leaves, haystack, haystackStems);
      /* The leaf has to have been matched on something substantial, not
         on a word it shares with forty siblings. "Individual therapy and
         counselling" hits the word "therapy" in Couples Therapy, Family
         Therapy and Child Therapy equally, and tagging a psychologist
         with all three because of it is not a match — it is noise
         wearing a match's clothes. 60 is the all-its-words threshold. */
      if (viaLeaf && viaLeaf.score >= 60) {
        const parents = [...new Set(viaLeaf.all.map((l) => byId.get(l.parentId)).filter(Boolean))];
        if (parents.length) {
          const better = {
            pick: parents[0],
            all: parents,
            score: viaLeaf.score,
            how: `via ${viaLeaf.all.map((l) => l.name).join(" + ")}`,
            runnerUp: "",
            confidence: parents.length > 1 ? "multiple" : viaLeaf.confidence,
          };
          // Only replace a weaker level-2 answer, never a confident one.
          if (!sub || sub.confidence === "weak" || better.confidence !== "multiple") sub = better;
        }
      }
    }

    /* Last resort, opt in with --default-sub.
     *
     * A great many listings name their specialty and nothing narrower:
     * "SC Therapy and Wellbeing", "Birmingham-Therapy", "Edgbaston
     * Private Medical Practice", with no description behind them. There
     * is genuinely nothing in the record that picks one subcategory over
     * another, so guessing would be inventing, and holding all of them
     * means hand-sorting a large fraction of 2,750.
     *
     * The honest third option is a general subcategory under each root —
     * which several roots already had, because a real directory needs
     * somewhere to put a generalist. Falling back to it is not a guess:
     * a psychologist filed under General Psychology & Counselling is
     * correctly filed, just not precisely filed. Marked "default" so the
     * rows are one filter away whenever somebody wants to refine them. */
    if ((!sub || sub.confidence === "weak") && has("--default-sub")) {
      const general = subs.find((x) => /^general\b/i.test(x.name));
      if (general) {
        sub = {
          pick: general,
          all: [general],
          score: 1,
          how: "nothing narrower in the listing - filed under " + general.name,
          runnerUp: "",
          confidence: "default",
        };
      }
    }

    if (!sub || sub.confidence === "weak") {
      confTally[sub ? sub.confidence : "none"] = (confTally[sub ? sub.confidence : "none"] ?? 0) + 1;
      unmapped.push({
        ...row,
        unmappedReason: sub
          ? `subcategory ${sub.confidence}: ${sub.how}${sub.runnerUp ? `, against "${sub.runnerUp}"` : ""}`
          : "nothing in the listing names a subcategory",
        suggestedPrimary: top.slug,
        suggestedSub: sub?.pick.slug ?? "",
      });
      continue;
    }
    confTally[sub.confidence] = (confTally[sub.confidence] ?? 0) + 1;

    // --- sub-sub: optional, only the children of the chosen sub ---
    const subSubs = childrenOf(sub.pick.id);
    const subSub = subSubs.length ? best(subSubs, haystack, haystackStems) : null;
    const takeSubSub = subSub && (subSub.confidence === "exact" || subSub.confidence === "strong");

    mapped.push({
      ...row,
      primarySpecialtySlug: top.slug,
      primarySpecialtyName: top.name,
      subSpecialtySlug: sub.pick.slug,
      subSpecialtyName: sub.pick.name,
      /* Every subcategory this listing belongs to, not just the leading
         one. The import writes these to specialist_specialties; the
         single subSpecialtySlug above is the primary. */
      subSpecialtySlugsAll: (sub.all ?? [sub.pick]).map((s) => s.slug).join(" "),
      subSubSpecialtySlug: takeSubSub ? subSub.pick.slug : "",
      subSubSpecialtyName: takeSubSub ? subSub.pick.name : "",
      taxonomyConfidence: sub.confidence,
      taxonomyEvidence: sub.how,
    });
  }

  // ---- report ----
  console.log(`  mapped   ${mapped.length}`);
  console.log(`  unmapped ${unmapped.length}\n`);

  if (Object.keys(primaryTally).length) {
    console.log("  primary specialty resolved (includes rows later held on subcategory):");
    for (const [k, v] of Object.entries(primaryTally).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(5)}  ${k}`);
    }
  }
  if (Object.keys(confTally).length) {
    console.log("\n  subcategory match quality:");
    for (const [k, v] of Object.entries(confTally).sort((a, b) => b[1] - a[1])) {
      const note = { exact: "the name appears verbatim", strong: "all its distinctive words matched", multiple: "several matched equally - tagged with each", weak: "one word matched - held", default: "nothing narrower said - filed under the root General", none: "nothing matched - held" }[k] ?? "";
      console.log(`    ${String(v).padStart(5)}  ${k.padEnd(10)} ${note}`);
    }
  }
  if (Object.keys(noHomeTally).length) {
    console.log("\n  categories with no predefined home (held back, as agreed):");
    let total = 0;
    for (const [k, v] of Object.entries(noHomeTally).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(5)}  ${k}`);
      total += v;
    }
    console.log(`    ${String(total).padStart(5)}  in total — these need a new top-level specialty before they can migrate`);
  }

  if (conflicts) {
    console.log(
      `\n  ${conflicts} listing(s) where the old site's category contradicts the listing's own\n` +
      `  words. Those are in unmapped.csv with both candidates named — the old site has\n` +
      `  them filed wrong, or the wording is misleading, and only a person can say which.`
    );
  }

  const rescuableByDefault = unmapped.filter(
    (r) => r.suggestedPrimary && /^(nothing in the listing|subcategory weak)/.test(r.unmappedReason)
  ).length;
  if (rescuableByDefault && !has("--default-sub")) {
    console.log(
      "\n  " + rescuableByDefault + " of the " + unmapped.length + " unmapped resolved a specialty but nothing narrower.\n" +
      "  Re-run with --default-sub to file those under the root General subcategory\n" +
      "  (marked \"default\", so they stay one filter away from being refined)."
    );
  }

  if (has("--write")) {
    const header = [
      ...listings.header.filter((h) => h !== "subCategory"),
      "primarySpecialtySlug", "primarySpecialtyName",
      "subSpecialtySlug", "subSpecialtyName", "subSpecialtySlugsAll",
      "subSubSpecialtySlug", "subSubSpecialtyName",
      "taxonomyConfidence", "taxonomyEvidence",
    ];
    writeCsv(path.join(OUT, "mapped.csv"), header, mapped);
    writeCsv(
      path.join(OUT, "unmapped.csv"),
      ["unmappedReason", "suggestedPrimary", "suggestedSub", "url", "name", "category", "description"],
      unmapped
    );
    console.log(`\n  → ${path.relative(BACKEND, path.join(OUT, "mapped.csv"))}`);
    console.log(`  → ${path.relative(BACKEND, path.join(OUT, "unmapped.csv"))}`);
  } else {
    console.log("\n  (report only — pass --write to produce mapped.csv and unmapped.csv)");
  }

  process.exit(0);
}

/** Show the full ranking for one search term, for when a mapping looks wrong. */
function explain(term, all, childrenOf, tops) {
  const haystack = term.toLowerCase();
  const haystackStems = new Set(tokens(haystack).map(stem));
  console.log(`how "${term}" scores against the tree\n`);
  for (const top of tops) {
    const subs = childrenOf(top.id);
    const ranked = subs
      .map((c) => ({ name: c.name, ...score(c, haystack, haystackStems) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    if (!ranked.length) continue;
    console.log(`  ${top.name}`);
    for (const r of ranked) console.log(`    ${String(r.score).padStart(4)}  ${r.name.padEnd(34)} ${r.how}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * Where the tree comes from
 *
 * src/data/taxonomy/specialty-tree.json, not the database. This used to
 * read the database, which meant classifying a CSV needed a live
 * Postgres on the other end of a connection string — and the connection
 * string for the environment you happen to be importing into, which is
 * a strange thing to need in order to decide that a hip surgeon belongs
 * under Hip. The file is the source of truth for the tree: seed.js
 * inserts it into a new database and sync-taxonomy.mjs brings an
 * existing one up to date with it. Reading the file directly means the
 * mapping cannot drift from the definition, and it runs offline.
 *
 * Slugs stand in for ids. Everything downstream of here — mapped.csv,
 * the importer, specialist_specialties — addresses specialties by slug
 * anyway, and the generated uuids were never in the output.
 *
 * If DATABASE_URL happens to be set we take one look at that database
 * and say so if it is behind the file, because a mapping onto a
 * subcategory that does not exist in the database you are importing
 * into will fail at import time, and it is much cheaper to hear about
 * it now.
 * ------------------------------------------------------------------ */
async function loadTaxonomy() {
  const file = path.join(BACKEND, "src", "data", "taxonomy", "specialty-tree.json");
  if (!fs.existsSync(file)) {
    console.error(`No specialty tree at ${file} — this script reads the tree from it.`);
    process.exit(1);
  }

  const all = [];
  const walk = (nodes, parentId) => {
    for (const n of nodes) {
      all.push({ id: n.slug, parentId, slug: n.slug, name: n.name });
      walk(n.children ?? [], n.slug);
    }
  };
  walk(JSON.parse(fs.readFileSync(file, "utf8")), null);

  const dupes = all.map((s) => s.slug).filter((sl, i, a) => a.indexOf(sl) !== i);
  if (dupes.length) {
    console.error(`specialty-tree.json has duplicate slugs: ${[...new Set(dupes)].join(", ")}`);
    process.exit(1);
  }

  await warnIfDatabaseIsBehind(all);
  return all;
}

/** One read-only look at the target database, if we have been given one. */
async function warnIfDatabaseIsBehind(all) {
  if (!process.env.DATABASE_URL) return;
  try {
    const { getDb, isDbConfigured } = await import("../src/db/client.js");
    if (!isDbConfigured()) return;
    const t = await import("../src/db/schema.js");
    const rows = await getDb().select({ slug: t.specialties.slug }).from(t.specialties);
    const have = new Set(rows.map((r) => r.slug));
    const behind = all.filter((s) => !have.has(s.slug));
    if (behind.length) {
      console.log(
        `NOTE: DATABASE_URL points at a database missing ${behind.length} of these ` +
        `${all.length} specialties, so an import into it would fail on them.\n` +
        "      Run:  node scripts/sync-taxonomy.mjs --write\n"
      );
    }
  } catch {
    /* Unreachable, wrong credentials, no such table — none of which stop
       the mapping. The tree came from the file. Say nothing and carry on;
       the import is where a bad connection string matters. */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
