import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { getReplyThread, postReply } from "../lib/api";
import type { ReplyThreadData } from "../lib/api";
import { initials } from "../components/dashboard/ui";

/* ------------------------------------------------------------------ *
 * A patient's own side of a message thread
 *
 * Reached only from the link in an email -- the token in the URL is the
 * whole of the access control (see reply.controller.js), so this page
 * asks for no sign-in and shows nothing else about the practice.
 * ------------------------------------------------------------------ */

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function ReplyThread() {
  const { token = "" } = useParams();
  const [data, setData] = useState<ReplyThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getReplyThread(token);
      setData(res);
    } catch {
      setError("This conversation link isn't valid, or has expired. Please check the email again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await postReply(token, body.trim());
      setData((d) => (d ? { ...d, messages: [...d.messages, res.message] } : d));
      setBody("");
      setSent(true);
    } catch {
      setError("Your message could not be sent. Please try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[640px] px-5 py-12 sm:py-16">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-[13.5px] text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your conversation…
        </div>
      )}

      {!loading && (error && !data) && (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-line">
          <p className="text-[14px] font-semibold text-ink">{error}</p>
        </div>
      )}

      {!loading && data && (
        <>
          <header className="mb-6 flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-50 text-[14px] font-bold text-teal-700 ring-1 ring-teal-100">
              {data.specialist?.photoUrl ? (
                <img src={data.specialist.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(data.specialist?.fullName)
              )}
            </span>
            <div className="min-w-0">
              <p className="font-display text-[18px] font-bold text-ink">
                Conversation with {data.specialist?.fullName ?? "your specialist"}
              </p>
              {data.specialist?.title && <p className="text-[12.5px] text-ink-muted">{data.specialist.title}</p>}
            </div>
          </header>

          <p className="mb-5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Only you and {data.specialist?.fullName?.split(" ").slice(-1)[0] ?? "the specialist"} can see this thread.
          </p>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-line sm:p-5">
            <div className="flex max-h-[440px] flex-col gap-3 overflow-y-auto">
              {data.messages.length === 0 && (
                <p className="py-6 text-center text-[13px] text-ink-faint">No messages yet.</p>
              )}
              {data.messages.map((m) => (
                <div key={m.id} className={`flex ${m.senderRole === "patient" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                      m.senderRole === "patient" ? "bg-teal-600 text-white" : "bg-paper-muted text-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p
                      className={`mt-1 text-[10.5px] font-semibold ${
                        m.senderRole === "patient" ? "text-teal-100" : "text-ink-faint"
                      }`}
                    >
                      {relativeTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSend} className="mt-4 border-t border-line-soft pt-4">
              <textarea
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setSent(false);
                }}
                rows={3}
                maxLength={4000}
                placeholder="Write a reply…"
                className="w-full resize-y rounded-xl border border-line bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                {sent && !sending ? (
                  <span className="text-[12.5px] font-semibold text-teal-700">Sent</span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={sending || !body.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2.5} />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
              {error && data && (
                <p role="alert" className="mt-3 text-[12.5px] font-semibold text-danger">
                  {error}
                </p>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
