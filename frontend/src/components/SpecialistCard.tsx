import { Link } from "react-router-dom";
import { MapPin, Star } from "lucide-react";
import type { SpecialistWithRelations } from "../lib/types";

function initialsOf(fullName: string) {
  return fullName
    .split(" ")
    .filter((w) => w[0] === w[0]?.toUpperCase())
    .slice(-2)
    .map((w) => w[0])
    .join("");
}

// Bordered white card with an inset framed portrait at the top, then
// name, title, rating, location and specialty tags — matching the
// reference design's Featured Specialists cards. Falls back to an
// initials panel when a specialist has no photoUrl yet.
export function SpecialistCard({ specialist }: { specialist: SpecialistWithRelations }) {
  const location = specialist.clinicLocations[0];

  const specialtyTags = [
    specialist.primarySpecialty?.name,
    specialist.treatments.find((t) => t.name !== specialist.primarySpecialty?.name)?.name ??
      specialist.conditions.find((c) => c.name !== specialist.primarySpecialty?.name)?.name,
  ].filter((t): t is string => Boolean(t));

  return (
    <Link
      to={`/specialists/${specialist.slug}`}
      className="group flex flex-col overflow-hidden rounded-[1.375rem] border border-line bg-white p-2.5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-teal-100 hover:shadow-lg"
    >
      <div className="aspect-[4/5] w-full overflow-hidden rounded-[1rem] bg-paper-muted">
        {specialist.photoUrl ? (
          <img
            src={specialist.photoUrl}
            alt={specialist.fullName}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-paper-tint to-teal-50 font-display text-3xl font-bold text-teal-700">
            {initialsOf(specialist.fullName)}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-2.5 pb-2 pt-4">
        <h3 className="font-display text-[17px] font-bold leading-snug text-ink group-hover:text-teal-700">
          {specialist.fullName}
        </h3>
        <p className="mt-1 text-[13px] text-ink-muted">{specialist.title}</p>

        <div className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-ink-muted">
          {specialist.ratingCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={0} />
              <span className="font-bold text-ink">{specialist.ratingAvg.toFixed(1)}</span>
              <span>({specialist.ratingCount} reviews)</span>
            </span>
          )}
          {/* city can be null on a specialist's own practice address —
              fall back to the street rather than printing nothing. */}
          {location && (location.city?.name || location.address) && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
              {location.city?.name ?? location.address}
            </span>
          )}
        </div>

        {specialtyTags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
            {specialtyTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-paper-tint px-2.5 py-1 text-[11px] font-semibold text-teal-700"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
