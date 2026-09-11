import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, BedDouble, Clock, MapPin, ShieldCheck, Star, Stethoscope, Users } from "lucide-react";
import { formatDistance, formatRating } from "../lib/format";
import { FACILITY_TYPES, REGULATORS, REGULATOR_RATINGS, hoursSummary, isOpenNow } from "../lib/facilityFacets";
import { placeHeroFor } from "../lib/specialtyHeroes";
import type { FacilityWithRelations } from "../lib/types";

/**
 * One place in a result list.
 *
 * Deliberately the same object as SpecialistResultCard: same photo block
 * on the left, same name/badge row, same metadata line, same tag chips,
 * same bottom strip with a fact on the left and "View profile" on the
 * right. A patient comparing a consultant against the hospital they
 * operate at should be reading two rows of one directory, not two
 * different products.
 *
 * What differs is what fills those slots, because a place is not chosen
 * on the same facts as a person: the badge row carries the regulator's
 * grade next to the TLS badge, and the bottom strip carries whether the
 * doors are open rather than the next free appointment. Every value
 * comes from a real column — a place with no rating, no regulator grade
 * or no published hours simply drops that element instead of inventing
 * one.
 */
export function FacilityCard({
  facility,
  highlighted = false,
}: {
  facility: FacilityWithRelations;
  highlighted?: boolean;
}) {
  const href = `/facilities/${facility.slug}`;
  const typeLabel = FACILITY_TYPES[facility.facilityType]?.label ?? facility.facilityType;
  const distance = formatDistance(facility.distanceKm);
  // Same rule as the specialist card: the badge is a plan feature AND a
  // verification outcome, and the API has already decided.
  const isVerified = facility.plan?.verifiedBadge ?? facility.verificationStatus === "verified";
  const grade = facility.regulatorRating ? REGULATOR_RATINGS[facility.regulatorRating] : null;
  const body = REGULATORS[facility.regulator ?? "cqc"];

  const open = isOpenNow(facility);
  const hours = hoursSummary(facility);
  const teamCount = facility.teamCount ?? facility.team?.length ?? 0;

  // Services come from the facility taxonomy the place is tagged at —
  // never a hardcoded list per type.
  const tags = facility.categories
    .map((c) => c.name)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 3);

  return (
    <article
      className={`rounded-[1.25rem] border bg-white p-4 transition sm:p-5 ${
        highlighted
          ? "border-teal-100 bg-teal-50/40 shadow-md ring-1 ring-teal-100"
          : "border-line shadow-sm hover:shadow-md"
      }`}
    >
      <div className="flex min-w-0 gap-4 sm:gap-5">
        <Link to={href} className="shrink-0" aria-label={`View ${facility.name}`}>
          <div className="h-24 w-20 overflow-hidden rounded-[0.875rem] bg-paper-muted sm:h-28 sm:w-24">
            {/* Unlike a person, a place always has a picture: its own if
                it has uploaded one, and the house image for its type if
                it has not. A grey box would be the only wrong answer. */}
            <img
              src={facility.photoUrl ?? placeHeroFor(facility.facilityType)}
              alt={facility.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-[17px] font-bold leading-tight text-ink">
                <Link to={href} className="hover:text-teal-700">
                  {facility.name}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-[13px] text-ink-muted">{facility.tagline ?? typeLabel}</p>
            </div>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {isVerified && (
                <span className="flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-teal-700">
                  <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                  TLS verified
                </span>
              )}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            {facility.ratingCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={0} />
                <span className="font-bold text-ink">{formatRating(facility.ratingAvg)}</span>
                <span>({facility.ratingCount} reviews)</span>
              </span>
            )}
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
              <span className="truncate">
                {facility.city?.name}
                {facility.address ? ` · ${facility.address}` : ""}
                {facility.postcode ? ` · ${facility.postcode}` : ""}
                {distance ? ` · ${distance}` : ""}
              </span>
            </span>
          </div>

          {/* The regulator's own grade, cited with the body that awarded
              it. This is the single fact a patient cannot get from a
              provider's own marketing, so it sits on the card, not
              three clicks in. */}
          {grade && (
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ring-1 ${grade.chip}`}
              >
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.25} />
                {body?.short ?? "Regulator"} {grade.label}
              </span>
              {facility.regulatorRatedAt && (
                <span className="text-ink-faint">
                  rated {new Date(facility.regulatorRatedAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </span>
              )}
            </p>
          )}

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
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-ink-muted">
              {open !== null && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-teal-600" strokeWidth={2} />
                  <span className={open ? "font-bold text-teal-700" : "font-bold text-ink"}>
                    {open ? "Open now" : "Closed"}
                  </span>
                  {hours && !facility.open24h && <span>· {hours}</span>}
                </span>
              )}
              {facility.bedCount != null && (
                <span className="flex items-center gap-1.5">
                  <BedDouble className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
                  {facility.bedCount} beds
                </span>
              )}
              {teamCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Stethoscope className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
                  {teamCount} listed {teamCount === 1 ? "specialist" : "specialists"}
                </span>
              )}
              {facility.staffCount != null && facility.bedCount == null && (
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
                  {facility.staffCount} staff
                </span>
              )}
            </div>
            <Link to={href} className="flex items-center gap-1 text-[12.5px] font-bold text-teal-600 hover:underline">
              View profile
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </div>

      {/* The specialist card explains a top result with its match
          reasons. A place has none — what it has is people who went
          there, so the best result leads with one of them. */}
      {highlighted && facility.reviewSample?.[0]?.comment && (
        <figure className="mt-4 rounded-xl border border-teal-100 bg-white/70 p-3">
          <blockquote className="text-[12.5px] leading-relaxed text-ink-muted">
            “{facility.reviewSample[0].comment}”
          </blockquote>
          <figcaption className="mt-1.5 text-[11.5px] font-semibold text-ink-faint">
            {facility.reviewSample[0].patientName ?? "Verified visitor"}
            {facility.reviewSample[0].verified ? " · verified visit" : ""}
          </figcaption>
        </figure>
      )}
    </article>
  );
}
