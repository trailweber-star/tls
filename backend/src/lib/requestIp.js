/* ------------------------------------------------------------------ *
 * Where a request came from
 *
 * Two values, recorded on sign-up and on every sign-in, because the
 * first question an administrator asks about a new member is whether
 * they are real — and an account for a Salford dental practice created
 * from an address in another hemisphere answers it faster than anything
 * else on the row.
 *
 * The country is whatever the edge told us. Cloudflare sends
 * CF-IPCountry, most other CDNs send something equivalent, and behind a
 * bare nginx there is nothing, in which case this returns null and the
 * interface shows no flag.
 *
 * It is never guessed from the address. A GeoIP database would give an
 * answer for every request, and a confidently wrong flag beside
 * somebody's name — on a page where an admin decides whether to suspend
 * them — is worse than an honest blank.
 * ------------------------------------------------------------------ */

/** The headers a CDN or proxy uses to name the visitor's country. */
const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country", // Vercel
  "x-geo-country",
  "x-country-code",
  "fastly-client-country", // Fastly, when configured
];

/**
 * The client's address.
 *
 * Express fills req.ip from X-Forwarded-For when "trust proxy" is set,
 * which app.js does. The header is still read directly as a fallback
 * for the case where it is not, and only the first entry is used: the
 * rest of that list is proxies, and anything a client puts there is a
 * claim rather than a fact.
 */
export function clientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();
  const raw = req.ip || forwarded || req.socket?.remoteAddress || "";
  // ::ffff:203.0.113.4 is an IPv4 address wearing an IPv6 coat.
  const ip = raw.replace(/^::ffff:/, "");
  // Loopback tells an admin nothing and looks like a bug on the screen.
  return ip && ip !== "::1" && ip !== "127.0.0.1" ? ip : null;
}

/** The two-letter country the edge reported, or null. */
export function clientCountry(req) {
  for (const header of COUNTRY_HEADERS) {
    const value = String(req.headers?.[header] ?? "").trim().toUpperCase();
    // Cloudflare sends XX for anonymising proxies and T1 for Tor.
    if (value && value.length === 2 && value !== "XX" && value !== "T1") return value;
  }
  return null;
}

/** Both at once, in the shape the user columns expect. */
export function requestOrigin(req) {
  return { ip: clientIp(req), country: clientCountry(req) };
}
