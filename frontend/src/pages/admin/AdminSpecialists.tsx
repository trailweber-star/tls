import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Search as SearchIcon, Star, Users } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../components/dashboard/ui";
import { adminApi } from "../../lib/dashboardApi";
import type { AdminSpecialistRow, VerificationStatus } from "../../lib/dashboardApi";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "pending", label: "Pending" },
  { key: "info_requested", label: "Info requested" },
  { key: "rejected", label: "Not approved" },
  { key: "suspended", label: "Suspended" },
] as const;

const STATUS_TONE: Record<VerificationStatus, string> = {
  verified: "bg-teal-50 text-teal-700",
  pending: "bg-amber/15 text-amber",
  info_requested: "bg-amber/15 text-amber",
  rejected: "bg-danger/10 text-danger",
  suspended: "bg-danger/10 text-danger",
  unverified: "bg-paper-tint text-ink-faint",
};

export default function AdminSpecialists() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);

  const [term, setTerm] = useState(q);
  const [rows, setRows] = useState<AdminSpecialistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTerm(q), [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.specialists({ q: q || undefined, status, page });
      setRows(res.results);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load specialists");
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  function navigate(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    setParams(p, { replace: true });
  }

  return (
    <DashboardShell
      variant="admin"
      icon={Users}
      eyebrow="Directory"
      title="Specialists"
      subtitle={`Every profile on the platform, whatever its status. ${total} ${total === 1 ? "record" : "records"} matching.`}
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q: term.trim() || null, page: null });
          }}
          className="relative min-w-0 flex-1 sm:max-w-sm"
        >
          <SearchIcon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search specialists by name"
            className="w-full rounded-full bg-white ring-1 ring-line py-2.5 pl-10 pr-4 text-[13.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          />
        </form>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => navigate({ status: f.key === "all" ? null : f.key, page: null })}
              aria-pressed={status === f.key}
              className={`rounded-full px-3.5 py-2 text-[12.5px] font-bold transition ${
                status === f.key ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingBlock label="Loading specialists…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={Users}
            title="No specialists match"
            body="Try a different search term or clear the status filter."
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <Panel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-faint">
                    <th scope="col" className="px-5 py-3 font-bold">
                      Name
                    </th>
                    <th scope="col" className="px-5 py-3 font-bold">
                      Specialty
                    </th>
                    <th scope="col" className="px-5 py-3 font-bold">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 font-bold">
                      Rating
                    </th>
                    <th scope="col" className="relative px-5 py-3 font-bold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-paper-muted">
                      <td className="px-5 py-3.5">
                        <span className="block text-[13.5px] font-bold text-ink">{row.fullName}</span>
                        {row.contactEmail && (
                          <span className="block text-[12px] text-ink-faint">{row.contactEmail}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-ink-muted">{row.specialty ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${STATUS_TONE[row.verificationStatus] ?? "bg-paper-tint text-ink-muted"}`}
                        >
                          {row.verificationStatus.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-ink-muted">
                        {row.ratingCount ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={2} aria-hidden />
                            {row.ratingAvg.toFixed(1)}
                            <span className="text-ink-faint">({row.ratingCount})</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="flex items-center justify-end gap-2">
                          <Link
                            to={`/admin/verifications?status=${row.verificationStatus}&open=${row.id}`}
                            className="rounded-full bg-paper-tint px-3 py-1.5 text-[11.5px] font-bold text-ink-muted transition hover:bg-line-soft"
                          >
                            Review
                          </Link>
                          <a
                            href={`/specialists/${row.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${row.fullName}'s public profile`}
                            className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition hover:bg-paper-tint hover:text-ink"
                          >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[12.5px] text-ink-faint">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => navigate({ page: String(page - 1) })}
                  className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => navigate({ page: String(page + 1) })}
                  className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
