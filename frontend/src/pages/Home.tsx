import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCities, getFeaturedSpecialists, getTopLevelSpecialties } from "../lib/api";
import { SearchBar } from "../components/SearchBar";
import { TrustBar } from "../components/TrustBar";
import { SpecialistCard } from "../components/SpecialistCard";
import { CategoryGrid } from "../components/CategoryGrid";
import { ReviewsCarousel } from "../components/ReviewsCarousel";
import { ArrowRight, MessagesSquare, Search, Send, ShieldCheck, Star } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import type { City, SpecialistWithRelations, Specialty } from "../lib/types";
import { HOMEPAGE_SPECIALTY_SLUGS, PHARMACY_TILE } from "../lib/categoryPhotos";
import heroPhoto from "../assets/images/hero-surgeon.webp";
import notSurePhoto from "../assets/images/banner-not-sure.webp";
import professionalsPhoto from "../assets/images/banner-professionals.webp";
import closingPhoto from "../assets/images/banner-closing.webp";
import { Seo, ORGANISATION_JSON_LD, SITE_URL } from "../components/Seo";

const HOW_IT_WORKS = [
  { step: "1", title: "Search", icon: Search, body: "Tell us what you need" },
  { step: "2", title: "Compare", icon: ShieldCheck, body: "Review profiles, experience, reviews and pricing" },
  { step: "3", title: "Connect", icon: Send, body: "Send an enquiry and get in touch directly" },
];

export default function Home() {
  const [topLevelSpecialties, setTopLevelSpecialties] = useState<Specialty[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [featured, setFeatured] = useState<SpecialistWithRelations[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // The search bar fetches its own taxonomy on demand now, so the
    // homepage only loads what it renders itself.
    Promise.all([getTopLevelSpecialties(), getCities(), getFeaturedSpecialists(4)])
      .then(([top, cityList, featuredList]) => {
        setTopLevelSpecialties(top);
        setCities(cityList);
        setFeatured(featuredList);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load the homepage"));
  }, []);

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl flex-1 px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-ink">Can&apos;t reach the server</h1>
        <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col bg-navy-950" style={{ marginTop: -HEADER_HEIGHT }}>
      <Seo
        title="Top Local Specialists — Find Verified UK Healthcare Specialists"
        description="Search verified consultants, surgeons, dentists and therapists across the UK by condition, treatment and location. Every specialist is checked against their regulator before they appear."
        path="/"
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Top Local Specialists",
            url: SITE_URL,
            potentialAction: {
              "@type": "SearchAction",
              target: `${SITE_URL}/search?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]}
      />
      {/* Hero — left aligned, photo bleeding in from the right. The top
          padding clears the transparent header floating over it. */}
      <section
        className="photo-panel relative overflow-hidden px-5 pb-24 sm:px-8 sm:pb-28"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundPosition: "center right",
          paddingTop: HEADER_HEIGHT + 56,
        }}
      >
        <div className="mx-auto max-w-7xl">
          <span className="inline-flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.18em] text-teal-300">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            Verified specialists <span className="text-white/30">·</span> UK
          </span>

          <h1 className="mt-5 max-w-2xl font-display text-4xl font-bold leading-[1.08] text-white sm:text-[58px]">
            Find expertise
            <br />
            you can trust.
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-white/70 sm:text-base">
            Discover verified specialists by expertise, treatment and location — then
            connect directly with the right professional for you.
          </p>

          <div className="mt-10 max-w-5xl">
            <SearchBar cities={cities} />
          </div>

          <div className="mt-12 max-w-5xl">
            <TrustBar variant="onHero" />
          </div>
        </div>
      </section>

      {/* Light content panel, curving up over the bottom of the hero */}
      <div className="relative z-10 -mt-10 rounded-t-[2.5rem] bg-paper sm:-mt-12 sm:rounded-t-[3.5rem]">
        {/* Explore specialties */}
        <section id="specialties" className="mx-auto w-full max-w-7xl px-5 pb-4 pt-14 sm:px-8 sm:pt-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="font-display text-[28px] font-bold text-ink sm:text-[34px]">Explore Our Specialties</h2>
              <p className="mt-2 text-[14.5px] text-ink-muted">World-class care across multiple specialties.</p>
            </div>
            <Link
              to="/search"
              className="hidden shrink-0 items-center gap-1.5 text-[13.5px] font-bold text-teal-600 hover:underline sm:flex"
            >
              View all specialties <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>
          <CategoryGrid
            specialties={HOMEPAGE_SPECIALTY_SLUGS.map((slug) => topLevelSpecialties.find((s) => s.slug === slug)).filter(
              (s): s is Specialty => Boolean(s)
            )}
            extra={[PHARMACY_TILE]}
          />
        </section>

        {/* Not sure where to start */}
        <section className="px-5 pb-6 pt-10 sm:px-8 sm:pb-8 sm:pt-14">
          <div
            className="photo-panel mx-auto flex max-w-7xl flex-col items-start gap-6 overflow-hidden rounded-[1.75rem] px-7 py-10 sm:px-12 sm:py-12"
            style={{ backgroundImage: `url(${notSurePhoto})` }}
          >
            <div>
              <h3 className="font-display text-[24px] font-bold text-white sm:text-[28px]">
                Not sure where to start?
              </h3>
              <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-white/70">
                Tell us what you need and we&apos;ll help you find the right specialist for you.
              </p>
            </div>
            <Link
              to="/search"
              className="flex shrink-0 items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
            >
              <Search className="h-4 w-4" strokeWidth={2.5} />
              Start your search
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>
        </section>

        {/* Real, approved patient reviews — drawn from the same rows the
            profiles show, never a hand-written testimonial set. Renders
            nothing at all until something has been approved. */}
        <ReviewsCarousel />

        {/* How it works — three steps across, testimonial alongside */}
        <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 sm:py-10">
          <div className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-16">
            <div>
              <h2 className="font-display text-[28px] font-bold text-ink sm:text-[34px]">How TLS Works</h2>

              {/* Arrows are rendered as siblings between the steps so they
                  sit on the icon row, not underneath the step copy. */}
              <div className="mt-9 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-0">
                {HOW_IT_WORKS.map((item, i) => (
                  <div key={item.step} className="flex items-start gap-4 sm:contents">
                    <div className="flex items-start gap-4 sm:block sm:flex-1">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
                        <item.icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <div className="sm:mt-4 sm:pr-4">
                        <h3 className="font-display text-[15px] font-bold text-ink">
                          {item.step}. {item.title}
                        </h3>
                        <p className="mt-1.5 max-w-[14rem] text-[12.5px] leading-relaxed text-ink-muted">
                          {item.body}
                        </p>
                      </div>
                    </div>
                    {i < HOW_IT_WORKS.length - 1 && (
                      <span className="hidden shrink-0 pt-4 sm:block" aria-hidden>
                        <ArrowRight className="h-4 w-4 text-ink-faint" strokeWidth={2} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <figure className="flex flex-col justify-center rounded-[1.75rem] bg-paper-tint p-8">
              <MessagesSquare className="h-7 w-7 text-teal-600" strokeWidth={1.75} />
              <blockquote className="mt-5 font-display text-[17px] italic leading-relaxed text-ink">
                &ldquo;I found the right specialist in minutes. The process was simple and reassuring.&rdquo;
              </blockquote>
              <div className="mt-5 flex items-center gap-0.5 text-amber">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber" strokeWidth={0} />
                ))}
              </div>
              <figcaption className="mt-3 text-[12.5px] font-bold text-ink-muted">Verified patient</figcaption>
            </figure>
          </div>
        </section>

        {/* Featured specialists */}
        <section className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-[28px] font-bold text-ink sm:text-[34px]">Featured Specialists</h2>
              <p className="mt-2 text-[14.5px] text-ink-muted">Top-rated and highly recommended by patients.</p>
            </div>
            <Link
              to="/search"
              className="hidden shrink-0 items-center gap-1.5 text-[13.5px] font-bold text-teal-600 hover:underline sm:flex"
            >
              View all specialists <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((specialist) => (
              <SpecialistCard key={specialist.id} specialist={specialist} />
            ))}
          </div>
        </section>

        {/* For healthcare professionals */}
        <section id="for-professionals" className="px-5 py-4 sm:px-8">
          <div
            className="photo-panel mx-auto max-w-7xl overflow-hidden rounded-[1.75rem]"
            style={{ backgroundImage: `url(${professionalsPhoto})`, backgroundPosition: "center right" }}
          >
            <div className="flex flex-col items-start gap-6 px-7 py-11 sm:px-12 sm:py-14">
              <div className="max-w-lg">
                <h3 className="font-display text-[24px] font-bold text-white sm:text-[30px]">
                  For Healthcare Professionals
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-white/70">
                  Build your profile. Reach patients. Grow your practice.
                </p>
              </div>
              <Link
                to="/search"
                className="flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
              >
                Join TLS
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        {/* Closing CTA — bright photo, dark editorial headline */}
        <section className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
          <div
            className="photo-panel-light flex flex-col items-center gap-7 overflow-hidden rounded-[1.75rem] px-6 py-16 text-center sm:py-20"
            style={{ backgroundImage: `url(${closingPhoto})` }}
          >
            <h2 className="max-w-2xl font-display text-[26px] font-bold leading-tight text-navy-950 sm:text-[40px]">
              The right specialist
              <br className="hidden sm:block" /> can change everything.
            </h2>
            <Link
              to="/search"
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-navy-800 to-teal-600 px-7 py-3.5 text-[13.5px] font-bold text-white shadow-xl transition hover:from-navy-900 hover:to-teal-700"
            >
              Find my specialist
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
