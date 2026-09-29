import { isDbConfigured } from "../config/db.js";
import {
  articles as articleRepo,
  facilities as facilityRepo,
  specialists as specialistRepo,
  taxonomy as taxonomyRepo,
} from "../db/repos.js";
import { normaliseOrigin } from "../lib/urls.js";
import {
  mockFacilitiesWithRelations,
  mockSpecialistsWithRelations,
  specialties as mockSpecialties,
} from "../data/mock.js";

/* ------------------------------------------------------------------ *
 * robots.txt and sitemap.xml
 *
 * Both are served by the API rather than shipped as static files,
 * because both depend on things a build cannot know: whether this
 * deployment is a password-gated preview, and which specialists,
 * facilities and articles exist right now.
 *
 * Without them, a crawler asking for /robots.txt fell through to the
 * single-page-app catch-all and was handed index.html with a 200 — an
 * HTML document where a text file was expected, which is worse than a
 * 404 because it looks like a valid answer.
 *
 * Every URL here is a page a stranger can reach and read. Dashboards,
 * the admin workspace, sign-in and search results are deliberately
 * absent: a search result page is thin, near-duplicate and infinite,
 * and asking Google to crawl it wastes the budget that should go on
 * profiles and articles.
 * ------------------------------------------------------------------ */

/** The public origin, from config or from the request that arrived. */
function siteUrl(req) {
  /* Validated, not trusted: Render's blueprint once filled SITE_URL
     with the service name, which would have put "tls-preview/about" in
     the sitemap — see normaliseOrigin in lib/urls.js. */
  for (const candidate of [
    process.env.SITE_URL,
    process.env.PUBLIC_API_URL,
    process.env.RENDER_EXTERNAL_URL,
  ]) {
    const origin = normaliseOrigin(candidate);
    if (origin) return origin;
  }
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  return `${proto}://${req.headers.host}`;
}

/** A preview must never be indexed, whatever else is true. */
const isStaging = () => process.env.STAGING === "1" || Boolean(process.env.SITE_PASSWORD);

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const iso = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

/* Static pages, with how often they genuinely change and how much they
   matter relative to each other. Priority is a hint, not a ranking
   factor — it says which of OUR pages to prefer when the crawler is
   choosing, and nothing more. */
const STATIC_PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/search", changefreq: "daily", priority: "0.9" },
  { path: "/blog", changefreq: "weekly", priority: "0.8" },
  { path: "/pricing", changefreq: "monthly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.6" },
  { path: "/contact", changefreq: "yearly", priority: "0.4" },
  { path: "/register", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.2" },
  { path: "/terms", changefreq: "yearly", priority: "0.2" },
];

// GET /robots.txt
export function robotsTxt(req, res) {
  res.type("text/plain");
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (isStaging()) {
    return res.send("User-agent: *\nDisallow: /\n");
  }

  const base = siteUrl(req);
  res.send(
    [
      "User-agent: *",
      "Allow: /",
      "",
      "# Nothing here is useful to a crawler, and some of it is private.",
      "Disallow: /admin",
      "Disallow: /dashboard",
      "Disallow: /signin",
      "Disallow: /api/",
      "Disallow: /uploads/",
      "",
      "# Filtered search results are near-duplicates of each other and",
      "# effectively infinite, so most /search? URLs are unwanted here —",
      "# but a blanket \"Disallow: /search?\" used to sit here and block the",
      "# whole path, including the specialty and specialty+location pages",
      "# the sitemap below lists as pages worth indexing (Google never",
      "# fetches a Disallowed URL at all, so it never even reached the",
      "# per-page <meta name=\"robots\"> tag that was supposed to decide this",
      "# case by case). Fine-grained control now lives entirely in that meta",
      "# tag — see hasFilters in frontend/src/pages/Search.tsx — so nothing",
      "# under /search is blocked here.",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n")
  );
}

// GET /sitemap.xml
export async function sitemapXml(req, res) {
  const base = siteUrl(req);
  res.type("application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");

  // A gated preview has nothing to offer a crawler, and listing real
  // clinicians' profiles on one would be worse than useless.
  if (isStaging()) {
    return res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`
    );
  }

  const [specialists, facilities, articles, specialties] = await Promise.all([
    isDbConfigured() ? specialistRepo.verified() : mockSpecialistsWithRelations,
    isDbConfigured() ? facilityRepo.all() : mockFacilitiesWithRelations,
    isDbConfigured() ? articleRepo.published() : [],
    isDbConfigured() ? taxonomyRepo.specialties() : mockSpecialties,
  ]).catch(() => [[], [], [], []]);

  const urls = [];

  for (const page of STATIC_PAGES) {
    urls.push({ loc: `${base}${page.path}`, changefreq: page.changefreq, priority: page.priority });
  }

  /* One landing page per top-level specialty. These are the queries
     patients actually type — "orthopaedic surgeon near me" — and unlike
     a filtered search they are stable, few, and worth indexing. */
  for (const s of specialties.filter((n) => !n.parentId)) {
    urls.push({
      loc: `${base}/search?specialty=${encodeURIComponent(s.slug)}`,
      changefreq: "weekly",
      priority: "0.7",
    });
  }

  /* One landing page per specialty+city that actually has someone on
     it — "orthopaedic surgeon in Birmingham" is the pattern a local
     directory lives or dies on, and it's exactly what the sitemap was
     missing: every one of these was previously invisible, blocked by a
     blanket robots.txt disallow on the whole /search path regardless of
     what was on the page (see robotsTxt above).
     Built from the specialist list already fetched above rather than a
     second query, and — this matters — only for combinations with at
     least one verified specialist. Listing "urologist in Truro" with
     nobody on it would tell Google the page is empty the first time it
     crawls, which is a worse signal than never listing it. */
  const specialtyCityPairs = new Map();
  for (const s of specialists) {
    if (s.verificationStatus && s.verificationStatus !== "verified") continue;
    const citySlugs = new Set((s.clinicLocations ?? []).map((loc) => loc.city?.slug).filter(Boolean));
    for (const specialty of s.specialties ?? []) {
      for (const citySlug of citySlugs) {
        specialtyCityPairs.set(`${specialty.slug}|${citySlug}`, { specialtySlug: specialty.slug, citySlug });
      }
    }
  }
  for (const { specialtySlug, citySlug } of specialtyCityPairs.values()) {
    urls.push({
      loc: `${base}/search?specialty=${encodeURIComponent(specialtySlug)}&location=${encodeURIComponent(citySlug)}`,
      changefreq: "weekly",
      priority: "0.6",
    });
  }

  for (const s of specialists) {
    if (s.verificationStatus && s.verificationStatus !== "verified") continue;
    urls.push({
      loc: `${base}/specialists/${encodeURIComponent(s.slug)}`,
      lastmod: iso(s.updatedAt ?? s.createdAt),
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  for (const f of facilities) {
    urls.push({
      loc: `${base}/facilities/${encodeURIComponent(f.slug)}`,
      lastmod: iso(f.updatedAt ?? f.createdAt),
      changefreq: "weekly",
      priority: "0.7",
    });
  }

  for (const a of articles) {
    urls.push({
      loc: `${base}/blog/${encodeURIComponent(a.slug)}`,
      lastmod: iso(a.updatedAt ?? a.publishedAt),
      changefreq: "monthly",
      priority: "0.7",
    });
  }

  const body = urls
    .map((u) =>
      [
        "  <url>",
        `    <loc>${escapeXml(u.loc)}</loc>`,
        u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : null,
        u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : null,
        u.priority ? `    <priority>${u.priority}</priority>` : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");

  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
}
