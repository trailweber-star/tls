import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScrollText, Search as SearchIcon } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { membersApi } from "../../lib/dashboardApi";
import { ADMIN_ACTION_LABEL as ACTION_LABEL } from "../../components/admin/memberChrome";
import type { AuditEntry } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * The activity log
 *
 * Who did what, to whom, from where. It exists for the two questions
 * that get asked after something goes wrong — "who approved this?" and
 * "was anybody signed in as them at the time?" — and it answers both
 * without anyone having to read a server log.
 *
 * Nothing here can be edited or deleted from the interface. A log an
 * administrator can tidy up is not a log.
 * ------------------------------------------------------------------ */


/** Actions worth making visually distinct in a long list. */
function toneFor(action: string) {
  if (action.startsWith("impersonate")) return "bg-amber/15 text-amber";
  if (action.includes("reject") || action.includes("suspend") || action.includes("deactivate")) {
    return "bg-danger/10 text-danger";
  }
  if (action.includes("approve") || action.includes("reactivate")) return "bg-teal-50 text-teal-700";
  return "bg-paper-tint text-ink-muted";
}

export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await membersApi.audit(limit);
      setEntries(res.results);
      setNote(res.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the activity log");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      [e.actorName, e.actorEmail, e.action, ACTION_LABEL[e.action], e.subjectLabel, e.ip]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [entries, term]);

  return (
    <DashboardShell
      variant="admin"
      icon={ScrollText}
      eyebrow="Accountability"
      title="Activity log"
      subtitle="Every administrative action, in order, with the name of whoever took it."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <SearchIcon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
            aria-hidden
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Filter by person, action or member…"
            aria-label="Filter the activity log"
            className="w-full rounded-full bg-white ring-1 ring-line py-2.5 pl-10 pr-4 text-[13.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          />
        </div>

        <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-ink-faint">
          <span className="sr-only">How many entries to load</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-full bg-white ring-1 ring-line px-3 py-2 text-[12.5px] font-semibold text-ink outline-none ring-1 ring-line focus:ring-teal-400/50 [&>option]:text-ink"
          >
            {[50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <LoadingBlock label="Loading the log…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && note && (
        <Panel className="mb-4">
          <p className="text-[13px] text-ink-muted">{note}</p>
        </Panel>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Panel>
          <EmptyState
            icon={ScrollText}
            title={term ? "Nothing matches that" : "Nothing recorded yet"}
            body={
              term
                ? "Try a shorter term — the log matches on names, actions, members and IP addresses."
                : "Administrative actions appear here as they happen: approvals, suspensions, support sessions and exports."
            }
          />
        </Panel>
      )}

      {!loading && !error && filtered.length > 0 && (
        <Panel padded={false}>
          <ol className="divide-y divide-line-soft">
            {filtered.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3.5">
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${toneFor(entry.action)}`}
                >
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">
                    <span className="font-bold">{entry.actorName}</span>
                    {entry.subjectLabel && (
                      <>
                        {" → "}
                        {entry.subjectId ? (
                          <Link
                            to={`/admin/members?q=${encodeURIComponent(entry.subjectId)}`}
                            className="text-teal-700 hover:underline"
                          >
                            {entry.subjectLabel}
                          </Link>
                        ) : (
                          entry.subjectLabel
                        )}
                      </>
                    )}
                  </span>
                  {entry.detail && typeof entry.detail === "object" && "note" in entry.detail && entry.detail.note ? (
                    <span className="block text-[12px] italic text-ink-muted">
                      “{String(entry.detail.note)}”
                    </span>
                  ) : null}
                  {entry.detail && typeof entry.detail === "object" && "reason" in entry.detail && entry.detail.reason ? (
                    <span className="block text-[12px] italic text-ink-muted">
                      “{String(entry.detail.reason)}”
                    </span>
                  ) : null}
                </span>

                <span className="shrink-0 text-right text-[11.5px] text-ink-faint">
                  <span className="block">{relativeTime(entry.createdAt)}</span>
                  {entry.ip && <span className="block font-mono">{entry.ip}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </DashboardShell>
  );
}
