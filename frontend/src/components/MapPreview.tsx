import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, MapPin, X } from "lucide-react";
import { getMapView } from "../lib/api";
import type { MapView } from "../lib/api";

/* ------------------------------------------------------------------ *
 * The map for one address
 *
 * A pinned address gets a map: medium-sized where it sits, and a full
 * one when you click it. Patients choose on "can I get there", and an
 * address on its own does not answer that — it asks them to open
 * another tab, which is where a good number of them stop.
 *
 * It works on this build with no account and no key, on OpenStreetMap.
 * The server decides which service answers, so adding
 * GOOGLE_MAPS_API_KEY to the backend .env turns every map on the site
 * into a Google map with nothing to change here. That is the whole
 * connect-once arrangement: one environment variable.
 *
 * The interactive frame is deliberately not clickable in place. A map
 * you can pan inside a scrolling page swallows the scroll wheel and
 * traps the reader — so the small one is a picture with a button on it,
 * and panning and zooming happen in the large one, which has the room
 * for it.
 * ------------------------------------------------------------------ */

export function MapPreview({
  lat,
  lng,
  address,
  /**
   * Where to centre when the address itself has no coordinates —
   * normally its town.
   *
   * Most addresses on this site were typed rather than picked from the
   * suggestions, so they have no pin of their own. Showing nothing
   * would mean almost no listing had a map; showing the town, clearly
   * labelled as the town, gives the reader the one thing they wanted to
   * know — roughly where this is — without pretending to a precision
   * we do not have.
   */
  fallback,
  /**
   * The square's side, in pixels. The frame is square where it sits —
   * a map is a picture of an area, and a letterbox crop throws away
   * exactly as much of it above and below as it keeps. The dialog is
   * still wide, because that is a viewing surface rather than a
   * thumbnail.
   *
   * Capped to the width available, so it stays square on a phone
   * instead of forcing the card wider than the screen.
   */
  size = 200,
  /**
   * Fill the column it is in instead of taking a fixed side. Used where
   * the map is a panel in a sidebar rather than a thumbnail beside some
   * text — it stays square either way.
   */
  fill = false,
  className = "",
  /** Hidden entirely when there is no map rather than showing a note. */
  quiet = false,
}: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  fallback?: { lat?: number | null; lng?: number | null; label?: string | null } | null;
  size?: number;
  fill?: boolean;
  className?: string;
  quiet?: boolean;
}) {
  const [view, setView] = useState<MapView | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  /**
   * Whether the frame ever actually loaded.
   *
   * A cross-origin iframe will not tell us it failed, so a blocked tile
   * server, an offline laptop or a privacy extension all produce the
   * same thing: an empty grey rectangle sitting on the page where a map
   * should be. That is precisely the kind of silent blank this site
   * cannot afford, so the frame is given a few seconds to prove itself
   * and is replaced by the address and a link if it does not.
   */
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const exact = lat != null && lng != null;
  const usingFallback = !exact && fallback?.lat != null && fallback?.lng != null;
  const centreLat = exact ? lat : usingFallback ? fallback?.lat : null;
  const centreLng = exact ? lng : usingFallback ? fallback?.lng : null;
  // A town needs a wider frame than a doorstep, or the map is a street
  // corner half a mile from the place being described.
  const zoom = exact ? 15 : 12;
  const hasSomething = centreLat != null || Boolean(address?.trim());

  useEffect(() => {
    if (!hasSomething) {
      setView(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    // A new address gets a fresh chance to load.
    setLoaded(false);
    setTimedOut(false);
    getMapView({ lat: centreLat, lng: centreLng, address, zoom })
      .then((res) => !cancelled && setView(res))
      // A map is an enhancement. If the lookup fails the address itself
      // is still on the page, so this stays silent rather than putting
      // an error where a map should be.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [centreLat, centreLng, address, zoom, hasSomething]);

  if (!hasSomething || failed) return null;
  if (!view) {
    return quiet ? null : (
      <div
        className={`aspect-square w-full animate-pulse rounded-xl bg-paper-muted ${className}`}
        style={fill ? undefined : { width: size, maxWidth: "100%" }}
        aria-hidden
      />
    );
  }

  if (!view.embedUrl || timedOut) {
    if (quiet && !view.embedUrl) return null;
    // Two different reasons, one shape: either the address was never
    // pinned, so there is nothing honest to draw, or the map service
    // could not be reached. Both leave a line of text and a working
    // link rather than an empty rectangle.
    return (
      <div
        className={`flex items-center gap-2.5 rounded-xl border border-dashed border-line bg-paper-muted px-3.5 py-3 text-[12.5px] text-ink-muted ${className}`}
      >
        <MapPin className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
        <span className="min-w-0 flex-1">
          {timedOut
            ? "The map couldn't be loaded here."
            : "This address hasn't been pinned on the map yet."}
        </span>
        {view.linkUrl && (
          <a
            href={view.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-bold text-teal-700 hover:underline"
          >
            {timedOut ? "Open the map" : "Search it"}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className="group relative aspect-square w-full overflow-hidden rounded-xl ring-1 ring-line"
        style={fill ? undefined : { width: size, maxWidth: "100%" }}
      >
        <iframe
          src={view.embedUrl}
          title={view.label ? `Map of ${view.label}` : "Map"}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block h-full w-full border-0"
          onLoad={() => setLoaded(true)}
          // Not interactive in place: see the note at the top.
          tabIndex={-1}
          aria-hidden
        />
        {/* Sits over the frame so a click anywhere opens the big map
            rather than starting a pan the reader did not ask for. */}
        {/* One chip on the map, not two. A square 200px frame is not
            wide enough for a caption and a button side by side — they
            collided and both ended up truncated — so the only thing
            sitting on the map is the thing you press, and what the map
            is gets said underneath it. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute inset-0 flex items-end justify-end p-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-label={view.label ? `View a larger map of ${view.label}` : "View a larger map"}
        >
          <span className="pointer-events-none inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-bold text-ink shadow-md ring-1 ring-line transition group-hover:bg-white">
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            Larger map
          </span>
        </button>
      </div>

      {/* Under the map rather than on it. A map centred on the town
          must not be read as the front door, and this is the line that
          says so — it has room to be read here, and it disappears the
          moment the address is properly pinned. */}
      {usingFallback && (
        <p
          className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint"
          style={fill ? undefined : { maxWidth: size }}
        >
          <MapPin className="h-3 w-3 shrink-0" strokeWidth={2.5} />
          <span className="truncate">
            Approximate — {fallback?.label ?? "town centre"}
          </span>
        </p>
      )}

      <LoadWatch
        embedUrl={view.embedUrl}
        probeUrl={view.probeUrl ?? null}
        loaded={loaded}
        setTimedOut={setTimedOut}
      />

      {open && <MapDialog view={view} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Gives the frame a fixed window to load in, then gives up.
 *
 * A separate component so the timer's own state changes cannot re-run
 * the parent's effects, and so the hook rules are satisfied without
 * putting a conditional hook above the early returns.
 */
function LoadWatch({
  embedUrl,
  probeUrl,
  loaded,
  setTimedOut,
}: {
  embedUrl: string;
  probeUrl: string | null;
  loaded: boolean;
  /* The setter itself, not a wrapper: a fresh arrow function on every
     render would restart these timers on every render, so they would
     never reach the end. */
  setTimedOut: (value: boolean) => void;
}) {
  // The frame hanging: nothing ever fires, so a deadline is the only
  // signal. Long enough for a slow connection and a cold tile cache,
  // short enough that nobody sits looking at a grey box wondering.
  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => setTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, [embedUrl, loaded, setTimedOut]);

  // The frame being refused: an ad blocker or an offline machine kills
  // the request, and the iframe reports that as a successful load of an
  // error page. An <img> is the one thing that will admit it failed, so
  // one small tile on the same host answers the question the frame
  // cannot.
  useEffect(() => {
    if (!probeUrl) return;
    const img = new Image();
    let cancelled = false;
    img.onerror = () => !cancelled && setTimedOut(true);
    img.src = probeUrl;
    return () => {
      cancelled = true;
      img.onerror = null;
    };
  }, [probeUrl, setTimedOut]);

  return null;
}

/* The large one. Interactive, because here there is room to pan without
   fighting the page for the scroll wheel. */
function MapDialog({ view, onClose }: { view: MapView; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while this is open, or dismissing
    // it returns the reader somewhere they did not leave.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/70 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={view.label ? `Map of ${view.label}` : "Map"}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-bold text-ink">
            <MapPin className="h-4 w-4 shrink-0 text-teal-600" strokeWidth={2.5} />
            <span className="truncate">{view.label || "Location"}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted hover:text-ink"
            aria-label="Close the map"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2.5} />
          </button>
        </div>

        <iframe
          src={view.embedUrl ?? ""}
          title={view.label ? `Map of ${view.label}` : "Map"}
          referrerPolicy="no-referrer-when-downgrade"
          className="h-[min(70vh,560px)] w-full border-0"
        />

        {view.linkUrl && (
          <div className="border-t border-line px-5 py-3">
            <a
              href={view.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-bold text-teal-700 hover:underline"
            >
              Open in {view.provider === "google" ? "Google Maps" : "OpenStreetMap"}
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
