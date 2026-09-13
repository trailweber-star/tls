/* ------------------------------------------------------------------ *
 * Per-page metadata
 *
 * React 19 hoists <title>, <meta> and <link> rendered anywhere in the
 * tree into <head>, so a page can declare its own metadata beside its
 * own content instead of reaching into the document with an effect.
 * That means the tags are real markup, not something a crawler has to
 * run JavaScript to discover after the fact.
 *
 * Every route renders one of these. A page with no <Seo> falls back to
 * the defaults in index.html, which are deliberately generic — good
 * enough not to embarrass, never good enough to leave in place.
 * ------------------------------------------------------------------ */

const SITE_NAME = "Top Local Specialists";
const SITE_URL = import.meta.env.VITE_SITE_URL || "https://www.toplocalspecialists.com";
const DEFAULT_IMAGE = `${SITE_URL}/apple-touch-icon.png`;

export function Seo({
  title,
  description,
  path,
  image,
  /** Search results, dashboards and anything behind a login. */
  noIndex = false,
  /** "article" for a blog post: Facebook, LinkedIn and Slack all render
   *  a different, richer card for one, and it is the only way the
   *  published and modified times below are read at all. */
  type = "website",
  publishedTime,
  modifiedTime,
  author,
  section,
  tags,
  /** Extra structured data for this page. */
  jsonLd,
}: {
  title: string;
  description: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}) {
  // Titles read "Page — Brand" except the home page, which is already
  // brand-first. Keeping the pattern in one place stops it drifting.
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
  const url = path ? `${SITE_URL}${path}` : undefined;
  const ogImage = image ?? DEFAULT_IMAGE;

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {url && <link rel="canonical" href={url} />}
      <meta name="robots" content={noIndex ? "noindex,nofollow" : "index,follow"} />

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={ogImage} />

      {type === "article" && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {type === "article" && modifiedTime && (
        <meta property="article:modified_time" content={modifiedTime} />
      )}
      {type === "article" && author && <meta property="article:author" content={author} />}
      {type === "article" && section && <meta property="article:section" content={section} />}
      {type === "article" &&
        (tags ?? []).map((tag) => <meta key={tag} property="article:tag" content={tag} />)}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {jsonLd && (
        <script
          type="application/ld+json"
          // Structured data is generated from our own page data, never
          // from anything a user typed.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}

/** The organisation, described once and reused. */
export const ORGANISATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  legalName: "TopLocalSpecialists.com Limited",
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  email: "admin@toplocalspecialists.com",
  telephone: "+44 1527 919848",
  address: {
    "@type": "PostalAddress",
    streetAddress: "27 New Road",
    addressLocality: "Bromsgrove",
    postalCode: "B60 2JL",
    addressCountry: "GB",
  },
  sameAs: [
    "https://web.facebook.com/people/Top-Local-Specialists/61574241973071/",
    "https://www.instagram.com/toplocalspecialists/",
    "https://www.youtube.com/@toplocalspecialists",
  ],
};

export { SITE_NAME, SITE_URL };
