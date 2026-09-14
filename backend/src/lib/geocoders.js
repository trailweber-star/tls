/* ------------------------------------------------------------------ *
 * Geocoders
 *
 * Two ways to turn "B3 2QD" or "Kings Heath" into coordinates:
 *
 *   postcodes.io — free, no account, no key, UK only. Registered by
 *     default, because "search near my postcode" is the single most
 *     common thing a patient types and it should not wait on anyone
 *     opening a billing account.
 *
 *   Google Geocoding — any address or place name anywhere, pay per
 *     call. Used instead when GOOGLE_MAPS_API_KEY is set.
 *
 * Either way lib/geo.js is the only thing that knows the difference:
 * everything downstream works off { lat, lng }.
 * ------------------------------------------------------------------ */

import { setGeocoder } from "./geo.js";

const TIMEOUT_MS = Number(process.env.GEOCODER_TIMEOUT_MS ?? 3500);

/** A lookup must never hang a patient's search. */
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const looksLikeUkPostcode = (q) => /^[a-z]{1,2}\d[a-z\d]?\s*\d?[a-z]{0,2}$/i.test(q.trim());

/**
 * postcodes.io. Handles a full postcode ("B3 2QD"), an outward code
 * ("B3"), and falls back to its place-name index for everything else.
 */
export function postcodesIoGeocoder() {
  return async (query) => {
    const q = query.trim();

    if (looksLikeUkPostcode(q)) {
      const clean = q.replace(/\s+/g, "");
      const full = await fetchJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
      if (full?.result) {
        return {
          name: `${full.result.postcode} · ${full.result.admin_district ?? full.result.region ?? ""}`.trim(),
          lat: full.result.latitude,
          lng: full.result.longitude,
        };
      }
      // Partial postcodes ("B3", "SW19") resolve through the outcode index.
      const out = await fetchJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(clean)}`);
      if (out?.result) {
        return {
          name: `${out.result.outcode} · ${out.result.admin_district?.[0] ?? ""}`.trim(),
          lat: out.result.latitude,
          lng: out.result.longitude,
        };
      }
    }

    const place = await fetchJson(`https://api.postcodes.io/places?q=${encodeURIComponent(q)}&limit=1`);
    const hit = place?.result?.[0];
    if (hit) {
      return {
        name: [hit.name_1, hit.county_unitary].filter(Boolean).join(", "),
        lat: hit.latitude,
        lng: hit.longitude,
      };
    }
    return null;
  };
}

/* ------------------------------------------------------------------ *
 * Bulk lookups
 *
 * The geocoder above answers one query at a time, because that is what
 * a search box does. Backfilling a table is the other shape: a hundred
 * postcodes at once, and a hundred separate requests would be both slow
 * and rude to a free service. postcodes.io takes a POST of up to a
 * hundred, so scripts/geotag.mjs uses these two instead.
 *
 * They return the administrative fields as well as the coordinates,
 * because a town called Stanmore exists in Shropshire, Hampshire,
 * Berkshire AND Greater London, and only the postcode's own district
 * says which one a listing means.
 * ------------------------------------------------------------------ */

/** Up to 100 postcodes in one request. Unknown codes come back as null. */
export async function bulkPostcodes(codes) {
  const out = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100);
    const res = await fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: chunk }),
    });
    if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`);
    const data = await res.json();
    for (const row of data.result ?? []) {
      out.set(
        row.query,
        row.result
          ? {
              postcode: row.result.postcode,
              lat: row.result.latitude,
              lng: row.result.longitude,
              district: row.result.admin_district ?? null,
              county: row.result.admin_county ?? null,
              region: row.result.region ?? null,
              ward: row.result.admin_ward ?? null,
              town: row.result.post_town ?? null,
            }
          : null
      );
    }
  }
  return out;
}

/** Every place of that name, so the caller can pick the right one. */
export async function lookupPlaces(name, limit = 10) {
  const res = await fetch(
    `https://api.postcodes.io/places?q=${encodeURIComponent(name)}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`);
  const data = await res.json();
  return (data.result ?? []).map((p) => ({
    name: p.name_1,
    type: p.local_type ?? null,
    county: p.county_unitary ?? null,
    district: p.district_borough ?? null,
    region: p.region ?? null,
    lat: p.latitude,
    lng: p.longitude,
  }));
}

/** Google Geocoding — anywhere, any address, needs a key. */
export function googleGeocoder(apiKey) {
  return async (query) => {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(query)}&components=country:GB&key=${apiKey}`;
    const data = await fetchJson(url);
    const hit = data?.results?.[0];
    if (!hit) return null;
    return {
      name: hit.formatted_address,
      lat: hit.geometry.location.lat,
      lng: hit.geometry.location.lng,
    };
  };
}

/**
 * Called once at boot. The city table stays underneath as the offline
 * fallback, so a geocoder outage degrades to city-level search rather
 * than to "no results".
 */
export function registerGeocoder() {
  const provider = (process.env.GEOCODER_PROVIDER ?? "").toLowerCase();
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (provider === "none") {
    console.log("[geo] geocoding disabled — location search matches the city table only");
    return;
  }
  if (provider === "google" || (provider === "" && key)) {
    if (!key) {
      console.warn("[geo] GEOCODER_PROVIDER=google but GOOGLE_MAPS_API_KEY is not set — falling back to postcodes.io");
    } else {
      setGeocoder(googleGeocoder(key));
      console.log("[geo] geocoding via Google");
      return;
    }
  }
  setGeocoder(postcodesIoGeocoder());
  console.log("[geo] geocoding via postcodes.io (free, UK postcodes and place names)");
}

/* ------------------------------------------------------------------ *
 * Address suggestions
 *
 * What the address field in the profile editor types against. Same
 * shape whichever service is behind it, so the form never learns which
 * one it is talking to.
 *
 * With no Google key this is postcodes.io: postcodes and place names,
 * free, no account, UK only. That is enough to put a real pin on a map
 * and to make distance search honest — the specialist types their
 * postcode, picks it, and the coordinates are stored.
 *
 * The moment GOOGLE_MAPS_API_KEY is set, the same field starts
 * suggesting full street addresses through Places instead, and the
 * stored shape is identical. That is the whole point of the seam: one
 * environment variable, no code change, nothing to migrate.
 * ------------------------------------------------------------------ */

/** A suggestion, in the one shape the form understands. */
function suggestion({ label, secondary = null, postcode = null, lat = null, lng = null, ref = null }) {
  return { label, secondary, postcode, lat, lng, ref };
}

async function postcodesIoSuggest(q) {
  const clean = q.replace(/\s+/g, "");
  const out = [];

  // Postcodes first: an autocomplete over partial postcodes, then one
  // lookup each to attach coordinates. Capped at five so a two-letter
  // query does not fan out into a hundred requests.
  if (/^[A-Za-z]{1,2}\d/.test(clean)) {
    const list = await fetchJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}/autocomplete`);
    const codes = (list?.result ?? []).slice(0, 5);
    if (codes.length) {
      const bulk = await fetchJson(
        `https://api.postcodes.io/postcodes?${codes.map((c) => `postcodes[]=${encodeURIComponent(c)}`).join("&")}`
      ).catch(() => null);
      const byCode = new Map(
        (bulk?.result ?? []).filter((r) => r.result).map((r) => [r.query, r.result])
      );
      for (const code of codes) {
        const hit = byCode.get(code);
        out.push(
          suggestion({
            label: code,
            secondary: hit ? [hit.admin_district, hit.region].filter(Boolean).join(", ") : null,
            postcode: code,
            lat: hit?.latitude ?? null,
            lng: hit?.longitude ?? null,
          })
        );
      }
    }
  }

  // Then towns and villages, so "Solihull" works as well as "B91".
  if (out.length < 6) {
    const places = await fetchJson(`https://api.postcodes.io/places?q=${encodeURIComponent(q)}&limit=6`);
    for (const hit of places?.result ?? []) {
      out.push(
        suggestion({
          label: hit.name_1,
          secondary: [hit.county_unitary, hit.region].filter(Boolean).join(", ") || null,
          lat: hit.latitude,
          lng: hit.longitude,
        })
      );
    }
  }
  return out.slice(0, 8);
}

async function googlePlacesSuggest(q, apiKey) {
  const url =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(q)}&components=country:gb&key=${apiKey}`;
  const data = await fetchJson(url);
  return (data?.predictions ?? []).slice(0, 8).map((p) =>
    suggestion({
      label: p.structured_formatting?.main_text ?? p.description,
      secondary: p.structured_formatting?.secondary_text ?? null,
      // Places autocomplete returns no coordinates. The place_id comes
      // back with the suggestion and is resolved on pick, so we make one
      // details call for the address chosen rather than eight per
      // keystroke — which is also the difference between a small bill
      // and a large one.
      ref: p.place_id,
    })
  );
}

/** Suggestions for a partial address. Never throws — an empty list is a
 *  valid answer, and a lookup outage must not break the form. */
export async function suggestAddresses(query) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const provider = (process.env.GEOCODER_PROVIDER ?? "").toLowerCase();
  try {
    if (key && provider !== "none" && provider !== "postcodes") {
      return await googlePlacesSuggest(q, key);
    }
    return await postcodesIoSuggest(q);
  } catch {
    return [];
  }
}

/**
 * Turn a picked suggestion into coordinates.
 *
 * Google hands back a place_id with no location, so the details call
 * happens here, once, for the one address someone chose. postcodes.io
 * already attached the coordinates, so this is a no-op for it.
 */
export async function resolveSuggestion({ ref, label, postcode }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (ref && key) {
    const data = await fetchJson(
      `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(ref)}&fields=formatted_address,geometry,address_component&key=${key}`
    ).catch(() => null);
    const r = data?.result;
    if (r?.geometry?.location) {
      const components = r.address_components ?? [];
      const find = (type) => components.find((c) => c.types?.includes(type))?.long_name ?? null;
      return {
        label: r.formatted_address ?? label,
        postcode: find("postal_code") ?? postcode ?? null,
        town: find("postal_town") ?? find("locality") ?? null,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      };
    }
  }
  // No key, or the details call failed: fall back to the plain geocoder,
  // which is the same service the search box already uses.
  const hit = await geocodeOnce(label ?? postcode ?? "");
  return hit ? { label: hit.name, postcode: postcode ?? null, town: null, lat: hit.lat, lng: hit.lng } : null;
}

/** One geocode through whichever provider is registered. */
async function geocodeOnce(query) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const fn = key ? googleGeocoder(key) : postcodesIoGeocoder();
  return fn(query).catch(() => null);
}

/**
 * Coordinates -> a place name, for the "My current location" option.
 *
 * postcodes.io answers this well (it is the nearest-postcode lookup), and
 * when it can't be reached the caller falls back to the nearest city in
 * our own table — which is always available and good enough to search by.
 */
export async function reverseLookup(lat, lng) {
  const data = await fetchJson(
    `https://api.postcodes.io/postcodes?lon=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}&limit=1`
  );
  const hit = data?.result?.[0];
  if (!hit) return null;
  return {
    name: hit.admin_district ?? hit.parish ?? hit.postcode,
    postcode: hit.postcode,
    lat: hit.latitude,
    lng: hit.longitude,
  };
}
