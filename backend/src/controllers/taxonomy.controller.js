import { isDbConfigured } from "../config/db.js";
import { taxonomy } from "../db/repos.js";
import {
  cities as mockCities,
  specialties as mockSpecialties,
  subspecialtiesOf,
  topLevelSpecialties,
  facilityCategories as mockFacilityCategories,
  facilityCategoryChildrenOf,
  topLevelFacilityCategories,
} from "../data/mock.js";

/* ------------------------------------------------------------------ *
 * Taxonomy
 *
 * The rows come back from Postgres already in the { id, parentId, slug,
 * name } shape the demo data uses, so there is nothing to serialise —
 * both modes return the same objects and the frontend cannot tell which
 * one served the request.
 * ------------------------------------------------------------------ */

const topLevel = (rows) => rows.filter((r) => !r.parentId);

function childrenOf(rows, slug) {
  const parent = rows.find((r) => r.slug === slug && !r.parentId);
  return parent ? rows.filter((r) => r.parentId === parent.id) : [];
}

// GET /api/specialties — full flat tree (top-level + subspecialties).
// The frontend SearchBar filters this in-browser to build the chained
// specialty -> sub-specialty dropdowns, so the whole tree travels once
// rather than a request per selection.
export async function getAllSpecialties(req, res) {
  if (!isDbConfigured()) return res.json(mockSpecialties);
  res.json(await taxonomy.specialties());
}

// GET /api/specialties/top-level
export async function getTopLevelSpecialties(req, res) {
  if (!isDbConfigured()) return res.json(topLevelSpecialties);
  res.json(topLevel(await taxonomy.specialties()));
}

// GET /api/specialties/:slug/subspecialties
export async function getSubspecialties(req, res) {
  if (!isDbConfigured()) return res.json(subspecialtiesOf(req.params.slug));
  res.json(childrenOf(await taxonomy.specialties(), req.params.slug));
}

// GET /api/cities
export async function getCities(req, res) {
  if (!isDbConfigured()) return res.json(mockCities);
  res.json(await taxonomy.cities());
}

// GET /api/facility-categories — full flat tree (Hospital Care, Care
// Homes, Pharmacy, Clinics, Hospitals and everything beneath them).
export async function getAllFacilityCategories(req, res) {
  if (!isDbConfigured()) return res.json(mockFacilityCategories);
  res.json(await taxonomy.facilityCategories());
}

// GET /api/facility-categories/top-level
export async function getTopLevelFacilityCategories(req, res) {
  if (!isDbConfigured()) return res.json(topLevelFacilityCategories);
  res.json(topLevel(await taxonomy.facilityCategories()));
}

// GET /api/facility-categories/:slug/children
export async function getFacilityCategoryChildren(req, res) {
  if (!isDbConfigured()) return res.json(facilityCategoryChildrenOf(req.params.slug));
  res.json(childrenOf(await taxonomy.facilityCategories(), req.params.slug));
}
