import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Clock3,
  Inbox,
  LogIn,
  Mail,
  MessageSquare,
  Phone,
  Search as SearchIcon,
  User,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, initials, relativeTime } from "../../components/dashboard/ui";
import { systemApi } from "../../lib/dashboardApi";
import type { AdminEnquiriesResponse, AdminEnquiry } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * Messages
 *
 * Every enquiry a patient has sent, across every specialist — the one
 * question the platform could not answer before, because enquiries were
 * only ever visible inside the dashboard of the member they were sent
 * to.
 *
 * It is deliberately read-only. An administrator can see that a patient
 * wrote, who to, and whether anybody replied; what they cannot do is
 * answer on a clinician's behalf, because a reply that appears to come
 * from a doctor and does not is the kind of mistake this whole product
 * exists to prevent. Where a reply genuinely needs to happen, the row
 * offers a support session into that member's own account, which is
 * recorded in the activity log with the administrator's name on it.
 * ------------------------------------------------------------------ */

const TABS = [
  { key: "all", label: "Everything", count: "all" },
  { key: "unanswered", label: "Waiting for a reply", count: "unanswered" },
  { key: "new", label: "New", count: "new" },
  { key: "responded", label: "Answered", count: "responded" },
  { key: "closed", label: "Closed", count: "closed" },
];

const STATUS_TONE: Record<string, string> = {
  new: "bg-amber/15 text-amber",
  in_progress: "bg-paper-tint text-ink-muted",
  responded: "bg-teal-50 text-teal-700",
  closed: "bg-paper-tint text-ink-faint",
};

/** Hours, in the words a person would use. */
function waitLabel(hours: number | null) {
  if (hours == null) return null;
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function AdminMessages() {
  const [params, setParams] = useSearchParams();
  const { startImpersonation } = useAuth();

  const [data, setData] = useState<AdminEnquiriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminEnquiry | null>(null);
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [busy, setBusy] = useState(false);

  const tab = params.get("tab") ?? "all";
  const specialist = params.get("specialist") ?? "";
  const page = Number(params.get("page") ?? 1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await systemApi.enquiries({
          q: params.get("q") ?? undefined,
          status: tab === "unanswered" || tab === "all" ? undefined : tab,
          unanswered: tab === "unanswered" ? "yes" : undefined,
          specialist: specialist || undefined,
          page,
          pageSize: 25,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load enquiries");
    } finally {
      setLoading(false);
    }
  }, [params, tab, specialist, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setTerm(params.get("q") ?? ""), [params]);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  async function supportSession(row: AdminEnquiry) {
    if (!row.specialist) return;
    setBusy(true);
    try {
      await startImpersonation(row.specialist.id, `Answering an enquiry from ${row.patientName}`);
      window.location.assign("/dashboard/enquiries");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the support session");
      setBusy(false);
    }
  }

  const counts = data?.counts ?? {};
  const stats = data?.stats;

  return (
    <DashboardShell
      variant="admin"
      icon={MessageSquare}
      eyebrow="Patients"
      title="Messages"
      subtitle="Every enquiry sent through the site, whoever it was sent to, and whether anybody answered it."
    >
      {/* ------------------------------------------------- headline */}
      {stats && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700">
              <Inbox className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="mt-3 font-display text-[24px] font-bold leading-none text-ink">{counts.all ?? 0}</p>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">enquiries in total</p>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <span
              className={`grid h-9 w-9 place-items-center rounded-xl ${
                counts.unanswered ? "bg-amber/12 text-amber" : "bg-teal-50 text-teal-700"
              }`}
            >
              <Clock3 className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="mt-3 font-display text-[24px] font-bold leading-none text-ink">{counts.unanswered ?? 0}</p>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">
              waiting for a reply
              {stats.longestWaitHours != null && (
                <span className="text-ink-faint"> · longest {waitLabel(stats.longestWaitHours)}</span>
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-navy-950/8 text-navy-800">
              <Mail className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="mt-3 font-display text-[24px] font-bold leading-none text-ink">
              {stats.medianReplyHours != null ? waitLabel(stats.medianReplyHours) : "—"}
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">
              typical time to a reply
              {stats.answeredPct != null && <span className="text-ink-faint"> · {stats.answeredPct}% answered</span>}
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- filters */}
      <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => update({ tab: t.key })}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition ${
                on ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${
                  on ? "bg-white/15 text-white" : "bg-paper-tint text-ink-faint"
                }`}
              >
                {counts[t.count] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="relative min-w-0 flex-1 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: term.trim() || null });
          }}
        >
          <SearchIcon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
            aria-hidden
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onBlur={() => update({ q: term.trim() || null })}
            placeholder="Patient name, email, or what they wrote…"
            aria-label="Search enquiries"
            className="w-full rounded-full border border-line bg-white py-2.5 pl-10 pr-4 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          />
        </form>

        {(data?.specialists.length ?? 0) > 0 && (
          <label className="inline-flex items-center gap-2">
            <span className="sr-only">Filter by specialist</span>
            <select
              value={specialist}
              onChange={(e) => update({ specialist: e.target.value || null })}
              className="rounded-full border border-line bg-white px-3.5 py-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-teal-500"
            >
              <option value="">Every specialist</option>
              {data?.specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && <LoadingBlock label="Loading enquiries…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && (data?.results.length ?? 0) === 0 && (
        <Panel>
          <EmptyState
            icon={Inbox}
            title={counts.all ? "Nothing matches that filter" : "No enquiries yet"}
            body={
              counts.all
                ? "Try a different tab, or clear the search."
                : "When a patient sends a message from a profile, it lands in that specialist's dashboard — and appears here, so you can see whether it was answered."
            }
          />
        </Panel>
      )}

      {/* ----------------------------------------------------- list */}
      {!loading && !error && (data?.results.length ?? 0) > 0 && (
        <Panel padded={false}>
          <ul className="divide-y divide-line-soft">
            {data?.results.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpen(row)}
                  className="flex w-full items-start gap-3.5 px-5 py-4 text-left transition hover:bg-paper-muted"
                >
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-tint text-[11.5px] font-bold text-ink-muted">
                    {initials(row.patientName)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-bold text-ink">{row.patientName}</span>
                      <span className="text-[12px] text-ink-faint">
                        → {row.specialist?.fullName ?? "a listing that no longer exists"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          STATUS_TONE[row.status] ?? "bg-paper-tint text-ink-muted"
                        }`}
                      >
                        {row.status.replace(/_/g, " ")}
                      </span>
                      {row.held && (
                        <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber">
                          Held by plan cap
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[13px] text-ink-muted">
                      {row.message || "No message"}
                    </span>
                    <span className="mt-1 block text-[11.5px] text-ink-faint">
                      {relativeTime(row.createdAt)}
                      {row.answered
                        ? ` · answered ${relativeTime(row.respondedAt)}`
                        : row.waitingHours != null
                          ? ` · waiting ${waitLabel(row.waitingHours)}`
                          : ""}
                    </span>
                  </span>

                  {!row.answered && (row.waitingHours ?? 0) >= 48 && (
                    <span
                      className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-danger"
                      title="Nobody has replied to this patient in over two days"
                    >
                      <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
                      Overdue
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-muted">
            Page {data?.page} of {data?.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
              className="rounded-full bg-white px-4 py-2 text-[12.5px] font-bold text-ink-muted ring-1 ring-line transition hover:text-ink disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= (data?.totalPages ?? 1)}
              onClick={() => update({ page: String(page + 1) })}
              className="rounded-full bg-white px-4 py-2 text-[12.5px] font-bold text-ink-muted ring-1 ring-line transition hover:text-ink disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- drawer */}
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-[2px]"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Enquiry from ${open.patientName}`}
            className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-paper shadow-2xl"
          >
            <header className="border-b border-line-soft bg-paper/95 px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-teal-700">Enquiry</p>
              <h2 className="mt-1 font-display text-[18px] font-bold text-ink">{open.patientName}</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {relativeTime(open.createdAt)} · to {open.specialist?.fullName ?? "an unknown listing"}
              </p>
            </header>

            <div className="flex-1 space-y-5 px-5 py-5">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">What they wrote</p>
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                  {open.message || "No message was included."}
                </p>
                <div className="mt-4 flex flex-wrap gap-4 border-t border-line-soft pt-3 text-[12.5px]">
                  {open.email && (
                    <a href={`mailto:${open.email}`} className="inline-flex items-center gap-1.5 text-teal-700 hover:underline">
                      <Mail className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      {open.email}
                    </a>
                  )}
                  {open.phone && (
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      <Phone className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                      {open.phone}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">The reply</p>
                {open.response ? (
                  <>
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{open.response}</p>
                    <p className="mt-2 text-[11.5px] text-ink-faint">Sent {relativeTime(open.respondedAt)}</p>
                  </>
                ) : (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    Nobody has replied yet
                    {open.waitingHours != null ? ` — this patient has been waiting ${waitLabel(open.waitingHours)}.` : "."}
                  </p>
                )}
              </div>

              {open.specialist && (
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">The specialist</p>
                  <p className="mt-2 text-[13.5px] font-bold text-ink">{open.specialist.fullName}</p>
                  {open.specialist.contactEmail && (
                    <p className="text-[12.5px] text-ink-muted">{open.specialist.contactEmail}</p>
                  )}

                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
                    Replies are written by the member, not by us. To answer this one, step into their account — the
                    session is recorded in the activity log under your name.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => supportSession(open)}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-ink/90 disabled:opacity-50"
                    >
                      <LogIn className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                      {busy ? "Starting…" : "Open their enquiries"}
                    </button>
                    <Link
                      to={`/admin/members?q=${encodeURIComponent(open.specialist.fullName)}`}
                      className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft"
                    >
                      <User className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                      Member record
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </DashboardShell>
  );
}
