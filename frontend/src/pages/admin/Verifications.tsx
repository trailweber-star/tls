import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  CircleAlert,
  CircleSlash,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime, initials } from "../../components/dashboard/ui";
import { Dialog } from "../../components/Dialog";
import { adminApi } from "../../lib/dashboardApi";
import { ClaimsQueue } from "../../components/admin/ClaimsQueue";
import type { VerificationDetail, VerificationRow } from "../../lib/dashboardApi";

const QUEUES = [
  { key: "pending", label: "Pending" },
  { key: "info_requested", label: "Info requested" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Not approved" },
  { key: "suspended", label: "Suspended" },
] as const;

/** The decisions available, and what each one does to the profile. */
const DECISIONS = {
  approve: {
    label: "Approve",
    icon: BadgeCheck,
    tone: "bg-teal-600 text-white hover:bg-teal-700",
    heading: "Approve this specialist?",
    body: "Their profile goes live immediately — it will appear in search and patients will be able to send enquiries. They'll be emailed to say so.",
    noteLabel: "Internal note (optional)",
    notePlaceholder: "e.g. GMC register checked, certificate matches.",
    noteRequired: false,
  },
  request_info: {
    label: "Request information",
    icon: CircleAlert,
    tone: "bg-amber text-white hover:opacity-90",
    heading: "Ask for more information?",
    body: "The profile stays hidden. Your note is shown to them on their dashboard and emailed, so be specific about what you need.",
    noteLabel: "What do you need from them?",
    notePlaceholder: "e.g. Please upload a certificate that shows your registration number.",
    noteRequired: true,
  },
  reject: {
    label: "Not approve",
    icon: CircleSlash,
    tone: "bg-danger text-white hover:opacity-90",
    heading: "Decline this application?",
    body: "The profile stays hidden and the applicant is emailed. Your note is included as the reason.",
    noteLabel: "Reason",
    notePlaceholder: "e.g. Registration number could not be verified with the regulator.",
    noteRequired: true,
  },
  suspend: {
    label: "Suspend",
    icon: CircleSlash,
    tone: "bg-danger text-white hover:opacity-90",
    heading: "Suspend this profile?",
    body: "It is removed from search and from public view straight away. The specialist is emailed and keeps dashboard access.",
    noteLabel: "Reason",
    notePlaceholder: "e.g. Complaint under investigation.",
    noteRequired: true,
  },
  reinstate: {
    label: "Reinstate",
    icon: RotateCcw,
    tone: "bg-teal-600 text-white hover:bg-teal-700",
    heading: "Reinstate this profile?",
    body: "It becomes publicly visible again and the specialist is emailed.",
    noteLabel: "Internal note (optional)",
    notePlaceholder: "e.g. Complaint resolved, no further action.",
    noteRequired: false,
  },
} as const;

type DecisionKey = keyof typeof DECISIONS;

const ACTIONS_FOR: Record<string, DecisionKey[]> = {
  pending: ["approve", "request_info", "reject"],
  info_requested: ["approve", "reject"],
  verified: ["suspend"],
  rejected: ["approve"],
  suspended: ["reinstate"],
};

export default function Verifications() {
  const [params, setParams] = useSearchParams();
  // Two different questions share this screen: is this person who they
  // say they are (applications), and does this listing belong to them
  // (claims). Same decision-making context, so same page — but never
  // mixed into one list, because the evidence you weigh differs.
  const tab = params.get("tab") === "claims" ? "claims" : "applications";
  const status = params.get("status") ?? "pending";
  const page = Number(params.get("page") ?? 1);
  const openId = params.get("open");

  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.verifications(status, page);
      setRows(res.results);
      setCounts(res.counts);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the verification queue");
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  function navigate(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v)));
    setParams(p, { replace: true });
  }

  return (
    <DashboardShell
      variant="admin"
      icon={ShieldCheck}
      eyebrow="Trust & safety"
      title="Verification centre"
      subtitle="Every specialist is checked by hand here. Nothing on this platform goes live without an approval on this page."
    >
      <div className="mb-5 flex gap-1 rounded-full bg-white ring-1 ring-line p-1" role="tablist" aria-label="Review queues">
        {(
          [
            ["applications", "Applications"],
            ["claims", "Profile claims"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(new URLSearchParams(key === "claims" ? { tab: "claims" } : {}), { replace: true })}
            className={`flex-1 rounded-full px-4 py-2.5 text-[13px] font-bold transition sm:flex-none ${
              tab === key ? "bg-navy-950 text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "claims" && <ClaimsQueue />}

      {tab === "applications" && (
        <>
      <div className="mb-5 flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <button
            key={q.key}
            type="button"
            onClick={() => navigate({ status: q.key, page: null, open: null })}
            aria-pressed={status === q.key}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${
              status === q.key ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
            }`}
          >
            {q.label}
            {counts[q.key] != null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${
                  status === q.key ? "bg-paper-tint text-ink-muted" : "bg-paper-tint text-ink-muted"
                }`}
              >
                {counts[q.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Loading applications…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={Inbox}
            title="Nothing in this queue"
            body={
              status === "pending"
                ? "No applications are waiting. New registrations land here automatically."
                : "There are no profiles with this status right now."
            }
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <Panel padded={false}>
            <ul className="divide-y divide-line-soft">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ open: row.id })}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-paper-muted sm:px-5"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-tint text-[13px] font-bold text-ink-muted">
                      {row.photoUrl ? (
                        <img src={row.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(row.fullName)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold text-ink">{row.fullName}</span>
                      <span className="block truncate text-[12.5px] text-ink-muted">
                        {[row.title, row.primarySpecialty].filter(Boolean).join(" · ") || "No title yet"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right sm:block">
                      <span className="block text-[12.5px] font-semibold text-ink">
                        {row.registrationNumber ?? "No registration number"}
                      </span>
                      <span className="block text-[11.5px] text-ink-faint">
                        {row.documentCount} document{row.documentCount === 1 ? "" : "s"} · applied{" "}
                        {relativeTime(row.submittedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-paper-tint px-3 py-1.5 text-[11.5px] font-bold text-ink-muted">
                      Review
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[12.5px] text-ink-faint">
                Page {page} of {totalPages} · {total} in this queue
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

        </>
      )}

      {tab === "applications" && openId && (
        <ApplicationDialog
          id={openId}
          onClose={() => navigate({ open: null })}
          onDecided={() => {
            navigate({ open: null });
            load();
          }}
        />
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * The application under review
 *
 * Everything the admin needs to decide, in one place: the claimed
 * registration, the documents supplied, where they practise, and the
 * full history of what has already been decided about them.
 * ------------------------------------------------------------------ */
function ApplicationDialog({
  id,
  onClose,
  onDecided,
}: {
  id: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [application, setApplication] = useState<VerificationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionKey | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .verification(id)
      .then((res) => {
        if (!cancelled) setApplication(res.application);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this application");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const config = decision ? DECISIONS[decision] : null;
  const DecisionIcon = config?.icon ?? ShieldCheck;

  async function confirm() {
    if (!decision || !config) return;
    if (config.noteRequired && !note.trim()) {
      setDecisionError("Please add a note — it's sent to the specialist.");
      return;
    }
    setSubmitting(true);
    setDecisionError(null);
    try {
      await adminApi.decide(id, decision, note.trim() || undefined);
      onDecided();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Could not record that decision");
    } finally {
      setSubmitting(false);
    }
  }

  const available = application ? (ACTIONS_FOR[application.verificationStatus] ?? []) : [];

  return (
    <Dialog open onClose={onClose} title={application?.fullName ?? "Application"} size="lg">
      {loading && (
        <p className="flex items-center justify-center gap-2 py-12 text-[13.5px] text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading application…
        </p>
      )}
      {error && !loading && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}

      {application && !loading && (
        <div className="space-y-5">
          {/* ---------------------------------------- identity */}
          <div className="flex items-start gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-paper-tint text-[18px] font-bold text-ink-muted">
              {application.photoUrl ? (
                <img src={application.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(application.fullName)
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink-muted">{application.title ?? "No title given"}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {application.primarySpecialty ?? "No specialty chosen"}
                {application.yearsExperience != null && ` · ${application.yearsExperience} years' experience`}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
                {application.contactEmail && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                    {application.contactEmail}
                  </span>
                )}
                {application.contactPhone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                    {application.contactPhone}
                  </span>
                )}
              </div>
            </div>
            <a
              href={`/specialists/${application.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-paper-tint px-3 py-2 text-[12px] font-bold text-ink-muted transition hover:bg-line-soft"
            >
              Profile
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
            </a>
          </div>

          {/* ------------------------------------ registration */}
          <div className="rounded-xl bg-paper-muted p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
              Registration to check
            </p>
            <p className="mt-2 font-display text-[18px] font-bold text-ink">
              {application.registrationNumber ?? "Not supplied"}
            </p>
            <p className="text-[12.5px] text-ink-muted">
              {application.regulator ? `${application.regulator.name} (${application.regulator.code})` : "Regulator not recorded"}
            </p>
          </div>

          {/* --------------------------------------- documents */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Supporting documents</p>
            {application.application?.documents?.length ? (
              <ul className="mt-2 space-y-1.5">
                {application.application.documents.map((doc, i) => (
                  <li key={`${doc?.url ?? "doc"}-${i}`}>
                    {/* Stored as free-form jsonb, so a row can arrive
                        without a URL. That becomes a listed but
                        unopenable document rather than a dead link an
                        admin clicks and gets nothing from. */}
                    {doc?.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 rounded-lg bg-paper-muted px-3 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-line-soft"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate">{doc.name ?? "Untitled document"}</span>
                        {doc.type && (
                          <span className="shrink-0 text-[11px] uppercase text-ink-faint">{doc.type}</span>
                        )}
                      </a>
                    ) : (
                      <span className="flex items-center gap-2.5 rounded-lg bg-paper-muted px-3 py-2.5 text-[12.5px] font-semibold text-ink-faint">
                        <FileText className="h-4 w-4 shrink-0" strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate">
                          {doc?.name ?? "Untitled document"} — no file attached
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2.5 text-[12.5px] text-amber">
                No documents uploaded. You may want to request evidence before approving.
              </p>
            )}
          </div>

          {/* --------------------------------------- locations */}
          {application.clinicLocations.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Practice locations</p>
              <ul className="mt-2 space-y-1">
                {application.clinicLocations.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
                    {[l.address, l.city].filter(Boolean).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {application.bio && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Biography</p>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
                {application.bio}
              </p>
            </div>
          )}

          {/* ----------------------------------------- history */}
          {application.verificationHistory.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Audit trail</p>
              <ul className="mt-2 space-y-2">
                {[...application.verificationHistory]
                  .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                  .map((h, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="font-semibold text-ink">
                        {h.action.replace("_", " ")}
                        {h.byName ? ` · ${h.byName}` : ""}
                      </span>
                      <span className="shrink-0 text-ink-faint">{relativeTime(h.at)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* ---------------------------------------- decision */}
          <div className="border-t border-line-soft pt-4">
            {!decision ? (
              <>
                <p className="mb-3 text-[12.5px] text-ink-muted">
                  Current status:{" "}
                  <strong className="font-bold text-ink">{application.verificationStatus.replace("_", " ")}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  {available.map((key) => {
                    const d = DECISIONS[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setDecision(key);
                          setNote("");
                          setDecisionError(null);
                        }}
                        className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold transition ${d.tone}`}
                      >
                        <d.icon className="h-4 w-4" strokeWidth={2.5} />
                        {d.label}
                      </button>
                    );
                  })}
                  {available.length === 0 && (
                    <p className="text-[12.5px] text-ink-muted">No further action is available for this status.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl bg-paper-muted p-4">
                <p className="text-[14px] font-bold text-ink">{config!.heading}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{config!.body}</p>

                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[12.5px] font-bold text-ink">{config!.noteLabel}</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder={config!.notePlaceholder}
                    className="w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </label>

                {decisionError && (
                  <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
                    {decisionError}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={submitting}
                    className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold transition disabled:opacity-50 ${config!.tone}`}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <DecisionIcon className="h-4 w-4" strokeWidth={2.5} />
                    )}
                    {submitting ? "Recording…" : `Confirm — ${config!.label.toLowerCase()}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision(null)}
                    disabled={submitting}
                    className="rounded-full px-5 py-2.5 text-[13px] font-bold text-ink-muted ring-1 ring-line transition hover:bg-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
