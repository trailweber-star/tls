import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Compass,
  FlaskConical,
  Globe,
  GraduationCap,
  Lock,
  Mail,
  MapPin,
  MessageSquareQuote,
  PenLine,
  Phone,
  Play,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Trophy,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getAllSpecialties, getSpecialistBySlug, getSpecialistReviews } from "../lib/api";
import { formatAvailability, formatPrice, formatRating } from "../lib/format";
import { EnquiryForm } from "../components/EnquiryForm";
import { BookingWidget } from "../components/BookingWidget";
import { MapPreview } from "../components/MapPreview";
import { Dialog } from "../components/Dialog";
import { ReviewForm } from "../components/ReviewForm";
import { SOCIAL_BRANDS, SocialGlyph } from "../lib/socialBrands";
import { heroPhotoFor } from "../lib/specialtyHeroes";
import { HEADER_HEIGHT } from "../components/Header";
import NotFound from "./NotFound";
import type { Review, SpecialistWithRelations, Specialty } from "../lib/types";
import { specialistJsonLd } from "../lib/structuredData";
import { Seo } from "../components/Seo";

/**
 * Tabs are computed per specialist rather than fixed: Gallery only
 * exists when the plan includes one AND images have been added, so a
 * Basic listing never shows a tab that leads to an empty section.
 */
function tabsFor(specialist: SpecialistWithRelations, isMedicoLegal = false) {
  const gallery = specialist.plan?.features.photoGallery && (specialist.gallery ?? []).length > 0;
  // A medico-legal listing has no clinic address and names case types,
  // not procedures -- so it gets no Treatments tab and no Locations
  // tab, and "Expertise" is relabelled to what it actually lists. See
  // the isMedicoLegal branch throughout this file for why: this is a
  // person who writes expert reports for solicitors, not a clinician a
  // patient books, and the clinical layout's own words (Treatments,
  // Book an appointment, Patient Reviews) are wrong for that job.
  return [
    { id: "overview", label: "Overview" },
    { id: "expertise", label: isMedicoLegal ? "Practice Areas" : "Expertise" },
    ...(isMedicoLegal ? [] : [{ id: "treatments", label: "Treatments" }]),
    ...(gallery ? [{ id: "gallery", label: "Gallery" }] : []),
    { id: "reviews", label: "Reviews" },
    ...(isMedicoLegal ? [] : [{ id: "locations", label: "Locations" }]),
  ];
}

/* ------------------------------------------------------------------ *
 * What the Treatments section actually has to show
 *
 * Two states, and each fact on this page belongs to exactly one of
 * them.
 *
 *   1. The listing names procedures, or conditions, or both. Show them.
 *      Conditions count: in a 623-listing sample, one in three of the
 *      listings that named anything at all named a condition and no
 *      procedure, and the page used to tell those visitors the
 *      clinician "hasn't listed individual treatments yet" while the
 *      record held Tennis Elbow, Endometriosis, Sciatica. That was not
 *      a missing feature, it was the page contradicting its database.
 *   2. The listing names neither. Say so, and stop.
 *
 * THERE WAS A THIRD STATE AND IT WAS A MISTAKE. When a listing named
 * nothing, this filled the section with the subcategories the mapper
 * resolved, labelled "Areas of practice", under a note explaining that
 * they were not procedures. The intention was to avoid ending on a
 * dead sentence. The effect was that Treatments restated Areas of
 * Expertise, verbatim, one screen below it -- on the 1,042 listings
 * that name nothing the two sections were word-for-word identical, and
 * on every other listing Expertise was ALSO rendering the treatments
 * and conditions, so the repetition was there too, just less obvious.
 * Two headings over one set of facts does not add information; it makes
 * a page look padded, and it teaches a reader that the second heading
 * is not worth reading.
 *
 * So the division is now by kind, and each fact appears once:
 *
 *   Areas of Expertise   where the listing is FILED -- its specialties
 *   Treatments           what it DOES -- procedures and conditions
 *
 * The one thing the old block genuinely added was a link out to others
 * in the same area, which the Expertise chips did not have. They have
 * it now, so nothing was lost by deleting the block. A named treatment
 * or condition goes to free-text search, which matches those names; a
 * specialty goes to its own filter value, which is exact.
 * ------------------------------------------------------------------ */
type PracticeGroup = {
  key: string;
  label: string;
  items: { key: string; name: string; href: string }[];
};

/* A root branch and a subcategory are different filters, and sending a
   root to ?subspecialty= matches nothing — a link that looks like it
   works and returns an empty directory.

   Which one a chip is has to come from the taxonomy, not from the
   profile payload: the payload does carry parentId, but the type it is
   declared under does not promise it, and a link that silently depends
   on an undeclared field is one refactor away from breaking quietly.
   Until the taxonomy has loaded, free-text search — it matches the same
   names and is never empty for a specialty that exists. */
function specialtyHrefIn(taxonomy: Specialty[]) {
  const bySlug = new Map(taxonomy.map((s) => [s.slug, s]));
  return (sp: { slug: string; name: string }) => {
    const node = bySlug.get(sp.slug);
    if (!node) return `/search?q=${encodeURIComponent(sp.name)}`;
    return `/search?${node.parentId ? "subspecialty" : "specialty"}=${encodeURIComponent(sp.slug)}`;
  };
}

function practiceGroups(s: SpecialistWithRelations): { groups: PracticeGroup[] } {
  /* One shared seen-set across the groups: a name that appeared as a
     procedure should not appear again under conditions. */
  const seen = new Set<string>();
  const fresh = <T extends { name: string }>(xs: T[]) =>
    xs.filter((x) => {
      const key = (x.name ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const groups: PracticeGroup[] = [];
  const search = (name: string) => `/search?q=${encodeURIComponent(name)}`;

  const procedures = fresh(s.treatments);
  if (procedures.length) {
    groups.push({
      key: "procedures",
      label: "Procedures",
      items: procedures.map((t) => ({ key: `tr-${t.id}`, name: t.name, href: search(t.name) })),
    });
  }

  const conditions = fresh(s.conditions);
  if (conditions.length) {
    groups.push({
      key: "conditions",
      label: "Conditions treated",
      items: conditions.map((c) => ({ key: `co-${c.id}`, name: c.name, href: search(c.name) })),
    });
  }

  return { groups };
}

const TAB_BAR_HEIGHT = 56;

// Icons cycle across the hero's specialty chips — decoration only, so a
// specialty without a bespoke icon still gets a sensible one.
const CHIP_ICONS = [Activity, Stethoscope, Sparkles];

function initialsOf(fullName: string) {
  return fullName
    .split(" ")
    .filter((w) => w[0] === w[0]?.toUpperCase())
    .slice(-2)
    .map((w) => w[0])
    .join("");
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SpecialistProfile() {
  const { slug = "" } = useParams();
  const [specialist, setSpecialist] = useState<SpecialistWithRelations | null | undefined>(undefined);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  useEffect(() => {
    setSpecialist(undefined);
    getSpecialistBySlug(slug)
      .then(setSpecialist)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this profile"));
  }, [slug]);

  // The taxonomy is needed to walk from the specialist's narrow specialty
  // up to its top-level parent, which is what picks the hero photo.
  useEffect(() => {
    getAllSpecialties().then(setSpecialties).catch(() => setSpecialties([]));
  }, []);

  const topLevelSlug = useMemo(() => {
    if (!specialist?.primarySpecialty || specialties.length === 0) return null;
    const byId = new Map(specialties.map((s) => [s.id, s]));
    let node = specialties.find((s) => s.slug === specialist.primarySpecialty?.slug) ?? null;
    while (node?.parentId) node = byId.get(node.parentId) ?? null;
    return node?.slug ?? null;
  }, [specialist, specialties]);

  const hrefForSpecialty = useMemo(() => specialtyHrefIn(specialties), [specialties]);

  // The one signal this whole page branches on. A medico-legal listing
  // is filed under the Expert Witness root (however deep the leaf that
  // tagged it sits under that root) -- topLevelSlug already walks the
  // taxonomy up to find it, so no second lookup is needed.
  const isMedicoLegal = topLevelSlug === "expert-witness";

  // Highlight the tab whose section is currently in view.
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!specialist) return;
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
  }, [specialist]);

  const tabs = useMemo(
    () => (specialist ? tabsFor(specialist, isMedicoLegal) : []),
    [specialist, isMedicoLegal]
  );

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
  if (specialist === undefined) {
    return <main className="flex-1 px-4 py-24 text-center text-sm text-ink-muted">Loading…</main>;
  }
  if (specialist === null) return <NotFound />;

  const location = specialist.clinicLocations[0];
  const availability = formatAvailability(specialist.nextAvailableAt);
  // Two conditions, both required: we checked their registration AND
  // their plan includes the badge. The API decides and sends the answer,
  // so the page can never display a badge the plan didn't buy.
  const showsVerifiedBadge = specialist.plan?.verifiedBadge ?? false;
  const heroPhoto = heroPhotoFor(topLevelSlug);

  // Hero chips: the specialist's own taxonomy tags, broadest first.
  const chips = [
    ...specialist.specialties.map((s) => s.name),
    ...specialist.treatments.map((t) => t.name),
  ]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 3);

  const practice = practiceGroups(specialist);

  const primaryLocation = specialist.clinicLocations[0] ?? null;
  const seoDescription = [
    specialist.title ?? "Specialist",
    primaryLocation?.city?.name
      ? `in ${primaryLocation.city.name}`
      : isMedicoLegal && specialist.coveredRegions?.length
        ? `covering ${specialist.coveredRegions.join(", ")}`
        : "in the UK",
    specialist.yearsExperience ? `· ${specialist.yearsExperience} years' experience` : "",
    specialist.ratingCount > 0 ? `· rated ${specialist.ratingAvg.toFixed(1)} from ${specialist.ratingCount} reviews` : "",
    // Only claimed where it is true. An unclaimed listing has had no
    // regulator check, and saying so in the description that Google
    // shows would be the site asserting something it has not done.
    showsVerifiedBadge ? "· credentials checked against the regulator." : "· unclaimed listing.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);

  return (
    <main className="flex flex-1 flex-col bg-paper" style={{ marginTop: -HEADER_HEIGHT }}>
      {/* The directory's highest-value pages for search, so each one
          describes this specialist specifically and carries Physician
          structured data — that is what produces a rich result with the
          star rating rather than a bare blue link. Ratings are only
          published when reviews actually exist. */}
      <Seo
        title={`${specialist.fullName}${specialist.title ? ` — ${specialist.title}` : ""}`}
        description={seoDescription}
        path={`/specialists/${specialist.slug}`}
        image={specialist.photoUrl ?? undefined}
        jsonLd={specialistJsonLd(specialist)}
      />

      {/* ---------------------------------------------------------------- Hero */}
      <section
        className="photo-panel photo-panel-deep relative px-5 pb-0 sm:px-8"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundPosition: "center right",
          paddingTop: HEADER_HEIGHT + 32,
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-7 sm:flex-row sm:items-start sm:gap-9">
          <div className="glass-frame w-40 shrink-0 rounded-[1.5rem] p-2 sm:w-52">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-[1.1rem] bg-navy-800">
              {specialist.photoUrl ? (
                <img src={specialist.photoUrl} alt={specialist.fullName} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center font-display text-4xl font-bold text-white/80">
                  {initialsOf(specialist.fullName)}
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {/* One chip, and only one. A listing is either checked by us
                or it is not, and the unclaimed case needs saying out
                loud rather than leaving a gap where a badge would be:
                these profiles are built from public professional
                listings, the person has not been near the site, and a
                patient deserves to know that before they read it as an
                endorsement. */}
            {/* Runs on ClinWell.

                The wording is fixed by the contract (§5: "Badge copy on
                TLS should say 'Runs on ClinWell', nothing stronger") and
                it sits deliberately apart from TLS Verified. The two say
                different things: one is a software subscription, the
                other is a person having checked a licence against a
                regulator's register. Anything implying ClinWell vouches
                for the clinician would be a claim neither company has
                made.

                Shown only when the nightly push last confirmed it
                within 72 hours — see the badge expiry in
                clinwellStatus.controller.js. */}
            {specialist.clinwellLive && (
              <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/70">
                <Stethoscope className="h-3.5 w-3.5" strokeWidth={2.5} />
                Runs on ClinWell
              </span>
            )}
            {showsVerifiedBadge ? (
              <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-teal-300">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                TLS Verified
              </span>
            ) : (
              !specialist.claimed && (
                <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/60">
                  <UserCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Unclaimed listing
                </span>
              )
            )}

            <h1 className="mt-4 font-display text-[34px] font-bold leading-tight text-white sm:text-[46px]">
              {specialist.fullName}
            </h1>
            {/* The letters after the name. On a directory of clinicians
                these are not decoration — they are the qualification a
                patient is checking for, and they belong beside the name
                rather than buried in a bio nobody reads to the end. */}
            {specialist.qualifications && (
              <p className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-teal-300/90">
                {specialist.qualifications}
              </p>
            )}
            {specialist.title && <p className="mt-1 text-[15px] text-white/75 sm:text-base">{specialist.title}</p>}
            {!!specialist.yearsExperience && (
              <p className="mt-1 text-[13.5px] font-semibold text-white/55">
                {specialist.yearsExperience} years experience
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-white/70">
              {specialist.ratingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber text-amber" strokeWidth={0} />
                  <span className="text-[15px] font-bold text-white">{formatRating(specialist.ratingAvg)}</span>
                  <span>({specialist.ratingCount} reviews)</span>
                </span>
              )}
              {location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-teal-300" strokeWidth={2} />
                  {[location.city?.name, location.address].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>

            {!specialist.claimed && <ClaimInvite specialist={specialist} />}

            {chips.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2.5">
                {chips.map((chip, i) => {
                  const Icon = CHIP_ICONS[i % CHIP_ICONS.length];
                  return (
                    <span
                      key={chip}
                      className="glass-chip flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-[13px] font-semibold text-white"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-teal-300">
                        <Icon className="h-4 w-4" strokeWidth={2} />
                      </span>
                      {chip}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Phones: in flow, since the page has no room beside the panel
            for a floating button at this width. */}
        <PrimaryAction
          specialist={specialist}
          onBook={() => setBookingOpen(true)}
          onEnquire={() => setEnquiryOpen(true)}
          isMedicoLegal={isMedicoLegal}
          className="relative mx-auto mt-9 flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13px] font-bold text-navy-950 shadow-xl transition hover:bg-teal-300 sm:hidden"
        />

        {/* The curve, and the shelf the button sits in.
            ------------------------------------------------------------
            The white content panel starts here, inside the hero so the
            photo carries on behind it. Its top edge used to stop 19rem
            short of the right so the button could float on the dark
            ground beside it — which left the button hanging off the end
            of the panel with nothing holding it.

            It is now tucked into the panel instead. The top edge runs
            along, curves up around the button's length, and curves back
            down again at the far end: the button sits in a shelf that is
            part of the panel rather than beside it. The two small
            squares are the concave joins — a rounded corner bends the
            wrong way for this, so each is a quarter-disc carved out of a
            paper-coloured square, which is what turns two straight edges
            meeting at a right angle into one continuous line.

            Full-bleed via negative margins that cancel the section's own
            padding. */}
        <div className="relative -mx-5 mt-10 sm:-mx-8 sm:mt-14">
          {/* A straight top edge. Both corners used to curve down into
              the hero; with the shelf's own rise and fall around the
              button, three curves on one line was two too many — the
              eye read them as one wobbling edge rather than a
              deliberate notch. The only shaping left on this line is
              the part that goes around the button. */}
          <div className="h-10 bg-paper" />

          {/* Desktop only: at phone width there is no room beside the
              panel, and the button is already in the flow above. */}
          {/* right-14 places the descent so it finishes level with the
              page's right content edge, leaving the last stretch of the
              panel's top edge running flat to the bleed. */}
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
              specialist={specialist}
              onBook={() => setBookingOpen(true)}
              onEnquire={() => setEnquiryOpen(true)}
              isMedicoLegal={isMedicoLegal}
              className="relative flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- Tabs */}
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
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-teal-600" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8">
        {/* ------------------------------------------------------ Overview */}
        <section
          id="overview"
          ref={(el) => {
            sectionRefs.current.overview = el;
          }}
          className="scroll-mt-32 py-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">
                About {specialist.fullName}
              </h2>
              <Bio text={specialist.bio || (isMedicoLegal && specialist.clinicalPracticeExperience) || null} facts={factsOnFile(specialist)} />
            </div>
            {specialist.videoUrl && (
              <IntroVideo
                url={specialist.videoUrl}
                thumbnailUrl={specialist.videoThumbnailUrl}
                durationSeconds={specialist.videoDurationSeconds}
                name={specialist.fullName}
              />
            )}
          </div>

          <StatsBar specialist={specialist} isMedicoLegal={isMedicoLegal} />
        </section>

        {/* ----------------------------------------------------- Expertise */}
        <section
          id="expertise"
          ref={(el) => {
            sectionRefs.current.expertise = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">
            {isMedicoLegal ? "Practice Areas" : "Areas of Expertise"}
          </h2>
          {isMedicoLegal && (
            <p className="mt-1.5 text-[13.5px] text-ink-muted">
              The case types {specialist.fullName} provides expert reports and opinion for.
            </p>
          )}
          {/* THE SPECIALTIES, AND NOTHING ELSE. This used to append every
              condition and every treatment as well, which made it a
              second copy of the Treatments section below — see the note
              above practiceGroups. "Areas of expertise" means the
              branches this listing is filed under; what it treats has
              its own heading.

              Each chip is a link because that is the one thing the
              duplicated block did that these did not. */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {specialist.specialties
              .filter((sp, i, arr) => arr.findIndex((x) => x.name === sp.name) === i)
              .map((sp) => {
                const isPrimary = sp.id === specialist.primarySpecialty?.id;
                return (
                  <Link
                    key={`sp-${sp.id}`}
                    to={hrefForSpecialty(sp)}
                    className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                      isPrimary
                        ? "bg-teal-100 text-teal-700 ring-1 ring-teal-100 hover:bg-teal-200"
                        : "border border-line bg-white text-ink-muted hover:border-teal-300 hover:text-ink"
                    }`}
                  >
                    {sp.name}
                  </Link>
                );
              })}
          </div>
          {specialist.languages.length > 0 && (
            <p className="mt-5 text-[13.5px] text-ink-muted">
              Speaks <span className="font-semibold text-ink">{specialist.languages.join(", ")}</span>
            </p>
          )}
          {(specialist.coveredRegions?.length ?? 0) > 0 && (
            <p className="mt-2 text-[13.5px] text-ink-muted">
              Covers <span className="font-semibold text-ink">{specialist.coveredRegions!.join(", ")}</span>
            </p>
          )}
          {isMedicoLegal && <MedicoLegalCV specialist={specialist} />}
        </section>

        {/* ---------------------------------------------------- Treatments
            Medico-legal listings skip this section outright rather than
            rendering it empty. "Treatments" and "Conditions treated" are
            what a clinician DOES to a patient -- an expert witness writes
            reports for solicitors, and forcing that into a Treatments
            heading is exactly the wrong-fields complaint this branch
            exists to fix. */}
        {!isMedicoLegal && (
        <section
          id="treatments"
          ref={(el) => {
            sectionRefs.current.treatments = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Treatments</h2>
          {practice.groups.length > 0 ? (
            <div className="mt-5 space-y-7">
              {practice.groups.map((group) => (
                <div key={group.key}>
                  <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                    {group.label}
                  </h3>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {group.items.map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3"
                      >
                        <span className="text-[13.5px] font-semibold text-ink">{item.name}</span>
                        <Link
                          to={item.href}
                          className="shrink-0 text-[12.5px] font-bold text-teal-600 hover:underline"
                        >
                          Compare
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            /* Nothing, said once. Not "hasn't listed yet", which blames a
               clinician who has never seen this page — most of these
               listings were migrated, and what the old site held was a
               category and a paragraph, never a list of procedures. The
               specialties are above under their own heading; repeating
               them here is what this sentence replaced. */
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
              No individual procedures or conditions are listed for {specialist.fullName}. The areas
              above are where this listing is filed.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-paper-muted px-5 py-4 text-[13.5px]">
            {specialist.consultationPriceMinor != null && (
              <span className="text-ink-muted">
                Consultation from{" "}
                <span className="font-bold text-ink">
                  {formatPrice(specialist.consultationPriceMinor, specialist.currency)}
                </span>
              </span>
            )}
            {availability && (
              <span className="flex items-center gap-1.5 text-ink-muted">
                <CalendarClock className="h-4 w-4 text-teal-600" strokeWidth={2} />
                Next available <span className="font-bold text-ink">{availability}</span>
              </span>
            )}
          </div>
        </section>
        )}

        {/* ------------------------------------------------------- Gallery */}
        {specialist.plan?.features.photoGallery && (specialist.gallery ?? []).length > 0 && (
          <section
            id="gallery"
            ref={(el) => {
              sectionRefs.current.gallery = el;
            }}
            className="scroll-mt-32 border-t border-line py-10"
          >
            <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Clinic &amp; facilities</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-muted">
              Photographs supplied by {specialist.fullName}&apos;s practice.
            </p>
            <Gallery images={specialist.gallery ?? []} />
          </section>
        )}

        {/* ------------------------------------------------------- Reviews */}
        <section
          id="reviews"
          ref={(el) => {
            sectionRefs.current.reviews = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <Reviews specialist={specialist} isMedicoLegal={isMedicoLegal} />
        </section>

        {/* ----------------------------------------------------- Locations
            Medico-legal listings don't have one -- they cover regions,
            not a clinic address, and that's already shown under Practice
            Areas above. */}
        {!isMedicoLegal && (
        <section
          id="locations"
          ref={(el) => {
            sectionRefs.current.locations = el;
          }}
          className="scroll-mt-32 border-t border-line py-10"
        >
          <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">Locations</h2>
          {/* The same two columns as the reviews above, in the same
              proportions: the addresses on the left, under the review,
              and the map on the far right, under the rating breakdown.
              Anything added to that right-hand rail later — an intro
              video, for instance — lands in the same column, which is
              what makes the page read as two rails rather than a stack
              of unrelated rows. */}
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="grid gap-4">
            {specialist.clinicLocations.map((l) => (
              <div key={l.id} className="rounded-xl border border-line bg-white p-5">
                <div className="min-w-0">
                  {/* An address with no clinic is the specialist's own
                      practice — added from their dashboard, belonging to
                      no clinic. It has no page to link to, so the
                      heading is what it is rather than a link to
                      nowhere. This line used to read `l.clinic.slug`
                      unconditionally, which threw and took the whole
                      page white the moment a specialist edited their own
                      locations. */}
                  {l.clinic ? (
                    <Link
                      to={`/clinics/${l.clinic.slug}`}
                      className="font-display text-[16px] font-bold text-ink hover:text-teal-700"
                    >
                      {l.clinic.name}
                    </Link>
                  ) : (
                    <p className="font-display text-[16px] font-bold text-ink">Private practice</p>
                  )}
                  <p className="mt-2 flex items-start gap-2 text-[13.5px] text-ink-muted">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
                    <span>
                      {l.address}
                      {l.postcode ? `, ${l.postcode}` : ""}
                      {l.city && (
                        <>
                          <br />
                          {l.city.name}
                          {l.city.region ? `, ${l.city.region}` : ""}
                        </>
                      )}
                    </span>
                  </p>
                  {l.phone && (
                    <p className="mt-2 flex items-center gap-2 text-[13.5px] text-ink-muted">
                      <Phone className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
                      <a href={`tel:${l.phone.replace(/\s/g, "")}`} className="hover:text-teal-700">
                        {l.phone}
                      </a>
                    </p>
                  )}
                </div>

              </div>
            ))}
            </div>

            {/* The right-hand rail. One map, of the main address: a
                sidebar is not the place to list every practice — the
                column on the left does that.

                Framed the same way as the address cards beside it —
                white, bordered, padded — rather than a bare square
                touching the column's edges. The old bare frame is also
                what made a failed provider (an unauthorised Google key,
                for instance) read as a broken white box: the label and
                border now stay put and only the picture inside changes. */}
            {primaryLocation && (
              <div className="rounded-xl border border-line bg-white p-5">
                <p className="mb-3 flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-wide text-ink-faint">
                  <MapPin className="h-3.5 w-3.5 text-teal-600" strokeWidth={2.5} />
                  Map
                </p>
                <MapPreview
                  lat={primaryLocation.lat}
                  lng={primaryLocation.lng}
                  address={[primaryLocation.address, primaryLocation.postcode, primaryLocation.city?.name]
                    .filter(Boolean)
                    .join(", ")}
                  fallback={
                    primaryLocation.city
                      ? {
                          lat: primaryLocation.city.lat,
                          lng: primaryLocation.city.lng,
                          label: primaryLocation.city.name,
                        }
                      : null
                  }
                  fill
                  quiet
                />
              </div>
            )}
          </div>
          {specialist.regulator && specialist.registrationNumber && (
            <p className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-faint">
              <BadgeCheck className="h-4 w-4 text-teal-600" strokeWidth={2} />
              Checked against {specialist.regulator.name} register — {specialist.regulator.code}{" "}
              {specialist.registrationNumber}
            </p>
          )}
        </section>
        )}

        {/* ------------------------------------------------------- Enquire */}
        <section
          id="enquire"
          ref={(el) => {
            sectionRefs.current.enquire = el;
          }}
          className="scroll-mt-32 pb-4"
        >
          {/* Backed by the same specialty photo as the hero, so the banner
              belongs to this specialist rather than being a generic slab. */}
          <div
            className="photo-panel overflow-hidden rounded-[1.5rem]"
            style={{ backgroundImage: `url(${heroPhoto})`, backgroundPosition: "center" }}
          >
            <div className="flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
              <div>
                <h2 className="font-display text-[20px] font-bold text-white sm:text-[25px]">
                  {isMedicoLegal ? `Instruct ${specialist.fullName}` : "Enquire about this specialist"}
                </h2>
                <p className="mt-1.5 text-[13.5px] text-white/65">
                  {isMedicoLegal
                    ? "Send the case details or ask a question — it goes straight to their team, no account needed."
                    : `Get a response from ${specialist.fullName}'s team — no account needed.`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                {/* No appointment to book here -- an expert witness is
                    instructed on a case, not booked for a slot, so this
                    branch skips the booking button outright rather than
                    offering one that leads nowhere sensible. */}
                {!isMedicoLegal && (specialist.bookingUrl ? (
                  <a
                    href={specialist.bookingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-full bg-teal-400 px-7 py-3.5 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
                  >
                    Book an appointment
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBookingOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-full bg-teal-400 px-7 py-3.5 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
                  >
                    Book online
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEnquiryOpen(true)}
                  className={`flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[13.5px] font-bold shadow-lg transition ${
                    isMedicoLegal
                      ? "bg-teal-400 text-navy-950 hover:bg-teal-300"
                      : "bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20"
                  }`}
                >
                  {isMedicoLegal ? "Send instructions" : "Send enquiry"}
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>

          <ContactStrip specialist={specialist} />
          <OwnerLockedNotice specialist={specialist} />
        </section>
      </div>

      {/* The enquiry itself. Submitting posts a lead and notifies the
          specialist at the address they registered with — see the
          backend's lib/mailer.js for the send path. */}
      <Dialog
        open={enquiryOpen}
        onClose={() => setEnquiryOpen(false)}
        title={isMedicoLegal ? `Instruct ${specialist.fullName}` : `Enquire about ${specialist.fullName}`}
        description={`Your message goes straight to ${specialist.fullName}'s team. No account needed.`}
      >
        {/* §7: where the practice runs on ClinWell and the integration
            has been switched on, the enquiry goes to their own booking
            widget in an iframe rather than to our form — that way the
            enquiry lands in the system the practice actually works in.

            Gated on clinwellLive, and that gate is load-bearing: the
            URL returns 404 until ClinWell switches the practice on, and
            a patient trying to reach a doctor is the last person who
            should meet a 404. Falls back to our own form for everybody
            else, which is still every practice today. */}
        {specialist.clinwellLive && specialist.clinwellEmbedUrl ? (
          <ClinWellEnquiryEmbed url={specialist.clinwellEmbedUrl} name={specialist.fullName} />
        ) : (
          <EnquiryForm specialistId={specialist.id} recipientName={specialist.fullName} />
        )}
      </Dialog>

      {/* The free, built-in alternative to bookingUrl -- see the note on
          the trigger button above. */}
      <Dialog
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title={`Book an appointment with ${specialist.fullName}`}
        description="Pick a time that works — no account needed."
      >
        <BookingWidget slug={specialist.slug} recipientName={specialist.fullName} />
      </Dialog>
    </main>
  );
}

/* -------------------------------------------------------------------- */

/* ------------------------------------------------------------------ *
 * What the About section says when nobody has written a biography
 *
 * Roughly a quarter of the migrated directory has no bio: the old site
 * did not have one either, and the person best placed to write it is the
 * clinician, who has not claimed the listing yet. "No biography
 * published yet" is true but it is also the whole panel, and on a
 * profile that otherwise has a specialty, a town and nine years of
 * practice on it, it reads as though we know nothing about them.
 *
 * So the fallback states the facts already on the record. Note that it
 * is RENDERED and not stored: writing a generated paragraph into
 * `bio` would make an assertion in the clinician's own voice, in a
 * column the dashboard presents to them as their own words, and it
 * would have to be recognised and cleared before they could write a
 * real one. This is the site describing what it holds, which is a
 * different thing and reads like one.
 *
 * Every clause is a field with a source. No adjectives, no claims about
 * skill, reputation or outcomes, nothing about what they treat beyond
 * the specialties they are actually tagged with.
 * ------------------------------------------------------------------ */
function factsOnFile(s: {
  fullName: string;
  primarySpecialty?: { name?: string } | null;
  specialties?: { name?: string }[] | null;
  yearsExperience?: number | null;
  clinicLocations?: { city?: { name?: string; region?: string | null } | null }[] | null;
  coveredRegions?: string[] | null;
}): string | null {
  const specialty = s.primarySpecialty?.name ?? null;

  /* The other tags, minus the primary — on a migrated listing these are
     the subcategories the mapper resolved, and they are the most useful
     thing on the record for somebody deciding whether this is the right
     person. */
  const also = (s.specialties ?? [])
    .map((x) => x?.name)
    .filter((n): n is string => Boolean(n) && n !== specialty);

  const places = [
    ...new Set(
      (s.clinicLocations ?? [])
        .map((l) => l?.city?.name)
        .filter((n): n is string => Boolean(n))
    ),
  ];
  const region = (s.clinicLocations ?? []).find((l) => l?.city?.region)?.city?.region ?? null;

  const regions = s.coveredRegions ?? [];

  const parts: string[] = [];
  if (specialty && places.length) {
    parts.push(
      `${s.fullName} is listed under ${specialty} and practises ` +
        (places.length === 1
          ? `in ${places[0]}${region ? `, ${region}` : ""}`
          : `at ${places.length} locations, including ${places.slice(0, 3).join(", ")}`) +
        "."
    );
  } else if (specialty && regions.length) {
    // No clinic address on this listing type -- covered regions is the
    // equivalent fact, so it fills the slot "practises in <city>" would.
    parts.push(`${s.fullName} is listed under ${specialty} and covers ${regions.join(", ")}.`);
  } else if (specialty) {
    parts.push(`${s.fullName} is listed under ${specialty}.`);
  } else if (places.length) {
    parts.push(`${s.fullName} practises in ${places[0]}${region ? `, ${region}` : ""}.`);
  } else if (regions.length) {
    parts.push(`${s.fullName} covers ${regions.join(", ")}.`);
  }

  if (also.length) {
    parts.push(
      `The listing is tagged ${also.slice(0, 6).join(", ")}${also.length > 6 ? ` and ${also.length - 6} more` : ""}.`
    );
  }
  if (s.yearsExperience) parts.push(`${s.yearsExperience} years in practice are recorded.`);

  return parts.length ? parts.join(" ") : null;
}

// Collapsible bio: clamped to four lines with a Read more toggle, and no
// toggle at all when the text is short enough to fit.
function Bio({ text, facts = null }: { text: string | null; facts?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClampable(el.scrollHeight - el.clientHeight > 4);
  }, [text]);

  if (!text) {
    if (!facts) {
      return <p className="mt-4 text-[14.5px] text-ink-muted">No biography published yet.</p>;
    }
    return (
      <div className="mt-4">
        <p className="text-[14.5px] leading-relaxed text-ink-muted">{facts}</p>
        <p className="mt-3 text-[13px] text-ink-muted/80">
          This summary is drawn from the details on this listing. No biography has been published
          yet — the specialist can add one when they claim the profile.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p
        ref={ref}
        className={`text-[14.5px] leading-relaxed text-ink-muted ${expanded ? "" : "line-clamp-4"}`}
      >
        {text}
      </p>
      {(clampable || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-[13px] font-bold text-teal-600 hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Read more"}
          <ArrowRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "-rotate-90" : "rotate-0"}`}
            strokeWidth={2.5}
          />
        </button>
      )}
    </div>
  );
}

// Thumbnail until clicked, then a real player. Rendered only when the
// specialist has actually published a video.
function IntroVideo({
  url,
  thumbnailUrl,
  durationSeconds,
  name,
}: {
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  name: string;
}) {
  const [playing, setPlaying] = useState(false);
  const duration = formatDuration(durationSeconds);

  return (
    <figure className="overflow-hidden rounded-[1.25rem] border border-line bg-white p-2 shadow-sm">
      <div className="relative aspect-video w-full overflow-hidden rounded-[0.9rem] bg-navy-900">
        {playing ? (
          <video src={url} controls autoPlay className="h-full w-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group h-full w-full"
            aria-label={`Play ${name}'s intro video`}
          >
            {thumbnailUrl && (
              <img src={thumbnailUrl} alt="" className="h-full w-full object-cover opacity-90" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-navy-950/25 transition group-hover:bg-navy-950/10">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 shadow-lg transition group-hover:scale-105">
                <Play className="ml-0.5 h-5 w-5 fill-navy-950 text-navy-950" strokeWidth={0} />
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="px-2 py-2.5 text-center text-[12.5px] text-ink-muted">
        {playing ? `${name} — intro video` : `Watch video${duration ? ` (${duration})` : ""}`}
      </figcaption>
    </figure>
  );
}

function StatsBar({ specialist, isMedicoLegal = false }: { specialist: SpecialistWithRelations; isMedicoLegal?: boolean }) {
  const stats = [
    specialist.yearsExperience
      ? { icon: Activity, value: String(specialist.yearsExperience), label: "years experience" }
      : null,
    specialist.ratingCount > 0
      ? { icon: Star, value: formatRating(specialist.ratingAvg), label: isMedicoLegal ? "rating" : "patient rating" }
      : null,
    specialist.ratingCount > 0
      ? { icon: MessageSquareQuote, value: String(specialist.ratingCount), label: "reviews" }
      : null,
    specialist.verificationStatus === "verified"
      ? { icon: ShieldCheck, value: "100%", label: "verified" }
      : { icon: ShieldCheck, value: "Pending", label: "verification" },
  ].filter(Boolean) as { icon: typeof Activity; value: string; label: string }[];

  // Click-to-reveal, not plain display: each needs its own tile
  // component rather than the {value, label} shape above. Omitted
  // entirely when entitled but nothing has been published — there is
  // nothing to reveal, same reasoning as the plain stats hiding on null.
  const showPhoneTile = specialist.plan?.features.phoneReveal ? Boolean(specialist.publicPhone) : true;
  const showEmailTile = specialist.plan?.features.publicContactEmail ? Boolean(specialist.publicEmail) : true;

  if (!stats.length && !showPhoneTile && !showEmailTile) return null;

  return (
    <div className="mt-8 grid grid-cols-2 gap-4 rounded-[1.25rem] border border-line bg-white px-5 py-5 shadow-sm sm:grid-cols-4 sm:px-7">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
            <stat.icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-[19px] font-bold leading-tight text-ink">{stat.value}</span>
            <span className="truncate text-[12px] text-ink-muted">{stat.label}</span>
          </span>
        </div>
      ))}
      {showPhoneTile && (
        <RevealTile
          icon={Phone}
          label="phone"
          entitled={Boolean(specialist.plan?.features.phoneReveal)}
          value={specialist.publicPhone ?? null}
          href={(v) => `tel:${v.replace(/\s/g, "")}`}
        />
      )}
      {showEmailTile && (
        <RevealTile
          icon={Mail}
          label="email"
          entitled={Boolean(specialist.plan?.features.publicContactEmail)}
          value={specialist.publicEmail ?? null}
          href={(v) => `mailto:${v}`}
        />
      )}
    </div>
  );
}

/**
 * One click-to-reveal tile: a phone number or email address, hidden
 * until tapped so the page itself doesn't publish it to anything
 * scraping the rendered HTML, and gated to "Upgrade to reveal" when the
 * specialist's plan doesn't include it.
 */
function RevealTile({
  icon: Icon,
  label,
  entitled,
  value,
  href,
}: {
  icon: typeof Activity;
  label: string;
  entitled: boolean;
  value: string | null;
  href: (value: string) => string;
}) {
  const [revealed, setRevealed] = useState(false);

  if (!entitled) {
    return (
      <Link to="/pricing" className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper-tint text-ink-faint ring-1 ring-line">
          <Lock className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-display text-[14px] font-bold leading-tight text-teal-700 hover:underline">
            Upgrade
          </span>
          <span className="truncate text-[12px] text-ink-muted">to reveal {label}</span>
        </span>
      </Link>
    );
  }

  if (!value) return null;

  if (revealed) {
    return (
      <a href={href(value)} className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-display text-[14px] font-bold leading-tight text-ink hover:text-teal-700">
            {value}
          </span>
          <span className="truncate text-[12px] text-ink-muted">{label}</span>
        </span>
      </a>
    );
  }

  return (
    <button type="button" onClick={() => setRevealed(true)} className="flex items-center gap-3 text-left">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-[14px] font-bold leading-tight text-ink">Reveal</span>
        <span className="truncate text-[12px] text-ink-muted">{label}</span>
      </span>
    </button>
  );
}

const SCORE_LABELS: { key: keyof NonNullable<SpecialistWithRelations["reviewScores"]>; label: string }[] = [
  { key: "communication", label: "Communication" },
  { key: "expertise", label: "Expertise" },
  { key: "care", label: "Care" },
  { key: "waitTime", label: "Wait time" },
];

function Reviews({ specialist, isMedicoLegal = false }: { specialist: SpecialistWithRelations; isMedicoLegal?: boolean }) {
  const [writeOpen, setWriteOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [allReviews, setAllReviews] = useState<Review[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const reviews = specialist.reviews.filter((r) => r.comment);
  const current: Review | undefined = reviews[index];
  const scores = specialist.reviewScores;

  // Fetched on demand from the paginated reviews endpoint rather than
  // shipped with the profile payload — a specialist with hundreds of
  // reviews should not make the profile heavier for everyone.
  useEffect(() => {
    if (!showAll) return;
    let cancelled = false;
    getSpecialistReviews(specialist.slug, page)
      .then((res) => {
        if (cancelled) return;
        setAllReviews(res.results);
        setPages(res.totalPages);
      })
      .catch(() => {
        if (!cancelled) setAllReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showAll, page, specialist.slug]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[24px] font-bold text-ink sm:text-[28px]">
          {isMedicoLegal ? "Reviews" : "Patient Reviews"}
        </h2>
        {/* The endpoint has always existed; nothing ever called it, so
            patients had no way to leave a review and the dashboard's
            promise that they could was untrue. */}
        <button
          type="button"
          onClick={() => setWriteOpen(true)}
          className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal-200 hover:text-teal-700"
        >
          <PenLine className="h-4 w-4 text-teal-600" strokeWidth={2} />
          Write a review
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="font-display text-[38px] font-bold leading-none text-ink">
            {formatRating(specialist.ratingAvg)}
          </span>
          <span>
            <span className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${i < Math.round(specialist.ratingAvg) ? "fill-amber text-amber" : "text-line"}`}
                  strokeWidth={0}
                />
              ))}
            </span>
            <span className="mt-1 block text-[12.5px] text-ink-muted">
              {specialist.ratingCount} {specialist.ratingCount === 1 ? "review" : "reviews"}
            </span>
          </span>
        </div>
        {specialist.ratingCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 text-[13px] font-bold text-teal-600 hover:underline"
            aria-expanded={showAll}
          >
            {showAll ? "Show less" : "View all reviews"}
            <ArrowRight
              className={`h-3.5 w-3.5 transition-transform ${showAll ? "-rotate-90" : ""}`}
              strokeWidth={2.5}
            />
          </button>
        )}
      </div>

      {/* items-start so the review card is the height of the review.
          Stretching it to match a tall sidebar left a third of it empty
          under the quote, which read as something failing to load. */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        {current ? (
          <figure className="flex flex-col rounded-[1.25rem] border border-line bg-white p-6">
            <MessageSquareQuote className="h-6 w-6 text-teal-600" strokeWidth={1.75} />
            <blockquote className="mt-4 flex-1 font-display text-[16px] italic leading-relaxed text-ink">
              &ldquo;{current.comment}&rdquo;
            </blockquote>
            <figcaption className="mt-5 flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-ink-muted">
                <span className="font-bold text-ink">{current.patientName ?? "Verified patient"}</span>
                {current.verified && <span className="ml-2 text-teal-700">Verified visit</span>}
              </span>
              <span className="text-ink-faint">
                {new Date(current.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </figcaption>

            {reviews.length > 1 && (
              <div className="mt-5 flex items-center gap-2 border-t border-line-soft pt-4">
                <button
                  type="button"
                  onClick={() => setIndex((i) => (i - 1 + reviews.length) % reviews.length)}
                  className="grid h-7 w-7 place-items-center rounded-full border border-line text-ink-muted transition hover:bg-paper-muted"
                  aria-label="Previous review"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
                <div className="flex items-center gap-1.5">
                  {reviews.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setIndex(i)}
                      aria-label={`Review ${i + 1}`}
                      aria-current={i === index}
                      className={`h-1.5 rounded-full transition-all ${
                        i === index ? "w-5 bg-teal-600" : "w-1.5 bg-line"
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setIndex((i) => (i + 1) % reviews.length)}
                  className="grid h-7 w-7 place-items-center rounded-full border border-line text-ink-muted transition hover:bg-paper-muted"
                  aria-label="Next review"
                >
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </figure>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-line bg-paper-muted p-6 text-[13.5px] text-ink-muted">
            No written reviews yet.
          </div>
        )}

        <div className="flex flex-col gap-5">
          {scores && (
            <div className="rounded-[1.25rem] border border-line bg-white p-6">
              <ul className="space-y-4">
                {SCORE_LABELS.filter(({ key }) => scores[key] != null).map(({ key, label }) => (
                  <li key={key}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-ink-muted">{label}</span>
                      <span className="font-bold text-ink">{scores[key]?.toFixed(1)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-line-soft">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${((scores[key] ?? 0) / 5) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      </div>

      {showAll && (
        <div className="mt-5 rounded-[1.25rem] border border-line bg-white p-6">
          {allReviews === null ? (
            <p className="text-[13.5px] text-ink-muted">Loading reviews…</p>
          ) : allReviews.length === 0 ? (
            <p className="text-[13.5px] text-ink-muted">No reviews yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-line-soft">
                {allReviews.map((r) => (
                  <li key={r.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${i < r.rating ? "fill-amber text-amber" : "text-line"}`}
                            strokeWidth={0}
                          />
                        ))}
                      </span>
                      <span className="text-[12px] text-ink-faint">
                        {new Date(r.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    {r.comment && <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{r.comment}</p>}
                    <p className="mt-1.5 text-[12px] text-ink-muted">
                      {r.patientName ?? "Verified patient"}
                      {r.verified && <span className="ml-2 font-semibold text-teal-700">Verified visit</span>}
                    </p>
                  </li>
                ))}
              </ul>

              {pages > 1 && (
                <div className="mt-5 flex items-center justify-center gap-3 border-t border-line-soft pt-4">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-ink-muted transition hover:bg-paper-muted disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-[12.5px] text-ink-muted">
                    Page {page} of {pages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page >= pages}
                    className="rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-ink-muted transition hover:bg-paper-muted disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Dialog
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        size="lg"
        title={`Review ${specialist.fullName}`}
        description="Your review is read by our team before it appears."
      >
        <ReviewForm
          subject="specialist"
          slug={specialist.slug}
          name={specialist.fullName}
          // What they were seen for, from this specialist's own tagged
          // conditions — never a free-text health field, and never
          // treatments, which live in a different table than the column
          // this is stored in.
          seenForOptions={specialist.conditions.map((c) => ({ id: c.id, name: c.name }))}
        />
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Gallery
 *
 * A Premium feature, so it is only ever rendered with images the API
 * actually served — on a Basic listing the field arrives empty and this
 * component is never reached.
 * ------------------------------------------------------------------ */
function Gallery({ images }: { images: { url: string; caption: string | null }[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const current = lightbox === null ? null : images[lightbox];

  return (
    <>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, i) => (
          <li key={`${image.url}-${i}`}>
            <button
              type="button"
              onClick={() => setLightbox(i)}
              className="group relative block w-full overflow-hidden rounded-xl bg-paper-muted ring-1 ring-line transition hover:ring-teal-400"
              style={{ aspectRatio: "4 / 3" }}
            >
              <img
                src={image.url}
                alt={image.caption ?? ""}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              />
              {image.caption && (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/80 to-transparent px-3 py-2 text-left text-[11.5px] font-semibold text-white">
                  {image.caption}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {current && (
        <Dialog
          open
          onClose={() => setLightbox(null)}
          size="lg"
          title={current.caption ?? "Clinic photograph"}
        >
          <img src={current.url} alt={current.caption ?? ""} className="w-full rounded-xl" />
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setLightbox((i) => (i === null ? null : (i - 1 + images.length) % images.length))}
              className="rounded-full px-4 py-2 text-[12.5px] font-bold text-ink-muted ring-1 ring-line transition hover:bg-paper-tint"
            >
              Previous
            </button>
            <p className="text-[12px] text-ink-faint">
              {(lightbox ?? 0) + 1} of {images.length}
            </p>
            <button
              type="button"
              onClick={() => setLightbox((i) => (i === null ? null : (i + 1) % images.length))}
              className="rounded-full px-4 py-2 text-[12.5px] font-bold text-ink-muted ring-1 ring-line transition hover:bg-paper-tint"
            >
              Next
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The medico-legal CV
 *
 * Nine free-text sections plus a tag list, all specific to an Expert
 * Witness listing (see migration 0014_expert_witness_profile_fields.sql
 * and scripts/import-expert-witnesses.mjs / enrich-expert-witnesses.mjs,
 * which are what actually fill them) and null for every other
 * specialist. Rendered the same way Bio's fallback is reasoned about
 * above: a fact with no source doesn't get a heading. A person with
 * three of the nine sections populated gets three headings, not nine
 * with six of them blank -- an empty "Research interests" card under a
 * real name is not a gap in OUR data, it reads as a gap in THEIRS.
 *
 * areasOfExpertise renders separately, as tag pills, because it isn't
 * one of the nine -- it's a flat list of 20-30 self-described terms
 * (the source sites' own sidebar tags), not a paragraph, and unlike the
 * specialty chips above it these aren't taxonomy values, so they're not
 * links (see the column's own comment in lib/types.ts for why).
 * ------------------------------------------------------------------ */
const CV_SECTIONS: { key: keyof SpecialistWithRelations; label: string; icon: LucideIcon }[] = [
  { key: "medicoLegalExperience", label: "Medico-legal experience", icon: Scale },
  { key: "clinicalPracticeExperience", label: "Clinical practice experience", icon: Stethoscope },
  { key: "clinicalInterests", label: "Clinical interests", icon: Compass },
  { key: "managementExperience", label: "Management experience", icon: Briefcase },
  { key: "researchInterests", label: "Research interests", icon: FlaskConical },
  { key: "summaryOfPublications", label: "Summary of publications", icon: BookOpen },
  { key: "teachingTraining", label: "Teaching & training", icon: GraduationCap },
  { key: "memberships", label: "Memberships", icon: Users },
  { key: "prizesAndAwards", label: "Prizes & awards", icon: Trophy },
];

function MedicoLegalCV({ specialist }: { specialist: SpecialistWithRelations }) {
  // clinicalPracticeExperience doubles as the About-section hero text when
  // there's no real `bio` (see the Bio call in the Overview section, a few
  // hundred lines up) -- when that happened, drop it from the CV list below
  // so the same paragraph doesn't appear twice on one page.
  const usedAsHero = !specialist.bio && Boolean(specialist.clinicalPracticeExperience);
  const sections = CV_SECTIONS.filter(({ key }) => {
    if (usedAsHero && key === "clinicalPracticeExperience") return false;
    const value = specialist[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  // Self-described, not ours to dedupe by meaning -- but the same literal
  // tag has shown up twice from a source page before, and a repeated
  // pill is a rendering bug, not a second fact.
  const tags = [...new Set((specialist.areasOfExpertise ?? []).map((t) => t.trim()).filter(Boolean))];

  if (sections.length === 0 && tags.length === 0) return null;

  return (
    <div className="mt-8 border-t border-line pt-8">
      {tags.length > 0 && (
        <div className={sections.length > 0 ? "mb-8" : undefined}>
          <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-muted">Areas of expertise</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-paper-tint px-3 py-1.5 text-[12.5px] font-medium text-ink-muted ring-1 ring-line"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {sections.length > 0 && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {sections.map(({ key, label, icon: Icon }) => (
            <div key={key} className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-muted">{label}</h3>
              </div>
              {/* whitespace-pre-line, not dangerouslySetInnerHTML: the source
                  pages give this as plain text with real line breaks (a
                  membership list, a run of publication titles), and a
                  paragraph tag alone collapses every one of them onto a
                  single line. */}
              <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink">
                {specialist[key] as string}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Contact strip
 *
 * Website and social links are available on every tier; a published
 * email address is not. Each item renders only if the API sent it, which
 * is the same thing as saying the plan allows it.
 * ------------------------------------------------------------------ */
function ContactStrip({ specialist }: { specialist: SpecialistWithRelations }) {
  const socials = specialist.socials ?? {};
  // Driven by the shared brand list rather than a second hand-written
  // one here, so a platform added in socialBrands.tsx appears on the
  // profile and in the editor without being typed out twice.
  const socialLinks = SOCIAL_BRANDS.map((brand) => ({
    brand,
    href: socials[brand.key] as string | null | undefined,
  })).filter((s) => Boolean(s.href));

  const hasAnything = specialist.publicEmail || specialist.websiteUrl || socialLinks.length > 0;
  if (!hasAnything) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-paper-muted px-5 py-4">
      {specialist.publicEmail && (
        <a
          href={`mailto:${specialist.publicEmail}`}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink transition hover:text-teal-700"
        >
          <Mail className="h-4 w-4 text-ink-muted" strokeWidth={2} />
          {specialist.publicEmail}
        </a>
      )}
      {specialist.websiteUrl && (
        <a
          href={specialist.websiteUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink transition hover:text-teal-700"
        >
          <Globe className="h-4 w-4 text-ink-muted" strokeWidth={2} />
          Practice website
        </a>
      )}
      {/* Each mark in its own colour. A row of five grey words is
          something you read; a row of five recognisable marks is
          something you spot, which is what someone scanning for
          "are they on LinkedIn" is actually doing. */}
      {socialLinks.length > 0 && (
        <span className="flex items-center gap-1.5">
          {socialLinks.map(({ brand, href }) => (
            <a
              key={brand.key}
              href={href as string}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${specialist.fullName} on ${brand.name}`}
              title={brand.name}
              className="grid h-9 w-9 place-items-center rounded-xl transition hover:scale-110"
              style={{ backgroundColor: brand.tint }}
            >
              <SocialGlyph platform={brand.key} className="h-[17px] w-[17px]" />
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Owner-only upgrade notice
 *
 * Shown to the specialist viewing their own page, never to patients.
 * The API tells us which fields are populated but withheld, so this is a
 * statement of fact — "these three things exist and nobody can see
 * them" — rather than a generic advert for Premium.
 * ------------------------------------------------------------------ */
const LOCKED_LABEL: Record<string, string> = {
  gallery: "clinic photo gallery",
  coverImageUrl: "cover banner",
  videoUrl: "video bio",
  videoThumbnailUrl: "video thumbnail",
  videoDurationSeconds: "video length",
  bookingUrl: "booking link",
  websiteUrl: "practice website",
  socials: "social links",
  publicEmail: "published contact email",
};

function OwnerLockedNotice({ specialist }: { specialist: SpecialistWithRelations }) {
  const locked = specialist.planAdmin?.lockedFields ?? [];
  if (locked.length === 0) return null;

  const labels = [...new Set(locked.map((f) => LOCKED_LABEL[f] ?? f))];

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber/10 px-5 py-4 ring-1 ring-amber/25">
      <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={2.5} />
        <span>
          <strong className="font-bold">Only you can see this.</strong> Your {labels.join(", ")}{" "}
          {labels.length === 1 ? "is" : "are"} saved but hidden from patients on the{" "}
          {specialist.plan?.name ?? "Basic"} plan. Nothing has been deleted — upgrading brings{" "}
          {labels.length === 1 ? "it" : "them"} straight back.
        </span>
      </p>
      <Link
        to="/dashboard/billing"
        className="shrink-0 rounded-full bg-amber px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:opacity-90"
      >
        View plans
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Claim invitation
 *
 * This listing was compiled from a public register rather than created
 * by the clinician it describes, and this is the invitation to take it
 * over. It lives inside the hero, attached to their own name and photo,
 * because claiming is a per-listing act — there is no generic "claim a
 * profile" anywhere on the site, and there shouldn't be.
 *
 * Addressed to one reader, so it is a quiet glass bar rather than a
 * banner: to every patient on this page it is furniture.
 * ------------------------------------------------------------------ */
function ClaimInvite({ specialist }: { specialist: SpecialistWithRelations }) {
  return (
    <div className="glass-chip mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3.5 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-teal-300">
        <UserCheck className="h-4 w-4" strokeWidth={2} />
      </span>
      <p className="min-w-[220px] flex-1 text-[13px] leading-relaxed text-white/75">
        <strong className="font-bold text-white">Are you {specialist.fullName}?</strong> This profile is unclaimed.
        Take it over to edit your details, answer enquiries
        {specialist.ratingCount > 0
          ? ` and keep the ${specialist.ratingCount} review${specialist.ratingCount === 1 ? "" : "s"} already on it`
          : ""}
        .
      </p>
      <Link
        to={`/claim/${specialist.slug}`}
        className="shrink-0 rounded-full bg-teal-400 px-5 py-2.5 text-[12.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
      >
        Claim this profile
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The primary action
 *
 * One page previously offered "Request a consultation" at the top and
 * "Send enquiry" at the bottom for the same thing, plus "Book an
 * appointment" for a different thing — three verbs for two actions.
 *
 * Now there are exactly two verbs on the whole site, and booking always
 * wins the primary slot: "Book an appointment" links straight out where
 * the plan carries a calendar link, and "Book online" opens the free,
 * built-in BookingWidget everywhere else -- the same fallback the
 * "Enquire about this specialist" section further down offers, brought
 * up to the one button a visitor sees without scrolling. That used to
 * fall back to "Send enquiry" instead, so a listing on no paid plan --
 * which is every unclaimed one -- showed no booking option at all above
 * the fold, only well below it. Enquiry is always one tap away as the
 * secondary button beside this one; it just never needs to stand in for
 * booking again.
 * ------------------------------------------------------------------ */
function PrimaryAction({
  specialist,
  onBook,
  onEnquire,
  isMedicoLegal = false,
  className,
}: {
  specialist: SpecialistWithRelations;
  onBook: () => void;
  onEnquire: () => void;
  isMedicoLegal?: boolean;
  className: string;
}) {
  // There is no appointment to book with an expert witness -- the ask is
  // "take my case", not "hold me a slot" -- so this button opens the
  // enquiry form directly rather than falling into the booking flow the
  // clinical branch below uses.
  if (isMedicoLegal) {
    return (
      <button type="button" onClick={onEnquire} className={className}>
        Contact this expert
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
    );
  }
  if (specialist.bookingUrl) {
    return (
      <a href={specialist.bookingUrl} target="_blank" rel="noreferrer" className={className}>
        Book an appointment
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </a>
    );
  }
  return (
    <button type="button" onClick={onBook} className={className}>
      Book online
      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}

/* -------------------------------------------------------------------- *
 * The ClinWell enquiry widget (§7)
 *
 * Only this one page of ClinWell may be framed — "Nothing else on
 * ClinWell may be framed; the paid booking flow opens in its own tab" —
 * so this component embeds exactly that URL and nothing navigable.
 *
 * The sandbox is the part worth reading. An iframe on a healthcare page
 * that collects a patient's name, email and symptoms should not also be
 * able to navigate the parent window or reach our storage, so it gets
 * only what a form needs: scripts, forms, its own origin, and popups
 * that cannot inherit this page's privileges. allow-top-navigation is
 * deliberately absent.
 * -------------------------------------------------------------------- */
function ClinWellEnquiryEmbed({ url, name }: { url: string; name: string }) {
  return (
    <div className="space-y-3">
      <iframe
        src={url}
        title={`Enquire about ${name} on ClinWell`}
        className="h-[32rem] w-full rounded-xl border border-ink/10 bg-white"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        loading="lazy"
      />
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        This enquiry form is provided by ClinWell, the clinical system {name}'s practice uses, so your message reaches
        their team directly. Booking and payment, if you go on to book, happen on ClinWell's own pages.
      </p>
    </div>
  );
}
