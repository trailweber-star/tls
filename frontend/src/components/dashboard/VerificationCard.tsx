import { BadgeCheck, CircleAlert, CircleSlash, Clock3, FileText, ShieldCheck } from "lucide-react";
import { Panel } from "../DashboardShell";
import { relativeTime } from "./ui";
import type { HistoryEntry, VerificationStatus } from "../../lib/dashboardApi";

/**
 * The specialist's view of the manual review process.
 *
 * Verification is a decision a human takes in the admin queue — never
 * something this screen can trigger. So the card's job is to say exactly
 * where the application stands, what happens next, and what the reviewer
 * has already said, all read from the audit trail the admin writes.
 */

const PRESENTATION: Record<
  VerificationStatus,
  {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    label: string;
    tone: string;
    ring: string;
    next: string;
  }
> = {
  verified: {
    icon: BadgeCheck,
    label: "Verified",
    tone: "bg-teal-50 text-teal-700",
    ring: "ring-teal-200",
    next: "Your profile is live. Patients can find you in search and send you enquiries.",
  },
  pending: {
    icon: Clock3,
    label: "Pending review",
    tone: "bg-amber/15 text-amber",
    ring: "ring-amber/30",
    next: "A member of our team is checking your registration details. Your profile is not visible to patients yet. Most applications are reviewed within two working days.",
  },
  info_requested: {
    icon: CircleAlert,
    label: "Information requested",
    tone: "bg-amber/15 text-amber",
    ring: "ring-amber/30",
    next: "We need something more before we can approve you — see the reviewer's note below, then update your profile and we'll take another look.",
  },
  rejected: {
    icon: CircleSlash,
    label: "Not approved",
    tone: "bg-danger/10 text-danger",
    ring: "ring-danger/25",
    next: "Your application wasn't approved. The reviewer's note explains why. Contact support if you'd like to appeal.",
  },
  suspended: {
    icon: CircleSlash,
    label: "Suspended",
    tone: "bg-danger/10 text-danger",
    ring: "ring-danger/25",
    next: "Your profile has been removed from public view. See the note below, or contact support.",
  },
  unverified: {
    icon: ShieldCheck,
    label: "Not submitted",
    tone: "bg-paper-tint text-ink-muted",
    ring: "ring-line",
    next: "Finish your profile and submit it for review to appear in the directory.",
  },
};

const HISTORY_LABEL: Record<string, string> = {
  submitted: "Application submitted",
  approved: "Approved",
  rejected: "Not approved",
  info_requested: "More information requested",
  suspended: "Suspended",
  reinstated: "Reinstated",
};

export function VerificationCard({
  status,
  history,
}: {
  status: VerificationStatus;
  history: HistoryEntry[];
}) {
  const view = PRESENTATION[status] ?? PRESENTATION.unverified;
  const Icon = view.icon;
  // Newest first — the current decision is the one that matters most.
  const entries = [...(history ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const latestNote = entries.find((e) => e.note)?.note ?? null;

  return (
    <Panel title="Verification status">
      <div className={`flex items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ${view.tone} ${view.ring}`}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.2} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold">{view.label}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed opacity-90">{view.next}</p>
        </div>
      </div>

      {latestNote && (status === "info_requested" || status === "rejected" || status === "suspended") && (
        <div className="mt-3 rounded-xl bg-paper-muted p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            <FileText className="h-3.5 w-3.5" strokeWidth={2.5} />
            Note from the reviewer
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{latestNote}</p>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">History</p>
          <ol className="mt-2.5 space-y-3">
            {entries.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="flex gap-3">
                <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-teal-500 ring-4 ring-teal-50" />
                  {i < entries.length - 1 && <span className="absolute top-4 h-full w-px bg-line" />}
                </span>
                <span className="min-w-0 flex-1 pb-0.5">
                  <span className="block text-[13px] font-bold text-ink">
                    {HISTORY_LABEL[entry.action] ?? entry.action}
                  </span>
                  <span className="block text-[12px] text-ink-muted">
                    {entry.byName ? `by ${entry.byName} · ` : ""}
                    {relativeTime(entry.at)}
                  </span>
                  {entry.note && <span className="mt-1 block text-[12.5px] text-ink-muted">“{entry.note}”</span>}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}
