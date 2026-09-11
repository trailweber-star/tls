import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HEADER_HEIGHT } from "./Header";
import { Seo } from "./Seo";
import { CONTACT_DETAILS } from "../pages/Contact";

/* ------------------------------------------------------------------ *
 * The shell every legal document on the site sits in
 *
 * Privacy and terms are read in two ways and have to serve both: start
 * to finish, once, by somebody deciding whether to trust the site; and
 * by jumping straight to one clause, by somebody who already knows what
 * they are looking for. Hence the numbered contents column that follows
 * you down the page, and section headings that are linkable on their
 * own — a support reply can point at a specific clause rather than "see
 * our terms".
 *
 * The document itself is plain: one column, generous line height, no
 * cards, no decoration. Legal text that is dressed up reads as though it
 * is being sold to you.
 * ------------------------------------------------------------------ */

export interface LegalSection {
  /** URL fragment. Stable — these get linked to from emails. */
  id: string;
  heading: string;
  body: React.ReactNode;
}

/**
 * Prose styling applied to each section's body, so the individual
 * documents can be written as plain paragraphs and lists without
 * carrying a class list on every element.
 */
const PROSE = [
  "[&_p]:mt-3 [&_p]:text-[14.5px] [&_p]:leading-[1.75] [&_p]:text-ink-muted",
  "[&_ul]:mt-3 [&_ul]:space-y-2 [&_ol]:mt-3 [&_ol]:space-y-2",
  "[&_li]:relative [&_li]:pl-5 [&_li]:text-[14.5px] [&_li]:leading-[1.7] [&_li]:text-ink-muted",
  "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:top-[0.66em] [&_ul>li]:before:h-1.5 [&_ul>li]:before:w-1.5 [&_ul>li]:before:rounded-full [&_ul>li]:before:bg-teal-500",
  "[&_strong]:font-bold [&_strong]:text-ink",
  "[&_a]:font-semibold [&_a]:text-teal-700 [&_a]:underline-offset-2 hover:[&_a]:underline",
  "[&_h3]:mt-7 [&_h3]:font-display [&_h3]:text-[17px] [&_h3]:font-bold [&_h3]:text-ink",
  "[&_dl]:mt-4 [&_dl]:space-y-4",
  "[&_dt]:text-[14.5px] [&_dt]:font-bold [&_dt]:text-ink",
  "[&_dd]:mt-1 [&_dd]:text-[14.5px] [&_dd]:leading-[1.7] [&_dd]:text-ink-muted",
].join(" ");

export function LegalPage({
  title,
  kicker,
  summary,
  updated,
  description,
  path,
  sections,
}: {
  title: string;
  kicker: string;
  /** One paragraph, in plain words, before any of the legal language. */
  summary: string;
  /** ISO date this version took effect. */
  updated: string;
  description: string;
  path: string;
  sections: LegalSection[];
}) {
  const { hash } = useLocation();
  const [active, setActive] = useState(sections[0]?.id ?? "");

  /* Arriving with a fragment — from the footer's "Cookies" link, or a
     link in an email — has to land on that clause. The browser only does
     this for a document that already exists, and this one is drawn after
     the navigation, so the scroll is done here once it has been. */
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
  }, [hash]);

  /* Which section the reader is actually in. Done with an observer
     rather than scroll maths so it costs nothing while scrolling, and
     it degrades to "the first one" where the API is missing. */
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      // Top third of the viewport: a heading is "current" once it has
      // reached reading position, not when it first peeks in at the foot.
      { rootMargin: `-${HEADER_HEIGHT + 16}px 0px -66% 0px` }
    );
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  const updatedLabel = new Date(updated).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="flex-1">
      <Seo title={title} description={description} path={path} />

      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        <div className="mx-auto w-full max-w-7xl px-5 pb-12 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-teal-300">{kicker}</p>
          <h1 className="mt-3 max-w-[20ch] font-display text-[34px] font-bold leading-[1.1] sm:text-[46px]">
            {title}
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-relaxed text-white/70">{summary}</p>
          <p className="mt-6 text-[12.5px] text-white/45">
            Last updated {updatedLabel} · {CONTACT_DETAILS.legalName}
          </p>
        </div>
      </section>

      {/* ================================================ document */}
      <section className="bg-paper">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[240px_1fr] lg:gap-16">
          {/* ------------------------------------------- contents */}
          <nav aria-label="On this page" className="lg:sticky lg:top-[112px] lg:self-start">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">On this page</h2>
            <ol className="mt-4 space-y-1.5">
              {sections.map((section, i) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    aria-current={active === section.id ? "true" : undefined}
                    className={`flex gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] leading-snug transition ${
                      active === section.id
                        ? "bg-teal-50 font-bold text-teal-700"
                        : "text-ink-muted hover:bg-paper-tint hover:text-ink"
                    }`}
                  >
                    <span className="tabular-nums text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* ------------------------------------------- the text */}
          <article className="min-w-0 max-w-[68ch]">
            {sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                style={{ scrollMarginTop: HEADER_HEIGHT + 24 }}
                className={i === 0 ? "" : "mt-11 border-t border-line pt-11"}
              >
                <h2 className="font-display text-[22px] font-bold leading-tight text-ink sm:text-[26px]">
                  <span className="mr-2 text-[15px] font-bold tabular-nums text-teal-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {section.heading}
                </h2>
                <div className={PROSE}>{section.body}</div>
              </section>
            ))}

            {/* Somebody who has just read this page usually wants one of
                two things next: the other document, or a person. */}
            <div className="mt-12 rounded-2xl bg-white p-6 ring-1 ring-line sm:p-7">
              <h2 className="font-display text-[17px] font-bold text-ink">Questions about any of this?</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
                Email{" "}
                <a
                  href={`mailto:${CONTACT_DETAILS.email}`}
                  className="font-semibold text-teal-700 underline-offset-2 hover:underline"
                >
                  {CONTACT_DETAILS.email}
                </a>{" "}
                or write to us at {CONTACT_DETAILS.address.join(", ")}. We answer data protection requests within one
                month.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to={path === "/privacy" ? "/terms" : "/privacy"}
                  className="rounded-full bg-navy-950 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-navy-900"
                >
                  {path === "/privacy" ? "Read the terms of use" : "Read the privacy notice"}
                </Link>
                <Link
                  to="/contact"
                  className="rounded-full bg-paper-tint px-5 py-2.5 text-[13px] font-bold text-ink-muted transition hover:bg-line-soft hover:text-ink"
                >
                  Contact us
                </Link>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
