import { isDbConfigured } from "../config/db.js";
import { specialists as specialistRepo } from "../db/repos.js";
import {
  ACCEPTED_DOC_LABEL,
  deleteApplicationDocument,
  getApplicationDocument,
  saveApplicationDocument,
} from "../lib/applicationDocuments.js";

/* ------------------------------------------------------------------ *
 * Registration documents
 *
 *   POST   /api/me/documents?type=&name=   body: the raw file
 *   GET    /api/documents/:id              admin, or the listing's owner
 *   DELETE /api/me/documents/:id           owner, until verified
 *
 * The jsonb list on the specialist (application.documents) is what the
 * admin queue already reads; the bytes themselves sit in
 * application_documents and are only reachable through GET above.
 * ------------------------------------------------------------------ */

const KINDS = new Set(["registration-certificate", "id", "other"]);

function entryFor(row) {
  return {
    id: row.id,
    type: row.kind,
    name: row.fileName,
    sizeBytes: row.sizeBytes,
    uploadedAt: new Date(row.createdAt ?? Date.now()).toISOString(),
  };
}

export async function uploadMyDocument(req, res) {
  if (!isDbConfigured()) return res.status(400).json({ error: "Uploading documents needs the database." });
  const specialistId = req.user?.specialistId;
  if (!specialistId) return res.status(403).json({ error: "Only a listing owner can attach documents." });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: `No file received. Send a ${ACCEPTED_DOC_LABEL} file.` });
  }

  const kind = KINDS.has(req.query.type) ? req.query.type : "registration-certificate";
  try {
    const row = await saveApplicationDocument({
      specialistId,
      uploadedBy: String(req.user.id ?? req.user._id),
      kind,
      name: req.query.name,
      buffer: req.body,
    });

    const current = await specialistRepo.rawById(specialistId);
    const application = current?.application && typeof current.application === "object" ? current.application : {};
    const documents = Array.isArray(application.documents) ? application.documents : [];
    await specialistRepo.update(specialistId, {
      application: { ...application, documents: [...documents, entryFor(row)] },
    });

    res.status(201).json({ ok: true, document: entryFor(row) });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Could not store that file" });
  }
}

export async function listMyDocuments(req, res) {
  if (!isDbConfigured()) return res.json({ documents: [] });
  const specialistId = req.user?.specialistId;
  if (!specialistId) return res.json({ documents: [] });
  const current = await specialistRepo.rawById(specialistId);
  const documents = Array.isArray(current?.application?.documents) ? current.application.documents : [];
  res.json({ documents: documents.filter((d) => d?.id) });
}

export async function getDocument(req, res) {
  if (!isDbConfigured()) return res.status(404).json({ error: "Not found" });
  const doc = await getApplicationDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });

  const isAdmin = req.user?.role === "admin";
  const isOwner = Boolean(req.user?.specialistId) && req.user.specialistId === doc.specialistId;
  if (!isAdmin && !isOwner) return res.status(404).json({ error: "Not found" });

  res.setHeader("Content-Type", doc.contentType);
  res.setHeader("Content-Length", String(doc.data.length));
  res.setHeader("Content-Disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.end(doc.data);
}

export async function deleteMyDocument(req, res) {
  if (!isDbConfigured()) return res.status(400).json({ error: "Removing documents needs the database." });
  const specialistId = req.user?.specialistId;
  if (!specialistId) return res.status(403).json({ error: "Only a listing owner can remove documents." });

  const current = await specialistRepo.rawById(specialistId);
  if (current?.verificationStatus === "verified") {
    return res.status(409).json({ error: "This profile is already verified, so its documents are kept on file." });
  }

  const removed = await deleteApplicationDocument(req.params.id, specialistId);
  if (!removed) return res.status(404).json({ error: "Document not found" });

  const application = current?.application && typeof current.application === "object" ? current.application : {};
  const documents = (Array.isArray(application.documents) ? application.documents : []).filter(
    (d) => d?.id !== req.params.id
  );
  await specialistRepo.update(specialistId, { application: { ...application, documents } });
  res.json({ ok: true });
}
