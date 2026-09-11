import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, ShieldCheck, Star } from "lucide-react";
import { getFeaturedReviews } from "../lib/api";
import { placeHeroFor } from "../lib/specialtyHeroes";
import type { FeaturedReview } from "../lib/types";

/**
 * The homepage review strip.
 *
 * Every card is a real row: an approved review of a real listing, with a
 * link straight to the profile it is about. There is no fallback set of
 * written-in testimonials — if nothing has been approved yet the whole
 * section removes itself, because a page that invents praise to fill a
 * gap is exactly the thing this directory exists not to be.
 *
 * It drifts on its own so the strip reads as alive at a glance, and it
 * has real buttons because an auto-scroller you cannot steer is a
 * frustration rather than a feature. Any interaction — hovering,
 * touching, focusing a card, pressing an arrow — stops the drift, and
 * `prefers-reduced-motion` stops it before it starts.
 */
export function ReviewsCarousel() {
  const [items, setItems] = useState<FeaturedReview[] | null>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    getFeaturedReviews(12)
      .then(setItems)
      // A failure here must not take the homepage with it. An empty
      // strip is the correct degraded state.
      .catch(() => setItems([]));
  }, []);

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  function scrollByCards(direction: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    // One card plus its gap, so a press always lands on a card edge.
    const step = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 320;
    el.scrollBy({ left: direction * (step + 16), behavior: "smooth" });
    setPaused(true);
  }

  /* ------------------------------------------------------- auto-scroll
     A slow continuous drift rather than a slide-every-N-seconds: a
     jumping carousel steals attention from the rest of the page, and
     this one is meant to be readable while ignored. At the end it
     returns to the start rather than reversing, so the order the API
     ranked the reviews in is always the order you read them in. */
  useEffect(() => {
    if (!items?.length || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last = performance.now();
    const PIXELS_PER_SECOND = 24;
    // The drift is under half a pixel per frame, and scrollLeft rounds
    // what you assign it — writing 0.4 sixty times a second moves
    // nothing at all. So the position is accumulated here at full
    // precision and only the whole part is written out.
    let offset = trackRef.current?.scrollLeft ?? 0;

    const tick = (now: number) => {
      const el = trackRef.current;
      if (el) {
        offset += ((now - last) / 1000) * PIXELS_PER_SECOND;
        if (offset + el.clientWidth >= el.scrollWidth - 1) offset = 0;
        el.scrollLeft = offset;
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [items, paused]);

  useEffect(() => {
    measure();
    const el = trackRef.current;
    el?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [items, measure]);

  // Loading and empty look the same from outside: no section at all,
  // rather than a skeleton that shifts the page as it fills.
  if (!items || items.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[28px] font-bold text-ink sm:text-[34px]">What patients actually said</h2>
          <p className="mt-2 flex items-center gap-1.5 text-[14px] text-ink-muted">
            <ShieldCheck className="h-4 w-4 text-teal-600" strokeWidth={2} />
            Every review below is a real one, read and approved by our team before it was published.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous reviews"
            onClick={() => scrollByCards(-1)}
            disabled={edges.start}
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-teal-200 hover:text-teal-700 disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="More reviews"
            onClick={() => scrollByCards(1)}
            disabled={edges.end}
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-teal-200 hover:text-teal-700 disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <ul
        ref={trackRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        // No scroll-snapping: mandatory snap points fight a continuous
        // drift, pulling scrollLeft back to the nearest card every frame
        // so the strip never moves at all. The arrows already step by a
        // whole card, which is what snapping was there to guarantee.
        className="mt-7 flex gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ review, subject, seenFor }) => (
          <li
            key={review.id}
            className="flex w-[19rem] shrink-0 flex-col rounded-2xl border border-line bg-white p-5 sm:w-[21rem]"
          >
            <Link to={subject.href} className="group flex items-center gap-3">
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-paper-muted">
                {subject.kind === "facility" ? (
                  <img
                    src={subject.photoUrl ?? placeHeroFor(subject.facilityType)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : subject.photoUrl ? (
                  <img src={subject.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-gradient-to-br from-paper-tint to-teal-50 font-display text-[13px] font-bold text-teal-700">
                    {subject.name
                      .split(" ")
                      .filter((w) => w[0] === w[0]?.toUpperCase())
                      .slice(-2)
                      .map((w) => w[0])
                      .join("")}
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-[14.5px] font-bold leading-tight text-ink group-hover:text-teal-700">
                  {subject.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-ink-muted">
                  {subject.kind === "facility" && <Building2 className="h-3 w-3 shrink-0" strokeWidth={2} />}
                  {subject.subtitle ?? (subject.kind === "facility" ? "Care setting" : "Specialist")}
                </span>
              </span>
            </Link>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-soft pt-3.5">
              <span className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`h-4 w-4 ${n <= review.rating ? "fill-amber text-amber" : "fill-line text-line"}`}
                    strokeWidth={0}
                  />
                ))}
                <span className="ml-1.5 text-[13px] font-bold text-ink tabular-nums">{review.rating}</span>
              </span>
              {review.verified && (
                <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-teal-700">
                  <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Verified
                </span>
              )}
            </div>

            <blockquote className="mt-3.5 line-clamp-5 text-[13.5px] leading-relaxed text-ink-muted">
              {review.comment}
            </blockquote>

            <div className="mt-auto pt-4">
              {seenFor ? (
                <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
                  Seen for:
                  <span className="rounded-full bg-paper-tint px-2.5 py-1 text-[11.5px] font-semibold text-teal-700">
                    {seenFor}
                  </span>
                </p>
              ) : (
                <p className="text-[12px] text-ink-faint">
                  {review.patientName ?? "Verified visitor"} ·{" "}
                  {new Date(review.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
