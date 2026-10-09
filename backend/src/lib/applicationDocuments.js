import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { applicationDocuments as table } from "../db/schema.js";

/* ------------------------------------------------------------------ *
 * Registration documents
 *
 * A certificate is identity paperwork, so it is handled differently to
 * a profile photo: it is checked by its first bytes (the filename and
 * Content-Type are the sender's word), size capped, held in the
 * database and handed back only to a signed in admin or to the person
 * who owns the listing.
 * ------------------------------------------------------------------ */

export const MAX_DOC_BYTES = Number(process.env.MAX_DOC_MB ?? 8) * 1024 * 1024;
export const MAX_DOCS_PER_SPECIALIST = 6;

const TYPES = [
  { ext: "pdf", mime: "application/pdf", test: (b) => b.slice(0, 5).toString("ascii") === "%PDF-" },
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) => b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP",
  },
];

export const ACCEPTED_DOC_LABEL = "PDF, JPG, PNG or WebP";

export function sniffDocument(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return TYPES.find((t) => t.test(buffer)) ?? null;
}

function cleanName(name, ext) {
  const base = String(name ?? "")
    .replace(/[\\/\u0000-\u001f"<>|?*:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "registration certificate";
  return `${stem}.${ext}`;
}

export async function saveApplicationDocument({ specialistId, uploadedBy, kind, name, buffer }) {
  if (buffer.length > MAX_DOC_BYTES) {
    const err = new Error(`That file is too large. The limit is ${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB.`);
    err.status = 413;
    throw err;
  }
  const type = sniffDocument(buffer);
  if (!type) {
    const err = new Error(`We can only accept a ${ACCEPTED_DOC_LABEL} file.`);
    err.status = 415;
    throw err;
  }

  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql`count(*)::int` })
    .from(table)
    .where(eq(table.specialistId, specialistId));
  if (n >= MAX_DOCS_PER_SPECIALIST) {
    const err = new Error(`You can attach up to ${MAX_DOCS_PER_SPECIALIST} documents. Remove one first.`);
    err.status = 409;
    throw err;
  }

  const [row] = await db
    .insert(table)
    .values({
      specialistId,
      uploadedBy: uploadedBy ?? null,
      kind: kind || "registration-certificate",
      fileName: cleanName(name, type.ext),
      contentType: type.mime,
      sizeBytes: buffer.length,
      data: buffer,
    })
    .returning({
      id: table.id,
      fileName: table.fileName,
      kind: table.kind,
      contentType: table.contentType,
      sizeBytes: table.sizeBytes,
      createdAt: table.createdAt,
    });
  return row;
}

export async function getApplicationDocument(id) {
  const [row] = await getDb().select().from(table).where(eq(table.id, id)).limit(1);
  return row ?? null;
}

export async function deleteApplicationDocument(id, specialistId) {
  const out = await getDb()
    .delete(table)
    .where(and(eq(table.id, id), eq(table.specialistId, specialistId)))
    .returning({ id: table.id });
  return out.length > 0;
}
