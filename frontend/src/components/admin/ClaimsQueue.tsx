import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  CircleSlash,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Star,
} from "lucide-react";
import { Panel } from "../DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, initials, relativeTime } from "../dashboard/ui";
import { Dialog } from "../Dialog";
import { claimsApi } from "../../lib/dashboardApi";
import type { ClaimRow } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Claims queue
 *
 * A claim is a question of identity, not credentials — the listing is
 * already verified. So the one thing an admin needs is prominent: does
 * the registration number the claimant supplied match the one already
 * held against the profile? A match is near-conclusive. A mismatch is
 * not a refusal, because our own record may be wrong, but it is the
 * thing to look at hardest.
 * ------------------------------------------------------------------ */

const STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Refused" },
] as const;

export function ClaimsQueue() {
  const [params, setParams] = useSearchParams();
  const status = params.get("claimStatus") ?? "pending";
  const openId = params.get("open");

  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await claimsApi.adminList(status);
      setRows(res.results);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load claims");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  function navigate(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v)));
    setParams(p, { replace: true });
  }

  const openClaim = rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate({ claimStatus: s.key, open: null })}
            aria-pressed={status === s.key}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${
              status === s.key ? "bg-navy-950 text-white" : "bg-white text-ink-muted ring-1 ring-line hover:text-ink"
            }`}
          >
            {s.label}
            {counts[s.key] != null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${
                  status === s.key ? "bg-paper-tint text-ink-muted" : "bg-paper-tint text-ink-muted"
                }`}
              >
                {counts[s.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Loading claims…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={Inbox}
            title="No claims here"
            body={
              status === "pending"
                ? "When a specialist claims a listing we compiled for them, it lands here for you to confirm."
                : "Nothing with this status yet."
            }
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <Panel padded={false}>
          <ul className="divide-y divide-line-soft">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => navigate({ open: row.id })}
                  className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-paper-muted sm:px-5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-tint text-[13px] font-bold text-ink-muted">
                    {initials(row.fullName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-ink">
                      {row.fullName}{" "}
                      <span className="font-normal text-ink-muted">claims {row.specialistName}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-muted">
                      {row.email} · applied {relativeTime(row.createdAt)}
                    </span>
                  </span>
                  <MatchChip matches={row.registrationMatches} />
                  <span className="shrink-0 rounded-full bg-paper-tint px-3 py-1.5 text-[11.5px] font-bold text-ink-muted">
                    Review
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {openClaim && (
        <ClaimDialog
          claim={openClaim}
          onClose={() => navigate({ open: null })}
          onDecided={() => {
            navigate({ open: null });
            load();
          }}
        />
      )}
    </>
  );
}

function MatchChip({ matches }: { matches: boolean }) {
  return (
    <span
      className={`hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide sm:inline-flex ${
        matches ? "bg-teal-50 text-teal-700" : "bg-danger/10 text-danger"
      }`}
    >
      {matches ? <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} /> : <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />}
      {matches ? "Registration matches" : "No match"}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ClaimDialog({
  claim,
  onClose,
  onDecided,
}: {
  claim: ClaimRow;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof claimsApi.adminGet>> | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    claimsApi
      .adminGet(claim.id)
      .then((res) => !cancelled && setDetail(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [claim.id]);

  async function confirm() {
    if (!decision) return;
    // The claimant is emailed the reason verbatim, so a refusal cannot
    // be blank. The API enforces the same rule.
    if (decision === "reject" && note.trim().length < 10) {
      setError("Please give a reason of at least 10 characters — it is emailed to the claimant.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await claimsApi.decide(claim.id, decision, note.trim() || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that decision");
    } finally {
      setSubmitting(false);
    }
  }

  const specialist = detail?.specialist ?? null;

  return (
    <Dialog open onClose={onClose} size="lg" title={`Claim on ${claim.specialistName}`}>
      <div className="space-y-5">
        {/* ------------------------------- the identity question */}
        <div
          className={`rounded-xl p-4 ring-1 ${
            claim.registrationMatches ? "bg-teal-50 ring-teal-200" : "bg-danger/10 ring-danger/25"
          }`}
        >
          <p
            className={`flex items-center gap-2 text-[13.5px] font-bold ${
              claim.registrationMatches ? "text-teal-800" : "text-danger"
            }`}
          >
            {claim.registrationMatches ? (
              <ShieldCheck className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
            )}
            {claim.registrationMatches
              ? "The registration number matches our record"
              : "The registration number does NOT match our record"}
          </p>
          <dl className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">They supplied</dt>
              <dd className="font-display text-[15px] font-bold text-ink">{claim.registrationNumber}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">We hold</dt>
              <dd className="font-display text-[15px] font-bold text-ink">
                {specialist?.registrationNumber ?? "—"}
                {specialist?.regulator && (
                  <span className="ml-2 text-[12px] font-semibold text-ink-muted">{specialist.regulator.code}</span>
                )}
              </dd>
            </div>
          </dl>
          {!claim.registrationMatches && (
            <p className="mt-3 text-[12px] leading-relaxed text-danger/90">
              Our own record may be wrong — these listings are compiled from public registers. Check the register
              directly before refusing.
            </p>
          )}
        </div>

        {/* ------------------------------------------ claimant */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Claimant</p>
          <p className="mt-1.5 text-[14px] font-bold text-ink">{claim.fullName}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" strokeWidth={2} />
              {claim.email}
            </span>
            {claim.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                {claim.phone}
              </span>
            )}
          </div>
          {claim.message && (
            <p className="mt-2.5 whitespace-pre-wrap rounded-lg bg-paper-muted px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              {claim.message}
            </p>
          )}
        </div>

        {/* -------------------------------- what they'd inherit */}
        {specialist && (
          <div className="rounded-xl bg-paper-muted p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              What transfers on approval
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[13px]">
              <span className="font-bold text-ink">{specialist.fullName}</span>
              {specialist.ratingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={2} aria-hidden />
                  {specialist.ratingAvg.toFixed(1)} from {specialist.ratingCount} reviews
                </span>
              )}
              <span className="text-ink-muted">Plan chosen: {claim.plan}</span>
              <a
                href={`/specialists/${specialist.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-bold text-teal-700 hover:underline"
              >
                Open profile
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
              </a>
            </div>
          </div>
        )}

        {/* -------------------------------------------- decision */}
        <div className="border-t border-line-soft pt-4">
          {claim.status !== "pending" ? (
            <p className="text-[13px] text-ink-muted">
              Already {claim.status} by {claim.decidedBy} {relativeTime(claim.decidedAt)}.
              {claim.note && <span className="mt-1 block text-ink">“{claim.note}”</span>}
            </p>
          ) : !decision ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDecision("approve");
                  setNote("");
                  setError(null);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
              >
                <BadgeCheck className="h-4 w-4" strokeWidth={2.5} />
                Approve claim
              </button>
              <button
                type="button"
                onClick={() => {
                  setDecision("reject");
                  setNote("");
                  setError(null);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90"
              >
                <CircleSlash className="h-4 w-4" strokeWidth={2.5} />
                Refuse claim
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-paper-muted p-4">
              <p className="text-[14px] font-bold text-ink">
                {decision === "approve" ? "Hand this profile over?" : "Refuse this claim?"}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                {decision === "approve"
                  ? `${claim.fullName} will be able to edit ${claim.specialistName}, answer its enquiries and reply to its reviews. Existing reviews and rating stay attached.`
                  : "The claimant is emailed your reason in full, so write it for them to read."}
              </p>

              <label className="mt-3 block">
                <span className="mb-1.5 block text-[12.5px] font-bold text-ink">
                  {decision === "approve" ? "Note (optional)" : "Reason"}
                  {decision === "reject" && <span className="ml-1 text-danger">*</span>}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={
                    decision === "approve"
                      ? "e.g. GMC register confirms this registrant."
                      : "e.g. The registration number you gave belongs to a different clinician on the GMC register."
                  }
                  className="w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </label>

              {error && (
                <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
                  {error}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={submitting}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white transition disabled:opacity-50 ${
                    decision === "approve" ? "bg-teal-600 hover:bg-teal-700" : "bg-danger hover:opacity-90"
                  }`}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {decision === "approve" ? "Confirm — hand over" : "Confirm — refuse"}
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
    </Dialog>
  );
}
