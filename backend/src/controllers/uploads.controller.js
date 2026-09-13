import {
  ACCEPTED_MIME,
  ACCEPTED_VIDEO_MIME,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  publicOriginFrom,
  removeImage,
  saveImage,
  saveVideo,
  storageProviderName,
} from "../lib/storage.js";

/* ------------------------------------------------------------------ *
 * Uploads
 *
 * The profile photo used to be a text box you pasted a URL into, which
 * asked every specialist to go and host their own headshot somewhere
 * first. Almost nobody will, so almost every listing stayed faceless —
 * on a directory where the photograph is most of what a patient is
 * choosing on.
 *
 * The body is the raw image, not multipart: Express parses it with a
 * built-in, so this adds no dependency, no base64 inflation and no
 * hand-rolled boundary parsing. `express.raw` also enforces the size
 * cap before the bytes reach here, which is the right place for it —
 * a 900MB upload should be refused at the door, not after it has been
 * buffered.
 * ------------------------------------------------------------------ */

/** What the file is for. Only affects the generated filename. */
const KINDS = new Set(["profile-photo", "cover", "gallery", "logo", "article"]);

// POST /api/uploads/image?kind=profile-photo   (body: the raw image)
export async function uploadImage(req, res) {
  const kind = KINDS.has(req.query.kind) ? req.query.kind : "image";

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({
      error: "No image received. Send the file as the request body with its own Content-Type.",
    });
  }

  try {
    // The URL goes back absolute: it is stored on the profile and then
    // rendered by a browser sitting on the frontend's origin, which is
    // not this one.
    const saved = await saveImage({ buffer: req.body, kind, origin: publicOriginFrom(req) });
    res.status(201).json(saved);
  } catch (err) {
    // saveImage throws with a status for the two cases a person can
    // actually fix — wrong file type, and too big — so the message they
    // read is the real reason rather than "upload failed".
    res.status(err.status ?? 500).json({ error: err.message ?? "Could not store that image" });
  }
}

/* What the file is for. Only affects the generated filename. */
const VIDEO_KINDS = new Set(["intro-video", "video"]);

// POST /api/uploads/video?kind=intro-video   (body: the raw video)
export async function uploadVideo(req, res) {
  const kind = VIDEO_KINDS.has(req.query.kind) ? req.query.kind : "video";

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({
      error: "No video received. Send the file as the request body with its own Content-Type.",
    });
  }

  try {
    const saved = await saveVideo({ buffer: req.body, kind, origin: publicOriginFrom(req) });
    res.status(201).json(saved);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Could not store that video" });
  }
}

// DELETE /api/uploads/image  { url }
export async function deleteImage(req, res) {
  const url = req.body?.url;
  if (!url) return res.status(400).json({ error: "url is required" });
  const result = await removeImage(String(url));
  res.json({ ok: true, ...result });
}

// GET /api/uploads/config — what the form should enforce before sending.
export async function uploadConfig(req, res) {
  res.json({
    maxBytes: MAX_UPLOAD_BYTES,
    maxMb: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024),
    accept: ACCEPTED_MIME,
    // Video has its own, much larger cap — a phone recording of a
    // minute is tens of megabytes, and the photo limit would refuse
    // every real one.
    video: {
      maxBytes: MAX_VIDEO_BYTES,
      maxMb: Math.round(MAX_VIDEO_BYTES / 1024 / 1024),
      accept: ACCEPTED_VIDEO_MIME,
    },
    provider: storageProviderName(),
  });
}
