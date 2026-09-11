import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CircleSlash,
  ExternalLink,
  Loader2,
  MessageSquareQuote,
  Star,
  Stethoscope,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { Dialog } from "../../components/Dialog";
import { adminApi } from "../../lib/dashboardApi";
import type { ModerationRow, ModerationStatus } from "../../lib/dashboardApi";

const QUEUES: { key: ModerationStatus; label: string }[] = [
  { key: "pending", label: "Awaiting approval" },
  { key: "approved", label: "Published" },
  { key: "rejected", label: "Rejected" },
];

/**
 * The two decisions, and what each one actually does. Written out in
 * full because publishing a patient's words about a named clinician —
 * or refusing to — is not a housekeeping action, and the dialog should
 * say what it commits to before the button is pressed.
 */
const DECISIONS = {
  approved: {
    label: "Publish",
    icon: BadgeCheck,
    tone: "bg-teal-600 text-white hover:bg-teal-700",
    heading: "Publish this review?",
    body: "It appears on the listing straight away, counts towards the star rating, and can be shown on the homepage. The provider will be able to reply to it.",
    noteLabel: "Internal note (optional)",
    notePlaceholder: "e.g. Checked against the booking record.",
    noteRequired: false,
  },
  rejected: {
    label: "Reject",
    icon: CircleSlash,
    tone: "bg-danger text-white hover:opacity-90",
    heading: "Reject this review?",
    body: "It stays out of public view and out of the rating. Nothing is deleted — the review and your reason are kept, so the decision can be accounted for later.",
    noteLabel: "Reason",
    notePlaceholder: "e.g. Names a member of staff and describes a clinical outcome we cannot verify.",
    noteRequired: true,
  },
} as const;

type DecisionKey = keyof typeof DECISIONS;

export default function ReviewModeration() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ModerationStatus) || "pending";

  const [rows, setRows] = useState<ModerationRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ row: ModerationRow; key: DecisionKey } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const data = await adminApi.reviews(status);
      setRows(data.results);
      setCounts(data.counts ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the review queue");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  function setQueue(next: ModerationStatus) {
    const p = new URLSearchParams(params);
    p.set("status", next);
    p.delete("open");
    setParams(p, { replace: true });
  }

  async function submit() {
    if (!decision) return;
    const config = DECISIONS[decision.key];
    if (config.noteRequired && note.trim().length < 3) {
      setSaveError("Please give a reason — it is kept as the record of this decision.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.moderateReview(decision.row.id, decision.key, note.trim() || undefined);
      setDecision(null);
      setNote("");
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save that decision");
    } finally {
      setSaving(false);
    }
  }

  const pending = counts.pending ?? 0;

  return (
    <DashboardShell
      variant="admin"
      icon={MessageSquareQuote}
      eyebrow="Moderation"
      title="Reviews"
      subtitle="Nothing a patient writes is published until it is read here."
    >
      <div className="flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <button
            key={q.key}
            type="button"
            onClick={() => setQueue(q.key)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${
              status === q.key
                ? "bg-ink text-white"
                : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
            }`}
          >
            {q.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                status === q.key ? "bg-paper-tint" : "bg-paper-tint text-ink-faint"
              }`}
            >
              {counts[q.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* The queue's own SLA, stated where the work happens. */}
      {status === "pending" && pending > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-soft px-4 py-3 text-[13px] text-amber-900 ring-1 ring-amber-line">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            Reviews left here are invisible to patients and unanswerable by the provider. Anything still waiting after
            24 hours raises a second alert to every admin.
          </span>
        </p>
      )}

      <div className="mt-6">
        {error ? (
          <ErrorBlock message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <LoadingBlock label="Loading reviews…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MessageSquareQuote}
            title={status === "pending" ? "Nothing waiting" : "Nothing here"}
            body={
              status === "pending"
                ? "Every review that has come in has been decided on."
                : "No reviews have reached this state yet."
            }
          />
        ) : (
          <ul className="grid gap-4">
            {rows.map((row) => (
              <li key={row.id}>
                <Panel>
                  <article className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-paper-tint text-teal-700">
                            {row.subjectType === "facility" ? (
                              <Building2 className="h-3.5 w-3.5" strokeWidth={2} />
                            ) : (
                              <Stethoscope className="h-3.5 w-3.5" strokeWidth={2} />
                            )}
                          </span>
                          <span className="font-bold text-ink">{row.subject?.name ?? "Unknown listing"}</span>
                          {row.subject?.href && (
                            <a
                              href={row.subject.href}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="flex items-center gap-1 text-[12px] font-semibold text-teal-600 hover:underline"
                            >
                              View listing
                              <ExternalLink className="h-3 w-3" strokeWidth={2} />
                            </a>
                          )}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="flex items-center gap-0.5" aria-label={`${row.rating} out of 5`}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={`h-4 w-4 ${n <= row.rating ? "fill-amber text-amber" : "fill-line text-line"}`}
                                strokeWidth={0}
                              />
                            ))}
                          </span>
                          {row.verified && (
                            <span className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-700">
                              <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                              Verified visit
                            </span>
                          )}
                          {row.seenFor && (
                            <span className="rounded-full bg-paper-tint px-2 py-0.5 text-[11.5px] font-semibold text-ink-muted">
                              Seen for: {row.seenFor}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* How long it has been sitting here, in words, so
                          the 24-hour line is legible at a glance. */}
                      <p
                        className={`shrink-0 text-[12.5px] font-bold tabular-nums ${
                          row.moderationStatus === "pending" && row.waitingHours >= 24 ? "text-danger" : "text-ink-faint"
                        }`}
                      >
                        {row.moderationStatus === "pending"
                          ? `Waiting ${row.waitingHours}h`
                          : relativeTime(row.moderatedAt ?? row.createdAt)}
                      </p>
                    </div>

                    {row.comment ? (
                      <blockquote className="rounded-xl bg-paper-muted p-4 text-[14px] leading-relaxed text-ink">
                        “{row.comment}”
                      </blockquote>
                    ) : (
                      <p className="text-[13.5px] italic text-ink-faint">A star rating with no written comment.</p>
                    )}

                    <p className="text-[12.5px] text-ink-muted">
                      {row.patientName ?? "Anonymous"} · submitted {relativeTime(row.createdAt)}
                    </p>

                    {row.moderationNote && (
                      <p className="rounded-xl bg-paper-tint px-3 py-2 text-[12.5px] text-ink-muted">
                        <span className="font-bold text-ink">Note: </span>
                        {row.moderationNote}
                      </p>
                    )}

                    {row.moderationStatus === "pending" && (
                      <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
                        {(Object.keys(DECISIONS) as DecisionKey[]).map((key) => {
                          const config = DECISIONS[key];
                          const Icon = config.icon;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setDecision({ row, key });
                                setNote("");
                                setSaveError(null);
                              }}
                              className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${config.tone}`}
                            >
                              <Icon className="h-4 w-4" strokeWidth={2.25} />
                              {config.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </article>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision ? DECISIONS[decision.key].heading : ""}
        description={decision ? DECISIONS[decision.key].body : ""}
      >
        {decision && (
          <div className="space-y-4">
            <blockquote className="rounded-xl bg-paper-muted p-3 text-[13px] leading-relaxed text-ink-muted">
              {decision.row.rating}★ for {decision.row.subject?.name}
              {decision.row.comment ? ` — “${decision.row.comment.slice(0, 160)}”` : ""}
            </blockquote>

            <label className="block">
              <span className="text-[12.5px] font-bold text-ink">{DECISIONS[decision.key].noteLabel}</span>
              <textarea
                id="moderation-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={DECISIONS[decision.key].notePlaceholder}
                className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-teal-400"
              />
            </label>

            {saveError && <p className="text-[13px] font-semibold text-danger">{saveError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecision(null)}
                className="rounded-full px-4 py-2 text-[13px] font-bold text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-bold transition disabled:opacity-60 ${
                  DECISIONS[decision.key].tone
                }`}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {DECISIONS[decision.key].label}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </DashboardShell>
  );
}
