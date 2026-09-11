import { isDbConfigured } from "../config/db.js";
import { facilities as facilityRepo, specialists as specialistRepo, taxonomy } from "../db/repos.js";
import {
  mockSpecialistsWithRelations,
  mockFacilitiesWithRelations,
  specialties as mockSpecialties,
  conditions as mockConditions,
  treatments as mockTreatments,
  facilityCategories as mockFacilityCategories,
} from "../data/mock.js";

/* ------------------------------------------------------------------ *
 * The search panel
 *
 * One endpoint behind the single search box, serving the three columns
 * the panel shows: specialties, procedures & conditions, and the people
 * (or places) themselves.
 *
 * It answers in two modes and the UI renders both the same way:
 *
 *   popular — nothing typed yet. The most useful starting points, so an
 *     empty box is still a way in rather than a blank stare.
 *   results — filtered by what has been typed, with the matched range
 *     marked so the UI can highlight it without guessing where it is.
 *
 * Every row is a real destination. Nothing here returns a search term
 * for the patient to re-type.
 * ------------------------------------------------------------------ */

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What each tab above the box actually searches. */
export const SEARCH_TYPES = {
  doctor: {
    label: "Doctor",
    plural: "Specialists",
    kind: "specialist",
    placeholder: "Search a name, specialty, treatment or condition",
  },
  dentist: {
    label: "Dentist",
    plural: "Dentists",
    kind: "specialist",
    specialtySlug: "dentistry",
    placeholder: "Search a dentist, treatment or condition",
  },
  practice: {
    label: "Practice",
    plural: "Practices",
    kind: "facility",
    facilityType: "clinic",
    placeholder: "Search for a practice by name",
  },
  hospital: {
    label: "Hospital",
    plural: "Hospitals",
    kind: "facility",
    facilityType: "hospital",
    placeholder: "Search for a hospital by name",
  },
  "care-home": {
    label: "Care Home",
    plural: "Care homes",
    kind: "facility",
    facilityType: "care_home",
    placeholder: "Search for a care home by name",
  },
  pharmacy: {
    label: "Pharmacy",
    plural: "Pharmacies",
    kind: "facility",
    facilityType: "pharmacy",
    placeholder: "Search for a pharmacy by name",
  },
};

/**
 * Where the needle sits in the text, so the UI can highlight exactly the
 * part that matched. Returns null when it doesn't match at all; `rank`
 * is lower for a better match and drives the ordering.
 */
function match(text, needle) {
  const hay = norm(text);
  if (!needle) return { rank: 99, from: -1, to: -1 };
  if (!hay) return null;

  const at = hay.indexOf(needle);
  if (at < 0) return null;

  const startsPhrase = at === 0;
  const startsWord = at === 0 || hay[at - 1] === " ";
  const exact = hay === needle;
  const rank = exact ? 0 : startsPhrase ? 1 : startsWord ? 2 : 3;

  // The offsets are into the ORIGINAL string, not the normalised one, so
  // the UI can slice the real label. Walk both together, because
  // normalising collapses punctuation and can shift positions.
  const original = String(text);
  let ni = 0;
  let start = -1;
  for (let oi = 0; oi < original.length; oi += 1) {
    const ch = original[oi].toLowerCase();
    const isWordChar = /[a-z0-9]/.test(ch);
    const mapped = isWordChar ? ch : " ";
    // Collapse runs of separators the same way norm() does.
    if (mapped === " " && (ni === 0 || hay[ni - 1] === " ")) continue;
    if (ni === at) start = oi;
    if (ni === at + needle.length) return { rank, from: start, to: oi };
    ni += 1;
  }
  return { rank, from: start, to: original.length };
}

/**
 * Rank, sort, de-duplicate and split one column.
 *
 * The split is what makes a long list usable: `primary` holds the direct
 * hits — the thing itself, or a name beginning with what was typed — and
 * `more` holds everything else that mentions it further in. The UI draws
 * a rule between the two and scrolls the whole column, so typing
 * "cardio" surfaces Cardiology first without hiding the twenty related
 * things underneath it.
 */
function column(rows, needle, limit, build) {
  const seen = new Set();
  const ranked = rows
    .map((row) => {
      const item = build(row);
      if (!item) return null;
      const m = match(item.match, needle);
      return m ? { ...item, rank: m.rank, from: m.from, to: m.to } : null;
    })
    .filter(Boolean)
    // With nothing typed there is nothing to rank against, so the order
    // the caller supplied is the order shown — and it all sits in one
    // undivided list, because a rule between "popular" and "also
    // popular" would mean nothing.
    .sort((a, b) =>
      needle ? a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label) : 0
    )
    .filter((item) => {
      // The taxonomy legitimately holds the same leaf name under two
      // parents ("Knee Fracture" under both Knee and Trauma). Two
      // identical rows read as a bug however true they are, so the
      // best-ranked one wins and the rest are dropped.
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  const strip = ({ match: _m, rank: _r, ...rest }) => rest;
  if (!needle) return { primary: ranked.map(strip), more: [] };
  return {
    primary: ranked.filter((i) => i.rank <= 1).map(strip),
    more: ranked.filter((i) => i.rank > 1).map(strip),
  };
}

async function loadAll() {
  if (!isDbConfigured()) {
    return {
      specialists: mockSpecialistsWithRelations.filter((s) => s.verificationStatus === "verified"),
      facilities: mockFacilitiesWithRelations,
      specialties: mockSpecialties,
      conditions: mockConditions,
      treatments: mockTreatments,
      facilityCategories: mockFacilityCategories,
    };
  }
  const [specialists, facilities, specialties, conditions, treatments, facilityCategories] = await Promise.all([
    specialistRepo.verified(),
    facilityRepo.all(),
    taxonomy.specialties(),
    taxonomy.conditions(),
    taxonomy.treatments(),
    taxonomy.facilityCategories(),
  ]);
  return { specialists, facilities, specialties, conditions, treatments, facilityCategories };
}

// The columns scroll, so these are generous. They exist to stop a
// one-letter query serialising the whole taxonomy, not to curate.
const COLUMN_LIMIT = 40;
const PEOPLE_LIMIT = 12;

const FACILITY_LABEL = {
  hospital: "Hospital",
  clinic: "Clinic",
  care_home: "Care home",
  pharmacy: "Pharmacy",
};

const count = (c) => c.primary.length + c.more.length;

// GET /api/search/panel?q=cardio&type=doctor
export async function searchPanel(req, res) {
  const typeKey = SEARCH_TYPES[req.query.type] ? req.query.type : "doctor";
  const type = SEARCH_TYPES[typeKey];
  const raw = String(req.query.q ?? "");
  const needle = norm(raw);
  const popular = needle.length < 2;

  const data = await loadAll();
  const specialtyById = new Map(data.specialties.map((s) => [s.id, s]));

  /* ------------------------------------------------------- reachable
     The taxonomy is far larger than the directory: hundreds of specialty
     nodes, and a specialist tagged at exactly one of them. Offering a
     suggestion nobody is behind is how a search ends up answering "0
     results" to something it proposed itself — so a row only appears
     here if searching it would actually find someone.

     Being tagged at a leaf counts for every ancestor of that leaf too: a
     knee replacement surgeon is a reason to offer "Knee" AND
     "Orthopaedics", because the search branch-expands downwards. */
  const liveSpecialtyIds = new Set();
  const liveConditionIds = new Set();
  const liveTreatmentIds = new Set();
  for (const sp of data.specialists) {
    for (const node of sp.specialties ?? []) {
      let cur = specialtyById.get(node.id);
      const guard = new Set();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        liveSpecialtyIds.add(cur.id);
        cur = cur.parentId ? specialtyById.get(cur.parentId) : null;
      }
    }
    (sp.conditions ?? []).forEach((c) => liveConditionIds.add(c.id));
    (sp.treatments ?? []).forEach((t) => liveTreatmentIds.add(t.id));
  }
  const parentName = (id) => (id ? specialtyById.get(id)?.name ?? null : null);

  /** The top-level specialty a node belongs to — "Orthopaedics", not
   *  "Total Knee Replacement". That is what a patient recognises as
   *  someone's field, so it is what a result card carries. */
  function rootSpecialtyName(id) {
    let node = id ? specialtyById.get(id) : null;
    const guard = new Set();
    while (node?.parentId && !guard.has(node.id)) {
      guard.add(node.id);
      node = specialtyById.get(node.parentId);
    }
    return node?.name ?? null;
  }

  /* --------------------------------------------------------- column 1
     Every tier of the specialty tree — category, sub-category and the
     narrow procedure level — condensed into one scrolling column. A
     patient does not know or care which tier "Knee Arthroscopy" lives
     on; they know the words. With nothing typed, the top-level
     categories lead because "Orthopaedics" is a better way in than
     "Knee Bursitis". */
  // Columns one and two are the same on every tab: what a patient is
  // looking for is a specialty or a procedure whether they want a person
  // or a place. Only the third column — and the horizontal strip above
  // the bar — change with the tab.
  const usingFacilityTree = type.kind === "facility";
  const tree = data.specialties;

  const reachable = tree.filter((n) => liveSpecialtyIds.has(n.id));
  const specialtySource = popular
    ? [...reachable.filter((s) => !s.parentId), ...reachable.filter((s) => s.parentId)]
    : reachable;
  const specialties = column(specialtySource, needle, COLUMN_LIMIT, (sp) => ({
    match: sp.name,
    kind: "specialty",
    label: sp.name,
    sublabel: parentName(sp.parentId) ?? "Specialty",
    href: sp.parentId ? `/search?subspecialty=${sp.slug}` : `/search?specialty=${sp.slug}`,
  }));

  /* --------------------------------------------------------- column 2
     Procedures and conditions together — a patient does not distinguish
     between "the thing I have" and "the thing they do about it", and
     both lead to the same place: people who treat it. */
  const procedureSource = [
    ...data.treatments.filter((t) => liveTreatmentIds.has(t.id)).map((t) => ({ ...t, kind: "treatment" })),
    ...data.conditions.filter((c) => liveConditionIds.has(c.id)).map((c) => ({ ...c, kind: "condition" })),
  ];
  const procedures = column(procedureSource, needle, COLUMN_LIMIT, (row) => ({
    match: row.name,
    kind: row.kind,
    label: row.name,
    sublabel: parentName(row.specialtyId) ?? (row.kind === "treatment" ? "Procedure" : "Condition"),
    href: `/search?q=${encodeURIComponent(row.name)}`,
  }));

  /* --------------------------------------------------------- column 3
     The people, or — under a places tab — the places. */
  let people = { primary: [], more: [] };
  let peopleLabel = type.plural;

  if (type.kind === "specialist") {
    let pool = data.specialists;
    if (type.specialtySlug) {
      // The Dentist tab is the specialist search scoped to the dentistry
      // branch, not a separate directory.
      const root = data.specialties.find((s) => s.slug === type.specialtySlug);
      const branch = new Set();
      if (root) {
        branch.add(root.id);
        let frontier = [root.id];
        while (frontier.length) {
          const kids = data.specialties.filter((s) => frontier.includes(s.parentId));
          if (!kids.length) break;
          kids.forEach((k) => branch.add(k.id));
          frontier = kids.map((k) => k.id);
        }
      }
      pool = pool.filter((s) => s.specialties.some((sp) => branch.has(sp.id)));
    }
    // With nothing typed, show the best-rated first rather than whoever
    // happens to be first in the table.
    const ordered = popular ? [...pool].sort((a, b) => b.ratingAvg - a.ratingAvg) : pool;
    people = column(ordered, needle, PEOPLE_LIMIT, (s) => ({
      // Matched on what they treat as well as what they are called, so
      // typing "sinus" finds the ENT surgeon whose specialty is filed
      // under "Septoplasty".
      match: [
        s.fullName,
        s.title ?? "",
        s.specialties.map((x) => x.name).join(" "),
        s.conditions.map((x) => x.name).join(" "),
        s.treatments.map((x) => x.name).join(" "),
      ].join(" "),
      kind: "specialist",
      label: s.fullName,
      sublabel: rootSpecialtyName(s.primarySpecialtyId) ?? s.title ?? null,
      photoUrl: s.photoUrl ?? null,
      href: `/specialists/${s.slug}`,
    }));
  } else {
    const pool = data.facilities.filter((f) => f.facilityType === type.facilityType);
    const ordered = popular ? [...pool].sort((a, b) => b.ratingAvg - a.ratingAvg) : pool;
    people = column(ordered, needle, PEOPLE_LIMIT, (f) => ({
      match: `${f.name} ${f.city?.name ?? ""} ${f.categories.map((c) => c.name).join(" ")}`,
      kind: "facility",
      label: f.name,
      sublabel: [FACILITY_LABEL[f.facilityType], f.city?.name].filter(Boolean).join(" · ") || null,
      photoUrl: f.photoUrl ?? null,
      // Carried so the row can show the building rather than a grey
      // square when a listing has not uploaded its own photo yet.
      facilityType: f.facilityType,
      href: `/facilities/${f.slug}`,
    }));
  }

  // The horizontal strip above the bar: the top level of whichever tree
  // this tab uses, always present regardless of what has been typed, so
  // there is a way in that needs no typing at all.
  const stripTree = usingFacilityTree ? data.facilityCategories : data.specialties;
  const topCategories = stripTree
    .filter((n) => !n.parentId)
    .map((n) => ({
      label: n.name,
      slug: n.slug,
      // One results page for everything: the strip under a places tab
      // has to land on /search with the tab preselected, not on the old
      // /facilities route, which now only redirects and would drop the
      // category on the way.
      href: usingFacilityTree
        ? `/search?type=${type.facilityType}&category=${n.slug}`
        : `/search?specialty=${n.slug}`,
    }));

  res.json({
    q: raw,
    type: typeKey,
    placeholder: type.placeholder,
    topCategories,
    mode: popular ? "popular" : "results",
    // Under a places tab the panel is one column: the places themselves.
    // Somebody looking for a hospital is looking for a hospital — the
    // clinical taxonomy beside it would only be two columns of rows that
    // lead away from what they asked for.
    columns: {
      specialties: usingFacilityTree
        ? null
        : { label: popular ? "Popular specialties" : "Specialties", ...specialties },
      procedures: usingFacilityTree
        ? null
        : {
            label: popular ? "Popular conditions and procedures" : "Conditions and procedures",
            ...procedures,
          },
      people: { label: peopleLabel, ...people },
    },
    // True when nothing at all matched, so the panel can offer a way out
    // instead of showing three empty columns.
    empty: usingFacilityTree
      ? count(people) === 0
      : count(specialties) === 0 && count(procedures) === 0 && count(people) === 0,
  });
}
