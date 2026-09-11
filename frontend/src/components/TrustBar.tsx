import { BadgeCheck, MapPin, MessageSquareQuote, ShieldCheck } from "lucide-react";

// Honest launch-stage figures. The reference mockup showed rounder
// marketing numbers ("4,200+ verified specialists"); these are kept
// truthful until the real directory numbers back them up, since they read
// as trust claims to patients.
const STATS = [
  { icon: ShieldCheck, value: "100%", label: "Regulator-checked" },
  { icon: BadgeCheck, value: "6", label: "Specialties at launch" },
  { icon: MapPin, value: "6", label: "UK cities covered" },
  { icon: MessageSquareQuote, value: "Real", label: "Patient reviews" },
];

// variant="onHero": sits directly inside the dark hero, under the
// search bar — thin ringed icon + value + label, matching the reference.
// variant="standalone": a light section on its own, used if a page
// wants the trust row outside a hero context.
export function TrustBar({ variant = "onHero" }: { variant?: "onHero" | "standalone" }) {
  const dark = variant === "onHero";
  return (
    <div
      className={`grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 sm:gap-x-8 ${
        dark ? "" : "border-y border-line bg-paper-muted py-8"
      }`}
    >
      {STATS.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-1 ${
              dark ? "bg-white/5 text-teal-300 ring-white/20" : "bg-teal-50 text-teal-700 ring-teal-100"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={`font-display text-[17px] font-bold leading-tight ${dark ? "text-white" : "text-ink"}`}
            >
              {value}
            </span>
            <span className={`text-[12px] leading-tight ${dark ? "text-white/55" : "text-ink-muted"}`}>{label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
