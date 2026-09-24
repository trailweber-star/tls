import { useCallback, useEffect, useState } from "react";
import { BarChart3, Eye, MessageSquareText, Percent, Search } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, KpiCard, LoadingBlock, Sparkline } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { AnalyticsData } from "../../lib/dashboardApi";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export default function Analytics() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.analytics(days);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DashboardShell
      title="Analytics"
      subtitle="Where your profile views and enquiries come from."
      actions={
        <div className="flex gap-1.5 rounded-full bg-paper-tint p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition ${
                days === r.days ? "bg-navy-950 text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {loading && <LoadingBlock label="Loading your analytics…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              icon={Eye}
              label="Profile views"
              value={data.profileViews.total}
              delta={data.profileViews.changePct}
              suffix="%"
              deltaLabel={`vs previous ${data.days} days (${data.profileViews.previousPeriod})`}
              tone="teal"
            >
              <Sparkline series={data.profileViews.series} />
            </KpiCard>
            <KpiCard
              icon={MessageSquareText}
              label="Enquiries"
              value={data.enquiries.total}
              tone="navy"
              deltaLabel={`in the last ${data.days} days`}
            />
            <KpiCard
              icon={Percent}
              label="View-to-enquiry rate"
              value={data.enquiries.conversionPct != null ? `${data.enquiries.conversionPct}%` : "—"}
              tone="amber"
              unavailable={data.profileViews.total === 0 ? "No views recorded yet in this range" : undefined}
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title="Where views come from">
              {data.sources.referrers.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="No referrer data yet"
                  body="Once patients start reaching your profile from other sites, the busiest ones will show up here."
                />
              ) : (
                <SourceList
                  rows={data.sources.referrers.map((r) => ({ label: r.referrer, count: r.count }))}
                  max={Math.max(...data.sources.referrers.map((r) => r.count))}
                />
              )}
            </Panel>

            <Panel title="What patients search for">
              {data.sources.searchTerms.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No search terms yet"
                  body="When someone finds you through the directory's own search, the terms they used will show up here."
                />
              ) : (
                <SourceList
                  rows={data.sources.searchTerms.map((r) => ({ label: r.term ?? "(no term)", count: r.count }))}
                  max={Math.max(...data.sources.searchTerms.map((r) => r.count))}
                />
              )}
            </Panel>
          </div>
        </>
      )}
    </DashboardShell>
  );
}

function SourceList({ rows, max }: { rows: { label: string; count: number }[]; max: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
            <span className="min-w-0 truncate font-semibold text-ink">{row.label}</span>
            <span className="shrink-0 font-bold text-ink-muted">{row.count}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-tint">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
