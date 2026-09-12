/* ------------------------------------------------------------------ *
 * The search tabs
 *
 * One definition of what the tabs above the search box mean, read by
 * both the suggestion panel (search.controller.js) and the results page
 * (specialists.controller.js). They used to be defined in the panel
 * alone, which is how the panel could offer a clinic to somebody
 * standing on a doctors tab: the tab scoped the third column and
 * nothing else.
 *
 * Two kinds of tab, and the distinction matters because they search
 * different tables:
 *
 *   specialist — a person. Scoped to a set of ROOT specialties.
 *   facility   — a place. Scoped to one facility type.
 *
 * The doctors tab is deliberately defined by subtraction: every root
 * specialty that no other tab claims. Add "Podiatry" to the taxonomy
 * tomorrow and it appears under Specialist Doctors without anybody
 * editing this file — whereas a hard-coded include list would silently
 * hide it, which is the bug this shape exists to prevent.
 * ------------------------------------------------------------------ */

/** Root specialty slugs that have a tab of their own. */
const CLAIMED_ROOTS = ["physiotherapy", "dentistry", "aesthetics-specialists"];

export const SEARCH_TABS = [
  {
    key: "specialist-doctors",
    label: "Specialist Doctors",
    plural: "Specialist doctors",
    kind: "specialist",
    /** null = every root the other specialist tabs do not claim. */
    roots: null,
    placeholder: "Search a consultant, specialty, treatment or condition",
  },
  {
    key: "physiotherapists",
    label: "Physiotherapists",
    plural: "Physiotherapists",
    kind: "specialist",
    roots: ["physiotherapy"],
    placeholder: "Search a physiotherapist, injury or treatment",
  },
  {
    key: "dentists",
    label: "Dentists",
    plural: "Dentists",
    kind: "specialist",
    roots: ["dentistry"],
    placeholder: "Search a dentist, treatment or condition",
  },
  {
    key: "aesthetics",
    label: "Aesthetics",
    plural: "Aesthetic practitioners",
    kind: "specialist",
    roots: ["aesthetics-specialists"],
    placeholder: "Search a practitioner or aesthetic treatment",
  },
  {
    key: "clinics",
    label: "Clinics",
    plural: "Clinics",
    kind: "facility",
    facilityType: "clinic",
    placeholder: "Search for a clinic by name",
  },
  {
    key: "hospitals",
    label: "Hospitals",
    plural: "Hospitals",
    kind: "facility",
    facilityType: "hospital",
    placeholder: "Search for a hospital by name",
  },
  {
    key: "care-homes",
    label: "Care Homes",
    plural: "Care homes",
    kind: "facility",
    facilityType: "care_home",
    placeholder: "Search for a care home by name",
  },
  {
    key: "pharmacies",
    label: "Pharmacies",
    plural: "Pharmacies",
    kind: "facility",
    facilityType: "pharmacy",
    placeholder: "Search for a pharmacy by name",
  },
];

export const DEFAULT_TAB = "specialist-doctors";

/**
 * Links, bookmarks and the smoke suite still carry the old six keys.
 * They resolve rather than 404 into the default tab, because a shared
 * link landing on the wrong directory is worse than a redirect.
 */
const ALIASES = {
  doctor: "specialist-doctors",
  doctors: "specialist-doctors",
  dentist: "dentists",
  physiotherapist: "physiotherapists",
  physiotherapy: "physiotherapists",
  practice: "clinics",
  practices: "clinics",
  clinic: "clinics",
  hospital: "hospitals",
  "care-home": "care-homes",
  carehome: "care-homes",
  carehomes: "care-homes",
  pharmacy: "pharmacies",
};

const BY_KEY = new Map(SEARCH_TABS.map((t) => [t.key, t]));

/** The tab for a key, an alias, or the default. Never null. */
export function tabFor(key) {
  const raw = String(key ?? "").trim().toLowerCase();
  return BY_KEY.get(raw) ?? BY_KEY.get(ALIASES[raw]) ?? BY_KEY.get(DEFAULT_TAB);
}

/** True when the key names a tab we know, alias included. */
export function isKnownTab(key) {
  const raw = String(key ?? "").trim().toLowerCase();
  return BY_KEY.has(raw) || Boolean(ALIASES[raw]);
}

/**
 * The root specialty slugs a specialist tab covers.
 *
 * `specialties` is the flat taxonomy; only its roots are consulted. For
 * the doctors tab this is every root minus the claimed ones, so a new
 * medical root joins it automatically.
 *
 * Returns null for a facility tab — there is nothing specialty-shaped
 * to scope.
 */
export function rootSlugsFor(tabKey, specialties = []) {
  const tab = tabFor(tabKey);
  if (tab.kind !== "specialist") return null;

  if (tab.roots) return new Set(tab.roots);

  const roots = specialties.filter((s) => !s.parentId).map((s) => s.slug);
  const claimed = new Set(CLAIMED_ROOTS);
  const rest = roots.filter((slug) => !claimed.has(slug));
  // A taxonomy consisting only of claimed roots would otherwise leave
  // the doctors tab matching everything, which is the opposite of what
  // an empty set means.
  return new Set(rest);
}

/** Every slug in the branches a tab covers, to any depth. */
export function branchSlugsFor(tabKey, specialties = []) {
  const roots = rootSlugsFor(tabKey, specialties);
  if (!roots) return null;

  const byId = new Map(specialties.map((s) => [s.id, s]));
  const childrenByParent = new Map();
  for (const node of specialties) {
    const list = childrenByParent.get(node.parentId ?? null) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId ?? null, list);
  }

  const out = new Set();
  let frontier = specialties.filter((s) => !s.parentId && roots.has(s.slug));
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      if (out.has(node.slug)) continue;
      out.add(node.slug);
      next.push(...(childrenByParent.get(node.id) ?? []));
    }
    frontier = next;
  }
  // Silences the unused-variable lint while documenting the intent: the
  // map is the index a deeper walk would use.
  void byId;
  return out;
}

/** The same, as ids rather than slugs — what row filtering needs. */
export function branchIdsFor(tabKey, specialties = []) {
  const slugs = branchSlugsFor(tabKey, specialties);
  if (!slugs) return null;
  return new Set(specialties.filter((s) => slugs.has(s.slug)).map((s) => s.id));
}

/** What the public API advertises, so the UI never hard-codes the list. */
export function publicTabs() {
  return SEARCH_TABS.map(({ key, label, plural, kind, facilityType = null }) => ({
    key,
    label,
    plural,
    kind,
    facilityType,
  }));
}
