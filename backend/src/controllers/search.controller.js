import { isDbConfigured } from "../config/db.js";
import { facilities as facilityRepo, specialists as specialistRepo, taxonomy } from "../db/repos.js";
import { tabFor, branchIdsFor, rootSlugsFor } from "../lib/searchTabs.js";
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

// GET /api/search/panel?q=cardio&type=specialist-doctors
export async function searchPanel(req, res) {
  const type = tabFor(req.query.type);
  const typeKey = type.key;
  const raw = String(req.query.q ?? "");
  const needle = norm(raw);
  const popular = needle.length < 2;

  const data = await loadAll();
  const specialtyById = new Map(data.specialties.map((s) => [s.id, s]));

  /* ----------------------------------------------------- tab scoping
     The tab is the subject of the whole panel, not a filter on its last
     column. Standing on Physiotherapists, a patient should not be
     offered Cardiology, a cardiologist, or a pharmacy — every column
     here is therefore narrowed to the branches this tab covers before
     anything is ranked.

     `branchIds` is null on a facility tab, where there is no specialty
     branch to speak of: those tabs show places and nothing else. */
  const branchIds = branchIdsFor(typeKey, data.specialties);

  /** The people this tab is about — the pool every column is drawn from. */
  const tabSpecialists =
    type.kind === "specialist" && branchIds
      ? data.specialists.filter((s) => (s.specialties ?? []).some((sp) => branchIds.has(sp.id)))
      : type.kind === "specialist"
        ? data.specialists
        : [];

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
  for (const sp of tabSpecialists) {
    for (const node of sp.specialties ?? []) {
      let cur = specialtyById.get(node.id);
      const guard = new Set();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        // Walking up from a leaf would otherwise climb out of the tab:
        // a dental implant leads to "Dentistry", which has no business
        // on the Specialist Doctors tab.
        if (!branchIds || branchIds.has(cur.id)) liveSpecialtyIds.add(cur.id);
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

  const inTab = branchIds ? tree.filter((n) => branchIds.has(n.id)) : tree;
  const reachable = inTab.filter((n) => liveSpecialtyIds.has(n.id));
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
  // Reachability is already computed from this tab's people only, so a
  // procedure survives here exactly when somebody on this tab performs
  // it. The branch test is belt-and-braces for a row whose specialtyId
  // sits outside the tab while a tagged practitioner sits inside it.
  const inTabTaxon = (row) => !branchIds || !row.specialtyId || branchIds.has(row.specialtyId);
  const procedureSource = [
    ...data.treatments
      .filter((t) => liveTreatmentIds.has(t.id) && inTabTaxon(t))
      .map((t) => ({ ...t, kind: "treatment" })),
    ...data.conditions
      .filter((c) => liveConditionIds.has(c.id) && inTabTaxon(c))
      .map((c) => ({ ...c, kind: "condition" })),
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
    // Already narrowed to this tab's branches by `tabSpecialists`, which
    // every column shares — so a dentist cannot appear under Aesthetics
    // however the panel is ranked.
    const pool = tabSpecialists;
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

  /* The horizontal strip above the bar: the top level of whichever tree
     this tab uses, always present regardless of what has been typed, so
     there is a way in that needs no typing at all.

     Scoped to the tab like everything else. Under a places tab the roots
     are derived from the listings of THIS type rather than from the whole
     facility tree — which is five roots covering hospitals, clinics, care
     homes and pharmacies, so an unscoped strip offered "Care Homes" to
     somebody standing on Pharmacies. Under a specialist tab it is the
     tab's own roots: Physiotherapists offers Physiotherapy, not
     Gynaecology. */
  let topCategories = [];
  if (usingFacilityTree) {
    const categoryById = new Map(data.facilityCategories.map((c) => [c.id, c]));
    const rootOf = (id) => {
      let node = categoryById.get(id);
      const guard = new Set();
      while (node?.parentId && !guard.has(node.id)) {
        guard.add(node.id);
        node = categoryById.get(node.parentId);
      }
      return node ?? null;
    };
    const roots = new Map();
    for (const f of data.facilities) {
      if (f.facilityType !== type.facilityType) continue;
      for (const cat of f.categories ?? []) {
        const root = rootOf(cat.id);
        if (root && !roots.has(root.id)) roots.set(root.id, root);
      }
    }
    topCategories = [...roots.values()].map((n) => ({
      label: n.name,
      slug: n.slug,
      // One results page for everything: the strip under a places tab
      // has to land on /search with the tab preselected, not on the old
      // /facilities route, which now only redirects and would drop the
      // category on the way.
      href: `/search?type=${type.facilityType}&category=${n.slug}`,
    }));
  } else {
    const roots = rootSlugsFor(typeKey, data.specialties);
    topCategories = data.specialties
      .filter((n) => !n.parentId && (!roots || roots.has(n.slug)) && liveSpecialtyIds.has(n.id))
      .map((n) => ({
        label: n.name,
        slug: n.slug,
        href: `/search?specialty=${n.slug}`,
      }));
  }

  res.json({
    q: raw,
    type: typeKey,
    kind: type.kind,
    /* What a bare search on this tab means to the results page: a group
       of root specialties, or one facility type. The UI builds its URL
       from these rather than keeping its own copy of the mapping. */
    group: type.kind === "specialist" ? typeKey : null,
    facilityType: type.facilityType ?? null,
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
