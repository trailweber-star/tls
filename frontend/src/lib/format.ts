// Money is always stored as integer minor units + an ISO currency code
// (never a float — Master Doc §41/§58 data-model principle). This is the
// one place that turns it back into a display string.
export function formatPrice(minorUnits: number, currency: string, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}

export function formatRating(avg: number): string {
  return avg.toFixed(1);
}

// "Next available" as a patient reads it: Today / Tomorrow / 14 Sep.
// Returns null when a specialist hasn't published availability, so the
// caller omits the line rather than inventing one.
export function formatAvailability(iso: string | null, locale = "en-GB"): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = daysUntil(then);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(then);
}

function daysUntil(then: Date): number {
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const now = new Date();
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86400000);
}

// Distance from the searched location, once a location has resolved to
// coordinates (see backend src/lib/geo.js).
export function formatDistance(km: number | null | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return "under 1 km away";
  return `${Math.round(km)} km away`;
}
