import { isDbConfigured } from "../config/db.js";
import { taxonomy } from "../db/repos.js";
import { cities as mockCities } from "../data/mock.js";
import { distanceKm } from "../lib/geo.js";
import { resolveSuggestion, reverseLookup, suggestAddresses } from "../lib/geocoders.js";
import { mapView } from "../lib/maps.js";

/* ------------------------------------------------------------------ *
 * GET /api/geo/reverse?lat=..&lng=..
 *
 * Behind the "My current location" option. The browser supplies the
 * coordinates — this turns them into a name a patient recognises and can
 * see in the search box, so nobody is searching against a number they
 * can't check.
 *
 * If the lookup service can't be reached we fall back to the nearest town
 * we already know about, which is always available and close enough to
 * search by. We never silently fail: a search that says "Birmingham" when
 * the patient is in Birmingham is honest, a blank box is not.
 * ------------------------------------------------------------------ */
export async function reverseGeocode(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const hit = await reverseLookup(lat, lng).catch(() => null);
  if (hit) return res.json({ label: hit.name, postcode: hit.postcode, source: "lookup" });

  const cities = isDbConfigured() ? await taxonomy.cities() : mockCities;
  let nearest = null;
  let best = Infinity;
  for (const city of cities) {
    const d = distanceKm({ lat, lng }, { lat: city.lat, lng: city.lng });
    if (d != null && d < best) {
      best = d;
      nearest = city;
    }
  }
  if (!nearest) return res.status(404).json({ error: "Could not work out where that is" });
  res.json({ label: nearest.name, postcode: null, source: "nearest-town", approximate: true });
}

/* ------------------------------------------------------------------ *
 * GET /api/geo/suggest?q=B3
 *
 * What the address field types against. postcodes.io today, Google
 * Places the moment a key is set — the response shape is the same
 * either way, so the form never has to know which.
 * ------------------------------------------------------------------ */
export async function suggestAddress(req, res) {
  const results = await suggestAddresses(req.query.q);
  res.json({
    results,
    // So the field can say "postcodes and towns" versus "full
    // addresses" rather than promising something it cannot do yet.
    provider: process.env.GOOGLE_MAPS_API_KEY ? "google" : "postcodes.io",
  });
}

/* ------------------------------------------------------------------ *
 * POST /api/geo/resolve  { ref, label, postcode }
 *
 * Called once, when a suggestion is picked, to attach coordinates. It is
 * a separate step because Google charges per details lookup and returns
 * no location with the suggestions themselves — resolving on pick means
 * one call for the address chosen, not one per keystroke.
 * ------------------------------------------------------------------ */
export async function resolveAddress(req, res) {
  const { ref = null, label = null, postcode = null } = req.body ?? {};
  if (!ref && !label && !postcode) {
    return res.status(400).json({ error: "Send the suggestion you picked" });
  }
  const hit = await resolveSuggestion({ ref, label, postcode }).catch(() => null);
  if (!hit) return res.status(404).json({ error: "Could not place that address on the map" });
  res.json(hit);
}

/* ------------------------------------------------------------------ *
 * GET /api/geo/map?lat=..&lng=..&address=..&zoom=..
 *
 * What to render for one address. The browser does not decide which map
 * service it is looking at, and never holds the key: it asks for a
 * view and gets back a frame to embed and a link to open. Adding
 * GOOGLE_MAPS_API_KEY to the backend .env switches every map on the
 * site from OpenStreetMap to Google without touching a line of the
 * frontend.
 * ------------------------------------------------------------------ */
export async function getMapView(req, res) {
  const view = mapView({
    lat: req.query.lat,
    lng: req.query.lng,
    address: req.query.address,
    zoom: req.query.zoom,
  });
  // A map of a fixed address does not change; caching it saves a
  // round trip on every profile that shows one.
  res.set("Cache-Control", "public, max-age=3600");
  res.json(view);
}
