import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import { Seo, ORGANISATION_JSON_LD } from "../components/Seo";
import collage1 from "../assets/images/about-collage-1.webp";
import collage2 from "../assets/images/about-collage-2.webp";
import collage3 from "../assets/images/about-collage-3.webp";
import accessImg from "../assets/images/about-access.webp";

/* ------------------------------------------------------------------ *
 * About
 *
 * Three pillars, stated plainly. The claims here are the ones the
 * product actually keeps — every specialist is checked by a person
 * before they appear, search covers specialty, location and need, and
 * profiles carry credentials, reviews and a route to book. Nothing on
 * this page promises something the build does not do.
 * ------------------------------------------------------------------ */

const PILLARS = [
  {
    n: "01",
    title: "Verification & Trust",
    body: "Every specialist is checked against their regulator — GMC, GDC, NMC or HCPC — by a member of our team before their profile appears. Nothing goes live automatically.",
  },
  {
    n: "02",
    title: "Specialist Discovery",
    body: "Search by specialty, sub-specialty, treatment, condition and location. Filter by availability, price and rating until what's left is genuinely relevant to you.",
  },
  {
    n: "03",
    title: "Transparent Information",
    body: "Clear specialties, practice locations, consultation prices, patient reviews and a direct path to an appointment — set out before you make contact, not after.",
  },
];

export default function About() {
  return (
    <main className="flex-1">
      <Seo
        title="About Us"
        description="Top Local Specialists connects patients with verified UK healthcare professionals. Every specialist is checked against their regulator by a person before their profile appears."
        path="/about"
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "AboutPage",
            name: "About Top Local Specialists",
            description:
              "How Top Local Specialists verifies healthcare professionals and helps patients find the right expertise.",
          },
        ]}
      />

      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1fr_1.05fr]">
          <div className="relative z-10 max-w-[560px]">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-teal-300">Our Mission &amp; Vision</p>
            <h1 className="mt-3 font-display text-[38px] font-bold leading-[1.08] sm:text-[52px]">
              Connecting People With Trusted Medical Expertise.
            </h1>
            <p className="mt-4 max-w-[44ch] text-[14.5px] leading-relaxed text-white/70">
              A trusted way to discover verified healthcare professionals — checked against real regulator records, not
              self-reported claims.
            </p>
            <Link
              to="/search"
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-teal-400 px-7 py-3.5 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
            >
              Find a Specialist
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>

          <HeroCollage />
        </div>
      </section>

      {/* ============================================ the problem */}
      <section className="bg-paper">
        <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-teal-700">
            Healthcare, without the guesswork
          </p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <h2 className="font-display text-[32px] font-bold leading-[1.15] text-ink sm:text-[40px]">
              Expert care should be easier to find.
            </h2>
            <p className="max-w-[52ch] self-end text-[14.5px] leading-relaxed text-ink-muted">
              Top Local Specialists connects patients with healthcare professionals through clear profiles, specialist
              discovery, professional credentials and direct paths to care — so choosing who to see is a decision you
              can actually make, rather than a guess between search results.
            </p>
          </div>

          <ol className="mt-10 space-y-4">
            {PILLARS.map((pillar) => (
              <li
                key={pillar.n}
                className="flex flex-col gap-4 rounded-2xl bg-white p-6 ring-1 ring-line transition hover:ring-teal-300 sm:flex-row sm:gap-7 sm:p-8"
              >
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-teal-50 font-display text-[15px] font-bold text-teal-700"
                  aria-hidden
                >
                  {pillar.n}
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-[19px] font-bold text-ink sm:text-[21px]">{pillar.title}</h3>
                  <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-ink-muted">{pillar.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ======================================== borderless care */}
      <section className="bg-paper pb-16 sm:pb-24">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="grid overflow-hidden rounded-[1.75rem] bg-teal-50 lg:grid-cols-[1fr_1.1fr]">
            <div className="flex flex-col justify-center px-7 py-10 sm:px-10 sm:py-14">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-teal-700">
                Borderless care access
              </p>
              <h2 className="mt-3 font-display text-[30px] font-bold leading-[1.14] text-ink sm:text-[36px]">
                The right expertise can be closer than you think.
              </h2>
              <p className="mt-4 max-w-[40ch] text-[14px] leading-relaxed text-ink-muted">
                Discover local specialists or explore expertise beyond your location. Search a radius around any UK
                town, or drop the distance filter entirely and find the person who treats exactly what you have.
              </p>
              <Link
                to="/search"
                className="mt-7 inline-flex w-fit items-center gap-2 rounded-full bg-navy-950 px-7 py-3.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
              >
                Explore Specialists
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            </div>
            <div className="min-h-[240px] lg:min-h-[380px]">
              <img
                src={accessImg}
                alt="A consultant discussing results with a patient in a clinic"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Hero collage
 *
 * Three photographs rather than one: a directory covering orthopaedics
 * through to dentistry is poorly represented by a single portrait, and
 * the overlap reads as breadth without needing a caption to say so.
 * Below `lg` it collapses to one image — a stack of three at phone width
 * is just noise on top of the headline.
 * ------------------------------------------------------------------ */
function HeroCollage() {
  return (
    <div className="relative" aria-hidden={false}>
      {/* Phones: one image, full width, behind nothing. */}
      <div className="overflow-hidden rounded-2xl lg:hidden">
        <img
          src={collage1}
          alt="An ENT specialist examining a patient"
          className="h-[220px] w-full object-cover sm:h-[300px]"
        />
      </div>

      {/* From lg: the staggered trio. */}
      <div className="relative hidden h-[440px] lg:block">
        <figure className="absolute right-0 top-0 h-[300px] w-[62%] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10">
          <img
            src={collage1}
            alt="An ENT specialist examining a patient in a clinic"
            className="h-full w-full object-cover"
          />
        </figure>
        <figure className="absolute bottom-0 right-[22%] h-[240px] w-[46%] overflow-hidden rounded-2xl shadow-2xl ring-4 ring-navy-950">
          <img
            src={collage3}
            alt="A doctor writing a prescription with a patient"
            className="h-full w-full object-cover"
          />
        </figure>
        <figure className="absolute bottom-[42px] left-0 h-[210px] w-[38%] overflow-hidden rounded-2xl shadow-2xl ring-4 ring-navy-950">
          <img
            src={collage2}
            alt="A surgeon marking up a patient before an aesthetic procedure"
            // Subject sits hard right in this frame; a centred crop is
            // mostly empty backdrop.
            className="h-full w-full object-cover object-[78%_center]"
          />
        </figure>
      </div>
    </div>
  );
}
