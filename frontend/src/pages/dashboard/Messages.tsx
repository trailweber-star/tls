import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Loader2, MessageSquare, Send } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { MessageThreadDetail, MessageThreadSummary } from "../../lib/dashboardApi";

export default function Messages() {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("thread");

  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.messageThreads();
      setThreads(res.results);
      setSelectedId((current) => {
        if (current && res.results.some((t) => t.leadId === current)) return current;
        return res.results[0]?.leadId ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your messages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function select(id: string) {
    setSelectedId(id);
    const p = new URLSearchParams(params);
    p.set("thread", id);
    setParams(p, { replace: true });
  }

  // A thread just opened has its unread count cleared server-side
  // (getMessageThread marks the patient's messages read); mirror that
  // locally so the badge disappears without waiting on a full reload.
  function clearUnread(id: string) {
    setThreads((rows) => rows.map((r) => (r.leadId === id ? { ...r, unread: 0 } : r)));
  }

  const selected = useMemo(() => threads.find((t) => t.leadId === selectedId) ?? null, [threads, selectedId]);

  return (
    <DashboardShell
      title="Messages"
      subtitle="The rest of the conversation, past your first reply to an enquiry. Patients can keep replying with no account of their own."
    >
      {loading && <LoadingBlock label="Loading your messages…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && threads.length === 0 && (
        <Panel>
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            body="Reply to an enquiry to start a thread — the patient can keep replying from the link in that email, with no account needed."
          />
        </Panel>
      )}

      {!loading && !error && threads.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
          <Panel padded={false}>
            <ul className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
              {threads.map((thread) => (
                <li key={thread.leadId}>
                  <button
                    type="button"
                    onClick={() => select(thread.leadId)}
                    aria-current={thread.leadId === selectedId}
                    className={`w-full px-4 py-3.5 text-left transition ${
                      thread.leadId === selectedId ? "bg-teal-50" : "hover:bg-paper-muted"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[13.5px] font-bold text-ink">{thread.patientName}</span>
                      <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(thread.lastActivity)}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[12.5px] text-ink-muted">
                        {thread.preview || "No messages yet"}
                      </span>
                      {thread.unread > 0 && (
                        <span className="shrink-0 grid h-5 min-w-5 place-items-center rounded-full bg-teal-600 px-1.5 text-[10.5px] font-bold text-white">
                          {thread.unread}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {selected ? (
            <ThreadDetail key={selected.leadId} leadId={selected.leadId} onOpened={() => clearUnread(selected.leadId)} />
          ) : null}
        </div>
      )}
    </DashboardShell>
  );
}

function ThreadDetail({ leadId, onOpened }: { leadId: string; onOpened: () => void }) {
  const [detail, setDetail] = useState<MessageThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.messageThread(leadId);
      setDetail(res);
      onOpened();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this conversation");
    } finally {
      setLoading(false);
    }
    // onOpened is a fresh closure every render by design (it captures the
    // current thread's id) -- only leadId should re-trigger the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await dashboardApi.sendMessage(leadId, body.trim());
      setResult(res.delivery);
      setBody("");
      setDetail((d) => (d ? { ...d, messages: [...d.messages, res.message] } : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Panel><LoadingBlock label="Loading conversation…" /></Panel>;
  if (error || !detail) return <Panel><ErrorBlock message={error ?? "Conversation not found"} onRetry={load} /></Panel>;

  return (
    <Panel>
      <div className="border-b border-line-soft pb-4">
        <h2 className="font-display text-[18px] font-bold text-ink">{detail.lead.patientName}</h2>
        {detail.lead.message && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
            Opened with: “{detail.lead.message}”
          </p>
        )}
      </div>

      <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto py-4">
        {detail.messages.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-faint">No messages in this thread yet.</p>
        )}
        {detail.messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderRole === "specialist" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                m.senderRole === "specialist" ? "bg-teal-600 text-white" : "bg-paper-muted text-ink"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p
                className={`mt-1 text-[10.5px] font-semibold ${
                  m.senderRole === "specialist" ? "text-teal-100" : "text-ink-faint"
                }`}
              >
                {relativeTime(m.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="border-t border-line-soft pt-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Write a message…"
          className="w-full resize-y rounded-xl border border-line bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        />
        <div className="mt-3 flex items-center justify-end">
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2.5} />}
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {result && (
          <p
            role="status"
            className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
              result.sent ? "bg-teal-50 text-teal-800" : "bg-amber/10 text-amber"
            }`}
          >
            {result.sent && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={3} />}
            {result.sent
              ? "Sent and emailed to the patient."
              : `Saved to the thread, but not emailed${result.reason ? ` — ${result.reason}` : ""}.`}
          </p>
        )}
      </form>
    </Panel>
  );
}
