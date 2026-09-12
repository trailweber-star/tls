/* ------------------------------------------------------------------ *
 * The blog
 *
 * Articles are generated in Abun and imported here. Abun publishes only
 * to WordPress, Webflow, Wix and Shopify and exposes no API, webhook or
 * Zapier action, so nothing about this table assumes a live connection:
 * a row arrives through the importer, from a paste or from a pull, and
 * the table is the same either way.
 *
 * body_html is stored ALREADY SANITISED. Doing it on the way in means
 * the read path cannot forget, and no endpoint added later can serve an
 * unsanitised body by omission — which is the failure mode that put
 * javascript: into a photo_url earlier in this project.
 * ------------------------------------------------------------------ */

CREATE TYPE "article_status" AS ENUM ('draft', 'published');

CREATE TABLE "articles" (
  "id"              text PRIMARY KEY NOT NULL,

  "slug"            text NOT NULL,
  "title"           text NOT NULL,
  "excerpt"         text,
  "body_html"       text NOT NULL,

  "hero_image_url"  text,
  "hero_image_alt"  text,

  "author_name"     text,
  "specialty_id"    text REFERENCES "specialties"("id"),
  "tags"            text[] NOT NULL DEFAULT '{}',

  "status"          "article_status" NOT NULL DEFAULT 'draft',
  "published_at"    timestamptz,

  "seo_title"       text,
  "seo_description" text,

  "source"          text NOT NULL DEFAULT 'manual',
  "source_ref"      text,

  "reading_minutes" integer NOT NULL DEFAULT 1,
  "view_count"      integer NOT NULL DEFAULT 0,

  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "articles_slug_unique" UNIQUE ("slug")
);

CREATE INDEX "articles_published_idx" ON "articles" ("status", "published_at");

/* Re-importing the same Abun article updates it rather than adding a
   second copy. Partial, because a hand-written post has no source_ref
   and several NULLs would otherwise collide. */
CREATE UNIQUE INDEX "articles_source_ref_idx"
  ON "articles" ("source", "source_ref")
  WHERE "source_ref" IS NOT NULL;
