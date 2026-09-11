import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Inbox, Loader2, Mail, Phone, Send } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { Enquiry } from "../../lib/dashboardApi";

const TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "in_progress", label: "In progress" },
  { key: "responded", label: "Responded" },
  { key: "closed", label: "Closed" },
] as const;

const STATUS_TONE: Record<string, string> = {
  new: "bg-teal-50 text-teal-700",
  responded: "bg-paper-tint text-ink-muted",
  in_progress: "bg-amber/15 text-amber",
  closed: "bg-paper-tint text-ink-faint",
};

export default function Enquiries() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const focusId = params.get("focus");

  const [rows, setRows] = useState<Enquiry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);

  // `silent` refreshes the data without tearing the pane down. A reply
  // triggers a reload, and a full loading state would unmount the detail
  // view — taking the "sent" confirmation with it before it is read.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.enquiries(status);
      setRows(res.results);
      setCounts(res.counts);
      // Keep a selection that still exists in the filtered list; otherwise
      // fall back to the first row so the detail pane is never blank.
      setSelectedId((current) => {
        if (current && res.results.some((r) => r.id === current)) return current;
        return res.results[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your enquiries");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  function setStatusFilter(next: string) {
    const p = new URLSearchParams(params);
    if (next === "all") p.delete("status");
    else p.set("status", next);
    p.delete("focus");
    setParams(p, { replace: true });
  }

  return (
    <DashboardShell
      title="Enquiries"
      subtitle="Messages patients have sent from your profile. Replies go straight to their inbox."
    >
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            aria-pressed={status === tab.key}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${
              status === tab.key ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
            }`}
          >
            {tab.label}
            {counts[tab.key] != null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${
                  status === tab.key ? "bg-paper-tint text-ink-muted" : "bg-paper-tint text-ink-muted"
                }`}
              >
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Loading enquiries…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={() => load()} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={Inbox}
            title={status === "all" ? "No enquiries yet" : "Nothing in this folder"}
            body={
              status === "all"
                ? "When a patient sends a message from your profile it arrives here, and a copy goes to your contact email."
                : "Try another folder — there's nothing with this status right now."
            }
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
          {/* ------------------------------------------------ list */}
          <Panel padded={false}>
            <ul className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    aria-current={row.id === selectedId}
                    className={`w-full px-4 py-3.5 text-left transition ${
                      row.id === selectedId ? "bg-teal-50" : "hover:bg-paper-muted"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[13.5px] font-bold text-ink">{row.patientName}</span>
                      <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(row.createdAt)}</span>
                    </span>
                    <span className="mt-1 block truncate text-[12.5px] text-ink-muted">
                      {row.message || "No message"}
                    </span>
                    <span
                      className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[row.status] ?? "bg-paper-tint text-ink-muted"}`}
                    >
                      {row.status.replace("_", " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {/* ---------------------------------------------- detail */}
          {selected ? <EnquiryDetail key={selected.id} enquiry={selected} onSaved={() => load(true)} /> : null}
        </div>
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * Detail and reply
 *
 * The reply is recorded server-side whether or not email delivery
 * succeeds, so the result tells the specialist which of the two happened
 * rather than implying the message definitely landed.
 * ------------------------------------------------------------------ */
function EnquiryDetail({ enquiry, onSaved }: { enquiry: Enquiry; onSaved: () => void }) {
  const [message, setMessage] = useState("");
  const [nextStatus, setNextStatus] = useState<"responded" | "in_progress" | "closed">("responded");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await dashboardApi.respond(enquiry.id, message.trim(), nextStatus);
      setResult(res.delivery);
      setMessage("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft pb-4">
        <div className="min-w-0">
          <h2 className="font-display text-[18px] font-bold text-ink">{enquiry.patientName}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            {enquiry.email && (
              <a href={`mailto:${enquiry.email}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                {enquiry.email}
              </a>
            )}
            {enquiry.phone && (
              <a href={`tel:${enquiry.phone}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                {enquiry.phone}
              </a>
            )}
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${STATUS_TONE[enquiry.status] ?? "bg-paper-tint text-ink-muted"}`}
        >
          {enquiry.status.replace("_", " ")}
        </span>
      </div>

      <div className="py-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
          Received {relativeTime(enquiry.createdAt)}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
          {enquiry.message || "No message was included."}
        </p>
      </div>

      {enquiry.response && (
        <div className="mb-4 rounded-xl bg-paper-muted p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            Your reply · {relativeTime(enquiry.respondedAt)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{enquiry.response}</p>
        </div>
      )}

      <form onSubmit={handleSend} className="border-t border-line-soft pt-4">
        <label className="mb-1.5 block text-[12.5px] font-bold text-ink" htmlFor="reply">
          {enquiry.response ? "Send a follow-up" : "Write a reply"}
        </label>
        <textarea
          id="reply"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={`Hello ${enquiry.patientName.split(" ")[0]}, thank you for getting in touch…`}
          className="w-full resize-y rounded-xl border border-line bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
            Then mark as
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as typeof nextStatus)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-ink outline-none focus:border-teal-500"
            >
              <option value="responded">Responded</option>
              <option value="in_progress">In progress</option>
              <option value="closed">Closed</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2.5} />}
            {sending ? "Sending…" : "Send reply"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}

        {result && (
          <p
            role="status"
            className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
              result.sent ? "bg-teal-50 text-teal-800" : "bg-amber/10 text-amber"
            }`}
          >
            {result.sent ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={3} />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            )}
            {result.sent
              ? "Reply saved and emailed to the patient."
              : `Reply saved on the enquiry, but it wasn't emailed${result.reason ? ` — ${result.reason}` : ""}. It will be delivered once email is configured.`}
          </p>
        )}
      </form>
    </Panel>
  );
}
