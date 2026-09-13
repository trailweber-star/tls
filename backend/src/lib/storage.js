import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseOrigin } from "./urls.js";

/* ------------------------------------------------------------------ *
 * Image storage, behind a boundary
 *
 * The same seam as the geocoder, the mailer and the payment provider:
 * the whole upload flow is built and working, and swapping local disk
 * for S3, Cloudflare R2 or Cloudinary is one `setStorageProvider()` call
 * with no change anywhere else.
 *
 * Local disk is the default because it makes the feature real on day
 * one — a specialist can upload their photo now, and it survives a
 * restart. It is NOT what should run in production behind more than one
 * server: files written to one machine's disk are invisible to the
 * next. That is a deployment decision, and it is flagged at boot rather
 * than discovered when the second instance starts serving 404s.
 *
 * To connect a real bucket:
 *
 *   import { setStorageProvider } from "./lib/storage.js";
 *   setStorageProvider({
 *     name: "s3",
 *     async save({ buffer, filename, contentType }) {
 *       …
 *       return { url: "https://cdn.example.com/…" };
 *     },
 *     async remove(url) { … },
 *   });
 * ------------------------------------------------------------------ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where local-disk uploads land. Served statically by server.js. */
export const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");
const PUBLIC_PREFIX = "/uploads";

let provider = null;

export function setStorageProvider(impl) {
  provider = impl;
}

/* ------------------------------------------------------------------ *
 * Absolute, not relative
 *
 * A stored "/uploads/photo.png" is served by this API — but the browser
 * asking for it is on the frontend's origin, so it resolved the path
 * against :5173 and got a 404. The upload succeeded, the field filled
 * in, and no photo appeared: a bug that only shows up as an absence.
 *
 * The URL is therefore absolute from the moment it is created. In
 * production set PUBLIC_API_URL to the API's public address; in
 * development the request's own origin is exactly right and needs no
 * configuration.
 * ------------------------------------------------------------------ */
export function publicOriginFrom(req) {
  /* Each candidate is validated rather than trusted — see
     normaliseOrigin in lib/urls.js. A configured value that is not a
     real origin (Render's blueprint filled this with the service NAME,
     which made every uploaded photo a broken relative path) is skipped
     rather than published. */
  for (const candidate of [
    process.env.PUBLIC_API_URL,
    process.env.API_PUBLIC_URL,
    // Set automatically on Render, and always the real public address.
    process.env.RENDER_EXTERNAL_URL,
  ]) {
    const origin = normaliseOrigin(candidate);
    if (origin) return origin;
  }

  if (!req) return "";
  // Behind a proxy Express fills these from X-Forwarded-* when
  // "trust proxy" is set, which server.js does. On a single-origin
  // deployment this is the correct answer anyway.
  const host = req.get?.("host");
  return host ? `${req.protocol}://${host}` : "";
}

export function storageProviderName() {
  return provider?.name ?? "local-disk";
}

/**
 * What may be uploaded.
 *
 * The list is by magic bytes, not by the filename or the Content-Type
 * header, both of which the client controls. A .jpg that is really an
 * HTML file, served back from our own origin, is a stored XSS — the
 * classic version of this bug.
 */
const SIGNATURES = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) =>
      b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP",
  },
  {
    ext: "gif",
    mime: "image/gif",
    test: (b) => b.slice(0, 3).toString("ascii") === "GIF",
  },
  /* AVIF shares HEIC's container: "ftyp" at offset 4, then a brand.
     Only the avif brands are accepted — the heic ones are the same
     shape of file and no browser will display them, which is handled
     separately below with a message that says what to do about it. */
  {
    ext: "avif",
    mime: "image/avif",
    test: (b) => isIsoBmff(b) && ["avif", "avis"].includes(isoBrand(b)),
  },
];

const isIsoBmff = (b) => b.slice(4, 8).toString("ascii") === "ftyp";
const isoBrand = (b) => b.slice(8, 12).toString("ascii").toLowerCase();

/* An iPhone photo, straight off the phone or out of Photos. Chrome,
   Firefox and Edge cannot display one, so storing it would produce a
   listing with an invisible picture rather than a useful upload. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "heif", "mif1", "msf1"]);
const looksHeic = (b) => Buffer.isBuffer(b) && b.length > 12 && isIsoBmff(b) && HEIC_BRANDS.has(isoBrand(b));

export const ACCEPTED_MIME = SIGNATURES.map((s) => s.mime);
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 5) * 1024 * 1024;

/**
 * Video, by the same rule: content, never the filename.
 *
 * MP4, MOV and the rest of the QuickTime family all begin with a size
 * field and then the four bytes "ftyp" at offset 4 — the brand that
 * follows says which. WebM is a Matroska container, whose EBML header
 * is a fixed four bytes. Anything else is refused, which is what stops
 * this endpoint becoming a general-purpose file host on our own domain.
 */
const VIDEO_SIGNATURES = [
  {
    ext: "mp4",
    mime: "video/mp4",
    test: (b) => b.slice(4, 8).toString("ascii") === "ftyp" && !isQuickTimeBrand(b),
  },
  {
    ext: "mov",
    mime: "video/quicktime",
    test: (b) => b.slice(4, 8).toString("ascii") === "ftyp" && isQuickTimeBrand(b),
  },
  {
    ext: "webm",
    mime: "video/webm",
    test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
];

/* "qt  " is the brand a QuickTime .mov declares; every other ftyp brand
   here (isom, mp42, avc1, M4V …) is an MP4 as far as a browser cares. */
function isQuickTimeBrand(b) {
  return b.slice(8, 12).toString("ascii") === "qt  ";
}

export const ACCEPTED_VIDEO_MIME = VIDEO_SIGNATURES.map((s) => s.mime);

/**
 * Videos get their own, much larger cap.
 *
 * A one-minute introduction recorded on a phone is comfortably 30-60MB,
 * so the 5MB photo limit would refuse every real one. It is still a
 * limit rather than none: the bytes are buffered in memory on the way
 * through, and an unbounded upload is a way to take the server down.
 */
export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_MB ?? 64) * 1024 * 1024;

/** Identify by content. Returns null for anything not on the list. */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer)) ?? null;
}

/** The same, for video. */
export function sniffVideo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return VIDEO_SIGNATURES.find((s) => s.test(buffer)) ?? null;
}

/**
 * Store one image and return its public URL.
 *
 * The filename is generated, never taken from the client: an uploaded
 * name can contain path separators, and "../../server.js" is a file
 * write where you did not want one.
 */
export async function saveImage({ buffer, kind = "image", origin = "" }) {
  const sig = sniffImage(buffer);
  if (!sig) {
    /* HEIC is the default on every iPhone, so "that is not an image" is
       both wrong and useless — the file is an image, it is simply one
       no browser can draw. Say what to do instead. */
    const err = looksHeic(buffer)
      ? new Error(
          "That is an iPhone HEIC photo, which browsers cannot display. Open it in Preview and choose File ▸ Export As ▸ JPEG, or set Camera ▸ Formats to “Most Compatible” on the phone."
        )
      : new Error("That file is not a JPEG, PNG, WebP, GIF or AVIF image.");
    err.status = 415;
    throw err;
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const err = new Error(`Images must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
    err.status = 413;
    throw err;
  }

  const filename = `${kind}-${Date.now()}-${randomBytes(6).toString("hex")}.${sig.ext}`;

  if (provider) {
    const res = await provider.save({ buffer, filename, contentType: sig.mime, kind });
    return { url: res.url, bytes: buffer.length, contentType: sig.mime, provider: provider.name };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return {
    // Absolute where we know our own address, relative otherwise —
    // never a broken image either way, because the frontend resolves a
    // relative one against the API origin as a second line of defence.
    url: `${origin}${PUBLIC_PREFIX}/${filename}`,
    path: `${PUBLIC_PREFIX}/${filename}`,
    bytes: buffer.length,
    contentType: sig.mime,
    provider: "local-disk",
  };
}

/**
 * Store one video and return its public URL.
 *
 * Deliberately the same shape as saveImage, so the provider seam does
 * not have to care which it was handed and a bucket adapter written for
 * one works for both.
 */
export async function saveVideo({ buffer, kind = "video", origin = "" }) {
  const sig = sniffVideo(buffer);
  if (!sig) {
    const err = new Error("That file is not an MP4, MOV or WebM video.");
    err.status = 415;
    throw err;
  }
  if (buffer.length > MAX_VIDEO_BYTES) {
    const err = new Error(`Videos must be under ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB.`);
    err.status = 413;
    throw err;
  }

  const filename = `${kind}-${Date.now()}-${randomBytes(6).toString("hex")}.${sig.ext}`;

  if (provider) {
    const res = await provider.save({ buffer, filename, contentType: sig.mime, kind });
    return { url: res.url, bytes: buffer.length, contentType: sig.mime, provider: provider.name };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return {
    url: `${origin}${PUBLIC_PREFIX}/${filename}`,
    path: `${PUBLIC_PREFIX}/${filename}`,
    bytes: buffer.length,
    contentType: sig.mime,
    provider: "local-disk",
  };
}

/**
 * Delete a previously stored image. Best-effort by design: a profile
 * photo that was replaced is not worth failing a save over, and an
 * orphaned file costs a few kilobytes.
 */
export async function removeImage(url) {
  if (!url) return { removed: false };
  try {
    if (provider) {
      await provider.remove?.(url);
      return { removed: true };
    }
    // Absolute or relative — the stored value has been both across the
    // life of this code, and a delete that silently skipped the
    // absolute form would leak a file on every replaced photo.
    let pathname = String(url);
    if (/^https?:\/\//i.test(pathname)) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return { removed: false, reason: "unparseable" };
      }
    }
    if (!pathname.startsWith(`${PUBLIC_PREFIX}/`)) return { removed: false, reason: "not-ours" };
    // basename only, so a crafted url cannot walk out of the directory.
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(pathname)));
    return { removed: true };
  } catch {
    return { removed: false };
  }
}
