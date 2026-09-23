/* ------------------------------------------------------------------ *
 * Real tags for the bots that never run JavaScript
 *
 * Every page's title, description, canonical, robots and OG tags are
 * rendered client-side by <Seo> (components/Seo.tsx in the frontend) —
 * deliberately, because React 19 hoists them from wherever they sit in
 * the tree, and that only happens once the page's own JavaScript runs.
 * Googlebot renders JS, but on a delay, and a page it meets before that
 * render can be indexed on the placeholder title in index.html with no
 * description at all. Bots that never run JS at all — every link-
 * preview crawler (Facebook, X, LinkedIn, Slack, WhatsApp, Telegram) —
 * never see the real tags, full stop.
 *
 * This sits in front of the single-page app and, for a request that
 * identifies as one of those bots, serves the same index.html with the
 * real page's title/description/canonical/OG spliced into <head> before
 * it goes out — using the same public API endpoints the page itself
 * calls, so there is exactly one place that decides what a given
 * specialist, facility or article is called and no risk of the two
 * disagreeing.
 *
 * A normal browser is untouched: it gets the same index.html as today,
 * <Seo> renders as it always has, and nothing here runs for it. That
 * matters beyond load — React's hoisting does not de-duplicate a tag
 * against one already sitting in the document, so splicing this into
 * what a real visitor's browser loads would leave two <title> and two
 * <meta name="description"> elements on the page rather than one.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";

const BOT_UA =
  /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|petalbot|slurp|facebookexternalhit|twitterbot|linkedinbot|slackbot|whatsapp|telegrambot|discordbot|redditbot|pinterest|embedly|quora link preview|showyoubot|outbrain|w3c_validator|semrushbot|ahrefsbot/i;

function isBot(req) {
  return BOT_UA.test(req.headers["user-agent"] ?? "");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Builds the block of tags this page gets, in the same shape <Seo> renders. */
function renderHead({ title, description, path: routePath, image, siteUrl, siteName, noIndex }) {
  const fullTitle = title.includes(siteName) ? title : `${title} — ${siteName}`;
  const url = routePath ? `${siteUrl}${routePath}` : undefined;
  const ogImage = image ?? `${siteUrl}/apple-touch-icon.png`;
  return `
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(description)}">
    ${url ? `<link rel="canonical" href="${esc(url)}">` : ""}
    <meta name="robots" content="${noIndex ? "noindex,nofollow" : "index,follow"}">
    <meta property="og:title" content="${esc(fullTitle)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${esc(siteName)}">
    ${url ? `<meta property="og:url" content="${esc(url)}">` : ""}
    <meta property="og:image" content="${esc(ogImage)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(fullTitle)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${esc(ogImage)}">
`;
}

const STATIC_PAGES = {
  "/": {
    title: "Top Local Specialists — Find Verified UK Healthcare Specialists",
    description:
      "Search verified consultants, surgeons, dentists and therapists across the UK by condition, treatment and location. Every specialist is checked against their regulator before they appear.",
  },
  "/about": {
    title: "About Us",
    description:
      "Top Local Specialists connects patients with verified UK healthcare professionals. Every specialist is checked against their regulator by a person before their profile appears.",
  },
  "/contact": {
    title: "Contact Us",
    description:
      "Questions, support, partnerships or practitioner enquiries — get in touch with the Top Local Specialists team. We reply within one working day.",
  },
  "/pricing": {
    title: "Pricing & Plans",
    description:
      "List free forever, or unlock top search priority, the Verified Specialist badge and the full ClinWell.ai EMR suite. No card needed to apply — you are only charged once approved.",
  },
  "/blog": {
    title: "Health guides — Top Local Specialists",
    description:
      "Plain-English guides to treatments, recovery and choosing private care in the UK, written and checked by verified specialists.",
  },
};

/**
 * Fetches this server's own public API — the same call the page itself
 * makes — rather than querying the database a second way. One function
 * decides what a specialist/facility/article is called; this only asks
 * it the question earlier than the browser would.
 */
async function apiGet(pathname) {
  const port = process.env.PORT || 4000;
  const res = await fetch(`http://127.0.0.1:${port}/api${pathname}`);
  if (!res.ok) return null;
  return res.json();
}

function specialistDescription(specialist) {
  const location = specialist.clinicLocations?.[0]?.city?.name;
  return [
    specialist.title ?? "Specialist",
    location ? `in ${location}` : "in the UK",
    specialist.yearsExperience ? `· ${specialist.yearsExperience} years' experience` : "",
    specialist.ratingCount > 0
      ? `· rated ${specialist.ratingAvg?.toFixed?.(1)} from ${specialist.ratingCount} reviews`
      : "",
    specialist.plan?.verifiedBadge ? "· credentials checked against the regulator." : "· unclaimed listing.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
}

function facilityDescription(facility) {
  return [
    facility.tagline ?? facility.facilityType ?? "Facility",
    facility.city?.name ? `in ${facility.city.name}` : "in the UK",
    facility.ratingCount > 0 ? `· ${facility.ratingAvg?.toFixed?.(1)} from ${facility.ratingCount} reviews` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
}

/** Matches a request path against the dynamic routes this covers. */
async function resolveDynamic(reqPath, siteUrl, siteName) {
  let m;

  if ((m = reqPath.match(/^\/specialists\/([^/]+)$/))) {
    const specialist = await apiGet(`/specialists/${m[1]}`);
    if (!specialist?.slug) return null;
    return {
      title: `${specialist.fullName}${specialist.title ? ` — ${specialist.title}` : ""}`,
      description: specialistDescription(specialist),
      path: `/specialists/${specialist.slug}`,
      image: specialist.photoUrl ?? undefined,
    };
  }

  if ((m = reqPath.match(/^\/facilities\/([^/]+)$/))) {
    const facility = await apiGet(`/facilities/${m[1]}`);
    if (!facility?.slug) return null;
    const typeLabel = facility.facilityType ?? "Facility";
    return {
      title: `${facility.name} — ${typeLabel}${facility.city ? ` in ${facility.city.name}` : ""}`,
      description: facilityDescription(facility),
      path: `/facilities/${facility.slug}`,
      image: facility.photoUrl ?? undefined,
    };
  }

  if ((m = reqPath.match(/^\/clinics\/([^/]+)$/))) {
    const clinic = await apiGet(`/clinics/${m[1]}`);
    if (!clinic?.name) return null;
    return {
      title: clinic.name,
      description: clinic.description ?? `${clinic.name} on ${siteName}.`,
      path: `/clinics/${clinic.slug ?? m[1]}`,
      image: clinic.logoUrl ?? undefined,
    };
  }

  if ((m = reqPath.match(/^\/blog\/([^/]+)$/))) {
    const data = await apiGet(`/articles/${m[1]}`);
    const article = data?.article;
    if (!article?.slug) return null;
    return {
      title: article.seoTitle ?? article.title,
      description: article.seoDescription ?? article.excerpt ?? "",
      path: `/blog/${article.slug}`,
      image: article.heroImageUrl ?? undefined,
    };
  }

  return null;
}

export function botSeo({ clientDir, siteUrl, siteName }) {
  const indexPath = path.join(clientDir, "index.html");

  return async function botSeoMiddleware(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isBot(req)) return next();

    let page = STATIC_PAGES[req.path];
    if (!page) {
      try {
        page = await resolveDynamic(req.path, siteUrl, siteName);
      } catch {
        // A slow or failing internal call should never take the page
        // down for a real crawler — it just falls through to the
        // ordinary (placeholder-tagged) response, same as today.
        page = null;
      }
    }
    if (!page) return next();

    let html;
    try {
      html = fs.readFileSync(indexPath, "utf8");
    } catch {
      return next();
    }

    const head = renderHead({ ...page, path: page.path ?? req.path, siteUrl, siteName });
    html = html
      .replace(/<title>.*?<\/title>/is, "")
      .replace("</head>", `${head}</head>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(html);
  };
}
