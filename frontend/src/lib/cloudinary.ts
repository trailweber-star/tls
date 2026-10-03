/* ------------------------------------------------------------------ *
 * Cloudinary delivery transforms
 *
 * Every specialist and facility photo goes up through Cloudinary's own
 * SDK (see backend/src/lib/storage.js), which hands back secure_url
 * verbatim — a full-size JPEG or PNG, served exactly as uploaded, with
 * no format negotiation and no compression beyond whatever the phone
 * or camera already did. Cloudinary can do both for free, through the
 * URL alone: f_auto picks WebP/AVIF for a browser that supports it,
 * q_auto picks the smallest quality that still looks right.
 *
 * This is a frontend-only rewrite rather than a change to what
 * storage.js stores or how the upload response is shaped: it is
 * reversible with no backfill, and it can never make an
 * already-uploaded photo's stored URL wrong — every non-Cloudinary
 * value (a local /uploads/ path, a bundled placeholder, a data: URI)
 * passes through untouched.
 * ------------------------------------------------------------------ */

// https://res.cloudinary.com/<cloud>/image/upload/v169.../tls/photo/xyz.jpg
//                                               ^^^^^^^ transforms go here
const CLOUDINARY_UPLOAD =
  /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(?!f_auto)(.*)$/;

/**
 * Insert f_auto,q_auto into a Cloudinary delivery URL.
 *
 * A no-op for anything that isn't one, so this is safe to wrap around
 * every photoUrl in the app without checking first where it came from.
 */
export function cloudinaryUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url !== "string") return url;
  const m = CLOUDINARY_UPLOAD.exec(url);
  if (!m) return url;
  return (m[1] + "f_auto,q_auto/" + m[2]) as T;
}
