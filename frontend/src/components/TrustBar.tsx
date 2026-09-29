import { BadgeCheck, MapPin, MessageSquareQuote, ShieldCheck } from "lucide-react";

// Honest figures. The reference mockup showed rounder marketing numbers
// ("4,200+ verified specialists"); these are kept truthful, since they
// read as trust claims to patients. "Specialties covered" and "UK cities
// covered" grow as the directory grows, so — unlike the launch-day
// hardcoded "6"/"6" this replaced, which drifted false within weeks —
// they're computed from the same live counts the rest of the homepage
// already fetches (see Home.tsx), never typed in by hand.
function buildStats(cityCount?: number, specialtyCount?: number) {
  return [
    { icon: ShieldCheck, value: "100%", label: "Regulator-checked" },
    { icon: BadgeCheck, value: specialtyCount, label: "Specialties covered" },
    { icon: MapPin, value: cityCount, label: "UK cities covered" },
    { icon: MessageSquareQuote, value: "Real", label: "Patient reviews" },
  ];
}

// variant="onHero": sits directly inside the dark hero, under the
// search bar — thin ringed icon + value + label, matching the reference.
// variant="standalone": a light section on its own, used if a page
// wants the trust row outside a hero context.
export function TrustBar({
  variant = "onHero",
  cityCount,
  specialtyCount,
  loading = false,
}: {
  variant?: "onHero" | "standalone";
  /** Live count of UK cities with at least one listing. Omit/undefined
      while still loading — a skeleton renders instead of a wrong number. */
  cityCount?: number;
  /** Live count of top-level specialties. Same loading contract as cityCount. */
  specialtyCount?: number;
  loading?: boolean;
}) {
  const dark = variant === "onHero";
  const stats = buildStats(cityCount, specialtyCount);
  return (
    <div
      className={`grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 sm:gap-x-8 ${
        dark ? "" : "border-y border-line bg-paper-muted py-8"
      }`}
    >
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-1 ${
              dark ? "bg-white/5 text-teal-300 ring-white/20" : "bg-teal-50 text-teal-700 ring-teal-100"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-col">
            {loading && value === undefined ? (
              <span
                className={`h-[17px] w-8 animate-pulse rounded ${dark ? "bg-white/15" : "bg-paper-muted"}`}
              />
            ) : (
              <span
                className={`font-display text-[17px] font-bold leading-tight ${dark ? "text-white" : "text-ink"}`}
              >
                {value}
              </span>
            )}
            <span className={`text-[12px] leading-tight ${dark ? "text-white/55" : "text-ink-muted"}`}>{label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
