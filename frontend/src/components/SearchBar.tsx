import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { placeHeroFor } from "../lib/specialtyHeroes";
import {
  Activity,
  AlertCircle,
  Building2,
  HeartHandshake,
  Hospital,
  Crosshair,
  Loader2,
  MapPin,
  Pill,
  Search,
  Smile,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import type { City } from "../lib/types";

/* ------------------------------------------------------------------ *
 * Search
 *
 * Free text, matched against the real taxonomy on the server. A patient
 * types what they know — "knee replacement", "Whitfield", a postcode —
 * and the panel offers back things that actually exist: specialties at
 * any tier, procedures, conditions, and the people or places themselves.
 * Every row is a destination, never a term to re-type.
 *
 * The tabs decide what the third column lists and where a bare search
 * lands: the first two are the specialist directory, the rest are the
 * places directory.
 *
 * Location is required. Searching a national directory with no place
 * gives a patient a list they cannot act on, so the form refuses and
 * says so rather than returning three hundred results in six cities.
 * ------------------------------------------------------------------ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/* The eight directories, in the order a patient thinks about them:
   people first, then the places they work in. The keys are the same
   strings the API uses — backend/src/lib/searchTabs.js is the one
   definition of what each one covers, and this list only adds the icon
   and the order. Keeping the keys identical is what stops the panel and
   the results page disagreeing about which directory is on screen. */
type TabKey =
  | "specialist-doctors"
  | "physiotherapists"
  | "dentists"
  | "aesthetics"
  | "clinics"
  | "hospitals"
  | "care-homes"
  | "pharmacies";

/** Which tabs are places, and the facility type each one means. */
const PLACE_TYPE: Partial<Record<TabKey, string>> = {
  clinics: "clinic",
  hospitals: "hospital",
  "care-homes": "care_home",
  pharmacies: "pharmacy",
};

const TABS: { key: TabKey; label: string; Icon: typeof Stethoscope }[] = [
  { key: "specialist-doctors", label: "Specialist Doctors", Icon: Stethoscope },
  { key: "physiotherapists", label: "Physiotherapists", Icon: Activity },
  { key: "dentists", label: "Dentists", Icon: Smile },
  { key: "aesthetics", label: "Aesthetics", Icon: Sparkles },
  { key: "clinics", label: "Clinics", Icon: Building2 },
  { key: "hospitals", label: "Hospitals", Icon: Hospital },
  { key: "care-homes", label: "Care Homes", Icon: HeartHandshake },
  { key: "pharmacies", label: "Pharmacies", Icon: Pill },
];

interface PanelItem {
  kind: string;
  label: string;
  sublabel: string | null;
  href: string;
  photoUrl?: string | null;
  /** Places only — used to pick the house photo when none was uploaded. */
  facilityType?: string | null;
  from: number;
  to: number;
}

interface PanelColumn {
  label: string;
  primary: PanelItem[];
  more: PanelItem[];
}

interface PanelResponse {
  q: string;
  type: string;
  mode: "popular" | "results";
  empty: boolean;
  placeholder: string;
  columns: { specialties: PanelColumn | null; procedures: PanelColumn | null; people: PanelColumn };
}

interface SearchBarProps {
  cities?: City[];
  defaultTerm?: string;
  defaultLocation?: string;
  /** Which tab opens selected — the results page passes what the URL
   *  asked for, so the bar always agrees with the page behind it. */
  defaultType?: TabKey;
  /** The results page renders it flat against the hero. */
  variant?: "hero" | "inline";
  /** True while the page this bar sits on is fetching results — that is
   *  what the button spins for. */
  searching?: boolean;
}

export function SearchBar({
  cities = [],
  defaultTerm = "",
  defaultLocation = "",
  defaultType = "specialist-doctors",
  variant = "hero",
  searching = false,
}: SearchBarProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>(defaultType);
  const [term, setTerm] = useState(defaultTerm);
  const [location, setLocation] = useState(defaultLocation);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PanelResponse | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  /* Whether a panel request is in flight with nothing yet to show. On a
     warm instance this is ~100ms and nobody sees it. On a cold Render
     instance it is several seconds of a control that looks like a plain
     text box -- which is exactly how this was reported, three times,
     each time on a preview that had just woken up. */
  const [panelLoading, setPanelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The button spins from the moment it is pressed until the results
  // have actually rendered, so a slow query looks like work happening
  // rather than a click that did nothing.
  const [busy, setBusy] = useState(false);
  // What was chosen from the panel, if anything. Choosing a tag is a
  // commitment to that exact thing, so the search uses its own
  // destination rather than re-guessing from the words in the box.
  const [picked, setPicked] = useState<{ label: string; href: string } | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [placeholder, setPlaceholder] = useState("Search a name, specialty, treatment or condition");
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  /* ----------------------------------------------------------- panel */
  // Debounced so a fast typist makes one request, not eight.
  /* A FAILED REQUEST USED TO BE INVISIBLE.
     `panel` starts null and the dropdown renders on `open && panel`, so
     a request that did not come back left the control looking like a
     plain text box -- no panel, no message, no spinner, nothing to
     retry. The preview's own console had seven 502s on this endpoint in
     one sitting, which is what a free Render instance does, and each one
     silently turned the combobox into a text field. Worse, the effect
     only re-runs on [term, tab, open]: type five characters, have the
     last request fail, stop typing, and it stays blank until you touch
     the field again.

     So: a failure is now recorded, retried once on its own, and says so
     if the retry fails too. `keepalive` state is deliberate -- the last
     good panel stays on screen while a newer request is in flight, so
     refining a query never blanks what you are reading. */
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let attempts = 0;

    const run = async (): Promise<void> => {
      attempts += 1;
      setPanelLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/search/panel?q=${encodeURIComponent(term)}&type=${tab}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PanelResponse = await res.json();
        setPanel(data);
        setPanelError(null);
        setPanelLoading(false);
        if (data.placeholder) setPlaceholder(data.placeholder);
      } catch (err) {
        if (controller.signal.aborted) return; // superseded by a newer keystroke
        if (attempts < 2) {
          // One retry, after a beat. A cold Render instance answers the
          // second request having failed the first.
          await new Promise((r) => setTimeout(r, 600));
          if (controller.signal.aborted) return;
          return run();
        }
        setPanelError(err instanceof Error ? err.message : "request failed");
        setPanelLoading(false);
      }
    };

    const timer = setTimeout(run, term ? 160 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, tab, open]);

  // The placeholder changes with the tab, so it is fetched with the tab
  // rather than waiting for the panel to be opened.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/search/panel?type=${tab}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PanelResponse | null) => {
        if (!cancelled && d?.placeholder) setPlaceholder(d.placeholder);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab]);

  /* --------------------------------------------------- open / close */
  useEffect(() => {
    if (!open && !locationOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setLocationOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setLocationOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, locationOpen]);

  /* -------------------------------------------------------- routing */
  const requireLocation = useCallback(() => {
    if (location.trim()) return true;
    setError("Add a location so we can show you who is near you.");
    setOpen(false);
    locationRef.current?.focus();
    return false;
  }, [location]);

  function navigateWithLocation(href: string) {
    const [path, query] = href.split("?");
    const params = new URLSearchParams(query);
    params.set("location", location.trim());
    setBusy(true);
    navigate(`${path}?${params.toString()}`);
  }

  /**
   * Choosing from the panel.
   *
   * A named person or place is a destination — it opens. A specialty,
   * category, procedure or condition is half a search: it fills the box
   * and hands over to the location field, because a national list of
   * everyone who treats a knee is not an answer to anything.
   */
  function go(item: { label: string; href: string }) {
    const isSearch = item.href.startsWith("/search") || item.href.startsWith("/facilities?");
    if (!isSearch) {
      setBusy(true);
      setOpen(false);
      navigate(item.href);
      return;
    }

    setTerm(item.label);
    setPicked(item);
    setOpen(false);
    setError(null);

    if (location.trim()) {
      navigateWithLocation(item.href);
      return;
    }
    // Nothing to search near yet — move them straight to the next thing
    // that has to be answered, with its options already open.
    locationRef.current?.focus();
    setLocationOpen(true);
  }

  /** Everything lands on the one results page; the tab decides which
   *  half of the directory it shows. */
  function runSearch(forTab: TabKey = tab) {
    const params = new URLSearchParams();
    if (term.trim()) params.set("q", term.trim());
    if (location.trim()) params.set("location", location.trim());

    const placeType = PLACE_TYPE[forTab];
    if (placeType) {
      params.set("type", placeType);
    } else {
      // A people tab carries its group, so the results page shows the
      // same directory the tab did. This used to send
      // `specialty=dentistry` for the one scoped tab and nothing at all
      // for the other, which is why a search from the Doctor tab
      // returned dentists and physiotherapists too.
      params.set("group", forTab);
    }

    setBusy(true);
    setOpen(false);
    navigate(`/search?${params.toString()}`);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requireLocation()) return;

    // A tag that is still in the box wins over re-interpreting its words.
    if (picked && picked.label === term) {
      navigateWithLocation(picked.href);
      setOpen(false);
      return;
    }
    runSearch();
  }

  // Clearing the error the moment they start fixing it is the difference
  // between a form that nags and one that helps.
  useEffect(() => {
    if (error && location.trim()) setError(null);
  }, [location, error]);

  // Released once the results are actually on screen. The safety timer
  // covers the homepage, where this component is replaced by the
  // navigation and never sees `searching` go false.
  useEffect(() => {
    if (!busy || searching) return;
    const timer = setTimeout(() => setBusy(false), 400);
    return () => clearTimeout(timer);
  }, [busy, searching, defaultTerm, defaultLocation]);

  // Keep the bar in step when the page's own URL changes underneath
  // (a filter click, the back button, a link from elsewhere).
  useEffect(() => setTerm(defaultTerm), [defaultTerm]);
  useEffect(() => setLocation(defaultLocation), [defaultLocation]);
  useEffect(() => setTab(defaultType), [defaultType]);

  const columns = useMemo(
    () =>
      panel
        ? [panel.columns.specialties, panel.columns.procedures, panel.columns.people].filter(
            (c): c is PanelColumn => Boolean(c)
          )
        : [],
    [panel]
  );

  /** The browser gives coordinates; the server turns them into a place
   *  a patient recognises, so nobody searches against a number. */
  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("This browser can't share your location. Type a town or postcode instead.");
      return;
    }
    setLocating(true);
    setLocationOpen(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `${API_URL}/geo/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`
          );
          const data = await res.json();
          if (res.ok && data.label) {
            setLocation(data.postcode ?? data.label);
            setError(null);
          } else {
            setError("We couldn't work out where you are. Type a town or postcode instead.");
          }
        } catch {
          setError("We couldn't work out where you are. Type a town or postcode instead.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        // A refused permission is a choice, not a fault — say what to do
        // next rather than what went wrong.
        setError("Location sharing is off, so type a town or postcode instead.");
        locationRef.current?.focus();
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }

  const cityMatches = useMemo(() => {
    const needle = location.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter((c) => c.name.toLowerCase().includes(needle));
  }, [cities, location]);

  const fieldTone = error ? "ring-rose-300" : "ring-black/5";

  return (
    <div ref={rootRef} className="relative w-full">
      {/* ============================================ provider tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setPanel(null);
                setPicked(null);
                // On a results page the tabs are a filter, not a mode
                // switch: the page behind them has to change too, or the
                // heading and the highlighted tab disagree about what is
                // being shown.
                if (defaultLocation || defaultTerm) {
                  runSearch(key);
                  return;
                }
                setOpen(true);
              }}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3.5 pb-2.5 pt-1 text-[13.5px] font-semibold transition ${
                active
                  ? variant === "hero"
                    ? "border-teal-300 text-white"
                    : "border-teal-600 text-ink"
                  : variant === "hero"
                    ? "border-transparent text-white/60 hover:text-white/90"
                    : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ============================================== the pill bar */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={`grid grid-cols-1 gap-1 rounded-[2rem] bg-white p-2.5 shadow-[0_30px_60px_-20px_rgba(6,22,38,0.35)] ring-1 sm:grid-cols-[1.4fr_1fr_auto] sm:items-stretch sm:gap-0 sm:rounded-full sm:p-3 sm:pl-6 ${fieldTone}`}
      >
        <label className="flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 sm:rounded-none sm:border-r sm:border-line sm:px-0 sm:pr-6 sm:py-1.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-teal-600" strokeWidth={2} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-teal-700">
              What are you searching for
            </span>
            <input
              type="text"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setPicked(null);
              }}
              onFocus={() => {
                setOpen(true);
                setLocationOpen(false);
              }}
              placeholder={placeholder}
              autoComplete="off"
              className="mt-1 w-full bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint"
            />
          </span>
        </label>

        <label className="flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 sm:rounded-none sm:px-6 sm:py-1.5">
          <MapPin className={`h-[18px] w-[18px] shrink-0 ${error ? "text-rose-500" : "text-teal-600"}`} strokeWidth={2} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={`text-[11px] font-bold uppercase tracking-[0.08em] ${error ? "text-rose-600" : "text-teal-700"}`}
            >
              Where
            </span>
            <input
              ref={locationRef}
              type="text"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setLocationOpen(true);
              }}
              onFocus={() => {
                setOpen(false);
                setLocationOpen(true);
              }}
              placeholder={locating ? "Finding you…" : "Town or postcode"}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-expanded={locationOpen}
              className="mt-1 w-full bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint"
            />
          </span>
        </label>

        <button
          type="submit"
          aria-label="Search"
          aria-busy={busy || searching}
          disabled={busy || searching}
          className="mt-1 flex shrink-0 items-center justify-center gap-2 rounded-full bg-navy-950 px-6 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-wait disabled:opacity-90 sm:mt-0 sm:h-14 sm:w-14 sm:self-center sm:px-0 sm:py-0"
        >
          <span className="sm:hidden">{busy || searching ? "Searching…" : "Search"}</span>
          {busy || searching ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
          ) : (
            <Search className="h-[18px] w-[18px]" strokeWidth={2.5} />
          )}
        </button>
      </form>

      {/* ------------------------------------------ location dropdown */}
      {locationOpen && (
        <Dropdown anchorRef={formRef} align="end" maxWidth={340}>
          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(6,22,38,0.4)] ring-1 ring-black/5">
          <button
            type="button"
            onClick={useCurrentLocation}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[14px] font-semibold text-ink transition hover:bg-teal-50"
          >
            My current location
            <Crosshair className="h-[18px] w-[18px] shrink-0 text-teal-600" strokeWidth={2} />
          </button>
          <hr className="border-line" />
          <ul className="max-h-[260px] overflow-y-auto overscroll-contain py-1">
            {/* AN EMPTY LIST IS NOT THE SAME ANSWER AS NO MATCH.
                `cities` arrives as a prop and defaults to [], so during
                the window before it loads -- seconds, on a cold Render
                instance -- every query fell through to "No town of that
                name". Typing "birmingham" was told Birmingham does not
                exist, while 262 listings sat in it. That is a confident
                factual claim made from having no data at all, which is
                worse than saying nothing: it sends somebody off to
                check their spelling of a city they spelled correctly.

                With no towns on hand we cannot speak to whether a name
                is among them, so we say what is actually true and give
                them a way through in the meantime. */}
            {cities.length === 0 ? (
              <li className="px-5 py-4 text-[13px] text-ink-muted">
                Still loading towns — you can type a postcode instead.
              </li>
            ) : cityMatches.length === 0 ? (
              <li className="px-5 py-4 text-[13px] text-ink-muted">
                No town of that name — a postcode works too.
              </li>
            ) : (
              cityMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocation(c.name);
                      setLocationOpen(false);
                      setError(null);
                    }}
                    className="w-full px-5 py-2.5 text-left text-[14px] text-ink transition hover:bg-teal-50"
                  >
                    {c.name}
                    {c.region && <span className="ml-2 text-[12.5px] text-ink-faint">{c.region}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
          </div>
        </Dropdown>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-rose-50 px-3.5 py-2 text-[13px] font-semibold text-rose-700 ring-1 ring-rose-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      {/* ================================================= the panel */}
      {/* A panel, or -- if the request failed -- the reason. Silence is
          the one thing this must never do: it is indistinguishable from
          the control not being a combobox at all. */}
      {open && !panel && !panelError && panelLoading && (
        <Dropdown anchorRef={formRef} maxWidth={460}>
          <div className="flex items-center gap-3 rounded-3xl bg-white px-5 py-4 shadow-[0_40px_80px_-24px_rgba(6,22,38,0.45)] ring-1 ring-black/5">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-teal-600"
              aria-hidden
            />
            <p className="text-[13.5px] text-ink-muted">Looking for matches…</p>
          </div>
        </Dropdown>
      )}

      {open && !panel && panelError && (
        <Dropdown anchorRef={formRef} maxWidth={460}>
          <div className="rounded-3xl bg-white p-5 shadow-[0_40px_80px_-24px_rgba(6,22,38,0.45)] ring-1 ring-black/5">
            <p className="text-[14px] font-semibold text-ink">Suggestions aren&rsquo;t loading.</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              You can still type and press Search.
            </p>
            <button
              type="button"
              onClick={() => {
                setPanelError(null);
                setOpen(false);
                setTimeout(() => setOpen(true), 0);
              }}
              className="mt-3 rounded-full bg-ink px-4 py-1.5 text-[13px] font-semibold text-white"
            >
              Try again
            </button>
          </div>
        </Dropdown>
      )}

      {open && panel && (
        <Dropdown anchorRef={formRef} maxWidth={columns.length > 1 ? undefined : 460}>
          {/* max-h + scroll because the columns STACK below md: three of
              them came to 1009px inside an 825px viewport, and the
              wrapper is position:fixed, so ~780px of it could not be
              scrolled to by any means. */}
          <div className="max-h-[70vh] overflow-y-auto overscroll-contain rounded-3xl bg-white shadow-[0_40px_80px_-24px_rgba(6,22,38,0.45)] ring-1 ring-black/5 md:max-h-none md:overflow-hidden">
          {panel.empty ? (
            <EmptyPanel
              term={term}
              onClear={() => {
                setTerm("");
                setPanel(null);
              }}
            />
          ) : (
            <div className={`grid gap-px bg-line ${columns.length > 1 ? "md:grid-cols-3" : ""}`}>
              {columns.map((col) => (
                <PanelColumnView key={col.label} column={col} onPick={go} />
              ))}
            </div>
          )}
          </div>
        </Dropdown>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Dropdown
 *
 * Rendered into document.body rather than beside the bar. Both heroes it
 * sits in use `isolation: isolate` and `overflow: hidden` for their
 * photograph, which would otherwise clip the panel and trap it beneath
 * the page content — a portal steps outside both, and the position is
 * measured from the bar itself.
 * ------------------------------------------------------------------ */
function Dropdown({
  anchorRef,
  children,
  align = "stretch",
  maxWidth,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "stretch" | "end";
  maxWidth?: number;
}) {
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = maxWidth ? Math.min(maxWidth, r.width) : r.width;
      setBox({
        top: r.bottom + 10,
        left: align === "end" ? r.right - width : r.left,
        width,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    // `true` so it also follows scrolling containers, not just the page.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchorRef, align, maxWidth]);

  if (!box) return null;
  return createPortal(
    <div
      style={{ position: "fixed", top: box.top, left: box.left, width: box.width, zIndex: 60 }}
      // The bar's own outside-click handler checks containment, so clicks
      // in here must not be treated as "outside".
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ *
 * One column.
 *
 * How it renders is decided by WHAT IS IN IT, not where it sits.
 * Taxonomy labels — specialties, conditions, procedures — are things you
 * scan, so they are chips. Real entries — a person or a place — are
 * things you recognise, so they get a picture, their name, and their
 * category underneath.
 *
 * This used to key off the column's index ("the first two are chips"),
 * which was true only on the Doctor and Dentist tabs. Under Hospital,
 * Care Home and Pharmacy the panel is a single column of listings at
 * index 0, so every hospital and care home was rendered as a bare chip —
 * no photo, no category — while the identical data under Doctor got the
 * full row.
 *
 * Each column scrolls on its own so a broad query can offer forty
 * options without pushing the page around.
 * ------------------------------------------------------------------ */
const ENTRY_KINDS = new Set(["specialist", "facility"]);

function PanelColumnView({
  column,
  onPick,
}: {
  column: PanelColumn;
  onPick: (item: { label: string; href: string }) => void;
}) {
  const items = [...column.primary, ...column.more];
  const empty = items.length === 0;
  // A column of real listings, or a column of labels.
  const chips = !items.some((item) => ENTRY_KINDS.has(item.kind));

  return (
    <section className="flex min-h-0 flex-col bg-white">
      <h3 className="border-b border-line px-5 py-3.5 text-[13px] font-bold text-ink">{column.label}</h3>
      <div className="max-h-[320px] overflow-y-auto overscroll-contain px-5 py-4">
        {empty ? (
          <p className="py-6 text-center text-[13px] text-ink-faint">Nothing here matches that</p>
        ) : chips ? (
          <>
            <ChipList items={column.primary} onPick={onPick} />
            {column.primary.length > 0 && column.more.length > 0 && <hr className="my-3 border-line" />}
            <ChipList items={column.more} onPick={onPick} />
          </>
        ) : (
          <ul className="-my-1 divide-y divide-line">
            {items.map((item) => (
              <li key={item.href}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <Avatar item={item} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold text-ink">
                      <Highlight item={item} />
                    </span>
                    {item.sublabel && (
                      <span className="block truncate text-[12.5px] text-ink-muted">{item.sublabel}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChipList({ items, onPick }: { items: PanelItem[]; onPick: (item: { label: string; href: string }) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={`${item.kind}-${item.href}-${item.label}`}>
          <button
            type="button"
            onClick={() => onPick(item)}
            title={item.sublabel ?? undefined}
            className="rounded-full bg-paper px-3.5 py-1.5 text-[13px] font-semibold text-ink ring-1 ring-line transition hover:bg-teal-50 hover:ring-teal-300"
          >
            <Highlight item={item} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The server returns where the match sits, so nothing is re-guessed here. */
function Highlight({ item }: { item: PanelItem }) {
  if (item.from < 0 || item.to <= item.from) return <>{item.label}</>;
  return (
    <>
      {item.label.slice(0, item.from)}
      <mark className="rounded bg-teal-200/70 px-px text-ink">{item.label.slice(item.from, item.to)}</mark>
      {item.label.slice(item.to)}
    </>
  );
}

function Avatar({ item }: { item: PanelItem }) {
  // A place always has a picture: its own if it uploaded one, and the
  // house photo for its type if it has not. Initials are for people —
  // "QC" tells you nothing about a hospital.
  const src = item.photoUrl ?? (item.kind === "facility" ? placeHeroFor(item.facilityType) : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-line"
      />
    );
  }
  const initials = item.label
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-50 text-[12.5px] font-bold text-teal-700 ring-1 ring-teal-100">
      {initials || "?"}
    </span>
  );
}

function EmptyPanel({ term, onClear }: { term: string; onClear: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-[19px] font-bold text-ink">No results found</p>
      <p className="mx-auto mt-2 max-w-[42ch] text-[13.5px] text-ink-muted">
        Nothing on the directory matches “{term}”. Check the spelling, or try the specialty or the procedure
        rather than the brand name.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50"
      >
        Clear search
      </button>
    </div>
  );
}
