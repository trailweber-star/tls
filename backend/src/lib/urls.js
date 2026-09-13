import { z } from "zod";

/* ------------------------------------------------------------------ *
 * URLs a member supplies
 *
 * Every one of these ends up in an href or a src on a page a patient
 * reads, which makes them the most dangerous strings in the database.
 * `javascript:alert(1)` in a website field is stored cross-site
 * scripting: it sits in a row looking like data until somebody clicks
 * the link on a public profile.
 *
 * They were accepted as plain strings with a length cap. This is the
 * check that was missing, and it lives here rather than inline so that
 * the profile editor, the claim form and anything added later cannot
 * each have their own idea of what a URL is.
 *
 * The rule: http and https only, or one of our own upload paths. No
 * data:, no javascript:, no file:, no protocol-relative "//evil.test"
 * — which a browser resolves against the current scheme and is the
 * usual way this check gets bypassed.
 * ------------------------------------------------------------------ */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Our own stored files, which are served by this API from /uploads. */
const OWN_PATH = /^\/(uploads|images|videos)\/[\w./-]+$/;

/**
 * Is this a URL we are willing to put in a page?
 * Returns the normalised string, or null.
 */
export function safeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // A relative path into our own storage is fine and common — that is
  // what an uploaded photo looked like before absolute URLs.
  if (OWN_PATH.test(trimmed)) return trimmed;

  // "//example.com/x" inherits the page's scheme and is a redirect off
  // the site wearing a relative URL's clothes.
  if (trimmed.startsWith("//")) return null;

  /* People paste "www.clinic.co.uk" and "clinic.co.uk/about" far more
     often than they paste a scheme, and refusing those taught nobody
     anything — the field just said the address was wrong. Anything with
     a scheme is left exactly as it is, so "javascript:" is still caught
     by the protocol check below; only a bare host picks up https.  */
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : /^[\w-]+(\.[\w-]+)+(\/|$|[?#])/.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // A hostname is required: "http:///x" parses but points nowhere.
  if (!url.hostname) return null;
  return url.toString();
}

/**
 * An origin we are willing to build public URLs on top of.
 *
 * This exists because of a real outage on the preview deployment. The
 * blueprint filled PUBLIC_API_URL from Render's `property: host`, which
 * is a service NAME — "tls-preview" — not a URL. Every uploaded photo
 * then came back as "tls-preview/uploads/photo.jpg": a relative path,
 * broken in every <img> on the site, and rejected by the URL check the
 * moment anyone tried to save a form containing one.
 *
 * So a configured value is checked rather than trusted. A bare host
 * picks up https; anything that does not resolve to a real host is
 * refused, and the caller falls back to the host the request actually
 * arrived on — which is correct on every deployment there is.
 */
export function normaliseOrigin(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (!raw) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return "";
    const host = url.hostname;
    // "tls-preview" is a service name. A public origin has a dot in it,
    // or is a loopback address somebody is developing against.
    const usable = host.includes(".") || host === "localhost" || host === "[::1]";
    return usable ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * A zod field for a member-supplied URL.
 *
 * Refuses rather than silently dropping, so the person editing their
 * profile is told which field is wrong instead of watching a value
 * disappear on save.
 */
export function urlField({ max = 500, message = "Use a full web address starting http:// or https://" } = {}) {
  return z
    .string()
    .max(max)
    .refine((value) => safeUrl(value) !== null, { message })
    .transform((value) => safeUrl(value));
}

/**
 * The same, for fields that are allowed to be empty or cleared.
 *
 * The message is set on the union itself as well as on the inner field:
 * zod reports a failed union with its own generic text, so without this
 * a mistyped web address came back to the person as "Invalid input",
 * which tells them neither what was wrong nor which box it was in.
 */
export function optionalUrlField(options) {
  const message = options?.message ?? "Use a full web address starting http:// or https://";
  return z
    .union([urlField(options), z.literal(""), z.null()], { error: message })
    .transform((value) => (value === "" ? null : value))
    .optional();
}
