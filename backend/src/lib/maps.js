/* ------------------------------------------------------------------ *
 * The map, behind the same seam as everything else
 *
 * A pinned address deserves a map. Until now the coordinates were only
 * used for distance sorting, so a patient reading "88 City Road" had to
 * copy it into another tab to find out whether it was anywhere near
 * them — which is the moment a lot of them leave.
 *
 * This works today with no account and no key: OpenStreetMap publishes
 * an embeddable map anyone may use, so the feature is real on this
 * build rather than a placeholder waiting on a purchase order. Set
 * GOOGLE_MAPS_API_KEY and every map on the site becomes a Google map,
 * with no change anywhere else — the frontend asks this endpoint what
 * to render and does as it is told, so the provider is a deployment
 * decision rather than a code change.
 *
 * Why the URL is built here rather than in the browser: a Google Maps
 * embed carries its key in the query string, so the key would otherwise
 * have to be shipped in the frontend bundle and duplicated in a second
 * .env. One key, one place, one thing to configure.
 *
 * Restrict that key by HTTP referrer in the Google Cloud console before
 * going live. An embed key is visible to anyone who views the page —
 * that is how the Maps Embed API works — and the referrer restriction
 * is what stops someone else's site spending your quota.
 * ------------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * encodeURIComponent leaves ! ' ( ) * alone — they are legal in a URL,
 * and in an href or an iframe src they are harmless. But this string is
 * built from an address somebody typed, and the day one of these URLs
 * is interpolated into HTML rather than passed to React, an apostrophe
 * is the character that closes an attribute. Escaping them here costs
 * nothing and means the output is safe wherever it ends up.
 */
function urlSafe(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function isCoord(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/** Which service is answering. "google" once a key is configured. */
export function mapProvider() {
  return process.env.GOOGLE_MAPS_API_KEY ? "google" : "osm";
}

/**
 * A degree of longitude shrinks towards the poles, so a box built from
 * equal degree offsets is stretched sideways in the UK by about a third.
 * Correcting for latitude is what keeps the pin in the middle of a
 * frame that is the shape it claims to be.
 */
function boundingBox(lat, lng, spanKm) {
  const latSpan = spanKm / 111;
  const lngSpan = spanKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - lngSpan, lat - latSpan, lng + lngSpan, lat + latSpan].map((n) => n.toFixed(6));
}

/**
 * Everything the browser needs to show one map.
 *
 * @param lat, lng   the pin. Optional — an address with no coordinates
 *                   still gets a map on Google (which can search for the
 *                   text) and an honest "not pinned" answer otherwise.
 * @param address    the text, used as the label and as Google's query
 *                   when there are no coordinates.
 * @param zoom       1 (the world) to 20 (a building). 15 is a street.
 * @returns { provider, embedUrl, linkUrl, pinned, label }
 *          embedUrl is null when there is nothing truthful to show.
 */
export function mapView({ lat, lng, address = "", zoom = 15 } = {}) {
  const provider = mapProvider();
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const z = clamp(Math.round(Number(zoom) || 15), 1, 20);
  const latitude = Number(lat);
  const longitude = Number(lng);
  const pinned = isCoord(latitude, longitude);
  const label = String(address || "").trim();

  if (provider === "google") {
    const q = pinned ? `${latitude},${longitude}` : label;
    if (!q) return { provider, embedUrl: null, linkUrl: null, probeUrl: null, pinned: false, label };
    return {
      provider,
      embedUrl: `https://www.google.com/maps/embed/v1/place?key=${urlSafe(key)}&q=${urlSafe(q)}&zoom=${z}`,
      // api=1 is the documented, key-free link format — it opens the
      // Maps app on a phone and maps.google.com on a desktop.
      linkUrl: `https://www.google.com/maps/search/?api=1&query=${urlSafe(q)}`,
      // No probe for Google: a bad key or a disabled API produces
      // Google's own readable error inside the frame, which is more
      // useful than us replacing it with a guess.
      probeUrl: null,
      pinned,
      label,
    };
  }

  // OpenStreetMap needs real coordinates: its embed takes a bounding
  // box, not a search. Without them there is no honest map to draw, and
  // a map of the wrong place is worse than no map at all.
  if (!pinned) {
    return {
      provider,
      embedUrl: null,
      linkUrl: label
        ? `https://www.openstreetmap.org/search?query=${urlSafe(label)}`
        : null,
      probeUrl: null,
      pinned: false,
      label,
    };
  }

  // Roughly the area a given zoom level shows, so the two providers
  // frame the same address about the same way.
  const spanKm = 40000 / Math.pow(2, z) / 2;
  const [west, south, east, north] = boundingBox(latitude, longitude, spanKm);
  return {
    provider,
    embedUrl:
      `https://www.openstreetmap.org/export/embed.html` +
      `?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${latitude}%2C${longitude}`,
    linkUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${z}/${latitude}/${longitude}`,
    /* One tiny image on the tile server, used by the browser to find
       out whether it can reach the map service at all.
       A cross-origin iframe never reports its own failure — a blocked
       or refused frame fires `load` on an error page exactly as a good
       one fires `load` on a map — so without this a privacy extension
       or an offline laptop leaves an empty grey rectangle on the page
       with nothing able to tell. An <img> does report failure, and this
       is the zoom-0 world tile: about 6KB, cached, and always there. */
    probeUrl: "https://tile.openstreetmap.org/0/0/0.png",
    pinned: true,
    label,
  };
}
