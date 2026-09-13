import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  Phone,
  Stethoscope,
  X,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { organisationsApi } from "../../lib/organisationsApi";
import type { OrgApplicationStatus, OrganisationApplication } from "../../lib/organisationsApi";
import { membersApi } from "../../lib/dashboardApi";
import type { MemberRow } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Organisations
 *
 * Hospitals, clinics, pharmacies and care homes are priced on how many
 * clinicians they cover, so they cannot self-serve: they apply, somebody
 * works out a figure, and they pay a link. This screen is that middle
 * step, and it is built around two facts about the work.
 *
 * THE QUEUE IS THE PRODUCT. An organisation that applied is asking to
 * give us money, and the cost of leaving one sitting is higher than any
 * other queue on this site. So the default view is "needs somebody",
 * oldest first, and the age of the oldest unanswered application is the
 * one number at the top.
 *
 * A QUOTE IS A NUMBER SOMEBODY TYPED. Which makes it the most dangerous
 * input here. The figure is entered in pounds because that is what a
 * person thinks in, VAT is shown as it is typed so nobody has to guess
 * whether they entered a net or gross figure, and the reasoning is
 * captured next to it — "£2,400" is not a record of an agreement,
 * "12 doctors, 2 sites, ClinWell for 4" is.
 * ------------------------------------------------------------------ */

const TABS: { key: OrgApplicationStatus | "needs"; label: string }[] = [
  /* Not a status: the two states that mean "a person has to do
     something", which is how the work is actually thought about. */
  { key: "needs", label: "Needs somebody" },
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "quoted", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "declined", label: "Declined" },
];

const TYPE_LABEL: Record<string, string> = {
  hospital: "Hospital",
  clinic: "Clinic",
  care_home: "Care home",
  pharmacy: "Pharmacy",
};

const STATUS_TONE: Record<OrgApplicationStatus, string> = {
  new: "bg-amber/15 text-amber",
  reviewing: "bg-navy-950/8 text-ink",
  quoted: "bg-teal-50 text-teal-700",
  won: "bg-teal-600 text-white",
  lost: "bg-ink/8 text-ink-muted",
  declined: "bg-rose-50 text-rose-700",
};

const money = (minor: number | null | undefined, currency = "GBP") =>
  minor === null || minor === undefined
    ? "—"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

function StatusPill({ status }: { status: OrgApplicationStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${STATUS_TONE[status]}`}>
      {status === "new" ? "New" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function AdminOrganisations() {
  const [tab, setTab] = useState<OrgApplicationStatus | "needs">("needs");
  const [rows, setRows] = useState<OrganisationApplication[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* Always the whole list. It is filtered in the browser because
         "needs somebody" spans two statuses and the volumes here are
         tens, not thousands — a request per tab would be slower and
         buy nothing. */
      const data = await organisationsApi.list();
      setRows(data.results);
      setCounts(data.counts ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (tab === "needs") return rows.filter((r) => r.status === "new" || r.status === "reviewing");
    return rows.filter((r) => r.status === tab);
  }, [rows, tab]);

  const needsCount = (counts.new ?? 0) + (counts.reviewing ?? 0);

  /* The oldest thing nobody has answered. One number, because it is the
     only one that says whether this queue is being kept on top of. */
  const oldestWaiting = useMemo(() => {
    const waiting = rows
      .filter((r) => r.status === "new" || r.status === "reviewing")
      .map((r) => new Date(r.createdAt).getTime())
      .filter((t) => Number.isFinite(t));
    return waiting.length ? Math.min(...waiting) : null;
  }, [rows]);

  const countFor = (key: OrgApplicationStatus | "needs") => (key === "needs" ? needsCount : (counts[key] ?? 0));

  return (
    <DashboardShell variant="admin" title="Organisations" icon={Building2} eyebrow="Pricing">
      {note && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl bg-teal-50 px-4 py-3 text-[13.5px] font-semibold text-teal-800 ring-1 ring-teal-100">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-ink-muted">
          {needsCount === 0 ? (
            <>Nothing waiting on anybody.</>
          ) : (
            <>
              <strong className="font-bold text-ink">
                {needsCount} {needsCount === 1 ? "organisation is" : "organisations are"}
              </strong>{" "}
              waiting on a quote
              {oldestWaiting && <> — the oldest since {relativeTime(new Date(oldestWaiting).toISOString())}</>}.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border-2 border-ink/10 px-4 py-2 text-[12.5px] font-bold text-ink transition hover:border-ink/20"
        >
          Refresh
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-bold transition ${
              tab === t.key ? "bg-navy-950 text-white" : "bg-white text-ink ring-1 ring-ink/10 hover:ring-ink/20"
            }`}
          >
            {t.label}
            <span className={tab === t.key ? "text-white/60" : "text-ink-faint"}>{countFor(t.key)}</span>
          </button>
        ))}
      </div>

      <Panel title={tab === "needs" ? "Waiting on a quote" : TABS.find((t) => t.key === tab)?.label}>
        {loading && <LoadingBlock label="Loading applications…" />}
        {error && !loading && <ErrorBlock message={error} onRetry={() => void load()} />}
        {!loading && !error && visible.length === 0 && (
          <EmptyState
            icon={Building2}
            title={tab === "needs" ? "Nothing waiting" : "Nothing here"}
            body={
              tab === "needs"
                ? "Every organisation that has applied has been quoted or closed."
                : "No applications in this state."
            }
          />
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[820px] border-separate border-spacing-y-1.5 px-2">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  <th className="px-3 pb-1">Organisation</th>
                  <th className="px-3 pb-1">Scale</th>
                  <th className="px-3 pb-1">Contact</th>
                  <th className="px-3 pb-1">Quote</th>
                  <th className="px-3 pb-1">Applied</th>
                  <th className="px-3 pb-1" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="bg-white align-middle shadow-sm ring-1 ring-ink/5">
                    <td className="rounded-l-xl px-3 py-3">
                      <span className="block text-[13.5px] font-bold text-ink">{row.organisationName}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-muted">
                        {TYPE_LABEL[row.organisationType] ?? row.organisationType}
                        {row.needsClinwell && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-bold text-teal-700">
                            <Stethoscope className="h-3 w-3" strokeWidth={2.5} />
                            ClinWell
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-ink">
                      {/* The pricing input, first column after the name,
                          because it is the thing a quote is worked out
                          from. "Not given" is stated rather than shown
                          as a dash: it is a thing to go and ask. */}
                      {row.doctorCount ? (
                        <span className="font-semibold">{row.doctorCount} clinicians</span>
                      ) : (
                        <span className="text-ink-faint">count not given</span>
                      )}
                      {row.siteCount ? <span className="block text-[11.5px] text-ink-muted">{row.siteCount} sites</span> : null}
                    </td>
                    <td className="px-3 py-3 text-[12.5px]">
                      <span className="block font-semibold text-ink">{row.contactName}</span>
                      <a href={`mailto:${row.contactEmail}`} className="block text-[11.5px] text-teal-700 hover:underline">
                        {row.contactEmail}
                      </a>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] font-semibold text-ink">
                      {row.quotedNetMinor ? (
                        <>
                          {money(row.quotedNetMinor, row.quotedCurrency)}
                          <span className="block text-[11px] font-medium text-ink-muted">
                            {row.quotedInterval === "monthly" ? "a month" : "a year"} · net
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[12px] text-ink-muted">{relativeTime(row.createdAt)}</td>
                    <td className="rounded-r-xl px-3 py-3 text-right">
                      <span className="mr-3 inline-block align-middle">
                        <StatusPill status={row.status} />
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpen(row.id)}
                        className="rounded-full bg-navy-950 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-navy-900"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {open && (
        <ApplicationDrawer
          id={open}
          onClose={() => setOpen(null)}
          onChanged={(message) => {
            setNote(message);
            void load();
          }}
        />
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * One application
 *
 * Everything they told us, then the three things that can be done
 * about it: quote, move, or take payment. Ordered that way because it
 * is the order the work happens in, and because taking payment before
 * a quote exists is refused by the server anyway.
 * ------------------------------------------------------------------ */

function ApplicationDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (note: string) => void;
}) {
  const [application, setApplication] = useState<OrganisationApplication | null>(null);
  const [history, setHistory] = useState<OrganisationApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await organisationsApi.get(id);
      setApplication(data.application);
      setHistory(data.history ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that application.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-navy-950/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Organisation application"
        className="relative h-full w-full max-w-[560px] overflow-y-auto bg-paper shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white px-6 py-5">
          <div className="min-w-0">
            {application ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  {TYPE_LABEL[application.organisationType] ?? application.organisationType}
                </p>
                <h2 className="mt-0.5 truncate font-display text-[22px] font-bold text-ink">
                  {application.organisationName}
                </h2>
              </>
            ) : (
              <h2 className="font-display text-[22px] font-bold text-ink">Application</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-ink-muted transition hover:bg-paper-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="space-y-5 p-6">
          {loading && <LoadingBlock label="Loading…" />}
          {error && !loading && <ErrorBlock message={error} onRetry={() => void load()} />}

          {application && !loading && (
            <>
              <WhatTheyTold application={application} />
              <QuoteBox
                application={application}
                onQuoted={(message) => {
                  onChanged(message);
                  void load();
                }}
              />
              <PaymentBox
                application={application}
                onSent={(message) => {
                  onChanged(message);
                  void load();
                }}
              />
              <MoveBox
                application={application}
                onMoved={(message) => {
                  onChanged(message);
                  void load();
                }}
              />

              {history.length > 0 && (
                <Panel title={`Also from ${application.contactEmail}`}>
                  {/* A second application from one address is usually a
                      follow-up. Quoting it as if it were new is how the
                      same hospital gets two different figures. */}
                  <ul className="space-y-2">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">{h.organisationName}</span>
                          <span className="text-[11.5px] text-ink-muted">{relativeTime(h.createdAt)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {h.quotedNetMinor ? (
                            <span className="text-[11.5px] font-semibold text-ink-muted">
                              {money(h.quotedNetMinor, h.quotedCurrency)}
                            </span>
                          ) : null}
                          <StatusPill status={h.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="w-[110px] shrink-0 text-[11.5px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-ink">{children}</span>
    </div>
  );
}

function WhatTheyTold({ application }: { application: OrganisationApplication }) {
  return (
    <Panel title="What they told us">
      <div className="divide-y divide-line">
        <Row label="Scale">
          {application.doctorCount ? (
            <strong className="font-bold">{application.doctorCount} clinicians</strong>
          ) : (
            /* Named as a gap rather than left blank: this is the number
               the price comes from, so a missing one is the first thing
               to go back and ask for. */
            <span className="text-amber">Clinician count not given — ask before quoting</span>
          )}
          {application.siteCount ? <span className="text-ink-muted"> · {application.siteCount} sites</span> : null}
        </Row>

        <Row label="ClinWell">
          {application.needsClinwell ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-teal-700">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              Wanted
            </span>
          ) : (
            <span className="text-ink-muted">Not asked for</span>
          )}
        </Row>

        {(application.specialties ?? []).length > 0 && (
          <Row label="Specialties">
            <span className="flex flex-wrap gap-1.5">
              {(application.specialties ?? []).map((s) => (
                <span key={s} className="rounded-full bg-navy-950/5 px-2.5 py-0.5 text-[11.5px] font-semibold">
                  {s}
                </span>
              ))}
            </span>
          </Row>
        )}

        <Row label="Contact">
          <span className="block font-semibold">
            {application.contactName}
            {application.contactRole ? <span className="font-normal text-ink-muted"> · {application.contactRole}</span> : null}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <a href={`mailto:${application.contactEmail}`} className="inline-flex items-center gap-1.5 text-teal-700 hover:underline">
              <Mail className="h-3.5 w-3.5" strokeWidth={2.5} />
              {application.contactEmail}
            </a>
            {application.contactPhone && (
              <a href={`tel:${application.contactPhone}`} className="inline-flex items-center gap-1.5 text-teal-700 hover:underline">
                <Phone className="h-3.5 w-3.5" strokeWidth={2.5} />
                {application.contactPhone}
              </a>
            )}
          </span>
        </Row>

        {application.websiteUrl && (
          <Row label="Website">
            <a
              href={application.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-teal-700 hover:underline"
            >
              {application.websiteUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
            </a>
          </Row>
        )}

        {application.notes && (
          <Row label="Notes">
            <span className="whitespace-pre-wrap leading-relaxed text-ink-muted">{application.notes}</span>
          </Row>
        )}

        <Row label="Applied">{relativeTime(application.createdAt)}</Row>
      </div>
    </Panel>
  );
}

const VAT_RATE = 0.2;
const inputClass =
  "w-full rounded-xl border-2 border-ink/10 bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition focus:border-teal-600";

function QuoteBox({
  application,
  onQuoted,
}: {
  application: OrganisationApplication;
  onQuoted: (note: string) => void;
}) {
  const [amount, setAmount] = useState(application.quotedNetMinor ? String(application.quotedNetMinor / 100) : "");
  const [plan, setPlan] = useState(application.quotedPlan ?? (application.needsClinwell ? "clinwell" : "premium"));
  const [interval, setIntervalValue] = useState(application.quotedInterval ?? "yearly");
  const [note, setNote] = useState(application.quoteNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Shown as it is typed, so nobody has to wonder whether the figure
     they entered was net or gross. Somebody entering £2,880 meaning
     "including VAT" sees £3,456 appear and corrects themselves — which
     is a mistake that otherwise surfaces as a hospital querying its
     invoice. */
  const net = Number(amount) > 0 ? Math.round(Number(amount) * 100) : 0;
  const vat = Math.round(net * VAT_RATE);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await organisationsApi.quote(application.id, {
        amount: Number(amount),
        plan,
        interval: interval as "monthly" | "yearly",
        note: note.trim() || undefined,
      });
      onQuoted(`Quoted ${application.organisationName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={application.quotedNetMinor ? "The quote" : "Quote them"}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="block text-[12.5px] font-bold text-ink">Net figure, excluding VAT</span>
            <span className="mt-1.5 flex items-center gap-2">
              <span className="text-[15px] font-bold text-ink-muted">£</span>
              <input
                required
                type="number"
                min={1}
                step="1"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2400"
              />
            </span>
          </label>
          <label className="block">
            <span className="block text-[12.5px] font-bold text-ink">Billed</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value as "monthly" | "yearly")}
            >
              <option value="yearly">Yearly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-[12.5px] font-bold text-ink">Tier</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">
            Only the price is negotiated — the tier still decides what they get.
          </span>
          <select className={`${inputClass} mt-1.5`} value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
            <option value="premium">Premium Listing</option>
            <option value="clinwell">Full Practice Suite (with ClinWell)</option>
            <option value="basic">Basic</option>
          </select>
        </label>

        {net > 0 && (
          <div className="rounded-xl bg-paper-muted px-4 py-3 text-[12.5px]">
            <span className="flex justify-between">
              <span className="text-ink-muted">Net</span>
              <span className="font-semibold text-ink">{money(net)}</span>
            </span>
            <span className="mt-1 flex justify-between">
              <span className="text-ink-muted">VAT at 20%</span>
              <span className="font-semibold text-ink">{money(vat)}</span>
            </span>
            <span className="mt-2 flex justify-between border-t border-line pt-2">
              <span className="font-bold text-ink">They pay</span>
              <span className="font-bold text-ink">
                {money(net + vat)} {interval === "monthly" ? "a month" : "a year"}
              </span>
            </span>
          </div>
        )}

        <label className="block">
          <span className="block text-[12.5px] font-bold text-ink">What was agreed</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">
            In words. The figure alone is not a record of the agreement.
          </span>
          <textarea
            rows={3}
            className={`${inputClass} mt-1.5`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="12 doctors, 2 sites, ClinWell for 4"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !amount}
            className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-600 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {application.quotedNetMinor ? "Update the quote" : "Save the quote"}
          </button>
          {application.quotedAt && (
            <span className="text-[11.5px] text-ink-muted">Last quoted {relativeTime(application.quotedAt)}</span>
          )}
        </div>
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Taking the money
 *
 * Needs a listing, because an organisation pays for a listing — the
 * subscription, its renewal date and its ClinWell entitlement all hang
 * off one. The server refuses without it rather than creating an order
 * with nothing to activate.
 * ------------------------------------------------------------------ */
function PaymentBox({
  application,
  onSent,
}: {
  application: OrganisationApplication;
  onSent: (note: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MemberRow[]>([]);
  const [chosen, setChosen] = useState<MemberRow | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ready = Boolean(application.quotedNetMinor && application.quotedPlan);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await membersApi.list({ q: query.trim(), pageSize: 8 });
        if (live) setMatches(data.results ?? []);
      } catch {
        if (live) setMatches([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  async function send() {
    if (!chosen) return;
    setError(null);
    setBusy(true);
    setLink(null);
    try {
      const result = await organisationsApi.paymentLink(application.id, chosen.id);
      setLink(result.paymentUrl);
      onSent(`Payment link ready for ${application.organisationName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a payment link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Take payment">
      {!ready && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Agree a quote first. A payment link charges the agreed figure, so there has to be one.
        </p>
      )}

      {ready && (
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Charges{" "}
            <strong className="font-bold text-ink">
              {money(
                (application.quotedNetMinor ?? 0) + Math.round((application.quotedNetMinor ?? 0) * VAT_RATE),
                application.quotedCurrency
              )}
            </strong>{" "}
            including VAT, {application.quotedInterval === "monthly" ? "monthly" : "yearly"}. The subscription attaches
            to a listing — search for theirs.
          </p>

          {chosen ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-paper-muted px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-ink">{chosen.fullName}</span>
                <span className="block truncate text-[11.5px] text-ink-muted">/{chosen.slug}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  setLink(null);
                }}
                className="shrink-0 text-[12px] font-bold text-teal-700 hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              <input
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search listings by name, email or town…"
              />
              {searching && <p className="mt-2 text-[12px] text-ink-muted">Searching…</p>}
              {matches.length > 0 && (
                <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl ring-1 ring-ink/10">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setChosen(m)}
                        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-2.5 text-left transition hover:bg-paper-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-ink">{m.fullName}</span>
                          <span className="block truncate text-[11.5px] text-ink-muted">/{m.slug}</span>
                        </span>
                        <span className="shrink-0 text-[11px] font-bold uppercase text-ink-faint">{m.planName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
              {error}
            </p>
          )}

          {link ? (
            <div className="rounded-xl bg-teal-50 p-4 ring-1 ring-teal-100">
              <p className="text-[12.5px] font-bold text-teal-800">Send them this link</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={link} className={`${inputClass} font-mono text-[11.5px]`} />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="shrink-0 rounded-xl bg-teal-700 px-3 text-white transition hover:bg-teal-600"
                  aria-label="Copy link"
                >
                  {copied ? <Check className="h-4 w-4" strokeWidth={3} /> : <Copy className="h-4 w-4" strokeWidth={2.5} />}
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-teal-800/80">
                They become Won when the payment clears, not before — the webhook does that.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!chosen || busy}
              className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-navy-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" strokeWidth={2.5} />}
              Create a payment link
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

function MoveBox({
  application,
  onMoved,
}: {
  application: OrganisationApplication;
  onMoved: (note: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* "Won" is deliberately absent. An organisation becomes won by
     paying, and the server refuses to set it by hand — a plan with no
     order behind it is invisible until somebody reconciles the books. */
  const moves: { status: OrgApplicationStatus; label: string; tone?: "danger" }[] = [
    { status: "reviewing", label: "Working on it" },
    { status: "lost", label: "Went elsewhere" },
    { status: "declined", label: "Declined", tone: "danger" },
  ];

  async function move(status: OrgApplicationStatus) {
    setError(null);
    setBusy(status);
    try {
      await organisationsApi.setStatus(application.id, status);
      onMoved(`${application.organisationName} marked ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Where it stands">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={application.status} />
        {moves
          .filter((m) => m.status !== application.status)
          .map((m) => (
            <button
              key={m.status}
              type="button"
              onClick={() => void move(m.status)}
              disabled={busy !== null}
              className={`rounded-full border-2 px-4 py-2 text-[12.5px] font-bold transition disabled:opacity-50 ${
                m.tone === "danger"
                  ? "border-rose-200 text-rose-700 hover:border-rose-300"
                  : "border-ink/10 text-ink hover:border-ink/20"
              }`}
            >
              {busy === m.status ? "…" : m.label}
            </button>
          ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">
        Won is not here on purpose: an organisation becomes won by paying, through the link above.
      </p>
    </Panel>
  );
}
