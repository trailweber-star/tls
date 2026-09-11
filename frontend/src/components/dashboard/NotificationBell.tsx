import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, CheckCheck, Clock3, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { notificationsApi } from "../../lib/dashboardApi";
import type { Notification, NotificationFeed } from "../../lib/dashboardApi";
import { relativeTime } from "./ui";

/* ------------------------------------------------------------------ *
 * The bell
 *
 * The badge counts *actionable* items, not unread ones. An admin needs
 * to know how many applications are still waiting on a decision — a
 * number that also counts "payment received" would make the badge
 * meaningless and, worse, trainable to ignore.
 *
 * Opening the panel does not mark anything read. Reading a list is not
 * the same as dealing with it, and an approval queue that empties itself
 * because someone glanced at it is a queue that loses people.
 * ------------------------------------------------------------------ */

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  signup_pending: UserPlus,
  claim_pending: ShieldCheck,
  approval_overdue: Clock3,
  payment_received: CheckCheck,
  enquiry_received: Bell,
  application_decided: CheckCheck,
};

const TYPE_TONE: Record<string, string> = {
  signup_pending: "bg-teal-50 text-teal-700",
  claim_pending: "bg-teal-50 text-teal-700",
  approval_overdue: "bg-danger/10 text-danger",
  payment_received: "bg-paper-tint text-ink-muted",
  enquiry_received: "bg-paper-tint text-ink-muted",
  application_decided: "bg-paper-tint text-ink-muted",
};

/** How often the badge re-checks while the tab is visible. */
const POLL_MS = 45_000;

export function NotificationBell({ tone = "dark" }: { tone?: "dark" | "light" } = {}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [counts, setCounts] = useState({ unread: 0, actionable: 0 });
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCounts(await notificationsApi.count());
    } catch {
      /* a failed poll is not worth telling anyone about */
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const id = window.setInterval(() => {
      // Polling a hidden tab burns the user's battery for a badge nobody
      // is looking at.
      if (document.visibilityState === "visible") refreshCount();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.list();
      setFeed(res);
      setCounts({ unread: res.unread, actionable: res.actionable });
    } catch {
      setFeed(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadFeed();
  }, [open, loadFeed]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(item: Notification) {
    setOpen(false);
    // Acting on it is what marks it read — see the note at the top.
    if (!item.readAt) {
      await notificationsApi.markRead(item.id).catch(() => undefined);
      refreshCount();
    }
    if (item.url) navigate(item.url);
  }

  const badge = counts.actionable;

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          badge > 0 ? `Notifications — ${badge} needing review` : `Notifications${counts.unread ? ` — ${counts.unread} unread` : ""}`
        }
        className={`relative grid h-9 w-9 place-items-center rounded-full transition ${
          tone === "light"
            ? "text-ink-muted hover:bg-paper-tint hover:text-ink"
            : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
        {badge > 0 && (
          <span className={`absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ${tone === "light" ? "ring-white" : "ring-navy-950"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {badge === 0 && counts.unread > 0 && (
          <span
            className={`absolute right-1 top-1 h-2 w-2 rounded-full bg-teal-400 ring-2 ${
              tone === "light" ? "ring-white" : "ring-navy-950"
            }`}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white text-ink shadow-2xl ring-1 ring-line"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
            <div>
              <p className="text-[13.5px] font-bold text-ink">Notifications</p>
              <p className="text-[11.5px] text-ink-muted">
                {badge > 0
                  ? `${badge} needing review`
                  : counts.unread > 0
                    ? `${counts.unread} unread`
                    : "Nothing outstanding"}
              </p>
            </div>
            {counts.unread > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await notificationsApi.markAllRead().catch(() => undefined);
                  await loadFeed();
                }}
                className="text-[12px] font-bold text-teal-700 transition hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[62vh] overflow-y-auto">
            {loading && (
              <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            )}

            {!loading && feed && feed.results.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-paper-tint text-ink-faint">
                  <BellOff className="h-4 w-4" strokeWidth={2} />
                </span>
                <p className="text-[13px] font-bold text-ink">You&rsquo;re all caught up</p>
                <p className="max-w-[30ch] text-[12.5px] leading-relaxed text-ink-muted">
                  New applications, profile claims and overdue reviews land here.
                </p>
              </div>
            )}

            {!loading && feed && feed.results.length > 0 && (
              <ul className="divide-y divide-line-soft">
                {feed.results.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? Bell;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openItem(item)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-paper-muted ${
                          item.readAt ? "" : "bg-teal-50/40"
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${TYPE_TONE[item.type] ?? "bg-paper-tint text-ink-muted"}`}
                        >
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-bold text-ink">{item.title}</span>
                            {!item.readAt && (
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden />
                            )}
                          </span>
                          {item.body && (
                            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">
                              {item.body}
                            </span>
                          )}
                          <span className="mt-1 block text-[11px] text-ink-faint">{relativeTime(item.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {feed && !feed.push.connected && (
            <p className="border-t border-line-soft bg-paper-muted px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
              Email and in-app alerts are on. Push to your phone needs a provider connected — these same notifications
              go out the moment it is.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
