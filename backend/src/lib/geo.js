// Location resolution + distance maths.
//
// This module is the ONLY place where a free-text location ("London",
// "B3 2QD", "near Solihull") becomes coordinates. Everything downstream
// — the search filter, the distance shown on a result, a future map view
// — works off the resolved `{ lat, lng }`, never off the raw string.
//
// Today `resolveLocation` matches against the city table, which already
// carries lat/lng, so radius filtering genuinely works right now at city
// granularity. To go live with a real geocoder (Google Places, Mapbox,
// Ordnance Survey postcode lookup), call `setGeocoder()` once at startup:
//
//   import { setGeocoder } from "./lib/geo.js";
//   setGeocoder(async (query) => {
//     const r = await fetch(`https://maps.googleapis.com/…&address=${query}&key=${process.env.MAPS_API_KEY}`);
//     const { results } = await r.json();
//     const hit = results[0];
//     return hit ? { name: hit.formatted_address, lat: hit.geometry.location.lat, lng: hit.geometry.location.lng } : null;
//   });
//
// Nothing else in the codebase changes: postcodes and neighbourhoods
// start resolving, and the existing radius filter picks them up. The city
// table stays as the offline fallback when the geocoder misses or errors.

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance between two {lat, lng} points, in kilometres.
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

let geocoder = null;

// Register a real geocoding function: async (query) => { name, lat, lng } | null
export function setGeocoder(fn) {
  geocoder = fn;
}

export function hasGeocoder() {
  return typeof geocoder === "function";
}

/**
 * Ask the geocoder directly, without the city-table fallback that
 * resolveLocation wraps it in.
 *
 * The importer wants exactly this: a postcode turned into real
 * coordinates and the district it sits in, or nothing. Falling back to
 * a city-table guess would be worse than nothing there, because it
 * would silently pin a hundred imported addresses on the same point.
 */
export async function geocode(query) {
  if (!hasGeocoder()) return null;
  try {
    return await geocoder(String(query));
  } catch {
    return null;
  }
}

function matchCity(query, cities) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  // Exact slug/name first, then a prefix/contains match so "lond" works.
  return (
    cities.find((c) => c.slug === needle || c.name.toLowerCase() === needle) ??
    cities.find((c) => c.name.toLowerCase().startsWith(needle)) ??
    cities.find((c) => c.name.toLowerCase().includes(needle) || (c.region ?? "").toLowerCase().includes(needle)) ??
    null
  );
}

/**
 * Turn a raw location string into something searchable.
 *
 * Returns { query, label, lat, lng, cityId, source, resolved } where
 * `source` is "city-table" | "geocoder" | "unresolved". A caller that
 * gets `resolved: false` should fall back to text matching rather than
 * silently returning nothing — an unrecognised place name must never
 * look like "no specialists exist here".
 */
export async function resolveLocation(query, cities) {
  const raw = (query ?? "").trim();
  if (!raw) return { query: "", label: null, lat: null, lng: null, cityId: null, source: "none", resolved: false };

  const city = matchCity(raw, cities);
  if (city) {
    return {
      query: raw,
      label: city.name,
      lat: city.lat ?? null,
      lng: city.lng ?? null,
      cityId: city.id ?? String(city._id ?? ""),
      source: "city-table",
      resolved: true,
    };
  }

  if (geocoder) {
    try {
      const hit = await geocoder(raw);
      if (hit && hit.lat != null && hit.lng != null) {
        return {
          query: raw,
          label: hit.name ?? raw,
          lat: hit.lat,
          lng: hit.lng,
          cityId: null,
          source: "geocoder",
          resolved: true,
        };
      }
    } catch {
      // A geocoder outage must not take search down — fall through to
      // plain text matching below.
    }
  }

  return { query: raw, label: raw, lat: null, lng: null, cityId: null, source: "unresolved", resolved: false };
}

// Shortest distance from a resolved location to any of a specialist's
// clinic locations, or null when either side lacks coordinates.
export function nearestDistanceKm(clinicLocations, resolved) {
  if (!resolved || resolved.lat == null) return null;
  const distances = (clinicLocations ?? [])
    .map((l) => distanceKm({ lat: resolved.lat, lng: resolved.lng }, { lat: l.city?.lat, lng: l.city?.lng }))
    .filter((d) => d != null);
  return distances.length ? Math.min(...distances) : null;
}

/**
 * Does this specialist practise at/near the requested location?
 *
 * With coordinates on both sides we use a real radius. Without them (an
 * unresolved free-text query, or a city row missing lat/lng) we fall back
 * to matching city name / slug / postcode text, which is how search
 * behaved before geocoding existed.
 */
export function matchesLocation(clinicLocations, resolved, radiusKm) {
  if (!resolved || !resolved.query) return true;

  if (resolved.lat != null && radiusKm) {
    const nearest = nearestDistanceKm(clinicLocations, resolved);
    if (nearest != null) return nearest <= radiusKm;
    // fall through to text matching if this specialist has no coordinates
  }

  const needle = resolved.query.toLowerCase();
  return (clinicLocations ?? []).some(
    (l) =>
      (l.city?.name ?? "").toLowerCase().includes(needle) ||
      (l.city?.slug ?? "").toLowerCase().includes(needle) ||
      (l.city?.region ?? "").toLowerCase().includes(needle) ||
      (l.postcode ?? "").toLowerCase().includes(needle)
  );
}
