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

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // A hostname is required: "http:///x" parses but points nowhere.
  if (!url.hostname) return null;
  return url.toString();
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

/** The same, for fields that are allowed to be empty or cleared. */
export function optionalUrlField(options) {
  return z
    .union([urlField(options), z.literal(""), z.null()])
    .transform((value) => (value === "" ? null : value))
    .optional();
}
