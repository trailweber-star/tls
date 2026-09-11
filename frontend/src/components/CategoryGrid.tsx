import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { categoryVisual } from "../lib/categoryVisuals";
import { CATEGORY_PHOTOS, CATEGORY_DESCRIPTIONS, CATEGORY_DISPLAY_NAMES } from "../lib/categoryPhotos";
import type { Specialty } from "../lib/types";

// Bordered white card with the photo INSET (a white gutter all round it,
// rounded corners of its own) rather than bleeding to the card edge —
// that inset frame is what gives the reference design its finished look.
export function CategoryGrid({ specialties }: { specialties: Specialty[] }) {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 sm:gap-6">
      {specialties.map((specialty) => {
        const photo = CATEGORY_PHOTOS[specialty.slug];
        const { icon: Icon, gradient } = categoryVisual(specialty.slug);
        const name = CATEGORY_DISPLAY_NAMES[specialty.slug] ?? specialty.name;
        const description = CATEGORY_DESCRIPTIONS[specialty.slug];
        return (
          <Link
            key={specialty.id}
            to={`/search?specialty=${specialty.slug}`}
            className="group flex flex-col overflow-hidden rounded-[1.375rem] border border-line bg-white p-2.5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-teal-100 hover:shadow-lg"
          >
            <div className="aspect-[5/4] w-full overflow-hidden rounded-[1rem] bg-paper-muted">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient}`}>
                  <Icon className="h-9 w-9 text-white/90" strokeWidth={1.75} />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col px-2.5 pb-2 pt-4">
              <h3 className="font-display text-[16px] font-bold leading-snug text-ink">{name}</h3>
              {description && (
                <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{description}</p>
              )}
              <span className="mt-auto flex items-center gap-1.5 pt-4 text-[12.5px] font-bold text-teal-600">
                Explore
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" strokeWidth={2.5} />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
