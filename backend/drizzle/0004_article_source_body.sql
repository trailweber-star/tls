-- Keep what was typed, not only what was rendered.
--
-- An article is stored as sanitised HTML, which is right for serving it
-- and wrong for editing it: somebody who pasted markdown from Abun and
-- clicks Edit should get their markdown back, not a wall of <p> tags
-- with ids injected into every heading.
--
-- So the original is kept alongside the rendered body. body_html stays
-- the only thing the public site reads; body_source exists purely so
-- the editor can show the author what they wrote.
--
-- Nullable on purpose: rows imported before this migration have no
-- source to recover, and the editor falls back to the rendered HTML for
-- those rather than pretending there is nothing to edit.

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "body_source" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "body_format" text;
