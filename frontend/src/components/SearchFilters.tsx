import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Star, X } from "lucide-react";
import { formatPrice } from "../lib/format";
import type { City, SearchFacets, SortOption, Specialty } from "../lib/types";

export interface SearchFilterState {
  /** Free text from the search bar, carried through every filter change. */
  q: string;
  /** Which people directory the search came from — a specialist tab key.
   *  Not a filter the sidebar owns: it says WHICH directory is on screen,
   *  and every filter change has to carry it or the patient is silently
   *  moved from "physiotherapists in Leeds" to everyone in Leeds. */
  group: string;
  specialty: string;
  subspecialties: string[];
  /** Expert Witness only -- one of lib/ukRegions.js's UK_REGIONS. */
  region: string;
  /** Expert Witness only -- leaf slugs under Medicolegal (Personal
   *  Injury, Clinical Negligence, ...). */
  practiceAreas: string[];
  location: string;
  minRating: number | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  verifiedOnly: boolean;
  availableWithinDays: number | null;
  sort: SortOption;
}

const SORT_LABELS: { value: SortOption; label: string }[] = [
  { value: "best-match", label: "Best match" },
  { value: "rating", label: "Highest rated" },
  { value: "reviews", label: "Most reviewed" },
  { value: "availability", label: "Soonest available" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "distance", label: "Nearest first" },
];

const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500";

/**
 * A text field that writes to the URL, but not on every keystroke: every
 * change here is a new URL and a new request, and typing a town
 * un-debounced would be one of each per letter, with the input fighting
 * the value coming back. It keeps its own value while you type and
 * commits once you stop.
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

  // Follow the URL when it changes from outside — back button, Clear —
  // without clobbering what is being typed.
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

const checkboxRow = "flex cursor-pointer items-center gap-2.5 py-1 text-[13px] text-ink-muted hover:text-ink";
const checkboxInput = "h-4 w-4 shrink-0 rounded border-line accent-teal-600";

/**
 * The results sidebar. It owns no filter state of its own except the
 * in-flight price slider (which is debounced so dragging doesn't fire a
 * request per pixel) — everything else is lifted to the page, which keeps
 * it in the URL. That means every filter combination is a shareable,
 * bookmarkable link and the browser's back button works.
 *
 * Counts beside each option come from the API's facet counts, computed
 * against the current search minus that one dimension, so they stay
 * truthful as other filters change.
 */
export function SearchFilters({
  filters,
  facets,
  specialties,
  cities,
  total,
  onChange,
  onReset,
}: {
  filters: SearchFilterState;
  facets: SearchFacets | null;
  specialties: Specialty[];
  cities: City[];
  total: number;
  onChange: (patch: Partial<SearchFilterState>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ceiling = facets?.price.ceilingMinor ?? 50000;
  const [priceRange, setPriceRange] = useState<[number, number]>([
    filters.minPriceMinor ?? 0,
    filters.maxPriceMinor ?? ceiling,
  ]);
  const dragging = useRef(false);

  // Keep the slider in step with the URL (back button, reset, a shared
  // link) — but never while the user is mid-drag.
  useEffect(() => {
    if (dragging.current) return;
    setPriceRange([filters.minPriceMinor ?? 0, filters.maxPriceMinor ?? ceiling]);
  }, [filters.minPriceMinor, filters.maxPriceMinor, ceiling]);

  function commitPrice(next: [number, number]) {
    dragging.current = false;
    onChange({
      minPriceMinor: next[0] > 0 ? next[0] : null,
      maxPriceMinor: next[1] < ceiling ? next[1] : null,
    });
  }

  const topLevel = specialties.filter((s) => s.parentId === null);
  const activeCount =
    (filters.subspecialties.length ? 1 : 0) +
    (filters.region ? 1 : 0) +
    (filters.practiceAreas.length ? 1 : 0) +
    (filters.minRating != null ? 1 : 0) +
    (filters.verifiedOnly ? 1 : 0) +
    (filters.availableWithinDays != null ? 1 : 0) +
    (filters.minPriceMinor != null || filters.maxPriceMinor != null ? 1 : 0);

  const minPct = (priceRange[0] / ceiling) * 100;
  const maxPct = (priceRange[1] / ceiling) * 100;

  function toggleSub(slug: string) {
    const next = filters.subspecialties.includes(slug)
      ? filters.subspecialties.filter((s) => s !== slug)
      : [...filters.subspecialties, slug];
    onChange({ subspecialties: next });
  }

  function togglePracticeArea(slug: string) {
    const next = filters.practiceAreas.includes(slug)
      ? filters.practiceAreas.filter((s) => s !== slug)
      : [...filters.practiceAreas, slug];
    onChange({ practiceAreas: next });
  }

  return (
    <>
      {/* Below lg the panel collapses behind a button so results lead. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-[13.5px] font-bold text-ink shadow-sm lg:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-teal-600" strokeWidth={2} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-700">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[12.5px] font-semibold text-ink-muted">{open ? "Hide" : "Show"}</span>
      </button>

      <aside className={`${open ? "block" : "hidden"} lg:block`}>
        <div className="rounded-[1.25rem] border border-line bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[17px] font-bold text-ink">Filters</h2>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="flex items-center gap-1 text-[12px] font-bold text-teal-600 hover:underline"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                Clear
              </button>
            )}
          </div>

          {/* The sidebar is the only search on this page. The tabbed bar
              with its expansive panel is how a search is started, and it
              lives on the homepage; here the words and the place sit
              with every other filter, so one panel is in charge. */}
          <Section title="Search">
            <DebouncedField
              id="filter-q"
              value={filters.q}
              placeholder="Name, specialty, condition or treatment"
              onCommit={(q) => onChange({ q })}
            />
            <div className="mt-2">
              <DebouncedField
                id="filter-location"
                value={filters.location}
                placeholder="Town or postcode"
                onCommit={(location) => onChange({ location })}
              />
            </div>
          </Section>

          <Section title="Specialty">
            <select
              value={filters.specialty}
              // Changing specialty clears sub-specialties (and region,
              // which only ever applied under Expert Witness): last
              // search's knee filters make no sense under Dentistry.
              onChange={(e) => onChange({ specialty: e.target.value, subspecialties: [], region: "", practiceAreas: [] })}
              className={selectClass}
            >
              <option value="">All specialties</option>
              {topLevel.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </Section>

          {filters.specialty === "expert-witness" && (facets?.regions.length ?? 0) > 0 && (
            <Section title="Regions covered">
              <select
                value={filters.region}
                onChange={(e) => onChange({ region: e.target.value })}
                className={selectClass}
              >
                <option value="">Any region</option>
                {facets?.regions.map((r) => (
                  <option key={r.slug} value={r.name}>
                    {r.name} ({r.count})
                  </option>
                ))}
              </select>
            </Section>
          )}

          {/* A solicitor or claims handler arriving here from the
              Medico-legal Experts tab is looking for a specific kind of
              report, not browsing a generic specialty tree -- so this is
              its own law-specific section rather than the generic
              "Sub-specialty" checkboxes below (which, for Expert Witness,
              only ever offer the single, un-narrowing "Medicolegal"
              option). */}
          {filters.specialty === "expert-witness" && (facets?.practiceAreas.length ?? 0) > 0 && (
            <Section title="Type of report">
              <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
                {facets?.practiceAreas.map((area) => (
                  <label key={area.slug} className={checkboxRow}>
                    <input
                      type="checkbox"
                      className={checkboxInput}
                      checked={filters.practiceAreas.includes(area.slug)}
                      onChange={() => togglePracticeArea(area.slug)}
                    />
                    <span className="flex-1 truncate">{area.name}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{area.count}</span>
                  </label>
                ))}
              </div>
            </Section>
          )}

          {filters.specialty && (facets?.subspecialties.length ?? 0) > 0 && (
            <Section title="Sub-specialty">
              <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
                {facets?.subspecialties.map((sub) => (
                  <label key={sub.slug} className={checkboxRow}>
                    <input
                      type="checkbox"
                      className={checkboxInput}
                      checked={filters.subspecialties.includes(sub.slug)}
                      onChange={() => toggleSub(sub.slug)}
                    />
                    <span className="flex-1 truncate">{sub.name}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-faint">{sub.count}</span>
                  </label>
                ))}
              </div>
            </Section>
          )}

          {/* A medico-legal expert isn't placed by a clinic city the way
              every other specialist is -- they're placed by the UK
              regions they cover (see lib/ukRegions.js and the "Regions
              covered" section above), so the city dropdown is not just
              unhelpful here, it's the wrong question. */}
          {filters.specialty !== "expert-witness" && (
            <Section title="Location">
              <select
                value={filters.location}
                onChange={(e) => onChange({ location: e.target.value })}
                className={selectClass}
              >
                <option value="">Anywhere in the UK</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Section>
          )}

          <Section title="Availability">
            {(facets?.availability ?? []).map((slot) => (
              <label key={slot.days} className={checkboxRow}>
                <input
                  type="checkbox"
                  className={checkboxInput}
                  checked={filters.availableWithinDays === slot.days}
                  // One window at a time: ticking a different one replaces
                  // the previous, ticking the active one clears it.
                  onChange={() =>
                    onChange({ availableWithinDays: filters.availableWithinDays === slot.days ? null : slot.days })
                  }
                />
                <span className="flex-1">{slot.label}</span>
                <span className="shrink-0 text-[11.5px] text-ink-faint">{slot.count}</span>
              </label>
            ))}
          </Section>

          <Section title="Price range">
            <div className="range-stack relative h-6">
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
              <span
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-teal-500"
                style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
              />
              <input
                type="range"
                aria-label="Minimum price"
                min={0}
                max={ceiling}
                step={500}
                value={priceRange[0]}
                onChange={(e) => {
                  dragging.current = true;
                  const v = Math.min(Number(e.target.value), priceRange[1] - 500);
                  setPriceRange([v, priceRange[1]]);
                }}
                onPointerUp={() => commitPrice(priceRange)}
                onKeyUp={() => commitPrice(priceRange)}
              />
              <input
                type="range"
                aria-label="Maximum price"
                min={0}
                max={ceiling}
                step={500}
                value={priceRange[1]}
                onChange={(e) => {
                  dragging.current = true;
                  const v = Math.max(Number(e.target.value), priceRange[0] + 500);
                  setPriceRange([priceRange[0], v]);
                }}
                onPointerUp={() => commitPrice(priceRange)}
                onKeyUp={() => commitPrice(priceRange)}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px] font-semibold text-ink-muted">
              <span>{formatPrice(priceRange[0], "GBP")}</span>
              <span>
                {formatPrice(priceRange[1], "GBP")}
                {priceRange[1] >= ceiling ? "+" : ""}
              </span>
            </div>
          </Section>

          <Section title="Rating">
            {(facets?.ratings ?? []).map((bucket) => (
              <label key={bucket.min} className={checkboxRow}>
                <input
                  type="checkbox"
                  className={checkboxInput}
                  checked={filters.minRating === bucket.min}
                  onChange={() => onChange({ minRating: filters.minRating === bucket.min ? null : bucket.min })}
                />
                <span className="flex flex-1 items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3 w-3 ${i < Math.floor(bucket.min) ? "fill-amber text-amber" : "text-line"}`}
                      strokeWidth={0}
                    />
                  ))}
                  <span className="ml-1 text-[12px]">{bucket.min}+</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-faint">{bucket.count}</span>
              </label>
            ))}
          </Section>

          <Section title="Verification">
            <label className={checkboxRow}>
              <input
                type="checkbox"
                className={checkboxInput}
                checked={filters.verifiedOnly}
                onChange={(e) => onChange({ verifiedOnly: e.target.checked })}
              />
              <span className="flex-1">TLS verified only</span>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{facets?.verified ?? 0}</span>
            </label>
          </Section>

          <Section title="Sort by">
            <select
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as SortOption })}
              className={selectClass}
            >
              {SORT_LABELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Section>

          <p className="border-t border-line pt-3 text-[12px] text-ink-faint">
            {total} {total === 1 ? "specialist" : "specialists"} match these filters
          </p>
        </div>
      </aside>
    </>
  );
}

export { SORT_LABELS };
