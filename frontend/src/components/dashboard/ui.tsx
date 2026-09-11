import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Shared workspace primitives
 *
 * Every screen in the dashboard has the same three states — loading,
 * failed, empty — so they are defined once here rather than reinvented
 * per page with slightly different wording.
 * ------------------------------------------------------------------ */

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl bg-white ring-1 ring-line py-16 text-[13.5px] text-ink-faint">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl bg-danger/10 p-5 text-[13.5px] text-white ring-1 ring-danger/30"
    >
      <p className="flex items-center gap-2 font-bold">
        <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={2.5} />
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold transition hover:bg-line-soft"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-paper-tint text-teal-700">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <p className="mt-1 text-[14px] font-bold text-ink">{title}</p>
      <p className="max-w-[36ch] text-[13px] leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * KPI tile. `value` of null means the metric is not measurable yet (no
 * booking model, no reviews) — the tile says so instead of printing a
 * zero that reads like a real count.
 */
const KPI_TONES = {
  teal: { chip: "bg-teal-50 text-teal-700", rule: "bg-teal-500" },
  amber: { chip: "bg-amber/12 text-amber", rule: "bg-amber" },
  navy: { chip: "bg-navy-950/8 text-navy-800", rule: "bg-navy-800" },
  slate: { chip: "bg-paper-tint text-ink-muted", rule: "bg-line" },
} as const;

export function KpiCard({
  icon: Icon,
  label,
  value,
  suffix,
  delta,
  deltaLabel,
  unavailable,
  /** A quiet band of colour, so four tiles in a row are distinguishable
   *  at a glance rather than four identical white rectangles. */
  tone = "teal",
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: React.ReactNode;
  suffix?: string;
  delta?: number | null;
  deltaLabel?: string;
  unavailable?: string;
  tone?: keyof typeof KPI_TONES;
  children?: React.ReactNode;
}) {
  const up = (delta ?? 0) > 0;
  const flat = !delta;

  const t = KPI_TONES[tone];

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-4 text-ink shadow-sm sm:p-5">
      <span className={`absolute inset-x-0 top-0 h-[3px] ${unavailable ? "bg-line" : t.rule}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${unavailable ? "bg-paper-tint text-ink-faint" : t.chip}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        {delta != null && !unavailable && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-bold ${
              flat ? "bg-paper-tint text-ink-muted" : up ? "bg-teal-50 text-teal-700" : "bg-danger/10 text-danger"
            }`}
          >
            {!flat &&
              (up ? (
                <ArrowUpRight className="h-3 w-3" strokeWidth={3} />
              ) : (
                <ArrowDownRight className="h-3 w-3" strokeWidth={3} />
              ))}
            {up ? "+" : ""}
            {delta}
            {suffix}
          </span>
        )}
      </div>

      {unavailable ? (
        <>
          <p className="mt-3 text-[15px] font-bold text-ink-faint">—</p>
          <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">{unavailable}</p>
        </>
      ) : (
        <>
          <p className="mt-3 font-display text-[26px] font-bold leading-none text-ink">{value}</p>
          <p className="mt-1.5 text-[12.5px] font-semibold text-ink-muted">{label}</p>
          {deltaLabel && <p className="mt-0.5 text-[11.5px] text-ink-faint">{deltaLabel}</p>}
          {children}
        </>
      )}
    </div>
  );
}

/**
 * Sparkline drawn from the real daily view series. Falls back to a flat
 * baseline when every day is zero, rather than dividing by zero.
 */
export function Sparkline({ series }: { series: { date: string; count: number }[] }) {
  if (series.length < 2) return null;
  const max = Math.max(...series.map((p) => p.count), 1);
  const step = 100 / (series.length - 1);
  const points = series.map((p, i) => `${(i * step).toFixed(2)},${(24 - (p.count / max) * 22).toFixed(2)}`).join(" ");

  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-3 block h-7 w-full overflow-hidden" aria-hidden focusable="false">
      <polyline
        points={points}
        fill="none"
        stroke="var(--teal-500)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Horizontal completion meter with an accessible value. */
export function ProgressBar({ percent, tone = "teal" }: { percent: number; tone?: "teal" | "amber" }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Profile completion"
      className="h-2 w-full overflow-hidden rounded-full bg-paper-tint"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone === "amber" ? "bg-amber" : "bg-teal-500"}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Initials for an avatar tile. Honorifics are skipped — otherwise every
 * clinician in the directory shows the same "D" for "Dr".
 */
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "dame"]);

export function initials(fullName: string | null | undefined) {
  const words = (fullName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !HONORIFICS.has(w.replace(/\.$/, "").toLowerCase()));
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}
