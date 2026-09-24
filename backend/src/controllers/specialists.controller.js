import { isDbConfigured } from "../config/db.js";
import { siteUrl } from "../lib/urls.js";
import { branchSlugsFor, isKnownTab } from "../lib/searchTabs.js";
import { specialists as specialistRepo, taxonomy as taxonomyRepo } from "../db/repos.js";
import {
  buildSpecialistWithRelations,
  mockSpecialistsWithRelations,
  specialists as mockSpecialists,
  specialties as mockSpecialties,
  cities as mockCities,
} from "../data/mock.js";
import { matchesLocation, nearestDistanceKm, resolveLocation } from "../lib/geo.js";
import { recordProfileView, persistProfileView, classifyReferrer } from "../lib/analytics.js";
import { gateCard, gateProfile } from "../lib/profileGate.js";
import { searchPriorityWeight } from "../lib/plans.js";
import { UK_REGIONS, regionSlug } from "../lib/ukRegions.js";

/* ------------------------------------------------------------------ *
 * There is no serializer here any more. The repositories return rows in
 * the same shape src/data/mock.js builds, so a card, a profile and a
 * search result are assembled by one code path whichever mode the
 * server is running in — which is what stopped the two drifting apart.
 * ------------------------------------------------------------------ */

/**
 * Which listings the public may see.
 *
 * Two states, for two different kinds of listing:
 *
 *  - "verified": somebody here checked this person against their
 *    regulator's register and approved them. They carry the badge.
 *  - "unverified": an unclaimed listing, seeded from public
 *    professional directories before the person ever heard of us. It is
 *    visible so that patients can find them and so they have something
 *    to claim — a directory nobody can find is a directory nobody
 *    claims a listing on — but it carries no badge and is marked
 *    unclaimed on every card and on the profile.
 *
 * What is deliberately NOT here is "pending". Registration creates an
 * application, not a listing, and it lands as "pending": that is the
 * gate that stops anyone publishing themselves into the directory, and
 * it is untouched by the above. Rejected and suspended stay out too.
 *
 * Every public endpoint funnels through this predicate so the rule
 * cannot be enforced in one place and forgotten in another.
 */
const PUBLIC_STATUSES = new Set(["verified", "unverified"]);
const isPubliclyVisible = (s) => PUBLIC_STATUSES.has(s.verificationStatus);

/**
 * Who is asking. The public profile endpoint takes no auth, but when a
 * signed-in specialist views their own page we let their withheld
 * content through so the "this is hidden on your plan" preview is real
 * rather than a mock-up. Everyone else is "public".
 */
function viewerRole(req, specialistId) {
  const user = req.user;
  if (!user) return "public";
  if (user.role === "admin") return "admin";
  const own = String(user.specialistId ?? user.specialist ?? "");
  return own && own === String(specialistId) ? "owner" : "public";
}
export const PUBLIC_QUERY = { verificationStatus: [...PUBLIC_STATUSES] };

// GET /api/specialists/featured?limit=4
export async function getFeaturedSpecialists(req, res) {
  const limit = Number(req.query.limit) || 4;

  if (!isDbConfigured()) {
    return res.json(
      mockSpecialistsWithRelations
        .filter(isPubliclyVisible)
        // Featured placement is a paid position: Premium tiers first,
        // then rating within each tier.
        .sort((a, b) => searchPriorityWeight(b) - searchPriorityWeight(a) || b.ratingAvg - a.ratingAvg)
        .slice(0, limit)
        .map((s) => gateCard(s, s))
    );
  }

  const rows = await specialistRepo.verified();
  const cards = rows.map((s) => gateCard(s, s));
  // Featured placement is a paid position: Premium tiers first, then
  // rating within each tier.
  cards.sort((a, b) => Number(b.priority) - Number(a.priority) || b.ratingAvg - a.ratingAvg);
  res.json(cards.slice(0, limit));
}

// GET /api/specialists/:slug
export async function getSpecialistBySlug(req, res) {
  const { slug } = req.params;

  if (!isDbConfigured()) {
    const specialist = mockSpecialists.find((s) => s.slug === slug);
    // An unapproved profile is a 404 to the public, not a 403: confirming
    // it exists would leak who has applied.
    if (!specialist || !isPubliclyVisible(specialist)) {
      return res.status(404).json({ error: "Specialist not found" });
    }
    recordProfileView(specialist.id);
    const built = buildSpecialistWithRelations(specialist);
    return res.json(gateProfile(built, specialist, viewerRole(req, specialist.id)));
  }

  const specialist = await specialistRepo.findBySlug(slug);
  // An unapproved profile is a 404 to the public, not a 403: confirming
  // it exists would leak who has applied.
  if (!specialist || !isPubliclyVisible(specialist)) {
    return res.status(404).json({ error: "Specialist not found" });
  }
  recordProfileView(specialist.id);
  // Off the response: a slow write here must never be the reason a
  // patient waits longer to see the profile they clicked through to.
  const { referrer, searchTerm } = classifyReferrer(req.get("referer"), siteUrl());
  persistProfileView({ specialistId: specialist.id, referrer, searchTerm, path: req.originalUrl }).catch(() => {});
  res.json(gateProfile(specialist, specialist, viewerRole(req, specialist.id)));
}

/* ------------------------------------------------------------------ *
 * Taxonomy helpers
 *
 * The specialty tree is 3 levels deep (top -> sub -> narrow) and a
 * specialist is tagged only at the narrowest level, never at an
 * ancestor. So a search scoped to any node has to expand to that node
 * plus every descendant beneath it. Both storage modes flatten to the
 * same { id, parentId, slug, name } shape so one implementation serves
 * demo mode and MongoDB alike.
 * ------------------------------------------------------------------ */
async function loadTaxonomy() {
  const source = isDbConfigured() ? await taxonomyRepo.specialties() : mockSpecialties;
  const flat = source.map((s) => ({ id: s.id, parentId: s.parentId ?? null, slug: s.slug, name: s.name }));

  const bySlug = new Map(flat.map((s) => [s.slug, s]));
  const childrenByParent = new Map();
  for (const node of flat) {
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node);
  }

  // A node's own slug plus every descendant slug, walked to any depth so
  // a future 4th tier keeps working without a code change.
  function branchSlugs(slug) {
    const root = bySlug.get(slug);
    if (!root) return new Set();
    const out = new Set([root.slug]);
    let frontier = [root.id];
    while (frontier.length) {
      const kids = frontier.flatMap((id) => childrenByParent.get(id) ?? []);
      if (!kids.length) break;
      kids.forEach((k) => out.add(k.slug));
      frontier = kids.map((k) => k.id);
    }
    return out;
  }

  return {
    flat,
    bySlug,
    branchSlugs,
    childrenOf: (slug) => {
      const parent = bySlug.get(slug);
      return parent ? childrenByParent.get(parent.id) ?? [] : [];
    },
  };
}

async function loadCities() {
  return isDbConfigured() ? taxonomyRepo.cities() : mockCities;
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

// Accepts ?sub=a&sub=b and ?sub=a,b — both are common from checkbox UIs.
function parseList(value) {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const PAGE_SIZE_DEFAULT = 8;
const PAGE_SIZE_MAX = 50;
// A max-price filter parked at (or above) this value means "no upper
// limit" — it's the "£500+" end-stop on the range slider.
export const PRICE_CEILING_MINOR = 50000;

// Whole calendar days from today, so "available today" means today and
// not "within 24 hours" — which is what a patient reads it as.
function daysUntil(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const thenDay = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((thenDay - today) / 86400000);
}

/* ------------------------------------------------------------------ *
 * Free-text search
 *
 * A patient types what they know — "knee replacement", "Whitfield",
 * "Invisalign", "sinus" — not the branch of a taxonomy tree. So every
 * word a profile is findable by is flattened into one haystack, and a
 * query matches when EVERY word in it appears somewhere in that
 * haystack. Words rather than the whole string, so "knee surgeon
 * birmingham" works across three different fields.
 *
 * Where a word matched decides how highly it ranks (see textScore): a
 * hit on the specialist's name beats one buried in their bio.
 * ------------------------------------------------------------------ */

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function searchWords(query) {
  return norm(query).split(" ").filter((w) => w.length > 1);
}

/** Every field a profile can be found by, weighted by how telling it is. */
function searchFields(s) {
  return {
    name: norm(`${s.fullName} ${s.title ?? ""}`),
    specialty: norm(s.specialties.map((x) => x.name).join(" ")),
    treatment: norm(s.treatments.map((x) => x.name).join(" ")),
    condition: norm(s.conditions.map((x) => x.name).join(" ")),
    place: norm(
      s.clinicLocations.map((l) => `${l.clinic?.name ?? ""} ${l.city?.name ?? ""} ${l.postcode ?? ""}`).join(" ")
    ),
    bio: norm(s.bio),
  };
}

// Which field a word hit in, and what that is worth.
const FIELD_WEIGHT = { name: 30, specialty: 20, treatment: 18, condition: 16, place: 8, bio: 4 };

function textScore(s, words) {
  if (words.length === 0) return 0;
  const fields = s.__fields ?? (s.__fields = searchFields(s));
  let score = 0;
  for (const word of words) {
    let best = 0;
    for (const [field, text] of Object.entries(fields)) {
      if (!text.includes(word)) continue;
      // A whole-word hit is worth more than a hit inside a longer word,
      // so "ent" ranks the ENT surgeon above every "treatment".
      const whole = new RegExp(`\\b${word}\\b`).test(text);
      best = Math.max(best, FIELD_WEIGHT[field] * (whole ? 1 : 0.45));
    }
    score += best;
  }
  return score;
}

function matchesText(s, words) {
  if (words.length === 0) return true;
  const fields = s.__fields ?? (s.__fields = searchFields(s));
  const haystack = Object.values(fields).join(" ");
  return words.every((word) => haystack.includes(word));
}

// Each filter is its own predicate so facet counts can re-run the whole
// set minus one dimension (see buildFacets) — that's what keeps the
// counts beside each checkbox honest as other filters change.
function buildPredicates(filters, taxonomy) {
  const specialtyBranch = filters.specialty ? taxonomy.branchSlugs(filters.specialty) : null;
  const subBranches = filters.subspecialties.map((slug) => taxonomy.branchSlugs(slug));
  // Expert Witness only -- the leaf (practice area) level under
  // Medicolegal. See buildFacets for why this is a separate dimension
  // from `subspecialty` rather than reusing it.
  const practiceAreaBranches = filters.practiceAreas.map((slug) => taxonomy.branchSlugs(slug));
  // The group narrows to the tab's branches. It sits alongside
  // `specialty` rather than replacing it: a patient can be on the
  // Specialist Doctors tab AND filtered to Orthopaedics, and both have
  // to hold.
  const groupBranch = filters.group ? branchSlugsFor(filters.group, taxonomy.flat) : null;

  const words = searchWords(filters.q);

  return {
    text: (s) => matchesText(s, words),
    group: (s) => !groupBranch || s.specialties.some((sp) => groupBranch.has(sp.slug)),
    specialty: (s) => !specialtyBranch || s.specialties.some((sp) => specialtyBranch.has(sp.slug)),
    // OR across ticked sub-specialties, which is how faceted checkbox
    // lists are expected to behave (ticking more shows more, not fewer).
    subspecialty: (s) =>
      subBranches.length === 0 || subBranches.some((branch) => s.specialties.some((sp) => branch.has(sp.slug))),
    practiceArea: (s) =>
      practiceAreaBranches.length === 0 ||
      practiceAreaBranches.some((branch) => s.specialties.some((sp) => branch.has(sp.slug))),
    location: (s) => matchesLocation(s.clinicLocations, filters.resolvedLocation, filters.radiusKm),
    region: (s) => !filters.region || (s.coveredRegions ?? []).includes(filters.region),
    rating: (s) => filters.minRating == null || s.ratingAvg >= filters.minRating,
    price: (s) => {
      const noFloor = filters.minPriceMinor == null;
      const noCeiling = filters.maxPriceMinor == null || filters.maxPriceMinor >= PRICE_CEILING_MINOR;
      if (noFloor && noCeiling) return true;
      // A profile with no published price can't be judged against a price
      // filter, so it drops out only while that filter is active.
      if (s.consultationPriceMinor == null) return false;
      if (!noFloor && s.consultationPriceMinor < filters.minPriceMinor) return false;
      if (!noCeiling && s.consultationPriceMinor > filters.maxPriceMinor) return false;
      return true;
    },
    verified: (s) => !filters.verifiedOnly || s.verificationStatus === "verified",
    availability: (s) => {
      if (filters.availableWithinDays == null) return true;
      const d = daysUntil(s.nextAvailableAt);
      return d != null && d <= filters.availableWithinDays;
    },
  };
}

function applyAllExcept(list, predicates, skipKey) {
  return list.filter((s) =>
    Object.entries(predicates).every(([key, fn]) => (key === skipKey ? true : fn(s)))
  );
}

/* ------------------------------------------------------------------ *
 * Facets — the counts shown next to each filter option. Each dimension
 * is counted against the set with every OTHER filter applied, so ticking
 * one box never zeroes out its siblings.
 * ------------------------------------------------------------------ */
function buildFacets(all, predicates, filters, taxonomy) {
  const forSub = applyAllExcept(all, predicates, "subspecialty");
  const forLocation = applyAllExcept(all, predicates, "location");
  const forRating = applyAllExcept(all, predicates, "rating");
  const forPrice = applyAllExcept(all, predicates, "price");
  const forAvailability = applyAllExcept(all, predicates, "availability");
  const forVerified = applyAllExcept(all, predicates, "verified");
  const forRegion = applyAllExcept(all, predicates, "region");
  const forPracticeArea = applyAllExcept(all, predicates, "practiceArea");

  // Expert Witness only -- every other category has never had a
  // coveredRegions value to filter on, so the dropdown stays empty
  // (and hidden) rather than offering 13 regions that always read 0.
  const regions =
    filters.specialty === "expert-witness"
      ? UK_REGIONS.map((name) => ({
          slug: regionSlug(name),
          name,
          count: forRegion.filter((s) => (s.coveredRegions ?? []).includes(name)).length,
        }))
      : [];

  // Expert Witness only -- the law-specific practice areas under
  // Medicolegal (Personal Injury, Clinical Negligence, ...). This is a
  // real search, arrived at by clicking Expert Witnesses from the
  // homepage, not the generic directory -- so it gets its own filter at
  // the leaf level rather than making do with the single, always-one-
  // option "Medicolegal" sub-specialty checkbox. Hidden (like `regions`)
  // until there's a tagged specialist to count.
  const practiceAreas =
    filters.specialty === "expert-witness"
      ? taxonomy.childrenOf("expert-witness-medicolegal").map((leaf) => {
          const branch = taxonomy.branchSlugs(leaf.slug);
          return {
            slug: leaf.slug,
            name: leaf.name,
            count: forPracticeArea.filter((s) => s.specialties.some((sp) => branch.has(sp.slug))).length,
          };
        })
      : [];

  const subOptions = filters.specialty ? taxonomy.childrenOf(filters.specialty) : [];
  const subspecialties = subOptions.map((child) => {
    const branch = taxonomy.branchSlugs(child.slug);
    return {
      slug: child.slug,
      name: child.name,
      count: forSub.filter((s) => s.specialties.some((sp) => branch.has(sp.slug))).length,
    };
  });

  const cityCounts = new Map();
  for (const s of forLocation) {
    for (const l of s.clinicLocations) {
      // `city` is looked up from a map, so a row whose city is missing
      // comes through as null even though the column is NOT NULL. That
      // location simply does not contribute a facet count — it must not
      // take the whole search response down with it.
      if (!l.city?.slug) continue;
      const key = l.city.slug;
      if (!cityCounts.has(key)) cityCounts.set(key, { slug: key, name: l.city.name, count: 0 });
      cityCounts.get(key).count += 1;
    }
  }

  const prices = forPrice.map((s) => s.consultationPriceMinor).filter((p) => p != null);

  return {
    subspecialties,
    regions,
    practiceAreas,
    cities: [...cityCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    availability: [
      { days: 0, label: "Available today", count: forAvailability.filter((s) => (daysUntil(s.nextAvailableAt) ?? Infinity) <= 0).length },
      { days: 7, label: "Within 7 days", count: forAvailability.filter((s) => (daysUntil(s.nextAvailableAt) ?? Infinity) <= 7).length },
      { days: 14, label: "Within 14 days", count: forAvailability.filter((s) => (daysUntil(s.nextAvailableAt) ?? Infinity) <= 14).length },
      { days: 30, label: "Within 30 days", count: forAvailability.filter((s) => (daysUntil(s.nextAvailableAt) ?? Infinity) <= 30).length },
    ],
    ratings: [
      { min: 4.5, count: forRating.filter((s) => s.ratingAvg >= 4.5).length },
      { min: 4, count: forRating.filter((s) => s.ratingAvg >= 4).length },
      { min: 3, count: forRating.filter((s) => s.ratingAvg >= 3).length },
    ],
    verified: forVerified.filter((s) => s.verificationStatus === "verified").length,
    price: {
      minMinor: prices.length ? Math.min(...prices) : null,
      maxMinor: prices.length ? Math.max(...prices) : null,
      ceilingMinor: PRICE_CEILING_MINOR,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Why this specialist? — built from the filters that actually matched,
 * never a fixed sentence, so the explainer stays true as filters change.
 * ------------------------------------------------------------------ */
function matchReasons(s, filters, taxonomy) {
  const reasons = [];

  const deepest = filters.subspecialties[0] ?? filters.specialty;
  if (deepest) {
    const branch = taxonomy.branchSlugs(deepest);
    const hit = s.specialties.find((sp) => branch.has(sp.slug));
    if (hit) reasons.push({ type: "specialty", label: `Specialises in ${hit.name}` });
  }

  if (filters.resolvedLocation?.query) {
    const here = s.clinicLocations[0];
    const km = s.distanceKm;
    // Without a distance and without a city there is nothing true to
    // say about where they are, so no reason is offered rather than a
    // half-written one.
    if (km != null) {
      reasons.push({
        type: "location",
        label: `${km < 1 ? "Under 1" : Math.round(km)} km from ${filters.resolvedLocation.label}`,
      });
    } else if (here?.city?.name) {
      reasons.push({ type: "location", label: `Practises in ${here.city.name}` });
    }
  }

  if (s.verificationStatus === "verified") {
    reasons.push({ type: "verification", label: "Checked against a real regulator record" });
  }

  if (s.ratingCount > 0 && s.ratingAvg >= 4.5) {
    reasons.push({ type: "rating", label: `Rated ${s.ratingAvg.toFixed(1)} across ${s.ratingCount} reviews` });
  }

  const d = daysUntil(s.nextAvailableAt);
  if (d != null && d <= 7) {
    reasons.push({ type: "availability", label: d <= 0 ? "Available today" : d === 1 ? "Available tomorrow" : `Available in ${d} days` });
  }

  return reasons;
}

const SORTS = {
  "best-match": (a, b) => b.__score - a.__score,
  rating: (a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount,
  reviews: (a, b) => b.ratingCount - a.ratingCount,
  "price-asc": (a, b) => (a.consultationPriceMinor ?? Infinity) - (b.consultationPriceMinor ?? Infinity),
  "price-desc": (a, b) => (b.consultationPriceMinor ?? -Infinity) - (a.consultationPriceMinor ?? -Infinity),
  availability: (a, b) => (daysUntil(a.nextAvailableAt) ?? Infinity) - (daysUntil(b.nextAvailableAt) ?? Infinity),
  distance: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
};

// Deterministic relevance score: how precisely the specialist matches the
// requested specialty, then proximity, verification, rating and how soon
// they can be seen. No randomness — the same query always ranks the same.
function relevanceScore(s, filters, taxonomy) {
  let score = 0;

  // A typed query dominates the ranking — someone who typed a name
  // wants that person first, not the highest-rated profile nearby.
  score += textScore(s, searchWords(filters.q)) * 2;

  const deepest = filters.subspecialties[0] ?? filters.specialty;
  if (deepest) {
    const exact = s.specialties.some((sp) => sp.slug === deepest);
    const inBranch = s.specialties.some((sp) => taxonomy.branchSlugs(deepest).has(sp.slug));
    score += exact ? 40 : inBranch ? 25 : 0;
  }

  if (s.distanceKm != null) score += Math.max(0, 20 - s.distanceKm / 5);
  else if (filters.resolvedLocation?.query) score += 5;

  if (s.verificationStatus === "verified") score += 10;
  score += s.ratingAvg * 2;
  score += Math.min(s.ratingCount, 100) / 50;

  const d = daysUntil(s.nextAvailableAt);
  if (d != null) score += Math.max(0, 8 - d / 3);

  return score;
}

/**
 * GET /api/specialists/search
 *
 * Query params:
 *   q                    free text — a name, specialty, treatment,
 *                        condition, clinic or town
 *   specialty            top-level slug
 *   subspecialty         repeatable (or comma-separated) — any depth
 *   location             free text; resolved via lib/geo.js
 *   radiusKm             search radius once a location resolves to coords
 *   minRating            e.g. 4
 *   minPrice / maxPrice  in minor units (pence)
 *   verifiedOnly         "true"
 *   availableWithinDays  0 | 7 | 14 | 30
 *   sort                 best-match | rating | reviews | price-asc |
 *                        price-desc | availability | distance
 *   page, pageSize
 *
 * Responds with an envelope: results plus the total, page info, facet
 * counts and the resolved location — everything the results page needs
 * to render its header, sidebar counts and pagination in one round trip.
 */
export async function searchSpecialists(req, res) {
  const taxonomy = await loadTaxonomy();
  const cities = await loadCities();

  const resolvedLocation = await resolveLocation(req.query.location ?? "", cities);

  const filters = {
    q: (req.query.q ?? "").toString().trim(),
    /* Which tab the search came from. A group is a set of ROOT
       specialties — "specialist-doctors" means every root that the
       physiotherapy, dentistry and aesthetics tabs do not claim — so a
       bare search launched from a tab returns that tab's directory
       rather than the whole of it. Unknown values are ignored rather
       than returning nothing, because a stale bookmark should widen the
       search, never empty it. */
    group: isKnownTab(req.query.group) ? String(req.query.group) : "",
    specialty: req.query.specialty || "",
    subspecialties: parseList(req.query.subspecialty),
    // Expert Witness only -- see lib/ukRegions.js. Ignored by the
    // predicate below for every other category, same as a stray
    // subspecialty slug from another branch would be.
    region: req.query.region || "",
    // Expert Witness only -- see buildFacets. Same parsing as
    // `subspecialty`: repeatable or comma-separated.
    practiceAreas: parseList(req.query.practiceArea),
    resolvedLocation,
    radiusKm: parseNumber(req.query.radiusKm, 25),
    minRating: parseNumber(req.query.minRating),
    minPriceMinor: parseNumber(req.query.minPrice),
    maxPriceMinor: parseNumber(req.query.maxPrice),
    verifiedOnly: String(req.query.verifiedOnly) === "true",
    availableWithinDays: parseNumber(req.query.availableWithinDays),
    sort: SORTS[req.query.sort] ? req.query.sort : "best-match",
    page: Math.max(1, parseNumber(req.query.page, 1) ?? 1),
    pageSize: Math.min(PAGE_SIZE_MAX, Math.max(1, parseNumber(req.query.pageSize, PAGE_SIZE_DEFAULT) ?? PAGE_SIZE_DEFAULT)),
  };

  // Candidate set: every publicly visible specialist. The predicates
  // below then run identically in both modes, which is what stops demo
  // mode and a live database drifting apart in behaviour. Deliberately
  // NOT narrowed by the ticked sub-specialties — the facet counts beside
  // those checkboxes are computed from this same set, and pre-filtering
  // by a ticked box would zero out its siblings. If the directory grows
  // past a few thousand profiles, push the cheap predicates (rating,
  // price, verified) down into SQL in db/repos.js.
  let candidates = isDbConfigured()
    ? await specialistRepo.verified()
    : mockSpecialistsWithRelations.filter(isPubliclyVisible);

  // Distance is needed by the location filter, the sort and the card, so
  // it's computed once up front.
  candidates = candidates.map((s) => ({
    ...s,
    distanceKm: nearestDistanceKm(s.clinicLocations, resolvedLocation),
  }));

  const predicates = buildPredicates(filters, taxonomy);
  const matched = candidates.filter((s) => Object.values(predicates).every((fn) => fn(s)));

  const scored = matched.map((s) => ({ ...s, __score: relevanceScore(s, filters, taxonomy) }));
  // Paid placement applies to every sort mode except the ones the
  // patient explicitly chose to order by a number (price, distance,
  // availability) — buying a plan must not misrepresent "cheapest first".
  const PRIORITY_APPLIES = new Set(["best-match", "rating", "reviews"]);
  const base = SORTS[filters.sort];
  scored.sort(
    PRIORITY_APPLIES.has(filters.sort)
      ? (a, b) => searchPriorityWeight(b) - searchPriorityWeight(a) || base(a, b)
      : base
  );

  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const start = (page - 1) * filters.pageSize;

  const results = scored.slice(start, start + filters.pageSize).map(({ __score, __fields, ...s }) => ({
    ...gateCard(s, s),
    matchReasons: matchReasons(s, filters, taxonomy),
  }));

  res.json({
    results,
    total,
    page,
    pageSize: filters.pageSize,
    totalPages,
    location: {
      query: resolvedLocation.query,
      label: resolvedLocation.label,
      lat: resolvedLocation.lat,
      lng: resolvedLocation.lng,
      source: resolvedLocation.source,
      resolved: resolvedLocation.resolved,
      radiusKm: filters.radiusKm,
    },
    q: filters.q,
    specialty: filters.specialty ? taxonomy.bySlug.get(filters.specialty) ?? null : null,
    subspecialties: filters.subspecialties.map((slug) => taxonomy.bySlug.get(slug) ?? { slug, name: slug }),
    facets: buildFacets(candidates, predicates, filters, taxonomy),
    sort: filters.sort,
  });
}
