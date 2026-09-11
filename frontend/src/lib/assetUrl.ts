/* ------------------------------------------------------------------ *
 * Where an uploaded file actually lives
 *
 * An uploaded photo is stored by the API and served by the API. The
 * browser, though, is on the frontend's origin — :5173 in development,
 * and quite possibly a different host entirely once this is deployed.
 * So a stored value of "/uploads/profile-photo-…​.png" resolves against
 * the wrong origin and the image 404s: the field looked like it saved,
 * the URL looked right in the form, and nothing appeared.
 *
 * That was a real bug, and this is the belt to the backend's braces.
 * The API now hands back absolute URLs, so new uploads need nothing
 * here — but rows written before that fix still hold the relative form,
 * and rewriting them at the edge means no page has to remember.
 *
 * It is applied once, in the two API clients, to every response body.
 * Doing it there rather than at each <img> is deliberate: there are two
 * dozen of those and a page added next month would be the one that
 * forgot.
 * ------------------------------------------------------------------ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/** The API's origin — "http://localhost:4000" from ".../api". */
export const API_ORIGIN = (() => {
  try {
    return new URL(API_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
})();

/**
 * Resolve one stored value.
 *
 * Absolute URLs, data: URIs and blob: URLs are returned untouched — the
 * only thing rewritten is a root-relative path into the uploads folder,
 * which is unambiguously ours.
 */
export function assetUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return url;
  return (API_ORIGIN + url) as T;
}

/**
 * Walk a parsed response and rewrite every uploads path inside it.
 *
 * Returns the same object when nothing changed, so the common case
 * costs a traversal and no allocation.
 */
export function absolutiseAssets<T>(value: T, depth = 0): T {
  // A guard against a cyclic structure; API payloads are trees, but a
  // stack overflow inside the fetch client would take the whole page
  // down and that is not a trade worth making.
  if (depth > 12) return value;

  if (typeof value === "string") return assetUrl(value) as T;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const mapped = absolutiseAssets(item, depth + 1);
      if (mapped !== item) changed = true;
      return mapped;
    });
    return (changed ? next : value) as T;
  }

  if (value && typeof value === "object") {
    // Dates, Files and the like are left alone — only plain payload
    // objects are walked.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const mapped = absolutiseAssets(item, depth + 1);
      if (mapped !== item) changed = true;
      next[key] = mapped;
    }
    return (changed ? next : value) as T;
  }

  return value;
}
