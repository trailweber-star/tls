import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, MapPin, SearchX, Sparkles } from "lucide-react";
import { getAllSpecialties, getCities, searchFacilities, searchSpecialists } from "../lib/api";
import { FacilityCard } from "../components/FacilityCard";
import { SearchFilters } from "../components/SearchFilters";
import { PlaceFilters } from "../components/PlaceFilters";
import type { PlaceFilterState } from "../components/PlaceFilters";
import type { SearchFilterState } from "../components/SearchFilters";
import type { FacilityType } from "../lib/types";
import type { FacilitySearchResponse } from "../lib/api";
import { SORT_LABELS } from "../components/SearchFilters";
import { SpecialistResultCard } from "../components/SpecialistResultCard";
import { heroHeadingFor, heroPhotoFor, placeHeroFor } from "../lib/specialtyHeroes";
import { HEADER_HEIGHT } from "../components/Header";
import type { City, SearchResponse, SortOption, Specialty } from "../lib/types";
import { Seo } from "../components/Seo";

// Filter state lives in the URL, using the same parameter names the API
// takes. So a search is a shareable link, the back button steps through
// filter changes, and a refresh keeps the results — none of which works
// if the state only lives in component memory.

/* One results page serves both halves of the directory, so the nouns it
   prints have to follow whichever half is being shown. */
const PLACE_NOUN: Record<FacilityType, string> = {
  hospital: "hospital",
  clinic: "practice",
  care_home: "care home",
  pharmacy: "pharmacy",
};
const PLACE_PLURAL: Record<FacilityType, string> = {
  hospital: "hospitals",
  clinic: "practices",
  care_home: "care homes",
  pharmacy: "pharmacies",
};
/** The tab that corresponds to each place type, so the bar opens on it. */
const PLACE_HEADING: Record<FacilityType, string> = {
  hospital: "Hospitals",
  clinic: "Practices & clinics",
  care_home: "Care homes",
  pharmacy: "Pharmacies",
};

function readFilters(params: URLSearchParams): SearchFilterState & { page: number } {
  const num = (key: string) => {
    const raw = params.get(key);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    q: params.get("q") ?? "",
    specialty: params.get("specialty") ?? "",
    subspecialties: params.getAll("subspecialty").filter(Boolean),
    location: params.get("location") ?? "",
    minRating: num("minRating"),
    minPriceMinor: num("minPrice"),
    maxPriceMinor: num("maxPrice"),
    verifiedOnly: params.get("verifiedOnly") === "true",
    availableWithinDays: num("availableWithinDays"),
    sort: (params.get("sort") as SortOption) || "best-match",
    page: num("page") ?? 1,
  };
}

function writeFilters(
  state: SearchFilterState & { page: number },
  keep?: { type?: string | null; category?: string | null }
): URLSearchParams {
  const qs = new URLSearchParams();
  // The place type and category are not filters the sidebar owns, but
  // they say WHICH directory is being shown. Dropping them on a filter
  // change silently threw the patient from "care homes in Leeds" back to
  // "specialists in Leeds" with no way to tell what had happened.
  if (keep?.type) qs.set("type", keep.type);
  if (keep?.category) qs.set("category", keep.category);
  if (state.q) qs.set("q", state.q);
  if (state.specialty) qs.set("specialty", state.specialty);
  state.subspecialties.forEach((s) => qs.append("subspecialty", s));
  if (state.location) qs.set("location", state.location);
  if (state.minRating != null) qs.set("minRating", String(state.minRating));
  if (state.minPriceMinor != null) qs.set("minPrice", String(state.minPriceMinor));
  if (state.maxPriceMinor != null) qs.set("maxPrice", String(state.maxPriceMinor));
  if (state.verifiedOnly) qs.set("verifiedOnly", "true");
  if (state.availableWithinDays != null) qs.set("availableWithinDays", String(state.availableWithinDays));
  if (state.sort && state.sort !== "best-match") qs.set("sort", state.sort);
  if (state.page > 1) qs.set("page", String(state.page));
  return qs;
}

/**
 * Place filters live in the same URL as the specialist ones, under their
 * own keys, so a filtered list of care homes is as shareable as a
 * filtered list of surgeons and the back button works on both.
 */
function readPlaceFilters(params: URLSearchParams): PlaceFilterState {
  const n = (key: string) => (params.get(key) ? Number(params.get(key)) : null);
  return {
    q: params.get("q") ?? "",
    location: params.get("location") ?? "",
    category: params.get("category") ?? "",
    minRating: n("minRating"),
    verifiedOnly: params.get("verifiedOnly") === "true",
    regulatorRating: params.get("regulatorRating") ?? "",
    amenities: (params.get("amenities") ?? "").split(",").filter(Boolean),
    openNow: params.get("openNow") === "true",
    emergency: params.get("emergency") === "true",
    sort: params.get("sort") || "distance",
  };
}

function writePlaceFilters(type: string, state: PlaceFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("type", type);
  if (state.q) qs.set("q", state.q);
  if (state.location) qs.set("location", state.location);
  if (state.category) qs.set("category", state.category);
  if (state.minRating != null) qs.set("minRating", String(state.minRating));
  if (state.verifiedOnly) qs.set("verifiedOnly", "true");
  if (state.regulatorRating) qs.set("regulatorRating", state.regulatorRating);
  if (state.amenities.length) qs.set("amenities", state.amenities.join(","));
  if (state.openNow) qs.set("openNow", "true");
  if (state.emergency) qs.set("emergency", "true");
  if (state.sort && state.sort !== "distance") qs.set("sort", state.sort);
  return qs;
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  /* ---------------------------------------------------------- places
     One results page for both halves of the directory. `type` says which
     half is being asked for: absent means people, a facility type means
     places. The hero, the heading and the count are shared — only the
     body of the page differs, so a patient never has to learn two
     different result screens. */
  const placeType = (searchParams.get("type") as FacilityType | null) ?? null;
  const placeMode = Boolean(placeType);
  const placeCategory = searchParams.get("category");
  const keepPlace = useMemo(
    () => ({ type: placeType, category: placeCategory }),
    [placeType, placeCategory]
  );
  const [placeData, setPlaceData] = useState<FacilitySearchResponse | null>(null);
  const [placesLoading, setPlacesLoading] = useState(false);
  const placeFilters = useMemo(() => readPlaceFilters(searchParams), [searchParams]);
  const placeQuery = searchParams.toString();
  const placePage = Math.max(1, Number(searchParams.get("page")) || 1);

  useEffect(() => {
    if (!placeMode || !placeType) return;
    let cancelled = false;
    setPlacesLoading(true);
    searchFacilities({
      page: placePage,
      pageSize: 12,
      q: placeFilters.q || undefined,
      type: placeType,
      category: placeFilters.category || undefined,
      location: placeFilters.location || undefined,
      minRating: placeFilters.minRating ?? undefined,
      verified: placeFilters.verifiedOnly || undefined,
      regulatorRating: placeFilters.regulatorRating || undefined,
      amenities: placeFilters.amenities.length ? placeFilters.amenities : undefined,
      openNow: placeFilters.openNow || undefined,
      emergency: placeFilters.emergency || undefined,
      sort: placeFilters.sort || undefined,
    })
      .then((res) => {
        if (!cancelled) setPlaceData(res);
      })
      .catch(() => {
        if (!cancelled) setPlaceData(null);
      })
      .finally(() => {
        if (!cancelled) setPlacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // placeQuery covers every filter key at once — the alternative is a
    // dependency list that silently stops refetching when a filter is
    // added.
  }, [placeMode, placeType, placeQuery]);

  /* -------------------------------------------- which filters to offer
     The whole facility vocabulary is far larger than what any one type
     actually uses, and a filter that can only ever return nothing is the
     same bug the search suggestions had. So the options are whatever
     these listings really carry.

     They arrive with the results now. Working them out here meant
     downloading every place of this type on every visit purely to read
     its categories off — invisible with eight demo listings, and a
     several-megabyte download on every search once the directory is
     full. The server computes them across the whole match, not just the
     page being shown, so paging never changes the filter list. */
  const availableCategories = placeData?.facets.categories ?? [];
  const availableAmenities = placeData?.facets.amenities ?? [];
  const places = placeData?.results ?? [];
  const placeTotal = placeData?.total ?? 0;

  function updatePlaces(patch: Partial<PlaceFilterState>) {
    if (!placeType) return;
    // No page carried through: narrowing a filter while on page 5 of the
    // old result would land on a page that no longer exists.
    setSearchParams(writePlaceFilters(placeType, { ...placeFilters, ...patch }));
  }

  function goToPlacePage(page: number) {
    if (!placeType) return;
    const next = writePlaceFilters(placeType, placeFilters);
    if (page > 1) next.set("page", String(page));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetPlaces() {
    if (!placeType) return;
    setSearchParams(
      writePlaceFilters(placeType, {
        ...placeFilters,
        category: "",
        minRating: null,
        verifiedOnly: false,
        regulatorRating: "",
        amenities: [],
        openNow: false,
        emergency: false,
      })
    );
  }

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Taxonomy and cities are static for the session — fetched once, not
  // on every filter change.
  useEffect(() => {
    Promise.all([getAllSpecialties(), getCities()])
      .then(([all, cityList]) => {
        setSpecialties(all);
        setCities(cityList);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load search"));
  }, []);

  const queryKey = searchParams.toString();
  useEffect(() => {
    // In place mode the specialist query never runs, so its loading flag
    // has to be cleared or the search button spins for ever.
    if (placeMode) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchSpecialists({
      q: filters.q,
      specialty: filters.specialty,
      subspecialties: filters.subspecialties,
      location: filters.location,
      minRating: filters.minRating,
      minPriceMinor: filters.minPriceMinor,
      maxPriceMinor: filters.maxPriceMinor,
      verifiedOnly: filters.verifiedOnly,
      availableWithinDays: filters.availableWithinDays,
      sort: filters.sort,
      page: filters.page,
    })
      .then((res) => {
        // A slower earlier request must not overwrite newer results.
        if (cancelled) return;
        setData(res);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load search results");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // queryKey covers every filter at once — one effect, one request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // Any filter change returns to page 1; paging keeps the filters.
  const update = useCallback(
    (patch: Partial<SearchFilterState>) => {
      setSearchParams(writeFilters({ ...filters, ...patch, page: 1 }, keepPlace));
    },
    [filters, setSearchParams, keepPlace]
  );

  const goToPage = useCallback(
    (page: number) => {
      setSearchParams(writeFilters({ ...filters, page }, keepPlace));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [filters, setSearchParams, keepPlace]
  );

  const reset = useCallback(() => {
    setSearchParams(
      writeFilters({
        // Resetting clears the filters, not the search itself — someone
        // who typed "knee replacement" still means it.
        q: filters.q,
        specialty: filters.specialty,
        subspecialties: [],
        location: filters.location,
        minRating: null,
        minPriceMinor: null,
        maxPriceMinor: null,
        verifiedOnly: false,
        availableWithinDays: null,
        sort: "best-match",
        page: 1,
      }, keepPlace)
    );
  }, [filters.q, filters.specialty, filters.location, setSearchParams, keepPlace]);

  const specialty = data?.specialty ?? specialties.find((s) => s.slug === filters.specialty) ?? null;
  const heading = heroHeadingFor(specialty, data?.subspecialties ?? []);
  const heroPhoto = placeMode ? placeHeroFor(placeType) : heroPhotoFor(filters.specialty);
  const locationLabel = data?.location.label ?? filters.location;
  const total = data?.total ?? 0;
  const sortLabel = SORT_LABELS.find((s) => s.value === filters.sort)?.label ?? "Best match";

  // A filtered search is a near-duplicate of every other filtered
  // search, so only the bare /search page is offered to crawlers. The
  // title still describes what is on screen, for the browser tab and for
  // anyone sharing the link.
  const hasFilters =
    Boolean(filters.q) ||
    Boolean(filters.location) ||
    filters.subspecialties.length > 0 ||
    filters.page > 1 ||
    filters.sort !== "best-match";
  const seoTitle = specialty
    ? `${specialty.name}${locationLabel ? ` in ${locationLabel}` : " specialists"}`
    : "Find a Specialist";
  const seoDescription = specialty
    ? `Compare ${total} verified ${specialty.name.toLowerCase()} specialists${locationLabel ? ` near ${locationLabel}` : " across the UK"} — credentials, prices, availability and patient reviews.`
    : "Search verified UK specialists by condition, treatment and location. Compare credentials, consultation prices, availability and patient reviews.";

  return (
    <main className="flex flex-1 flex-col bg-paper" style={{ marginTop: -HEADER_HEIGHT }}>
      {/* Filtered result pages are near-duplicates of one another, so
          only the bare /search page is offered to crawlers — the rest
          would dilute it rather than rank. */}
      <Seo
        title={seoTitle}
        description={seoDescription}
        path="/search"
        noIndex={hasFilters}
      />
      {/* Hero — photo, heading and location all follow the live query */}
      <section
        className="photo-panel px-5 pb-10 sm:px-8"
        style={{
          backgroundImage: `url(${heroPhoto})`,
          backgroundPosition: "center right",
          paddingTop: HEADER_HEIGHT + 36,
        }}
      >
        <div className="mx-auto max-w-7xl">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-white/70 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            Back to home
          </Link>

          <h1 className="mt-5 font-display text-[32px] font-bold leading-tight text-white sm:text-[44px]">
            {placeMode ? PLACE_HEADING[placeType!] : heading}
          </h1>
          {locationLabel && (
            <p className="mt-1 flex items-center gap-2 font-display text-[26px] font-bold text-teal-300 sm:text-[34px]">
              {locationLabel}
            </p>
          )}
          <p className="mt-3 text-[14.5px] text-white/70">
            {placeMode
              ? placesLoading
                ? "Searching…"
                : `${placeTotal} ${placeTotal === 1 ? PLACE_NOUN[placeType!] : PLACE_PLURAL[placeType!]} matching your search`
              : loading && !data
                ? "Searching…"
                : `${total} ${total === 1 ? "specialist" : "specialists"} matching your search`}
          </p>

          {/* No search bar here on purpose.
              The tabbed bar with its expansive three-column panel is how
              a search is STARTED, and it belongs on the homepage. Once
              you are looking at results, the sidebar is the search: it
              owns the words, the place and every other filter in one
              panel, and every change is a URL you can share or go back
              through. Two search surfaces on one screen only invited the
              question of which one was in charge. */}
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        {placeMode && placeType ? (
          <div className="grid gap-6 lg:grid-cols-[264px_1fr] lg:gap-8">
            <PlaceFilters
              placeType={placeType}
              filters={placeFilters}
              availableCategories={availableCategories}
              availableAmenities={availableAmenities}
              total={placeTotal}
              onChange={updatePlaces}
              onReset={resetPlaces}
            />

            <section aria-live="polite" className="min-w-0">
              {placesLoading && places.length === 0 ? (
                <p className="py-16 text-center text-sm text-ink-muted">Searching…</p>
              ) : places.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-paper-muted p-10 text-center">
                  <p className="text-sm text-ink-muted">
                    Nothing matches that yet. Try a broader service, a nearby town, or clearing a filter.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-4">
                  {places.map((facility, i) => (
                    <li key={facility.id}>
                      {/* The first result on a relevance-sorted page
                          leads with a patient's own words, the way the
                          best specialist result leads with why it
                          matched. */}
                      <FacilityCard facility={facility} highlighted={i === 0 && placeFilters.sort === "distance"} />
                    </li>
                  ))}
                </ul>
              )}

              {placeData && (
                <Pager page={placeData.page} totalPages={placeData.totalPages} onGo={goToPlacePage} />
              )}
            </section>
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper-muted p-10 text-center">
            <p className="text-sm text-ink-muted">{loadError}</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[264px_1fr] lg:gap-8">
            <SearchFilters
              filters={filters}
              facets={data?.facets ?? null}
              specialties={specialties}
              cities={cities}
              total={total}
              onChange={update}
              onReset={reset}
            />

            <section aria-live="polite" className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper-muted px-4 py-3">
                <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
                  <Sparkles className="h-4 w-4 text-teal-600" strokeWidth={2} />
                  {filters.sort === "best-match" ? "Best match for your needs" : `Sorted by ${sortLabel.toLowerCase()}`}
                </span>
                {data && total > 0 && (
                  <span className="text-[12.5px] text-ink-muted">
                    Showing {(data.page - 1) * data.pageSize + 1}–
                    {Math.min(data.page * data.pageSize, total)} of {total}
                  </span>
                )}
              </div>

              {loading && !data ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-40 animate-pulse rounded-[1.25rem] border border-line bg-paper-muted" />
                  ))}
                </div>
              ) : total === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-line bg-paper-muted p-10 text-center">
                  <SearchX className="mx-auto h-7 w-7 text-ink-faint" strokeWidth={1.75} />
                  <h2 className="mt-3 font-display text-[18px] font-bold text-ink">No specialists match these filters</h2>
                  <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-ink-muted">
                    Try widening the price range, clearing the availability window, or searching a
                    nearby city — our specialist network is still growing.
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-5 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
                  {data?.results.map((specialist, i) => (
                    <SpecialistResultCard
                      key={specialist.id}
                      specialist={specialist}
                      // The explainer belongs to the actual best match:
                      // the top of page one of a relevance-sorted search.
                      highlighted={i === 0 && data.page === 1 && filters.sort === "best-match"}
                      // Only these sort modes give paid tiers a lift, so
                      // only here is anything actually promoted. Sorting
                      // by price or distance ignores the plan entirely.
                      promoted={
                        Boolean(specialist.priority) &&
                        ["best-match", "rating", "reviews"].includes(filters.sort)
                      }
                    />
                  ))}
                </div>
              )}

              {data && <Pager page={data.page} totalPages={data.totalPages} onGo={goToPage} />}

              {data?.location.query && !data.location.resolved && (
                <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-ink-faint">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                  We couldn&apos;t pinpoint &ldquo;{data.location.query}&rdquo;, so these are name matches rather than a
                  radius search.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * The pager, shared by both halves of this page.
 *
 * It was written inline for specialists only, which is how the places
 * results ended up with no pager at all — and, behind that, no paging:
 * every matching hospital in the country would have arrived in one
 * response and been rendered in one list.
 */
function Pager({
  page,
  totalPages,
  onGo,
}: {
  page: number;
  totalPages: number;
  onGo: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page <= 1}
        className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Previous page"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
      </button>

      {pageWindow(page, totalPages).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-ink-faint">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onGo(p)}
            aria-current={p === page ? "page" : undefined}
            className={`grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold transition ${
              p === page ? "bg-navy-950 text-white" : "text-ink-muted hover:bg-paper-muted hover:text-ink"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page >= totalPages}
        className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Next page"
      >
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </nav>
  );
}

// 1 … 4 5 [6] 7 8 … 12 — keeps the control a fixed width however many
// pages there are.
function pageWindow(current: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] as number) > 1) out.push("gap");
    out.push(p);
  });
  return out;
}
