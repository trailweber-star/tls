-- Members writing their own articles, and articles written for them.
--
-- Two entry points, one review queue, and the publish decision always
-- ends with an administrator:
--
--   admin drafts  ─assign─▶ awaiting_author ─member edits─▶ in_review ─▶ published
--   member drafts ──────────────submits───────────────────▶ in_review ─▶ published
--                                        sent back ─▶ changes_requested ─▶ member
--
-- The point of awaiting_author is that nothing is ever published under a
-- clinician's name that the clinician has not read. The point of
-- in_review is that nothing medical reaches a patient on this site
-- without a human at TLS having looked at it.

ALTER TYPE "article_status" ADD VALUE IF NOT EXISTS 'awaiting_author';
ALTER TYPE "article_status" ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE "article_status" ADD VALUE IF NOT EXISTS 'changes_requested';

-- Who the article is BY. A member is a specialist or a facility, never
-- both, so these are two nullable references rather than one polymorphic
-- column: the database can then actually enforce that the id exists.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "author_specialist_id" text REFERENCES "specialists"("id");
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "author_facility_id" text REFERENCES "facilities"("id");

-- Who typed it, which is not always who it is by — that is the whole
-- ghostwriting case.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "created_by_user_id" text REFERENCES "users"("id");

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" text REFERENCES "users"("id");

-- What an administrator said when they sent it back. Read by the member.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "review_note" text;

-- The review queue reads by status, oldest submission first.
CREATE INDEX IF NOT EXISTS "articles_queue_idx" ON "articles" ("status", "submitted_at");
-- A member's own list.
CREATE INDEX IF NOT EXISTS "articles_author_specialist_idx" ON "articles" ("author_specialist_id", "updated_at");
CREATE INDEX IF NOT EXISTS "articles_author_facility_idx" ON "articles" ("author_facility_id", "updated_at");
