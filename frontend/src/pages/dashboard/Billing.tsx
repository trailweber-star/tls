import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Clock3, CreditCard, ExternalLink, FileText, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { money, plansApi } from "../../lib/plansApi";
import type { BillingInterval, PlanCatalogue, PlanId, SubscriptionResponse } from "../../lib/plansApi";
import { useAuth } from "../../lib/auth";
import { ClinWellPanel } from "../../components/dashboard/ClinWellPanel";

/* ------------------------------------------------------------------ *
 * Plan & billing
 *
 * Two gates stand between an application and a live Premium listing —
 * verification, then payment — and the whole job of this screen is to
 * say which one you are behind and what closes it. Anything vaguer
 * leaves a paying customer guessing why their badge hasn't appeared.
 * ------------------------------------------------------------------ */

const STATUS_COPY: Record<
  SubscriptionResponse["subscription"]["status"],
  { label: string; tone: string; ring: string }
> = {
  active: { label: "Active", tone: "bg-teal-50 text-teal-700", ring: "ring-teal-200" },
  pending_verification: { label: "Awaiting verification", tone: "bg-amber/15 text-amber", ring: "ring-amber/30" },
  pending_payment: { label: "Awaiting payment", tone: "bg-amber/15 text-amber", ring: "ring-amber/30" },
  past_due: { label: "Payment overdue", tone: "bg-danger/10 text-danger", ring: "ring-danger/25" },
  canceled: { label: "Cancelled", tone: "bg-paper-tint text-ink-muted", ring: "ring-line" },
};

export default function Billing() {
  const { refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const welcome = params.get("welcome") === "1";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [sub, cat] = await Promise.all([plansApi.subscription(), plansApi.catalogue()]);
      setData(sub);
      setCatalogue(cat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from the pricing page with ?plan= means "switch me to this".
  useEffect(() => {
    const wanted = params.get("plan");
    if (!wanted || !data) return;
    const interval = (params.get("interval") === "monthly" ? "monthly" : "yearly") as BillingInterval;
    if (wanted === data.subscription.selectedPlan && interval === data.subscription.interval) {
      params.delete("plan");
      params.delete("interval");
      setParams(params, { replace: true });
      return;
    }
    void selectPlan(wanted as PlanId, interval);
    params.delete("plan");
    params.delete("interval");
    setParams(params, { replace: true });
    // Runs once per arrival; selectPlan is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.subscription.selectedPlan]);

  async function selectPlan(planId: PlanId, interval: BillingInterval) {
    setWorking(planId);
    setNotice(null);
    try {
      const res = await plansApi.changePlan(planId, interval);
      await load(true);
      await refresh();
      setNotice(
        res.outcome === "downgraded"
          ? { tone: "ok", text: "You're on the Basic plan. Premium content is hidden, not deleted — it returns if you upgrade again." }
          : res.outcome === "pending_payment"
            ? { tone: "warn", text: "Plan selected. Complete payment below to switch your features on." }
            : { tone: "warn", text: "Plan selected. We'll ask for payment once your application is approved." }
      );
    } catch (err) {
      setNotice({ tone: "warn", text: err instanceof Error ? err.message : "Could not change your plan" });
    } finally {
      setWorking(null);
    }
  }

  async function pay() {
    setWorking("pay");
    setNotice(null);
    try {
      const res = await plansApi.checkout();
      if (res.status === "redirect" && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      if (res.status === "unconfigured") {
        setNotice({
          tone: "warn",
          text: "Your order is recorded, but card payments aren't switched on for this site yet. Connect a payment provider and this button will take you straight to checkout.",
        });
      } else if (res.status === "error") {
        setNotice({ tone: "warn", text: res.reason ?? "Checkout could not be opened." });
      }
      await load(true);
    } catch (err) {
      setNotice({ tone: "warn", text: err instanceof Error ? err.message : "Could not open checkout" });
    } finally {
      setWorking(null);
    }
  }

  async function simulate() {
    setWorking("simulate");
    try {
      // An order has to exist before it can be paid. Opening checkout
      // creates one, so the simulator walks the real path rather than a
      // shortcut that skips the record a webhook would look up.
      await plansApi.checkout().catch(() => undefined);
      await plansApi.simulatePayment();
      await load(true);
      await refresh();
      setNotice({ tone: "ok", text: "Payment recorded and your plan is active. Your upgraded features are live now." });
    } catch (err) {
      setNotice({ tone: "warn", text: err instanceof Error ? err.message : "Could not simulate payment" });
    } finally {
      setWorking(null);
    }
  }

  const sub = data?.subscription;
  const status = sub ? STATUS_COPY[sub.status] : null;

  return (
    <DashboardShell
      title="Plan & billing"
      subtitle="What you're on, what it costs, and what's still outstanding."
      actions={
        <Link
          to="/pricing"
          className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-4 py-2.5 text-[13px] font-bold text-ink ring-1 ring-line transition hover:bg-line-soft"
        >
          Compare plans
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      }
    >
      {loading && <LoadingBlock label="Loading your plan…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={() => load()} />}

      {data && sub && !loading && (
        <div className="space-y-5">
          {welcome && (
            <div className="rounded-2xl bg-teal-500/10 px-5 py-4 ring-1 ring-teal-400/25">
              <p className="text-[13.5px] text-ink">
                <strong className="font-bold text-ink">Application received.</strong> Nothing has been charged. We'll
                review your registration and email you — payment is only asked for once you're approved.
              </p>
            </div>
          )}

          {notice && (
            <p
              role="status"
              className={`rounded-2xl px-5 py-4 text-[13.5px] leading-relaxed ${
                notice.tone === "ok" ? "bg-teal-500/10 text-teal-200 ring-1 ring-teal-400/25" : "bg-amber/10 text-amber ring-1 ring-amber/25"
              }`}
            >
              {notice.text}
            </p>
          )}

          {/* ------------------------------------- current plan */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Your plan</p>
                  <h2 className="mt-1 font-display text-[24px] font-bold leading-tight text-ink">
                    {sub.effectivePlanName}
                  </h2>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {sub.effectivePlan === "basic" && sub.selectedPlan === "basic"
                      ? "Free forever. Upgrade whenever you're ready."
                      : `Billed ${sub.interval}${sub.renewsAt ? ` · renews ${new Date(sub.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}`}
                  </p>
                </div>
                {status && (
                  <span
                    className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${status.tone} ${status.ring}`}
                  >
                    {status.label}
                  </span>
                )}
              </div>

              {/* ------------------------- what's outstanding */}
              {sub.awaitingActivation && (
                <div className="mt-5 rounded-xl bg-amber/10 p-4 ring-1 ring-amber/25">
                  <p className="flex items-center gap-2 text-[13.5px] font-bold text-amber">
                    <Clock3 className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    {sub.selectedPlanName} isn&rsquo;t active yet
                  </p>
                  <ol className="mt-3 space-y-2.5">
                    <GateStep
                      done={sub.verificationStatus === "verified"}
                      title="We verify your registration"
                      body={
                        sub.verificationStatus === "verified"
                          ? "Approved — thank you for your patience."
                          : "A member of our team is checking your details. Most applications are reviewed within two working days."
                      }
                    />
                    <GateStep
                      done={false}
                      disabled={sub.verificationStatus !== "verified"}
                      title="You complete payment"
                      body={
                        sub.verificationStatus === "verified"
                          ? "Your features switch on the moment payment goes through."
                          : "Available once you're approved. Nothing is charged before then."
                      }
                    />
                  </ol>

                  {sub.canPayNow && data.quote && (
                    <div className="mt-4 rounded-xl bg-white p-4">
                      <dl className="space-y-1.5 text-[13px]">
                        <Row label={`${data.quote.planName} (${data.quote.interval})`} value={money(data.quote.netMinor)} />
                        <Row label="VAT at 20%" value={money(data.quote.vatMinor)} />
                        <Row label="Total due today" value={money(data.quote.totalMinor)} strong />
                      </dl>
                      <button
                        type="button"
                        onClick={pay}
                        disabled={working === "pay"}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-5 py-3 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
                      >
                        {working === "pay" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CreditCard className="h-4 w-4" strokeWidth={2.5} />
                        )}
                        Pay {money(data.quote.totalMinor)} and activate
                      </button>

                      {!data.payments.connected && (
                        <button
                          type="button"
                          onClick={simulate}
                          disabled={working === "simulate"}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[12.5px] font-bold text-ink-muted ring-1 ring-line transition hover:bg-paper-tint disabled:opacity-60"
                        >
                          {working === "simulate" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Simulate a successful payment (demo only)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!data.payments.connected && (
                <p className="mt-4 flex gap-2 rounded-xl bg-paper-muted px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.5} />
                  <span>
                    No payment provider is connected to this site yet, so cards cannot be taken. Orders are still
                    recorded, and connecting a provider makes this page take payments without any other change.
                  </span>
                </p>
              )}
            </Panel>

            <ClinWellPanel />
          </div>

          {/* ------------------------------------ change plan */}
          {catalogue && (
            <Panel title="Change plan">
              <div className="grid gap-3 sm:grid-cols-3">
                {catalogue.plans.map((plan) => {
                  const isSelected = plan.id === sub.selectedPlan;
                  const isEffective = plan.id === sub.effectivePlan;
                  return (
                    <div
                      key={plan.id}
                      className={`rounded-xl p-4 ring-1 ${isSelected ? "bg-teal-50 ring-teal-300" : "bg-paper-muted ring-line"}`}
                    >
                      <p className="text-[13.5px] font-bold text-ink">{plan.name}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">
                        {plan.freeForever
                          ? "Free forever"
                          : `${money(plan.priceMinor[sub.interval])} / ${sub.interval === "yearly" ? "year" : "month"}`}
                      </p>
                      {isSelected ? (
                        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-bold text-teal-700">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          {isEffective ? "Current plan" : "Selected — not active yet"}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectPlan(plan.id, sub.interval)}
                          disabled={working === plan.id}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12px] font-bold text-ink ring-1 ring-line transition hover:bg-paper-tint disabled:opacity-60"
                        >
                          {working === plan.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          {plan.priceMinor.yearly === 0 ? "Downgrade" : "Switch to this"}
                          <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
                <p className="text-[12.5px] font-semibold text-ink">Billing interval</p>
                {(["monthly", "yearly"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => selectPlan(sub.selectedPlan, option)}
                    aria-pressed={sub.interval === option}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold capitalize transition ${
                      sub.interval === option ? "bg-teal-600 text-white" : "text-ink-muted ring-1 ring-line hover:bg-paper-tint"
                    }`}
                  >
                    {option}
                  </button>
                ))}
                {catalogue.plans.find((p) => p.id === sub.selectedPlan)?.pricing.savingMinor ? (
                  <p className="text-[12px] text-ink-faint">
                    Yearly saves{" "}
                    <strong className="font-bold text-teal-700">
                      {money(catalogue.plans.find((p) => p.id === sub.selectedPlan)!.pricing.savingMinor)}
                    </strong>{" "}
                    a year on this plan.
                  </p>
                ) : null}
              </div>
            </Panel>
          )}

          {/* -------------------------------------- invoices */}
          <Panel title="Billing history">
            {data.invoices.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-muted">
                No invoices yet. Anything you're charged will be listed here with VAT itemised.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {data.invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-tint text-ink-muted">
                        <FileText className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-bold text-ink">{inv.planName}</span>
                        <span className="block text-[12px] text-ink-faint">
                          {inv.interval} · {relativeTime(inv.paidAt ?? inv.createdAt)} · inc. {money(inv.vatMinor)} VAT
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-[13.5px] font-bold text-ink">{money(inv.totalMinor)}</span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${
                          inv.status === "paid" ? "bg-teal-50 text-teal-700" : "bg-amber/15 text-amber"
                        }`}
                      >
                        {inv.status.replace("_", " ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------- what you get now */}
          <Panel title="What your plan gives you">
            <ul className="grid gap-2 sm:grid-cols-2">
              {FEATURE_LABELS.map(([key, label]) => {
                const on = Boolean(data.features[key as keyof typeof data.features]);
                return (
                  <li key={key} className="flex items-center gap-2.5 text-[13px]">
                    {on ? (
                      <Check className="h-4 w-4 shrink-0 text-teal-600" strokeWidth={3} aria-hidden />
                    ) : (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-ink-faint/60" strokeWidth={2.5} aria-hidden />
                    )}
                    <span className={on ? "text-ink" : "text-ink-faint"}>{label}</span>
                  </li>
                );
              })}
            </ul>
            {data.features.enquiryMonthlyCap != null && (
              <p className="mt-4 flex gap-2 rounded-xl bg-paper-muted px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" strokeWidth={2.5} />
                <span>
                  Your plan takes up to <strong className="font-bold text-ink">{data.features.enquiryMonthlyCap}</strong>{" "}
                  patient enquiries a month. Premium removes the cap and alerts you the moment one arrives.
                </span>
              </p>
            )}
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}

const FEATURE_LABELS: [string, string][] = [
  ["verifiedBadge", "Verified Specialist badge"],
  ["searchPriority", "Top priority in search results"],
  ["publicContactEmail", "Contact email published on your profile"],
  ["photoGallery", "Clinical photo gallery & cover banner"],
  ["videoBio", "Video bio on your profile"],
  ["bookingLink", "Booking / calendar link"],
  ["privateChat", "Private chat with patients"],
  ["reviewReplies", "Reply to patient reviews"],
  ["contentPublishing", "Publish articles, events and jobs"],
  ["subAccounts", "Sub-accounts & multi-practice profiles"],
  ["clinwell", "ClinWell.ai EMR & AI practice suite"],
];

function GateStep({
  done,
  disabled,
  title,
  body,
}: {
  done: boolean;
  disabled?: boolean;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
          done ? "bg-teal-600 text-white" : disabled ? "bg-white text-ink-faint ring-1 ring-line" : "bg-amber text-white"
        }`}
        aria-hidden
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <Clock3 className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13px] font-bold ${disabled ? "text-ink-faint" : "text-ink"}`}>{title}</span>
        <span className="block text-[12.5px] leading-relaxed text-ink-muted">{body}</span>
      </span>
    </li>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-bold text-ink" : "text-ink-muted"}>{label}</dt>
      <dd className={strong ? "font-display text-[16px] font-bold text-ink" : "font-semibold text-ink"}>{value}</dd>
    </div>
  );
}

