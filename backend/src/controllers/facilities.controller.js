import { isDbConfigured } from "../config/db.js";
import { facilities as facilityRepo, reviews as reviewRepo, taxonomy } from "../db/repos.js";
import { matchesLocation, nearestDistanceKm, resolveLocation } from "../lib/geo.js";
import { isOpenAt } from "../lib/facilityFacets.js";
import { gateFacilityProfile } from "../lib/profileGate.js";
import { alertAdminsOfPendingReview } from "./reviews.controller.js";
import {
  buildFacilityWithRelations,
  mockFacilitiesWithRelations,
  facilities as mockFacilities,
  facilityCategoryBranchSlugs,
  addFacilityReview,
  cities as mockCities,
} from "../data/mock.js";

/* ------------------------------------------------------------------ *
 * Facilities
 *
 * The filtering runs in JavaScript in both modes on purpose: the
 * directory of places is small, and one implementation means demo mode
 * and a live database cannot answer the same query differently.
 * ------------------------------------------------------------------ */

/** A category's own slug plus every descendant slug, to any depth. */
function branchSlugsFrom(rows, slug) {
  const root = rows.find((r) => r.slug === slug);
  if (!root) return new Set();
  const out = new Set([root.slug]);
  let frontier = [root.id];
  while (frontier.length) {
    const kids = rows.filter((r) => frontier.includes(r.parentId));
    if (!kids.length) break;
    kids.forEach((k) => out.add(k.slug));
    frontier = kids.map((k) => k.id);
  }
  return out;
}

async function loadFacilities() {
  return isDbConfigured() ? facilityRepo.all() : mockFacilitiesWithRelations;
}

async function branchSlugs(slug) {
  if (!slug) return null;
  return isDbConfigured()
    ? branchSlugsFrom(await taxonomy.facilityCategories(), slug)
    : facilityCategoryBranchSlugs(slug);
}

/**
 * What leaves the server for a place.
 *
 * Two things are stripped unconditionally, exactly as they are for a
 * specialist: the private inbox an enquiry is routed to, and the
 * internal review/verification paperwork. Everything else goes through
 * the plan gate, so a Basic listing's gallery is withheld at the API
 * rather than merely hidden in React.
 */
function serialiseFacility(facility, viewer = "public") {
  const {
    contactEmail,
    contactPhone,
    application,
    verificationHistory,
    userId,
    // Authoring shorthand from the demo dataset — the API contract is
    // `categories`, and shipping both would let a consumer bind to the
    // one that exists in only one of the two modes.
    categorySlugs,
    teamRoles,
    ...rest
  } = facility;
  return gateFacilityProfile(rest, facility, viewer);
}

/** A search-result card. Same withholding, minus the long-form fields. */
function serialiseCard(facility) {
  const { about, reviews, team, ...card } = serialiseFacility(facility);
  return {
    ...card,
    teamCount: team?.length ?? 0,
    // The card shows two or three reviewer voices at most; the full list
    // belongs to the profile.
    reviewSample: (reviews ?? []).slice(0, 1),
  };
}

// GET /api/facilities/featured?limit=4
export async function getFeaturedFacilities(req, res) {
  const limit = Number(req.query.limit) || 4;
  const all = await loadFacilities();
  res.json(
    [...all]
      .sort((a, b) => b.ratingAvg - a.ratingAvg)
      .slice(0, limit)
      .map((f) => serialiseCard(f))
  );
}

// GET /api/facilities/:slug
export async function getFacilityBySlug(req, res) {
  const { slug } = req.params;
  const facility = isDbConfigured()
    ? await facilityRepo.findBySlug(slug)
    : (() => {
        const raw = mockFacilities.find((f) => f.slug === slug);
        return raw ? buildFacilityWithRelations(raw) : null;
      })();
  if (!facility) return res.status(404).json({ error: "Facility not found" });

  // The owner and admins see their own withheld content, marked locked,
  // so the dashboard can preview what an upgrade would publish.
  const viewer =
    req.user?.role === "admin" ? "admin" : req.user?.id && req.user.id === facility.userId ? "owner" : "public";
  res.json(serialiseFacility(facility, viewer));
}

/* ---------------------------------------------------------- searching */

function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const RATING_RANK = { inadequate: 0, requires_improvement: 1, not_rated: 1, good: 2, outstanding: 3 };

// GET /api/facilities/search?type=hospital&category=…&location=…&…
export async function searchFacilities(req, res) {
  const type = req.query.type || "";
  const categorySlug = req.query.category || "";
  const rawLocation = String(req.query.location ?? "").trim();
  const radiusKm = Number(req.query.radiusKm) || 25;

  /* ------------------------------------------------- place-only filters
     A patient choosing a care home is not choosing on "next available
     appointment" or "consultation price" — the specialist filters do not
     translate. These are the questions a place is actually chosen on. */
  const minRating = Number(req.query.minRating) || 0;
  const verifiedOnly = req.query.verified === "true" || req.query.verified === "1";
  const minRegulator = String(req.query.regulatorRating ?? "").trim();
  const amenities = csv(req.query.amenities);
  const openNow = req.query.openNow === "true" || req.query.openNow === "1";
  const emergencyOnly = req.query.emergency === "true" || req.query.emergency === "1";
  const sort = String(req.query.sort ?? "").trim();

  /* ------------------------------------------------------- paging
     This endpoint used to return every match. With eight demo places
     that was invisible; with a directory of several thousand hospitals,
     clinics, pharmacies and care homes it is a multi-megabyte response
     rendered into several thousand DOM nodes, which is a page that
     appears to hang. Paged from the start, on the same contract the
     specialist search already uses, so the two behave alike.

     Both values are clamped rather than trusted: `page=abc` is 1 and
     `pageSize=100000` is 48, so no caller can ask for the whole table. */
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const pageSize = Math.min(48, Math.max(1, Math.floor(Number(req.query.pageSize)) || 12));

  // Same free-text contract as the specialist search: every word has to
  // appear somewhere, so "private hospital birmingham" works.
  const words = String(req.query.q ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1);

  const all = await loadFacilities();
  const targetSlugs = await branchSlugs(categorySlug);

  // Same location contract as the specialist search: a postcode or town
  // becomes coordinates and the filter is a real radius. Both halves of
  // one results page have to answer "near me" the same way, or the same
  // query would mean two different things depending on the tab.
  const cities = isDbConfigured() ? await taxonomy.cities() : mockCities;
  const resolved = await resolveLocation(rawLocation, cities);
  const needle = rawLocation.toLowerCase();
  const now = new Date();

  const matched = all
    .map((f) => {
      // A place has one front door. Its own coordinates are used when it
      // has published them, and the city centroid stands in when it has
      // not — so distance is never silently wrong by a whole city.
      const point = [
        {
          city: f.city,
          postcode: f.postcode,
          lat: f.lat ?? f.city?.lat,
          lng: f.lng ?? f.city?.lng,
        },
      ];
      return { ...f, __point: point, distanceKm: nearestDistanceKm(point, resolved) };
    })
    .filter((f) => {
      const matchesType = !type || f.facilityType === type;
      const matchesCategory = !targetSlugs || f.categories.some((c) => targetSlugs.has(c.slug));
      // Falls back to text when the place name could not be resolved, so
      // an unrecognised town never looks like "nothing exists here".
      const matchesPlace = !rawLocation
        ? true
        : resolved.resolved
          ? matchesLocation(f.__point, resolved, radiusKm)
          : (f.city?.name ?? "").toLowerCase().includes(needle) ||
            (f.postcode ?? "").toLowerCase().includes(needle);
      const haystack = [
        f.name,
        f.tagline,
        f.description,
        f.address,
        f.postcode,
        f.city?.name,
        f.categories.map((c) => c.name).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      const matchesText = words.every((w) => haystack.includes(w));

      const matchesRating = !minRating || (f.ratingCount > 0 && f.ratingAvg >= minRating);
      const matchesVerified = !verifiedOnly || f.verificationStatus === "verified";
      // An unrated place is not filtered out by a regulator floor: a
      // newly registered service has no rating yet, and hiding it would
      // punish it for the regulator's timetable rather than its care.
      const matchesRegulator =
        !minRegulator ||
        !f.regulatorRating ||
        f.regulatorRating === "not_rated" ||
        (RATING_RANK[f.regulatorRating] ?? 0) >= (RATING_RANK[minRegulator] ?? 0);
      const matchesAmenities = amenities.every((a) => (f.amenities ?? []).includes(a));
      const matchesEmergency = !emergencyOnly || f.emergencyDepartment;
      // isOpenAt returns null when hours were never published. Treating
      // that as closed would hide every listing that has not filled the
      // field in yet, so silence keeps the listing in the results.
      const openState = openNow ? isOpenAt(f, now) : null;
      const matchesOpen = !openNow || openState !== false;

      return (
        matchesType &&
        matchesCategory &&
        matchesPlace &&
        matchesText &&
        matchesRating &&
        matchesVerified &&
        matchesRegulator &&
        matchesAmenities &&
        matchesEmergency &&
        matchesOpen
      );
    })
    .sort(comparator(sort));

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Asking for page 40 of a 3-page result gets page 3, not an empty
  // list: a stale link or a filter that just narrowed the results
  // should land somewhere real.
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;

  /* The facets are computed across every match, not just this page —
     otherwise the filter list would change as you paged through, which
     is how a filter that returns nothing gets offered. */
  const categories = new Map();
  const amenityNames = new Set();
  for (const f of matched) {
    for (const c of f.categories ?? []) if (c?.slug) categories.set(c.slug, c.name ?? c.slug);
    for (const a of f.amenities ?? []) amenityNames.add(a);
  }

  res.json({
    results: matched.slice(start, start + pageSize).map(({ __point, ...f }) => serialiseCard(f)),
    total,
    page: current,
    pageSize,
    totalPages,
    facets: {
      categories: [...categories.entries()]
        .map(([slug, name]) => ({ slug, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      amenities: [...amenityNames].sort(),
    },
  });
}

function comparator(sort) {
  if (sort === "rating") {
    return (a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount;
  }
  if (sort === "reviews") {
    return (a, b) => b.ratingCount - a.ratingCount || b.ratingAvg - a.ratingAvg;
  }
  if (sort === "name") {
    return (a, b) => a.name.localeCompare(b.name);
  }
  // Default: nearest first, then best rated — the same default the
  // specialist results use, so switching tabs does not reorder the world.
  return (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.ratingAvg - a.ratingAvg;
}

/* ----------------------------------------------------------- reviews */

// GET /api/facilities/:slug/reviews?page=1&pageSize=10
export async function listFacilityReviews(req, res) {
  const { slug } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));

  let all;
  if (isDbConfigured()) {
    const facility = await facilityRepo.findBySlug(slug);
    if (!facility) return res.status(404).json({ error: "Facility not found" });
    all = await reviewRepo.forSubject("facility", facility.id);
  } else {
    const raw = mockFacilities.find((f) => f.slug === slug);
    if (!raw) return res.status(404).json({ error: "Facility not found" });
    all = buildFacilityWithRelations(raw).reviews;
  }

  res.json({
    results: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
  });
}

// POST /api/facilities/:slug/reviews
export async function createFacilityReview(req, res) {
  const { slug } = req.params;
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }

  const review = {
    rating: Math.round(rating),
    // No "seen for" on a place. reviews.conditionId is a foreign key to
    // the clinical conditions table, and a facility's service categories
    // are a different vocabulary entirely — storing one in the other
    // would break the key and mislabel the review.
    conditionId: null,
    comment: req.body?.comment ? String(req.body.comment).slice(0, 2000) : null,
    patientName: req.body?.patientName ? String(req.body.patientName).slice(0, 120) : null,
    // Never asserted from user input — a review is "verified" only when
    // a booking or invite record backs it.
    verified: false,
    scores: {
      communication: score(req.body?.scores?.communication),
      expertise: score(req.body?.scores?.expertise),
      care: score(req.body?.scores?.care),
      waitTime: score(req.body?.scores?.waitTime),
    },
  };

  // Reviews of places go through the same moderation queue as reviews of
  // people: created pending, invisible and uncounted, with every admin
  // told at once. There is no second, looser path for facilities.
  if (!isDbConfigured()) {
    const raw = mockFacilities.find((f) => f.slug === slug);
    if (!raw) return res.status(404).json({ error: "Facility not found" });
    const stored = addFacilityReview(raw.id, review);
    await alertAdminsOfPendingReview({ review: stored.review, subjectName: raw.name, subjectKind: "listing" });
    return res.status(201).json({
      ok: true,
      demo: true,
      moderationStatus: "pending",
      message: "Thanks — your review has been sent to our team and will appear once it has been checked.",
    });
  }

  const facility = await facilityRepo.findBySlug(slug);
  if (!facility) return res.status(404).json({ error: "Facility not found" });
  const created = await reviewRepo.create({ ...review, subjectType: "facility", subjectId: facility.id });
  await alertAdminsOfPendingReview({ review: created, subjectName: facility.name, subjectKind: "listing" });
  res.status(201).json({
    ok: true,
    moderationStatus: "pending",
    message: "Thanks — your review has been sent to our team and will appear once it has been checked.",
  });
}

function score(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
}
