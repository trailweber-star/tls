import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, CalendarClock, MapPin, Sparkles, Star } from "lucide-react";
import { formatAvailability, formatDistance, formatPrice, formatRating } from "../lib/format";
import type { SpecialistWithRelations } from "../lib/types";

function initialsOf(fullName: string) {
  return fullName
    .split(" ")
    .filter((w) => w[0] === w[0]?.toUpperCase())
    .slice(-2)
    .map((w) => w[0])
    .join("");
}

/**
 * A search result row. Every value on it comes from a real field on the
 * Specialist record — photo, rating, clinic address, published price,
 * next available appointment, verification status — so the same card
 * renders live profiles unchanged once they arrive through the
 * specialist submission form. Nothing here is decorative filler: if a
 * field is absent (no photo, no published price, no availability) the
 * card drops that element rather than inventing a value.
 *
 * `highlighted` marks the best match on the first page of a relevance-
 * sorted search, which additionally shows why it matched.
 */
export function SpecialistResultCard({
  specialist,
  highlighted = false,
  /**
   * True when the current sort actually gives paid tiers a lift. The
   * search page passes this from the sort mode, so "Promoted" appears
   * exactly when it is true and never as decoration.
   */
  promoted = false,
}: {
  specialist: SpecialistWithRelations;
  highlighted?: boolean;
  promoted?: boolean;
}) {
  const location = specialist.clinicLocations[0];
  const availability = formatAvailability(specialist.nextAvailableAt);
  const distance = formatDistance(specialist.distanceKm);
  // Matches the profile page: badge = verified AND on a plan that
  // includes it. `verifiedBadge` is computed by the API (profileGate.js).
  const isVerified = specialist.verifiedBadge ?? false;

  // Tags come from the taxonomy and the specialist's own tagged
  // treatments/conditions — never a hardcoded list.
  // specialties runs broad-to-narrow (sub-specialty then the procedure),
  // which reads better than leading with the narrowest term.
  const tags = [
    ...specialist.specialties.map((s) => s.name),
    specialist.primarySpecialty?.name,
    ...specialist.treatments.map((t) => t.name),
    ...specialist.conditions.map((c) => c.name),
  ]
    .filter((t): t is string => Boolean(t))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 3);

  return (
    <article
      className={`rounded-[1.25rem] border bg-white p-4 transition sm:p-5 ${
        highlighted ? "border-teal-100 bg-teal-50/40 shadow-md ring-1 ring-teal-100" : "border-line shadow-sm hover:shadow-md"
      }`}
    >
      <div className="flex min-w-0 gap-4 sm:gap-5">
        <Link
          to={`/specialists/${specialist.slug}`}
          className="shrink-0"
          aria-label={`View ${specialist.fullName}'s profile`}
        >
          <div className="h-24 w-20 overflow-hidden rounded-[0.875rem] bg-paper-muted sm:h-28 sm:w-24">
            {specialist.photoUrl ? (
              <img
                src={specialist.photoUrl}
                alt={specialist.fullName}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="grid h-full w-full place-items-center bg-gradient-to-br from-paper-tint to-teal-50 font-display text-xl font-bold text-teal-700">
                {initialsOf(specialist.fullName)}
              </div>
            )}
          </div>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-[17px] font-bold leading-tight text-ink">
                <Link to={`/specialists/${specialist.slug}`} className="hover:text-teal-700">
                  {specialist.fullName}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-[13px] text-ink-muted">{specialist.title}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {/* Paid placement is disclosed, not hidden. A patient is
                  entitled to know that a result is above another because
                  of a subscription rather than a better match — and UK
                  guidance on online choice architecture expects it to be
                  said plainly. Shown only where ranking was actually
                  affected: on price or distance sorting nothing is
                  promoted, so nothing claims to be. */}
              {promoted && (
                <span className="rounded-full bg-paper-tint px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                  Promoted
                </span>
              )}
              {isVerified && (
                <span className="flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-teal-700">
                  <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                  TLS verified
                </span>
              )}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            {specialist.ratingCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={0} />
                <span className="font-bold text-ink">{formatRating(specialist.ratingAvg)}</span>
                <span>({specialist.ratingCount} reviews)</span>
              </span>
            )}
            {location && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
                <span className="truncate">
                  {[location.city?.name, location.address, distance].filter(Boolean).join(" · ")}
                </span>
              </span>
            )}
          </div>

          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-paper-tint px-2.5 py-1 text-[11px] font-semibold text-teal-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
              {specialist.consultationPriceMinor != null && (
                <span className="font-bold text-ink">
                  From {formatPrice(specialist.consultationPriceMinor, specialist.currency)}
                </span>
              )}
              {availability && (
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-teal-600" strokeWidth={2} />
                  Next available: <span className="font-semibold text-ink">{availability}</span>
                </span>
              )}
            </div>
            <Link
              to={`/specialists/${specialist.slug}`}
              className="flex items-center gap-1 text-[12.5px] font-bold text-teal-600 hover:underline"
            >
              View profile
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </div>

      {highlighted && (specialist.matchReasons?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-xl border border-teal-100 bg-white/70 p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
            <Sparkles className="h-3.5 w-3.5 text-teal-600" strokeWidth={2} />
            Why this specialist?
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
            {specialist.matchReasons?.map((reason) => (
              <li key={reason.type} className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-teal-500" />
                {reason.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
