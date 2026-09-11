import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  ExternalLink,
  LogIn,
  MoreHorizontal,
  RefreshCw,
  Star,
  Users,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { Dialog } from "../../components/Dialog";
import { MemberFilters, FILTER_KEYS } from "../../components/admin/MemberFilters";
import { MemberDrawer } from "../../components/admin/MemberDrawer";
import { MemberAvatar, StatusChip } from "../../components/admin/memberChrome";
import { membersApi } from "../../lib/dashboardApi";
import type { BulkAction, MemberQuery, MemberRow, MembersResponse } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * Members
 *
 * The screen an administrator lives on. One list of everybody on the
 * platform, every filter stacked above it, and the actions that follow
 * from what the filter returned — including signing in as a member to
 * see exactly what they are seeing.
 *
 * The whole state of the screen lives in the URL. That is not tidiness:
 * it means a filter that found a problem can be sent to a colleague as a
 * link, and that the browser's back button does what it looks like it
 * does instead of dumping the person back at an unfiltered list.
 * ------------------------------------------------------------------ */

const TABS = [
  { key: "all", label: "Everyone", count: "all" },
  { key: "pending", label: "Awaiting review", count: "pending" },
  { key: "info_requested", label: "Info requested", count: "info_requested" },
  { key: "verified", label: "Approved", count: "verified" },
  { key: "unverified", label: "Unclaimed", count: "unverified" },
  { key: "rejected", label: "Rejected", count: "rejected" },
  { key: "suspended", label: "Suspended", count: "suspended" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "last-login", label: "Recently active" },
  { value: "rating", label: "Highest rated" },
  { value: "status", label: "By status" },
];

/**
 * What each bulk action does, in the words of the person doing it, and
 * what it needs before it will run. `tone: "danger"` is not decoration —
 * it is what separates "approve four hundred listings" from "reject four
 * hundred listings" at a glance in an open menu.
 */
const BULK: {
  action: BulkAction;
  label: string;
  needsNote?: boolean;
  needsTag?: boolean;
  tone?: "danger";
  blurb: string;
}[] = [
  { action: "approve", label: "Approve listing", blurb: "Their profile becomes publicly visible and marked verified." },
  { action: "hold", label: "Put back on hold", blurb: "Moves the listing back into the review queue." },
  {
    action: "request-info",
    label: "Request more information",
    blurb: "Marks the listing as waiting on the member for documents.",
  },
  {
    action: "reject",
    label: "Reject listing",
    needsNote: true,
    tone: "danger",
    blurb: "The listing is not published. Your reason is recorded against it.",
  },
  {
    action: "suspend",
    label: "Suspend listing",
    needsNote: true,
    tone: "danger",
    blurb: "Removes the profile from the public site without deleting anything.",
  },
  {
    action: "deactivate-account",
    label: "Deactivate account",
    tone: "danger",
    blurb: "They can no longer sign in. Administrator accounts are skipped.",
  },
  { action: "reactivate-account", label: "Reactivate account", blurb: "Restores their ability to sign in." },
  { action: "tag", label: "Add a tag", needsTag: true, blurb: "Tags are internal and never shown publicly." },
  { action: "untag", label: "Remove a tag", needsTag: true, blurb: "Takes the tag off every selected member." },
];

export default function AdminMembers() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { startImpersonation } = useAuth();

  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [pending, setPending] = useState<(typeof BULK)[number] | null>(null);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [impersonating, setImpersonating] = useState<MemberRow | null>(null);
  const [reason, setReason] = useState("");

  const [exporting, setExporting] = useState(false);

  /* The query is whatever is in the URL, nothing more. Read fresh on
     every render so there is only ever one copy of this state. */
  const query: MemberQuery = useMemo(() => {
    const q: Record<string, string> = {};
    params.forEach((value, key) => {
      q[key] = value;
    });
    return q as MemberQuery;
  }, [params]);

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setReloading(true);
      else setLoading(true);
      setError(null);
      try {
        setData(await membersApi.list(query));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load members");
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    load();
  }, [load]);

  // A click anywhere closes an open row menu — otherwise it follows the
  // scroll around like a burr.
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [rowMenu]);

  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    flashTimer.current = window.setTimeout(() => setFlash(null), 6000);
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [flash]);

  /** Change filters. Any change puts you back on page one — otherwise a
      narrower filter lands on a page that no longer exists. */
  function update(patch: Partial<Record<string, string | null>>, keepPage = false) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      // undefined counts as "remove it" too — a caller spreading an
      // optional field should not silently write the string "undefined".
      if (value === null || value === undefined || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    setParams(next, { replace: true });
    setSelected(new Set());
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of FILTER_KEYS) next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
    setSelected(new Set());
  }

  const rows = data?.results ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ------------------------------------------------- bulk actions */

  function openBulk(spec: (typeof BULK)[number]) {
    setPending(spec);
    setNote("");
    setTag("");
    setActionError(null);
  }

  async function runBulk() {
    if (!pending) return;
    setRunning(true);
    setActionError(null);
    try {
      const res = await membersApi.bulk({
        action: pending.action,
        ids: [...selected],
        note: note.trim() || undefined,
        tag: tag.trim() || undefined,
      });
      setPending(null);
      setSelected(new Set());
      const skipped = res.skippedCount
        ? ` ${res.skippedCount} skipped (${[...new Set(res.skipped.map((s) => s.reason))].join(", ")}).`
        : "";
      setFlash(`${res.label}: ${res.changed} ${res.changed === 1 ? "member" : "members"}.${skipped}`);
      await load(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not go through");
    } finally {
      setRunning(false);
    }
  }

  /* ----------------------------------------------- impersonation */

  async function confirmImpersonation() {
    if (!impersonating) return;
    setRunning(true);
    setActionError(null);
    try {
      await startImpersonation(impersonating.id, reason.trim() || undefined);
      // Straight into their workspace — which is the thing the
      // administrator wanted to look at.
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start the support session");
      setRunning(false);
    }
  }

  /* ------------------------------------------------------ export */

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const { blob, filename } = await membersApi.exportCsv(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFlash(`Exported ${data?.total ?? 0} members to ${filename}.`);
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "The export failed");
    } finally {
      setExporting(false);
    }
  }

  const counts = data?.counts ?? {};
  const status = params.get("status") ?? "all";
  const page = data?.page ?? 1;
  const totalPages = data?.totalPages ?? 1;

  return (
    <DashboardShell
      variant="admin"
      icon={Users}
      eyebrow="Directory"
      title="Members"
      subtitle="Everybody on the platform — filter, act in bulk, or step into an account to see what they see."
    >
      {/* ------------------------------------------------------ tabs */}
      <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((tab) => {
          const on = status === tab.key || (tab.key === "all" && status === "all");
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => update({ status: tab.key === "all" ? null : tab.key })}
              aria-pressed={on}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition ${
                on ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] ${
                  on ? "bg-paper-tint text-ink-muted" : "bg-paper-tint text-ink-faint"
                }`}
              >
                {counts[tab.count] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <MemberFilters
        query={query}
        facets={data?.facets ?? null}
        onChange={(patch) => update(patch)}
        onClear={clearFilters}
      />

      {/* --------------------------------------------- list controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-[12.5px] text-ink-muted">
          {loading ? "Loading…" : `${data?.total ?? 0} ${data?.total === 1 ? "member" : "members"}`}
          {selected.size > 0 && <span className="font-bold text-ink"> · {selected.size} selected</span>}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-[12px] text-ink-faint">
            <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            <span className="sr-only">Sort by</span>
            <select
              value={params.get("sort") ?? "newest"}
              onChange={(e) => update({ sort: e.target.value })}
              className="rounded-full bg-white ring-1 ring-line px-3 py-2 text-[12.5px] font-semibold text-ink outline-none ring-1 ring-line focus:ring-teal-400/50 [&>option]:text-ink"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-2 text-[12px] text-ink-faint">
            <span className="sr-only">Rows per page</span>
            <select
              value={params.get("pageSize") ?? "25"}
              onChange={(e) => update({ pageSize: e.target.value })}
              className="rounded-full bg-white ring-1 ring-line px-3 py-2 text-[12.5px] font-semibold text-ink outline-none ring-1 ring-line focus:ring-teal-400/50 [&>option]:text-ink"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => load(true)}
            className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-line px-3.5 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-paper-tint hover:text-ink"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} strokeWidth={2.5} aria-hidden />
            Refresh
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || (data?.total ?? 0) === 0}
            className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-3.5 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        </div>
      </div>

      {flash && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 rounded-2xl bg-teal-500/15 px-4 py-3 text-[13px] text-white ring-1 ring-teal-400/30"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" strokeWidth={2.5} aria-hidden />
          {flash}
        </div>
      )}

      {/* ------------------------------------------------- bulk bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm">
          <p className="text-[13px] font-bold text-ink">
            {selected.size} selected
          </p>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12px] font-semibold text-ink-faint underline-offset-2 hover:underline"
          >
            Clear
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {BULK.map((spec) => (
              <button
                key={spec.action}
                type="button"
                onClick={() => openBulk(spec)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition ${
                  spec.tone === "danger"
                    ? "bg-danger/10 text-danger hover:bg-danger/20"
                    : "bg-paper-tint text-ink-muted hover:bg-line-soft hover:text-ink"
                }`}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <LoadingBlock label="Loading members…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={() => load()} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={Users}
            title="Nobody matches that"
            body="Every filter above narrows the one below it. Clear one of them and the list will come back."
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full bg-teal-600 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-teal-700"
              >
                Clear all filters
              </button>
            }
          />
        </Panel>
      )}

      {/* ---------------------------------------------------- table */}
      {!loading && !error && rows.length > 0 && (
        <>
          <Panel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-faint">
                    <th scope="col" className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        aria-label="Select every member on this page"
                        className="h-4 w-4 rounded border-line-soft text-teal-600 focus:ring-teal-500/30"
                      />
                    </th>
                    <th scope="col" className="px-4 py-3 font-bold">Member</th>
                    <th scope="col" className="px-4 py-3 font-bold">Status</th>
                    <th scope="col" className="px-4 py-3 font-bold">Membership</th>
                    <th scope="col" className="px-4 py-3 font-bold">Location</th>
                    <th scope="col" className="px-4 py-3 font-bold">Joined</th>
                    <th scope="col" className="px-4 py-3 font-bold">Last seen</th>
                    <th scope="col" className="px-4 py-3 font-bold">Rating</th>
                    {/* `relative` is load-bearing. The visually-hidden
                        label below is absolutely positioned, and without
                        a positioned ancestor its containing block is the
                        page itself — so it sits at x≈950 outside the
                        table's scroll container and gives the whole
                        document a horizontal scrollbar on a phone. */}
                    <th scope="col" className="relative px-4 py-3 text-right font-bold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.map((row) => {
                    const picked = selected.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        className={`transition ${picked ? "bg-teal-50/60" : "hover:bg-paper-muted"}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => toggleOne(row.id)}
                            aria-label={`Select ${row.fullName}`}
                            className="mt-1 h-4 w-4 rounded border-line-soft text-teal-600 focus:ring-teal-500/30"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenId(row.id)}
                            className="flex items-start gap-3 text-left"
                          >
                            <MemberAvatar photoUrl={row.photoUrl} fullName={row.fullName} size={36} />
                            <span className="min-w-0">
                              <span className="block truncate text-[13.5px] font-bold text-ink hover:text-teal-700">
                                {row.fullName}
                              </span>
                              <span className="block truncate text-[12px] text-ink-faint">
                                {row.email ?? "no account"}
                              </span>
                              {row.specialty && (
                                <span className="block truncate text-[11.5px] text-ink-faint">{row.specialty}</span>
                              )}
                            </span>
                          </button>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <span className="flex flex-col items-start gap-1">
                            <StatusChip status={row.verificationStatus} />
                            {row.accountActive === false && (
                              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
                                No sign-in
                              </span>
                            )}
                            {!row.claimed && row.verificationStatus !== "unverified" && (
                              <span className="text-[10.5px] font-semibold text-ink-faint">Unclaimed</span>
                            )}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <span className="block text-[12.5px] font-semibold text-ink">{row.planName}</span>
                          <span className="block text-[11.5px] text-ink-faint">
                            {row.planStatus.replace(/_/g, " ")}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top text-[12.5px] text-ink-muted">
                          {row.city ?? "—"}
                          {row.signupCountry && (
                            <span className="ml-1.5 rounded bg-paper-tint px-1.5 py-0.5 text-[10px] font-bold text-ink-faint">
                              {row.signupCountry}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top text-[12.5px] text-ink-muted">
                          {relativeTime(row.joinedAt)}
                        </td>

                        <td className="px-4 py-3 align-top text-[12.5px]">
                          {row.lastLoginAt ? (
                            <span className="text-ink-muted">{relativeTime(row.lastLoginAt)}</span>
                          ) : (
                            <span className="font-semibold text-amber">Never</span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top text-[12.5px] text-ink-muted">
                          {row.ratingCount ? (
                            <span className="inline-flex items-center gap-1">
                              <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={2} aria-hidden />
                              {row.ratingAvg.toFixed(1)}
                              <span className="text-ink-faint">({row.ratingCount})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="relative px-4 py-3 text-right align-top">
                          <button
                            type="button"
                            aria-label={`Actions for ${row.fullName}`}
                            aria-expanded={rowMenu === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowMenu(rowMenu === row.id ? null : row.id);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full text-ink-faint transition hover:bg-paper-tint hover:text-ink"
                          >
                            <MoreHorizontal className="h-4 w-4" strokeWidth={2.5} />
                          </button>

                          {rowMenu === row.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-4 top-12 z-20 w-56 overflow-hidden rounded-xl bg-white text-left shadow-lg ring-1 ring-line-soft"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenu(null);
                                  setOpenId(row.id);
                                }}
                                className="block w-full px-4 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-paper-muted"
                              >
                                Open record
                              </button>
                              <button
                                type="button"
                                disabled={!row.canImpersonate}
                                title={
                                  row.canImpersonate
                                    ? undefined
                                    : "No active account behind this listing"
                                }
                                onClick={() => {
                                  setRowMenu(null);
                                  setReason("");
                                  setActionError(null);
                                  setImpersonating(row);
                                }}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-paper-muted disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-white"
                              >
                                <LogIn className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                                Sign in as this member
                              </button>
                              <a
                                href={`/specialists/${row.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-paper-muted"
                              >
                                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                                Public profile
                              </a>
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenu(null);
                                  setSelected(new Set([row.id]));
                                }}
                                className="block w-full border-t border-line-soft px-4 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-paper-muted"
                              >
                                Select only this one
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
                  onClick={() => update({ page: String(page - 1) }, true)}
                  className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => update({ page: String(page + 1) }, true)}
                  className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------- bulk confirmation */}
      <Dialog
        open={Boolean(pending)}
        onClose={() => (running ? undefined : setPending(null))}
        title={pending ? `${pending.label} — ${selected.size} ${selected.size === 1 ? "member" : "members"}` : ""}
        description={pending?.blurb}
      >
        <div className="space-y-4">
          {pending?.needsTag && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-ink">Tag</span>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="chase-documents"
                className="w-full rounded-xl border border-line-soft bg-paper px-3 py-2 text-[13px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-ink">
              {pending?.needsNote ? "Reason (required)" : "Note (optional)"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={
                pending?.needsNote
                  ? "Registration number could not be matched against the GMC register."
                  : "Recorded in the activity log alongside this action."
              }
              className="w-full rounded-xl border border-line-soft bg-paper px-3 py-2 text-[13px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </label>

          {actionError && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] font-semibold text-danger">
              {actionError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={running}
              className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runBulk}
              disabled={running || (pending?.needsNote && !note.trim()) || (pending?.needsTag && !tag.trim())}
              className={`rounded-full px-4 py-2 text-[12.5px] font-bold text-white transition disabled:opacity-40 ${
                pending?.tone === "danger" ? "bg-danger hover:brightness-110" : "bg-teal-600 hover:bg-teal-700"
              }`}
            >
              {running ? "Working…" : pending?.label}
            </button>
          </div>
        </div>
      </Dialog>

      {/* ------------------------------------- impersonation confirm */}
      <Dialog
        open={Boolean(impersonating)}
        onClose={() => (running ? undefined : setImpersonating(null))}
        title={impersonating ? `Sign in as ${impersonating.fullName}` : ""}
        description="You will see their dashboard exactly as they do, and anything you change is changed on their account. The session is recorded against your name and ends after 30 minutes."
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-ink">Why (optional, but recorded)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reported that the photo upload fails on their profile"
              className="w-full rounded-xl border border-line-soft bg-paper px-3 py-2 text-[13px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </label>

          {actionError && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] font-semibold text-danger">
              {actionError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setImpersonating(null)}
              disabled={running}
              className="rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmImpersonation}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-ink/90 disabled:opacity-40"
            >
              <LogIn className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              {running ? "Starting…" : "Start support session"}
            </button>
          </div>
        </div>
      </Dialog>

      <MemberDrawer
        memberId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => load(true)}
        onImpersonate={(member) => {
          setOpenId(null);
          setReason("");
          setActionError(null);
          setImpersonating(member);
        }}
      />
    </DashboardShell>
  );
}
