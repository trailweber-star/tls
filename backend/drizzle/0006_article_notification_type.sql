-- The bell needs a type for "an article is waiting".
--
-- Separate from 0005 because that migration is already applied
-- everywhere it has run, and editing an applied migration is how a
-- deployment ends up with a schema that does not match its own ledger.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'article_pending';
