import { useEffect, useState } from "react";
import { SlidersHorizontal, Star, X } from "lucide-react";
import { FACILITY_AMENITIES, REGULATORS, REGULATOR_RATINGS } from "../lib/facilityFacets";
import type { FacilityType } from "../lib/types";

/**
 * What a place is filtered on.
 *
 * Deliberately not the specialist filter set. Nobody chooses a care home
 * by consultation price or a pharmacy by next available appointment; they
 * choose on where it is, what the regulator said, whether it is open, and
 * whether they can get a wheelchair through the door. Every field here is
 * a real column on the facility record — nothing is aspirational.
 */
export interface PlaceFilterState {
  q: string;
  location: string;
  category: string;
  minRating: number | null;
  verifiedOnly: boolean;
  regulatorRating: string;
  amenities: string[];
  openNow: boolean;
  emergency: boolean;
  sort: string;
}

export const PLACE_SORTS: { value: string; label: string }[] = [
  { value: "distance", label: "Nearest first" },
  { value: "rating", label: "Highest rated" },
  { value: "reviews", label: "Most reviewed" },
  { value: "name", label: "Name A–Z" },
];

const PLACE_SEARCH_PLACEHOLDER: Record<FacilityType, string> = {
  hospital: "Name of a hospital",
  clinic: "Name of a clinic or practice",
  care_home: "Name of a care home",
  pharmacy: "Name of a pharmacy",
};

/** Regulator grades offered as a floor, best first. */
const GRADE_FLOORS = [
  { value: "outstanding", label: "Outstanding only" },
  { value: "good", label: "Good or better" },
];

/**
 * A text field that writes to the URL, but not on every keystroke.
 *
 * The sidebar is the search on this page, and every change is a new URL
 * and a new request. Typing "Solihull" un-debounced would be eight of
 * each, and the input would fight the value coming back. It keeps its
 * own value while you type and commits once you stop.
 */
function DebouncedField({
  id,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Follow the URL when it changes from outside — a back button press,
  // or Clear — without clobbering what is being typed.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onCommit(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, value, onCommit]);

  return (
    <input
      id={id}
      type="search"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 text-[13px] font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}

const selectClass =
  "w-full truncate rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-medium text-ink outline-none transition focus:border-teal-500";
const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500";
const checkboxRow = "flex cursor-pointer items-center gap-2.5 py-1 text-[13px] text-ink-muted hover:text-ink";
const checkboxInput = "h-4 w-4 shrink-0 rounded border-line accent-teal-600";

export function PlaceFilters({
  placeType,
  filters,
  /**
   * Only the categories and amenities that some listing of this type
   * actually has. Offering the whole vocabulary would mean offering
   * filters that can only ever return nothing — the same mistake the
   * search suggestions used to make.
   */
  availableCategories,
  availableAmenities,
  total,
  onChange,
  onReset,
}: {
  placeType: FacilityType;
  filters: PlaceFilterState;
  availableCategories: { slug: string; name: string }[];
  availableAmenities: string[];
  total: number;
  onChange: (patch: Partial<PlaceFilterState>) => void;
  onReset: () => void;
}) {
  const amenityOptions = FACILITY_AMENITIES.filter(
    (a) => a.types.includes(placeType) && availableAmenities.includes(a.slug)
  );

  const active =
    Boolean(filters.category) ||
    filters.minRating != null ||
    filters.verifiedOnly ||
    Boolean(filters.regulatorRating) ||
    filters.amenities.length > 0 ||
    filters.openNow ||
    filters.emergency;

  function toggleAmenity(slug: string) {
    const next = filters.amenities.includes(slug)
      ? filters.amenities.filter((a) => a !== slug)
      : [...filters.amenities, slug];
    onChange({ amenities: next });
  }

  return (
    <aside className="h-fit rounded-2xl border border-line bg-white p-5 lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
          <SlidersHorizontal className="h-4 w-4 text-teal-600" strokeWidth={2} />
          Filters
        </h2>
        {active && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[12px] font-bold text-ink-muted transition hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            Clear
          </button>
        )}
      </div>

      <p className="mt-1 text-[12.5px] text-ink-muted">
        {total} {total === 1 ? "result" : "results"}
      </p>

      <div className="mt-4">
        {/* The sidebar is the search on this page — the words and the
            place live here alongside every other filter, rather than in
            a second bar above the results competing with it. */}
        <Section title="Search">
          <DebouncedField
            id="place-q"
            value={filters.q}
            placeholder={PLACE_SEARCH_PLACEHOLDER[placeType]}
            onCommit={(q) => onChange({ q })}
          />
          <div className="mt-2">
            <DebouncedField
              id="place-location"
              value={filters.location}
              placeholder="Town or postcode"
              onCommit={(location) => onChange({ location })}
            />
          </div>
        </Section>

        <Section title="Sort by">
          <select
            id="place-sort"
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value })}
            className={selectClass}
          >
            {PLACE_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Section>

        {availableCategories.length > 0 && (
          <Section title="Service">
            <select
              id="place-category"
              value={filters.category}
              onChange={(e) => onChange({ category: e.target.value })}
              className={selectClass}
            >
              <option value="">Any service</option>
              {availableCategories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Section>
        )}

        {/* The regulator's grade, which is the one thing a patient cannot
            get from a provider's own website. An unrated listing is never
            filtered out by a floor — a newly registered service has no
            grade yet, and hiding it would punish it for the regulator's
            timetable rather than its care. */}
        <Section title="Inspection rating">
          <select
            id="place-grade"
            value={filters.regulatorRating}
            onChange={(e) => onChange({ regulatorRating: e.target.value })}
            className={selectClass}
          >
            <option value="">Any rating</option>
            {GRADE_FLOORS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
            As published by {REGULATORS.cqc.short} and the other UK inspectorates. Newly registered services that have
            not been rated yet are still shown.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["outstanding", "good", "requires_improvement"] as const).map((key) => (
              <span
                key={key}
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ${REGULATOR_RATINGS[key].chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${REGULATOR_RATINGS[key].dot}`} />
                {REGULATOR_RATINGS[key].label}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Patient rating">
          <div className="space-y-0.5">
            {[4.5, 4, 3.5].map((value) => (
              <label key={value} className={checkboxRow}>
                <input
                  type="radio"
                  name="place-min-rating"
                  checked={filters.minRating === value}
                  onChange={() => onChange({ minRating: value })}
                  className={checkboxInput}
                />
                <span className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={0} />
                  {value}+ and above
                </span>
              </label>
            ))}
            <label className={checkboxRow}>
              <input
                type="radio"
                name="place-min-rating"
                checked={filters.minRating == null}
                onChange={() => onChange({ minRating: null })}
                className={checkboxInput}
              />
              Any rating
            </label>
          </div>
        </Section>

        <Section title="Availability">
          <label className={checkboxRow}>
            <input
              type="checkbox"
              id="place-open-now"
              checked={filters.openNow}
              onChange={(e) => onChange({ openNow: e.target.checked })}
              className={checkboxInput}
            />
            Open right now
          </label>
          {placeType === "hospital" && (
            <label className={checkboxRow}>
              <input
                type="checkbox"
                id="place-emergency"
                checked={filters.emergency}
                onChange={(e) => onChange({ emergency: e.target.checked })}
                className={checkboxInput}
              />
              Has an emergency department
            </label>
          )}
          <label className={checkboxRow}>
            <input
              type="checkbox"
              id="place-verified"
              checked={filters.verifiedOnly}
              onChange={(e) => onChange({ verifiedOnly: e.target.checked })}
              className={checkboxInput}
            />
            TLS verified only
          </label>
        </Section>

        {amenityOptions.length > 0 && (
          <Section title="Facilities &amp; access">
            <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
              {amenityOptions.map((a) => (
                <label key={a.slug} className={checkboxRow}>
                  <input
                    type="checkbox"
                    id={`amenity-${a.slug}`}
                    checked={filters.amenities.includes(a.slug)}
                    onChange={() => toggleAmenity(a.slug)}
                    className={checkboxInput}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}
