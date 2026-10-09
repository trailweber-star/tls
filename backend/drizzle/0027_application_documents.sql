/* ------------------------------------------------------------------ *
 * Registration documents an applicant sends in (a GDC, GMC or HCPC
 * certificate, for example). Held in the database, not on disk or a
 * public image host: the host's disk is wiped on every deploy and an
 * image CDN link is readable by anyone who guesses it. Served only
 * through an authenticated endpoint, to admins and to the owner.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS "application_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "specialist_id" text NOT NULL REFERENCES "specialists"("id") ON DELETE CASCADE,
  "uploaded_by" text,
  "kind" text NOT NULL DEFAULT 'registration-certificate',
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_documents_specialist_idx" ON "application_documents" ("specialist_id");
