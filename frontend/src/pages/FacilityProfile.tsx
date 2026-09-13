import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Accessibility,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  Languages,
  MapPin,
  MessageSquareQuote,
  PenLine,
  Phone,
  ShieldCheck,
  Star,
  Stethoscope,
  Users,
} from "lucide-react";
import { getFacilityBySlug, getFacilityReviews } from "../lib/api";
import { formatRating } from "../lib/format";
import { EnquiryForm } from "../components/EnquiryForm";
import { MapPreview } from "../components/MapPreview";
import { Dialog } from "../components/Dialog";
import { ReviewForm } from "../components/ReviewForm";
import { SOCIAL_BRANDS, SocialGlyph } from "../lib/socialBrands";
import { placeHeroFor } from "../lib/specialtyHeroes";
import { HEADER_HEIGHT } from "../components/Header";
import {
  DAY_KEYS,
  DAY_LABELS,
  FACILITY_TYPES,
  REGULATORS,
  REGULATOR_RATINGS,
  amenityLabel,
  hoursSummary,
  isOpenNow,
} from "../lib/facilityFacets";
import NotFound from "./NotFound";
import { facilityJsonLd } from "../lib/structuredData";
import { Seo } from "../components/Seo";
import type { FacilityWithRelations, Review } from "../lib/types";

const TAB_BAR_HEIGHT = 56;

/**
 * Which schema.org type a place is. Getting this right is the difference
 * between a rich result with a star rating and a bare blue link, and
 * Google is specific about it: a care home is not a Hospital.
 */
const SCHEMA_TYPE: Record<string, string> = {
  hospital: "Hospital",
  clinic: "MedicalClinic",
  care_home: "ResidentialCare",
  pharmacy: "Pharmacy",
};

/**
 * Tabs are computed per place, not fixed. A pharmacy has no team and a
 * clinic with no gallery gets no Gallery tab, so a tab never leads to an
 * empty section — the same rule the specialist profile follows.
 */
function tabsFor(facility: FacilityWithRelations) {
  const gallery = facility.plan?.features.photoGallery && (facility.gallery ?? []).length > 0;
  return [
    { id: "overview", label: "Overview" },
    { id: "services", label: "Services" },
    ...((facility.team?.length ?? 0) > 0 ? [{ id: "team", label: "Specialists" }] : []),
    { id: "facilities", label: "Facilities & access" },
    ...(gallery ? [{ id: "gallery", label: "Gallery" }] : []),
    { id: "reviews", label: "Reviews" },
    { id: "location", label: "Location" },
  ];
}

export default function FacilityProfile() {
  const { slug = "" } = useParams();
  const [facility, setFacility] = useState<FacilityWithRelations | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setFacility(undefined);
    setLoadError(null);
    getFacilityBySlug(slug)
      .then(setFacility)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this listing"));
  }, [slug]);

  const tabs = facility ? tabsFor(facility) : [];

  // Which section you are reading drives the tab bar, so the bar always
  // describes where you are rather than the last thing you clicked.
  useEffect(() => {
    if (!facility) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveTab(visible.target.id);
      },
      { rootMargin: `-${HEADER_HEIGHT + TAB_BAR_HEIGHT + 8}px 0px -60% 0px`, threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [facility]);

  function goToSection(id: string) {
    const el = sectionRefs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (HEADER_HEIGHT + TAB_BAR_HEIGHT + 12);
    window.scrollTo({ top, behavior: "smooth" });
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl flex-1 px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-ink">Can&apos;t reach the server</h1>
        <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
      </main>
    );
  }
  if (facility === undefined) {
    return <main className="flex-1 px-4 py-24 text-center text-sm text-ink-muted">Loading…</main>;
  }
  if (facility === null) return <NotFound />;

  const typeLabel = FACILITY_TYPES[facility.facilityType]?.label ?? facility.facilityType;
  const heroPhoto = facility.coverImageUrl ?? facility.photoUrl ?? placeHeroFor(facility.facilityType);
  const showsVerifiedBadge = facility.plan?.verifiedBadge ?? false;
  const grade = facility.regulatorRating ? REGULATOR_RATINGS[facility.regulatorRating] : null;
  const body = facility.regulator ? REGULATORS[facility.regulator] : null;
  const open = isOpenNow(facility);
  const hours = hoursSummary(facility);

  const chips = facility.categories.map((c) => c.name).slice(0, 3);

  const seoDescription = [
    facility.tagline ?? typeLabel,
    facility.city?.name ? `in ${facility.city.name}` : "in the UK",
    grade && body ? `· ${body.short} rated ${grade.label}` : "",
    facility.ratingCount > 0 ? `· ${facility.ratingAvg.toFixed(1)} from ${facility.ratingCount} reviews` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);

  return (
    <main className="flex flex-1 flex-col bg-paper" style={{ marginTop: -HEADER_HEIGHT }}>
      <Seo
        title={`${facility.name} — ${typeLabel}${facility.city ? ` in ${facility.city.name}` : ""}`}
        description={seoDescription}
        path={`/facilities/${facility.slug}`}
        image={facility.photoUrl ?? undefined}
        jsonLd={facilityJsonLd(facility, SCHEMA_TYPE[facility.facilityType] ?? "MedicalOrganization")}
      />

      {/* ------------------------------------------------------------ Hero */}
      <section
        className="photo-panel photo-panel-deep relative px-5 pb-0 sm:px-8"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundPosition: "center",
          paddingTop: HEADER_HEIGHT + 32,
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-7 sm:flex-row sm:items-start sm:gap-9">
          <div className="glass-frame w-40 shrink-0 rounded-[1.5rem] p-2 sm:w-52">
            {/* A place is 4:3, not 4:5 — a building photographed in
                portrait is a photograph of a wall. */}
            <div className="aspect-[4/3] w-full overflow-hidden rounded-[1.1rem] bg-navy-800">
              <img
                src={facility.photoUrl ?? placeHeroFor(facility.facilityType)}
                alt={facility.name}
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/75">
                <Building2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                {typeLabel}
              </span>
              {showsVerifiedBadge && (
                <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-teal-300">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                  TLS Verified
                </span>
              )}
            </div>

            <h1 className="mt-4 font-display text-[34px] font-bold leading-tight text-white sm:text-[46px]">
              {facility.name}
            </h1>
            {facility.tagline && <p className="mt-1 text-[15px] text-white/75 sm:text-base">{facility.tagline}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-white/70">
              {facility.ratingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber text-amber" strokeWidth={0} />
                  <span className="text-[15px] font-bold text-white">{formatRating(facility.ratingAvg)}</span>
                  <span>({facility.ratingCount} reviews)</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-teal-300" strokeWidth={2} />
                {[facility.address, facility.city?.name, facility.postcode].filter(Boolean).join(", ")}
              </span>
              {open !== null && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-teal-300" strokeWidth={2} />
                  <span className="font-bold text-white">{open ? "Open now" : "Closed"}</span>
                  {hours && !facility.open24h && <span>· {hours}</span>}
                </span>
              )}
            </div>

            {chips.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2.5">
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="glass-chip flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-[13px] font-semibold text-white"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-teal-300">
                      <Stethoscope className="h-4 w-4" strokeWidth={2} />
                    </span>
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <PrimaryAction
          facility={facility}
          onEnquire={() => setEnquiryOpen(true)}
          className="relative mx-auto mt-9 flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13px] font-bold text-navy-950 shadow-xl transition hover:bg-teal-300 sm:hidden"
        />

        {/* The same shelf the specialist profile uses — the button is
            tucked into the panel's top edge rather than left hanging off
            the end of it. See the fuller note on SpecialistProfile. */}
        <div className="relative -mx-5 mt-10 sm:-mx-8 sm:mt-14">
          {/* A straight top edge. Both corners used to curve down into
              the hero; with the shelf's own rise and fall around the
              button, three curves on one line was two too many — the
              eye read them as one wobbling edge rather than a
              deliberate notch. The only shaping left on this line is
              the part that goes around the button. */}
          <div className="h-10 bg-paper" />
          <div className="absolute bottom-0 right-14 hidden h-[4.5rem] items-center rounded-t-[1.5rem] bg-paper px-6 sm:flex">
            <span
              aria-hidden
              className="absolute -left-6 bottom-10 h-6 w-6"
              style={{
                background: "radial-gradient(circle 1.5rem at top left, transparent 1.5rem, var(--paper) 1.5rem)",
              }}
            />
            <span
              aria-hidden
              className="absolute -right-6 bottom-10 h-6 w-6"
              style={{
                background: "radial-gradient(circle 1.5rem at top right, transparent 1.5rem, var(--paper) 1.5rem)",
              }}
            />
            <PrimaryAction
              facility={facility}
              onEnquire={() => setEnquiryOpen(true)}
              className="relative flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Tabs */}
      <div
        className="sticky z-30 border-b border-line bg-paper/95 backdrop-blur"
        style={{ top: HEADER_HEIGHT, height: TAB_BAR_HEIGHT }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center gap-6 overflow-x-auto px-5 sm:px-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => goToSection(tab.id)}
              className={`relative h-full whitespace-nowrap text-[13.5px] font-bold transition ${
                activeTab === tab.id ? "text-teal-700" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-teal-600" />}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8">
        {/* -------------------------------------------------------- Overview */}
        <section
          id="overview"
          ref={(el) => {
            sectionRefs.current.overview = el;
          }}
          className="scroll-mt-32 py-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">About {facility.name}</h2>
              <About text={facility.about ?? facility.description} />
            </div>
            <RegulatorCard facility={facility} />
          </div>

          <StatsBar facility={facility} />
        </section>

        {/* -------------------------------------------------------- Services */}
        <section
          id="services"
          ref={(el) => {
            sectionRefs.current.services = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Services &amp; specialisms</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-muted">
            What this {typeLabel.toLowerCase()} is listed for. Each one is a search category, so you can see everyone
            else offering it nearby.
          </p>
          {facility.categories.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {facility.categories.map((c) => (
                <Link
                  key={c.id}
                  to={`/search?type=${facility.facilityType}&category=${c.slug}`}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 transition hover:border-teal-200 hover:shadow-sm"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper-tint text-teal-700">
                      <Stethoscope className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <span className="truncate text-[14px] font-semibold text-ink">{c.name}</span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-teal-600"
                    strokeWidth={2}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-[14px] text-ink-muted">This listing has not published its services yet.</p>
          )}

          {(facility.insurers.length > 0 || facility.languages.length > 0) && (
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {facility.insurers.length > 0 && (
                <FactList
                  title="Payment and insurers"
                  icon={<BadgeCheck className="h-4 w-4" strokeWidth={2} />}
                  items={facility.insurers}
                />
              )}
              {facility.languages.length > 0 && (
                <FactList
                  title="Languages spoken"
                  icon={<Languages className="h-4 w-4" strokeWidth={2} />}
                  items={facility.languages}
                />
              )}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------ Team */}
        {(facility.team?.length ?? 0) > 0 && (
          <section
            id="team"
            ref={(el) => {
              sectionRefs.current.team = el;
            }}
            className="scroll-mt-32 border-t border-line py-10"
          >
            <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Specialists who practise here</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-muted">
              Listed clinicians with a profile on Top Local Specialists. Each has been checked against their own
              regulator&apos;s register.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {facility.team?.map((member) => (
                <Link
                  key={member.id}
                  to={`/specialists/${member.slug}`}
                  className="group flex gap-4 rounded-2xl border border-line bg-white p-4 transition hover:shadow-md"
                >
                  <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-paper-muted">
                    {member.photoUrl ? (
                      <img src={member.photoUrl} alt={member.fullName} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-paper-tint to-teal-50 font-display text-lg font-bold text-teal-700">
                        {member.fullName
                          .split(" ")
                          .filter((w) => w[0] === w[0]?.toUpperCase())
                          .slice(-2)
                          .map((w) => w[0])
                          .join("")}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-[15px] font-bold leading-tight text-ink group-hover:text-teal-700">
                      {member.fullName}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">{member.role ?? member.title}</p>
                    {member.primarySpecialty && (
                      <p className="mt-1.5 inline-block rounded-full bg-paper-tint px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                        {member.primarySpecialty.name}
                      </p>
                    )}
                    {member.ratingCount > 0 && (
                      <p className="mt-1.5 flex items-center gap-1 text-[12px] text-ink-muted">
                        <Star className="h-3 w-3 fill-amber text-amber" strokeWidth={0} />
                        <span className="font-bold text-ink">{formatRating(member.ratingAvg)}</span>
                        <span>({member.ratingCount})</span>
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ---------------------------------------------- Facilities & access */}
        <section
          id="facilities"
          ref={(el) => {
            sectionRefs.current.facilities = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Facilities &amp; access</h2>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div>
              {facility.amenities.length > 0 ? (
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {facility.amenities.map((slug) => (
                    <li
                      key={slug}
                      className="flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] text-ink ring-1 ring-line"
                    >
                      <Accessibility className="h-4 w-4 shrink-0 text-teal-600" strokeWidth={2} />
                      {amenityLabel(slug)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-ink-muted">
                  This listing has not published its facilities yet. Call ahead if access matters for your visit.
                </p>
              )}

              {facility.accreditations.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Accreditations</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {facility.accreditations.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-paper-tint px-3 py-1.5 text-[12.5px] font-semibold text-teal-700"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <OpeningHoursCard facility={facility} />
          </div>
        </section>

        {/* --------------------------------------------------------- Gallery */}
        {facility.plan?.features.photoGallery && (facility.gallery?.length ?? 0) > 0 && (
          <section
            id="gallery"
            ref={(el) => {
              sectionRefs.current.gallery = el;
            }}
            className="scroll-mt-32 border-t border-line py-10"
          >
            <Gallery images={facility.gallery ?? []} />
          </section>
        )}

        {/* --------------------------------------------------------- Reviews */}
        <section
          id="reviews"
          ref={(el) => {
            sectionRefs.current.reviews = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <Reviews facility={facility} />
        </section>

        {/* -------------------------------------------------------- Location */}
        <section
          id="location"
          ref={(el) => {
            sectionRefs.current.location = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Location &amp; contact</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white p-5">
              {/* The address on the left, the map on the right, side by
                  side — somebody choosing a hospital or a care home is
                  choosing partly on where it is, and the two belong next
                  to each other rather than one under the other. */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <p className="flex min-w-0 flex-1 items-start gap-2.5 text-[14px] leading-relaxed text-ink">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" strokeWidth={2} />
                  <span>
                    {facility.address && (
                      <>
                        {facility.address}
                        <br />
                      </>
                    )}
                    {facility.city?.name}
                    {facility.postcode ? `, ${facility.postcode}` : ""}
                    {facility.city?.region ? (
                      <>
                        <br />
                        <span className="text-ink-muted">{facility.city.region}</span>
                      </>
                    ) : null}
                  </span>
                </p>

                <MapPreview
                  lat={facility.lat}
                  lng={facility.lng}
                  address={[facility.name, facility.address, facility.city?.name, facility.postcode]
                    .filter(Boolean)
                    .join(", ")}
                  fallback={
                    facility.city
                      ? { lat: facility.city.lat, lng: facility.city.lng, label: facility.city.name }
                      : null
                  }
                  size={220}
                  className="shrink-0"
                  quiet
                />
              </div>

              <div className="mt-5 space-y-2.5 border-t border-line-soft pt-5 text-[13.5px]">
                {facility.phone && (
                  <a href={`tel:${facility.phone.replace(/\s/g, "")}`} className="flex items-center gap-2.5 text-ink transition hover:text-teal-700">
                    <Phone className="h-4 w-4 text-ink-faint" strokeWidth={2} />
                    {facility.phone}
                  </a>
                )}
                {facility.websiteUrl && (
                  <a
                    href={facility.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-2.5 text-ink transition hover:text-teal-700"
                  >
                    <Globe className="h-4 w-4 text-ink-faint" strokeWidth={2} />
                    Visit website
                    <ExternalLink className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
                  </a>
                )}

                {/* The same coloured marks as a specialist's profile —
                    one directory, one treatment. */}
                {(() => {
                  const socials = facility.socials ?? {};
                  const links = SOCIAL_BRANDS.map((brand) => ({
                    brand,
                    href: socials[brand.key] as string | null | undefined,
                  })).filter((l) => Boolean(l.href));
                  if (links.length === 0) return null;
                  return (
                    <div className="flex items-center gap-1.5 pt-1">
                      {links.map(({ brand, href }) => (
                        <a
                          key={brand.key}
                          href={href as string}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`${facility.name} on ${brand.name}`}
                          title={brand.name}
                          className="grid h-9 w-9 place-items-center rounded-xl transition hover:scale-110"
                          style={{ backgroundColor: brand.tint }}
                        >
                          <SocialGlyph platform={brand.key} className="h-[17px] w-[17px]" />
                        </a>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* An external map rather than an embedded one: a place's
                  own coordinates are enough to hand the visitor over to
                  whatever they navigate with, without loading a
                  third-party tracker onto a health page. */}
              <a
                href={
                  facility.lat != null && facility.lng != null
                    ? `https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lng}#map=17/${facility.lat}/${facility.lng}`
                    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(
                        [facility.name, facility.address, facility.city?.name, facility.postcode]
                          .filter(Boolean)
                          .join(", ")
                      )}`
                }
                target="_blank"
                rel="noreferrer noopener"
                className="mt-5 flex items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal-200 hover:text-teal-700"
              >
                Open in maps
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              </a>
            </div>

            <div className="rounded-2xl border border-line bg-paper-muted p-5">
              <h3 className="text-base font-bold text-ink">Get in touch</h3>
              <p className="mt-1 text-[13.5px] text-ink-muted">
                Send an enquiry directly — no account needed. It goes to {facility.name}, not to us.
              </p>
              <div className="mt-4">
                <EnquiryForm facilityId={facility.id} recipientName={facility.name} />
              </div>
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={enquiryOpen}
        onClose={() => setEnquiryOpen(false)}
        title={`Enquire with ${facility.name}`}
        description="Your message goes straight to this listing. No account needed."
      >
        <EnquiryForm facilityId={facility.id} recipientName={facility.name} />
      </Dialog>
    </main>
  );
}

/* ------------------------------------------------------------ pieces */

function PrimaryAction({
  facility,
  onEnquire,
  className,
}: {
  facility: FacilityWithRelations;
  onEnquire: () => void;
  className: string;
}) {
  // A booking link is a paid feature, and the API has already withheld
  // it if the plan does not include one — so the button that appears is
  // always a button that works.
  if (facility.bookingUrl) {
    return (
      <a href={facility.bookingUrl} target="_blank" rel="noreferrer noopener" className={className}>
        <CalendarClock className="h-4 w-4" strokeWidth={2.5} />
        Book an appointment
      </a>
    );
  }
  return (
    <button type="button" onClick={onEnquire} className={className}>
      <MessageSquareQuote className="h-4 w-4" strokeWidth={2.5} />
      Send an enquiry
    </button>
  );
}

function About({ text }: { text: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) {
    return <p className="mt-4 text-[14.5px] leading-relaxed text-ink-muted">This listing has not written a description yet.</p>;
  }
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const shown = expanded ? paragraphs : paragraphs.slice(0, 1);
  return (
    <div className="mt-4">
      {shown.map((p, i) => (
        <p key={i} className="mt-3 text-[14.5px] leading-relaxed text-ink-muted first:mt-0">
          {p}
        </p>
      ))}
      {paragraphs.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-[13px] font-bold text-teal-600 hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

/**
 * The regulator panel. This is the fact a provider's own website will
 * never volunteer, so it gets its own card, cites the body by name, and
 * links to the public report rather than asking to be believed.
 */
function RegulatorCard({ facility }: { facility: FacilityWithRelations }) {
  const body = facility.regulator ? REGULATORS[facility.regulator] : null;
  const grade = facility.regulatorRating ? REGULATOR_RATINGS[facility.regulatorRating] : null;
  if (!body) return null;

  return (
    <aside className="h-fit rounded-2xl border border-line bg-white p-5">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Regulator</h3>
      <p className="mt-2.5 text-[14px] font-bold text-ink">{body.name}</p>
      <p className="text-[12.5px] text-ink-muted">Inspects services in {body.nation}</p>

      {grade ? (
        <p className={`mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13.5px] font-bold ring-1 ${grade.chip}`}>
          <span className={`h-2 w-2 rounded-full ${grade.dot}`} />
          {grade.label}
        </p>
      ) : (
        <p className="mt-4 rounded-xl bg-paper-tint px-3 py-2.5 text-[13px] text-ink-muted ring-1 ring-line">
          Registered, with no published rating for this location.
        </p>
      )}

      <dl className="mt-4 space-y-1.5 border-t border-line-soft pt-4 text-[12.5px]">
        {facility.regulatorRef && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Registration</dt>
            <dd className="font-semibold text-ink">{facility.regulatorRef}</dd>
          </div>
        )}
        {facility.regulatorRatedAt && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Last inspected</dt>
            <dd className="font-semibold text-ink">
              {new Date(facility.regulatorRatedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </dd>
          </div>
        )}
      </dl>

      {facility.regulatorUrl && (
        <a
          href={facility.regulatorUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 flex items-center justify-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-bold text-ink transition hover:border-teal-200 hover:text-teal-700"
        >
          Read the inspection report
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      )}
    </aside>
  );
}

/** The strip of hard numbers under the overview. */
function StatsBar({ facility }: { facility: FacilityWithRelations }) {
  const stats = [
    facility.yearEstablished != null && {
      icon: Building2,
      value: String(new Date().getFullYear() - facility.yearEstablished),
      label: `years open · since ${facility.yearEstablished}`,
    },
    facility.bedCount != null && { icon: BedDouble, value: String(facility.bedCount), label: "beds" },
    facility.staffCount != null && { icon: Users, value: String(facility.staffCount), label: "staff" },
    (facility.team?.length ?? 0) > 0 && {
      icon: Stethoscope,
      value: String(facility.team?.length),
      label: "listed specialists",
    },
    facility.ratingCount > 0 && {
      icon: Star,
      value: formatRating(facility.ratingAvg),
      label: `from ${facility.ratingCount} reviews`,
    },
  ].filter(Boolean) as { icon: typeof Building2; value: string; label: string }[];

  if (stats.length === 0) return null;

  return (
    <div className="mt-8 grid gap-3 rounded-2xl border border-line bg-white p-2 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-3 rounded-xl px-3 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-tint text-teal-700">
            <s.icon className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[20px] font-bold leading-none text-ink tabular-nums">{s.value}</span>
            <span className="mt-1 block truncate text-[12px] text-ink-muted">{s.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FactList({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
        <span className="text-teal-600">{icon}</span>
        {title}
      </h3>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded-full bg-paper-tint px-2.5 py-1 text-[12.5px] font-semibold text-ink">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function OpeningHoursCard({ facility }: { facility: FacilityWithRelations }) {
  const todayKey = DAY_KEYS[(new Date().getDay() + 6) % 7];

  if (facility.open24h) {
    return (
      <aside className="h-fit rounded-2xl border border-line bg-white p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Opening hours</h3>
        <p className="mt-3 flex items-center gap-2 text-[14px] font-bold text-teal-700">
          <Clock className="h-4 w-4" strokeWidth={2} />
          Open 24 hours, every day
        </p>
        {facility.emergencyDepartment && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-800 ring-1 ring-rose-200">
            Emergency department — no appointment or referral needed.
          </p>
        )}
      </aside>
    );
  }

  if (!facility.openingHours) {
    return (
      <aside className="h-fit rounded-2xl border border-line bg-white p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Opening hours</h3>
        {/* Deliberately not "Closed": nobody has told us the hours, and
            saying "closed" would turn a missing field into a claim. */}
        <p className="mt-3 text-[13.5px] text-ink-muted">
          This listing has not published its opening hours. Call ahead before travelling.
        </p>
      </aside>
    );
  }

  return (
    <aside className="h-fit rounded-2xl border border-line bg-white p-5">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Opening hours</h3>
      <dl className="mt-3 space-y-1">
        {DAY_KEYS.map((key) => {
          const day = facility.openingHours?.[key];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-[13.5px] ${
                isToday ? "bg-paper-tint font-bold text-ink" : "text-ink-muted"
              }`}
            >
              <dt>{DAY_LABELS[key]}</dt>
              <dd className="tabular-nums">{day ? `${day.open} – ${day.close}` : "Closed"}</dd>
            </div>
          );
        })}
      </dl>
      {facility.openingHours.notes && (
        <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-ink-muted">
          {facility.openingHours.notes}
        </p>
      )}
    </aside>
  );
}

function Gallery({ images }: { images: { url: string; caption: string | null }[] }) {
  const [index, setIndex] = useState(0);
  const current = images[index];
  if (!current) return null;

  return (
    <div>
      <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Gallery</h2>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-navy-900">
        <div className="relative aspect-[16/9]">
          <img src={current.url} alt={current.caption ?? ""} className="h-full w-full object-cover" />
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white transition hover:bg-black/65"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => setIndex((i) => (i + 1) % images.length)}
                className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white transition hover:bg-black/65"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
        {current.caption && <p className="px-5 py-3 text-[13px] text-white/80">{current.caption}</p>}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setIndex(i)}
              className={`h-14 w-20 overflow-hidden rounded-lg ring-2 transition ${
                i === index ? "ring-teal-500" : "ring-transparent hover:ring-line"
              }`}
            >
              <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SCORE_LABELS: { key: keyof NonNullable<FacilityWithRelations["reviewScores"]>; label: string }[] = [
  { key: "communication", label: "Communication" },
  { key: "expertise", label: "Expertise" },
  { key: "care", label: "Care" },
  { key: "waitTime", label: "Wait time" },
];

function Reviews({ facility }: { facility: FacilityWithRelations }) {
  const [writeOpen, setWriteOpen] = useState(false);
  const [reviews, setReviews] = useState<Review[]>(facility.reviews ?? []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReviews(facility.reviews ?? []);
    setPage(1);
  }, [facility.slug, facility.reviews]);

  async function loadMore() {
    setLoading(true);
    try {
      const next = await getFacilityReviews(facility.slug, page + 1);
      setReviews((prev) => [...prev, ...next.results]);
      setPage(next.page);
      setTotalPages(next.totalPages);
    } finally {
      setLoading(false);
    }
  }

  const scores = facility.reviewScores;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Reviews</h2>
        <div className="flex flex-wrap items-center gap-4">
          {facility.ratingCount > 0 && (
            <p className="flex items-center gap-2 text-[14px] text-ink-muted">
              <Star className="h-4 w-4 fill-amber text-amber" strokeWidth={0} />
              <span className="text-[18px] font-bold text-ink">{formatRating(facility.ratingAvg)}</span>
              <span>from {facility.ratingCount} reviews</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => setWriteOpen(true)}
            className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal-200 hover:text-teal-700"
          >
            <PenLine className="h-4 w-4 text-teal-600" strokeWidth={2} />
            Write a review
          </button>
        </div>
      </div>

      {/* Every review here has been read by a moderator before it was
          published — that is what the line is for, and it is only true
          because the API never serves an unapproved one. */}
      <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
        <ShieldCheck className="h-3.5 w-3.5 text-teal-600" strokeWidth={2} />
        Every review is checked by our team before it appears.
      </p>

      {scores && SCORE_LABELS.some((s) => scores[s.key] != null) && (
        <div className="mt-6 grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          {SCORE_LABELS.filter((s) => scores[s.key] != null).map((s) => (
            <div key={s.key}>
              <p className="flex items-baseline justify-between text-[12.5px] text-ink-muted">
                {s.label}
                <span className="font-bold text-ink tabular-nums">{Number(scores[s.key]).toFixed(1)}</span>
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-tint">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${(Number(scores[s.key]) / 5) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-ink-muted">
          No reviews yet. Be the first to write one after your visit.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1" aria-label={`${review.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-4 w-4 ${n <= review.rating ? "fill-amber text-amber" : "fill-line text-line"}`}
                      strokeWidth={0}
                    />
                  ))}
                </span>
                {review.verified && (
                  <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-700">
                    <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                    Verified visit
                  </span>
                )}
              </div>
              {review.comment && (
                <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{review.comment}</p>
              )}
              <p className="mt-3 text-[12.5px] font-semibold text-ink-faint">
                {review.patientName ?? "Anonymous"} ·{" "}
                {new Date(review.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {page < totalPages && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-5 rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal-200 hover:text-teal-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Show more reviews"}
        </button>
      )}

      <Dialog
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        size="lg"
        title={`Review ${facility.name}`}
        description="Your review is read by our team before it appears."
      >
        <ReviewForm
          subject="facility"
          slug={facility.slug}
          name={facility.name}
          // No "seen for" on a place. That field is tied to the clinical
          // conditions table, and a hospital's service categories are a
          // different vocabulary — offering them would store a value the
          // server has to throw away.
        />
      </Dialog>
    </div>
  );
}
