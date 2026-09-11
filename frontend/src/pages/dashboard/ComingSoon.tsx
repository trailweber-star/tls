import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Hammer } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";

/**
 * A section that is planned but has no backend behind it yet.
 *
 * It exists so the sidebar links go somewhere honest rather than a 404 —
 * and so nobody mistakes an empty screen for a broken one. Each of these
 * is replaced by a real screen when its model lands.
 *
 * It is dressed like every other page in the workspace on purpose: an
 * unfinished section that looks unfinished makes the whole product feel
 * unfinished, and the person clicking it is usually deciding whether to
 * trust the rest.
 */
export default function ComingSoon({
  title,
  description,
  needs,
  /** Which sidebar to show. An admin landing on the member navigation
   *  would be a worse bug than the missing screen itself. */
  variant = "specialist",
  icon,
  /** Where else to go — the thing this section will eventually replace. */
  instead,
}: {
  title: string;
  description: string;
  needs: string[];
  variant?: "specialist" | "admin";
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  instead?: { to: string; label: string };
}) {
  const home = variant === "admin" ? "/admin" : "/dashboard";

  return (
    <DashboardShell
      variant={variant}
      icon={icon ?? Hammer}
      eyebrow="In progress"
      title={title}
      subtitle={description}
    >
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700">
              <Hammer className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-bold text-ink">Not switched on yet</h2>
              <p className="mt-1.5 max-w-[56ch] text-[13.5px] leading-relaxed text-ink-muted">
                This part of the workspace is designed but has no data behind it, so it shows nothing rather than
                inventing something. It needs:
              </p>
              <ul className="mt-3 space-y-1.5">
                {needs.map((need) => (
                  <li key={need} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden />
                    {need}
                  </li>
                ))}
              </ul>
              <Link
                to={home}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-navy-900"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
                {variant === "admin" ? "Back to the dashboard" : "Back to your dashboard"}
              </Link>
            </div>
          </div>
        </Panel>

        {/* Somewhere to actually go. A dead end that only apologises is
            still a dead end. */}
        <Panel tone="dark">
          <h2 className="font-display text-[15px] font-bold">In the meantime</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-white/65">
            {instead
              ? "The nearest working screen does most of this today."
              : "Everything else in the workspace is live and working — nothing on this page blocks the rest."}
          </p>
          {instead && (
            <Link
              to={instead.to}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2.5 text-[12.5px] font-bold text-navy-950 transition hover:bg-teal-400"
            >
              {instead.label}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}
