import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, MessageSquare, Star } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { ReviewsResponse } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

const CATEGORY_LABEL: Record<string, string> = {
  communication: "Communication",
  expertise: "Expertise",
  care: "Bedside manner",
  waitTime: "Waiting time",
};

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          style={{ width: size, height: size }}
          className={n <= Math.round(value) ? "fill-amber text-amber" : "text-line"}
          strokeWidth={2}
          aria-hidden
        />
      ))}
    </span>
  );
}

export default function Reviews() {
  const { specialist } = useAuth();
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await dashboardApi.reviews());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your reviews");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Two different numbers, deliberately: `ratingCount` is the published
  // figure shown on the public profile, while `written` is how many
  // review records exist. In the seeded demo dataset the first is larger,
  // so the star breakdown is scaled against the reviews actually held.
  const total = data?.ratingCount ?? 0;
  const written = data?.results.length ?? 0;

  return (
    <DashboardShell
      title="Reviews"
      subtitle="What patients have said about you. Your average rating is calculated from these and shown on your public profile."
    >
      {loading && <LoadingBlock label="Loading reviews…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {data && !loading && total === 0 && (
        <Panel>
          <EmptyState
            icon={MessageSquare}
            title="No reviews yet"
            body="Patients can leave a review from your public profile after a consultation. Ratings are averaged automatically as they come in."
            action={
              specialist ? (
                <Link
                  to={`/specialists/${specialist.slug}`}
                  className="inline-flex rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
                >
                  View your profile
                </Link>
              ) : null
            }
          />
        </Panel>
      )}

      {data && !loading && total > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
          {/* ------------------------------------------- summary */}
          <div className="space-y-5">
            <Panel>
              <div className="text-center">
                <p className="font-display text-[44px] font-bold leading-none text-ink">{data.ratingAvg.toFixed(1)}</p>
                <div className="mt-2 flex justify-center">
                  <Stars value={data.ratingAvg} size={18} />
                </div>
                <p className="mt-2 text-[12.5px] text-ink-muted">
                  Based on {total} {total === 1 ? "review" : "reviews"}
                </p>
              </div>

              <ul className="mt-5 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = data.distribution?.[String(star)] ?? 0;
                  const pct = written ? (count / written) * 100 : 0;
                  return (
                    <li key={star} className="flex items-center gap-2.5">
                      <span className="w-3 text-[12px] font-bold text-ink-muted">{star}</span>
                      <Star className="h-3 w-3 fill-amber text-amber" strokeWidth={2} aria-hidden />
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-tint">
                        <span className="block h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-6 text-right text-[11.5px] text-ink-faint">{count}</span>
                    </li>
                  );
                })}
              </ul>
              {written !== total && (
                <p className="mt-3 border-t border-line-soft pt-3 text-[11.5px] leading-relaxed text-ink-faint">
                  The breakdown covers the {written} {written === 1 ? "review" : "reviews"} written on the platform.
                  Your published total includes {total - written} carried over from before you joined.
                </p>
              )}
            </Panel>

            {data.scores && Object.values(data.scores).some((v) => v != null) && (
              <Panel title="By category">
                <ul className="space-y-3">
                  {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((key) => {
                    const value = (data.scores as Record<string, number | null>)[key];
                    if (value == null) return null;
                    return (
                      <li key={key}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-semibold text-ink">{CATEGORY_LABEL[key]}</span>
                          <span className="text-[12.5px] font-bold text-ink">{value.toFixed(1)}</span>
                        </div>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paper-tint">
                          <span
                            className="block h-full rounded-full bg-teal-500"
                            style={{ width: `${(value / 5) * 100}%` }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-faint">
                  Categories are averaged only across the reviews that scored them, so a category nobody rated is left
                  out rather than counted as zero.
                </p>
              </Panel>
            )}
          </div>

          {/* -------------------------------------------- list */}
          <Panel title={`All reviews (${written})`}>
            <ul className="divide-y divide-line-soft">
              {data.results.map((review) => (
                <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold text-ink">{review.patientName ?? "Anonymous"}</span>
                      {review.verified && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-700">
                          <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                          Verified patient
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <Stars value={review.rating} />
                      <span className="text-[11.5px] text-ink-faint">{relativeTime(review.createdAt)}</span>
                    </span>
                  </div>
                  {review.comment && (
                    <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{review.comment}</p>
                  )}
                  {review.scores && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {Object.entries(review.scores)
                        .filter(([, v]) => v != null)
                        .map(([key, value]) => (
                          <li
                            key={key}
                            className="rounded-full bg-paper-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted"
                          >
                            {CATEGORY_LABEL[key] ?? key} {value}/5
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}
