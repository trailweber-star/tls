import { useId, useState } from "react";
import type { TrendDay } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Fourteen days of platform activity
 *
 * Two series on one scale — applications submitted and decisions taken —
 * because they are the same kind of quantity (events per day) and the
 * only question worth asking of them is whether the second is keeping up
 * with the first. A second y-axis would let them drift apart visually
 * while looking level, which is the one thing a queue chart must not do.
 *
 * Everything drawn here is a real recorded event. No smoothing, no
 * interpolation across gaps, and a fortnight with nothing in it draws a
 * flat line at zero rather than inventing a slope.
 * ------------------------------------------------------------------ */

const SERIES = [
  { key: "applications" as const, label: "Applications", color: "var(--amber)" },
  { key: "approvals" as const, label: "Approvals", color: "var(--teal-600)" },
];

const W = 760;
const H = 230;
const PAD = { top: 16, right: 14, bottom: 26, left: 32 };

export function ActivityChart({ days }: { days: TrendDay[] }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (days.length < 2) return null;

  /* One scale for both series, rounded up to something a person would
     choose, so the gridline labels are whole numbers. */
  const peak = Math.max(1, ...days.flatMap((d) => [d.applications, d.approvals]));
  const step = peak <= 4 ? 1 : peak <= 10 ? 2 : Math.ceil(peak / 4 / 5) * 5;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i * plotW) / (days.length - 1);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const line = (key: "applications" | "approvals") =>
    days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key: "applications" | "approvals") =>
    `${line(key)} L${x(days.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const label = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <figure className="m-0">
      {/* Identity is never colour alone: the legend names both series and
          the tooltip repeats the names on hover. */}
      <figcaption className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[11.5px] text-ink-faint">Last {days.length} days</span>
      </figcaption>

      <div
        className="relative"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const plotStart = PAD.left / W;
          const plotSpan = plotW / W;
          const i = Math.round(((ratio - plotStart) / plotSpan) * (days.length - 1));
          setHover(Math.min(days.length - 1, Math.max(0, i)));
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Applications and approvals over the last fortnight">
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Recessive grid: present enough to read a value against, quiet
              enough that the data is what you see. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--line-soft, #e8eef4)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-ink-faint text-[10px]">
                {t}
              </text>
            </g>
          ))}

          {SERIES.map((s) => (
            <path key={`${s.key}-area`} d={area(s.key)} fill={`url(#${gradientId}-${s.key})`} />
          ))}
          {SERIES.map((s) => (
            <path
              key={`${s.key}-line`}
              d={line(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Every day is a point, but only the ones that carry a value
              are marked — a dot on fourteen zeroes is just a second
              gridline. */}
          {SERIES.map((s) =>
            days.map((d, i) =>
              d[s.key] > 0 ? (
                <circle
                  key={`${s.key}-${d.date}`}
                  cx={x(i)}
                  cy={y(d[s.key])}
                  r={hover === i ? 5 : 3.5}
                  fill={s.color}
                  stroke="white"
                  strokeWidth="2"
                />
              ) : null
            )
          )}

          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--ink-faint, #8998a8)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Four date labels, not fourteen — the axis says where you are,
              the tooltip says exactly which day. */}
          {days.map((d, i) =>
            i % Math.ceil(days.length / 5) === 0 || i === days.length - 1 ? (
              <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink-faint text-[10px]">
                {label(d.date)}
              </text>
            ) : null
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-max -translate-x-1/2 rounded-xl bg-navy-950 px-3 py-2 text-white shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            <p className="text-[11px] font-bold">{label(days[hover].date)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-white/75">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
                <span className="ml-1 font-bold tabular-nums text-white">{days[hover][s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
