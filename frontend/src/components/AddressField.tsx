import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MapPin, Search } from "lucide-react";
import { resolveAddress, suggestAddresses } from "../lib/api";
import type { AddressSuggestion } from "../lib/api";
import { MapPreview } from "./MapPreview";

/* ------------------------------------------------------------------ *
 * The address field
 *
 * Typing an address into a plain text box got you a pin on the middle of
 * the nearest city, because that was the only coordinate we had. So
 * "within 5km" meant "in a city whose centre is within 5km" — a much
 * vaguer promise than the filter appeared to make, and one nobody could
 * see was being made.
 *
 * This types against the geocoder instead. Pick a suggestion and the
 * real coordinates come back with it and are saved on the location.
 *
 * It works today with no key at all: postcodes.io gives UK postcodes and
 * towns, free, no account. Add GOOGLE_MAPS_API_KEY to the backend .env
 * and the same field starts suggesting full street addresses through
 * Places, with no change here — the server decides which service answers
 * and hands back the same shape. That is the whole connect-once
 * arrangement: one environment variable, nothing to migrate.
 * ------------------------------------------------------------------ */

export interface AddressValue {
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
}

export function AddressField({
  id,
  value,
  onChange,
  placeholder = "Start typing a postcode or address",
  /**
   * Where to centre the map before the address has been pinned —
   * normally the town that was chosen alongside it. Without this an
   * address that was typed rather than picked shows no map at all,
   * which is most of them.
   */
  fallback,
}: {
  id: string;
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  placeholder?: string;
  fallback?: { lat?: number | null; lng?: number | null; label?: string | null } | null;
}) {
  const [draft, setDraft] = useState(value.address);
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * The label most recently chosen from the list.
   *
   * Needed to stop the field re-querying the moment a suggestion is
   * picked — otherwise choosing "B3 2AP" immediately asks for
   * suggestions for "B3 2AP" and reopens the list under the cursor.
   *
   * Comparing the draft against `value.address` looked like it did the
   * same job and did not: typing writes straight through to
   * `value.address`, so the two were always equal and the guard
   * swallowed every request. The field looked like it worked and never
   * called the geocoder once.
   */
  const justPicked = useRef<string | null>(null);

  useEffect(() => setDraft(value.address), [value.address]);

  // Debounced: a suggestion request per keystroke is a bill with Google
  // behind it and a rate limit with postcodes.io.
  useEffect(() => {
    if (!open || draft.trim().length < 2 || draft === justPicked.current) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await suggestAddresses(draft);
        if (!cancelled) {
          setItems(res.results);
          setProvider(res.provider);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  async function pick(item: AddressSuggestion) {
    setOpen(false);
    setDraft(item.label);
    justPicked.current = item.label;
    // Coordinates already attached (postcodes.io), or one details call
    // for the address chosen (Google). Either way it happens once, on
    // pick, not on every keystroke.
    if (item.lat != null && item.lng != null) {
      onChange({ address: item.label, postcode: item.postcode ?? value.postcode, lat: item.lat, lng: item.lng });
      return;
    }
    setBusy(true);
    try {
      const hit = await resolveAddress(item);
      onChange({
        address: hit?.label ?? item.label,
        postcode: hit?.postcode ?? item.postcode ?? value.postcode,
        lat: hit?.lat ?? null,
        lng: hit?.lng ?? null,
      });
    } catch {
      // Still keep what they picked. An address without coordinates is
      // worse than one with them, not worthless — it falls back to the
      // city centre exactly as before.
      onChange({ ...value, address: item.label, postcode: item.postcode ?? value.postcode });
    } finally {
      setBusy(false);
    }
  }

  const located = value.lat != null && value.lng != null;

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" strokeWidth={2} />
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            justPicked.current = null;
            // Typing after picking invalidates the pin — the text no
            // longer describes the coordinates we hold.
            onChange({ ...value, address: e.target.value, lat: null, lng: null });
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-line bg-white py-2.5 pl-9 pr-9 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-ink-faint" strokeWidth={2} />
          ) : located ? (
            <Check className="h-4 w-4 text-teal-600" strokeWidth={2.5} />
          ) : (
            <Search className="h-4 w-4 text-ink-faint" strokeWidth={2} />
          )}
        </span>
      </div>

      {/* Says plainly whether this address is pinned or approximate,
          because the difference decides whether a patient searching
          "within 5km" will find it. */}
      <p className="mt-1 text-[11.5px] text-ink-faint">
        {located ? (
          <span className="text-teal-700">Pinned on the map — patients searching nearby will find this address.</span>
        ) : provider === "google" ? (
          "Pick from the suggestions to place it on the map."
        ) : (
          "Pick a suggestion to pin it. Without one, distance searches fall back to the town centre."
        )}
      </p>

      {/* The map appears as soon as there is an address to show, so
          nobody has to save and go and look at their own profile to
          find out whether the pin landed on the right building. It is
          labelled "Approximate" until a suggestion is picked, which is
          a clearer nudge to pick one than the sentence above it. */}
      {(located || (value.address.trim() && fallback?.lat != null)) && (
        <MapPreview
          lat={value.lat}
          lng={value.lng}
          address={value.address}
          fallback={fallback}
          size={180}
          className="mt-2.5"
          quiet
        />
      )}

      {open && (items.length > 0 || busy) && (
        <ul className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-lg">
          {items.map((item, i) => (
            <li key={`${item.label}-${i}`}>
              <button
                type="button"
                onClick={() => void pick(item)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition hover:bg-paper-muted"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{item.label}</span>
                  {item.secondary && (
                    <span className="block truncate text-[12px] text-ink-muted">{item.secondary}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {busy && items.length === 0 && (
            <li className="px-3.5 py-2.5 text-[13px] text-ink-faint">Looking…</li>
          )}
        </ul>
      )}
    </div>
  );
}
