import type { FacilityWithRelations, Review, SpecialistWithRelations } from "./types";

/* ------------------------------------------------------------------ *
 * Structured data for the two pages that earn search traffic
 *
 * A profile page is the only page on this site a patient arrives at
 * directly from Google, and the only one where a rich result — stars,
 * a specialty, an address, an opening status — decides whether they
 * click us or the listing above us.
 *
 * Both pages already declared the basics. What is added here is the
 * detail Google actually reads: absolute image URLs (a relative one is
 * silently ignored), @id and mainEntityOfPage so the markup is
 * understood to BE the page rather than to mention it, the credential
 * that makes a directory worth trusting, and the individual reviews
 * behind the rating.
 *
 * Two rules this file keeps:
 *
 *   Nothing is claimed that the page does not show. Markup asserting a
 *   rating a visitor cannot see is against Google's guidelines and is
 *   the kind of thing that costs a site its rich results entirely.
 *
 *   Undefined rather than null or "". A JSON-LD key with an empty value
 *   is a claim that the value is empty, which is not the same as not
 *   claiming it.
 * ------------------------------------------------------------------ */

export const SITE_URL = import.meta.env.VITE_SITE_URL || "https://www.toplocalspecialists.com";

/**
 * Structured data needs absolute URLs; uploads are stored as paths.
 *
 * Validating rather than prefixing. A member's website field holding
 * something that is not a URL used to come out of here as
 * "https://www.toplocalspecialists.com/<that text>" — a claim, in
 * machine-readable markup, that we are the same entity as whatever they
 * typed. Anything that is not http(s) or one of our own paths is simply
 * not published.
 */
export function absoluteUrl(url?: string | null): string | undefined {
  const raw = (url ?? "").trim();
  if (!raw) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.hostname ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  // Our own stored files, and nothing else that starts with a slash:
  // "//evil.test" is protocol-relative and leaves the site.
  if (/^\/(uploads|images|videos)\/[\w./-]+$/.test(raw)) return `${SITE_URL}${raw}`;
  return undefined;
}

/** Drops every key whose value is undefined, null or an empty array. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
}

const sameAsFrom = (
  website?: string | null,
  socials?: Record<string, string | null | undefined> | null
) =>
  [website, ...Object.values(socials ?? {})]
    .map((u) => absoluteUrl(u))
    .filter((u): u is string => Boolean(u));

/**
 * The reviews behind the rating.
 *
 * Included because this is a third-party directory publishing reviews
 * of clinicians — not a business marking up reviews of itself, which is
 * what Google's self-serving rule prohibits. Only reviews with words in
 * them: a bare star with no text adds nothing to a result.
 */
function reviewsFor(reviews: Review[] | undefined, itemName: string) {
  return (reviews ?? [])
    .filter((r) => r.comment && r.comment.trim().length > 20)
    .slice(0, 5)
    .map((r) =>
      clean({
        "@type": "Review",
        reviewRating: {
          "@type": "Rating",
          ratingValue: r.rating,
          bestRating: 5,
          worstRating: 1,
        },
        author: { "@type": "Person", name: r.patientName ?? "Verified patient" },
        datePublished: r.createdAt?.slice(0, 10),
        reviewBody: r.comment ?? undefined,
        itemReviewed: { "@type": "Thing", name: itemName },
      })
    );
}

function aggregateFor(ratingAvg: number, ratingCount: number) {
  // Never asserted without reviews behind it: an aggregateRating of 0
  // from 0 reviews is both meaningless and a guidelines breach.
  if (!ratingCount || ratingCount < 1) return undefined;
  return {
    "@type": "AggregateRating",
    ratingValue: Number(ratingAvg.toFixed(1)),
    reviewCount: ratingCount,
    bestRating: 5,
    worstRating: 1,
  };
}

function breadcrumb(trail: { name: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) =>
      clean({
        "@type": "ListItem",
        position: i + 1,
        name: step.name,
        item: step.path ? `${SITE_URL}${step.path}` : undefined,
      })
    ),
  };
}

/* ------------------------------------------------------------ people */

export function specialistJsonLd(s: SpecialistWithRelations) {
  const url = `${SITE_URL}/specialists/${s.slug}`;
  const location = s.clinicLocations?.[0] ?? null;
  const specialties = (s.specialties ?? []).map((x) => x.name);

  const physician = clean({
    "@context": "https://schema.org",
    "@type": "Physician",
    "@id": `${url}#physician`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    name: s.fullName,
    /* The letters after a name are what a patient scans for, and
       alternateName is where a search engine expects to find the form
       they may have typed. */
    alternateName: s.qualifications ? `${s.fullName}, ${s.qualifications}` : undefined,
    jobTitle: s.title ?? undefined,
    description: s.bio ?? undefined,
    image: absoluteUrl(s.photoUrl),
    medicalSpecialty: specialties.length ? specialties : (s.primarySpecialty?.name ?? undefined),
    knowsLanguage: s.languages?.length ? s.languages : undefined,
    knowsAbout: (s.conditions ?? []).map((c) => c.name).slice(0, 20),
    availableService: (s.treatments ?? []).slice(0, 20).map((t) => ({
      "@type": "MedicalProcedure",
      name: t.name,
    })),
    /* The registration number is the single most trust-bearing fact on
       the page, and identifier is where a machine looks for it. */
    identifier:
      s.registrationNumber && s.regulator
        ? {
            "@type": "PropertyValue",
            propertyID: s.regulator.name ?? s.regulator.code,
            value: s.registrationNumber,
          }
        : undefined,
    email: s.publicEmail ?? undefined,
    sameAs: sameAsFrom(s.websiteUrl, s.socials),
    address: location
      ? clean({
          "@type": "PostalAddress",
          streetAddress: location.address ?? undefined,
          addressLocality: location.city?.name ?? undefined,
          postalCode: location.postcode ?? undefined,
          addressCountry: "GB",
        })
      : undefined,
    geo:
      location?.lat != null && location?.lng != null
        ? { "@type": "GeoCoordinates", latitude: location.lat, longitude: location.lng }
        : undefined,
    /* A consultation price is an offer, and it is one of the few things
       that can appear in a result beside the stars. */
    makesOffer:
      s.consultationPriceMinor != null
        ? {
            "@type": "Offer",
            name: "Initial consultation",
            price: (s.consultationPriceMinor / 100).toFixed(2),
            priceCurrency: s.currency || "GBP",
            availability: "https://schema.org/InStock",
          }
        : undefined,
    aggregateRating: aggregateFor(s.ratingAvg, s.ratingCount),
    review: reviewsFor(s.reviews, s.fullName),
  });

  return [
    physician,
    breadcrumb([
      { name: "Home", path: "/" },
      { name: "Find a specialist", path: "/search" },
      ...(s.primarySpecialty
        ? [{ name: s.primarySpecialty.name, path: `/search?specialty=${s.primarySpecialty.slug}` }]
        : []),
      { name: s.fullName },
    ]),
  ];
}

/* ------------------------------------------------------------ places */

const DAY_SCHEMA: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function facilityJsonLd(f: FacilityWithRelations, schemaType: string) {
  const url = `${SITE_URL}/facilities/${f.slug}`;

  /* Opening hours are what produce the "Open now · Closes 18:00" line
     under a local result. open24h is expressed the way the spec asks
     for it — 00:00 to 23:59 across every day — rather than omitted. */
  const openingHoursSpecification = f.open24h
    ? [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: Object.values(DAY_SCHEMA),
          opens: "00:00",
          closes: "23:59",
        },
      ]
    : Object.entries(f.openingHours ?? {})
        .filter(([day, hours]) => DAY_SCHEMA[day] && hours && hours.open && hours.close)
        .map(([day, hours]) => ({
          "@type": "OpeningHoursSpecification",
          dayOfWeek: DAY_SCHEMA[day],
          opens: (hours as { open: string }).open,
          closes: (hours as { close: string }).close,
        }));

  const place = clean({
    "@context": "https://schema.org",
    "@type": schemaType,
    "@id": `${url}#place`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    name: f.name,
    description: f.about ?? f.description ?? f.tagline ?? undefined,
    image: absoluteUrl(f.photoUrl ?? f.coverImageUrl),
    telephone: f.phone ?? undefined,
    sameAs: sameAsFrom(f.websiteUrl, f.socials),
    address: clean({
      "@type": "PostalAddress",
      streetAddress: f.address ?? undefined,
      addressLocality: f.city?.name ?? undefined,
      postalCode: f.postcode ?? undefined,
      addressCountry: "GB",
    }),
    geo:
      f.lat != null && f.lng != null
        ? { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lng }
        : undefined,
    hasMap:
      f.lat != null && f.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`
        : undefined,
    openingHoursSpecification: openingHoursSpecification.length ? openingHoursSpecification : undefined,
    medicalSpecialty: (f.categories ?? []).map((c) => c.name).slice(0, 12),
    availableService: f.emergencyDepartment
      ? [{ "@type": "MedicalProcedure", name: "Emergency and urgent care" }]
      : undefined,
    numberOfBeds: f.bedCount ?? undefined,
    foundingDate: f.yearEstablished ? String(f.yearEstablished) : undefined,
    knowsLanguage: f.languages?.length ? f.languages : undefined,
    /* Parking, wheelchair access and step-free entry decide whether some
       patients can use a place at all, and this is the only machine
       readable place to say so. */
    amenityFeature: (f.amenities ?? []).slice(0, 20).map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    })),
    /* The regulator's own rating, attributed to the regulator rather
       than presented as ours. */
    additionalProperty:
      f.regulator && f.regulatorRating
        ? [
            {
              "@type": "PropertyValue",
              name: `${f.regulator} rating`,
              value: f.regulatorRating,
            },
          ]
        : undefined,
    aggregateRating: aggregateFor(f.ratingAvg, f.ratingCount),
    review: reviewsFor(f.reviews ?? f.reviewSample, f.name),
  });

  return [
    place,
    breadcrumb([
      { name: "Home", path: "/" },
      { name: "Find care", path: "/search" },
      { name: f.name },
    ]),
  ];
}
