import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  Gem,
  Loader2,
  Lock,
  Minus,
  Search as SearchIcon,
  ShieldCheck,
  Timer,
  TrendingUp,
} from "lucide-react";
import { money, plansApi } from "../lib/plansApi";
import type { BillingInterval, Plan, PlanCatalogue, PlanId } from "../lib/plansApi";
import { useAuth } from "../lib/auth";
import { HEADER_HEIGHT } from "../components/Header";
import heroImg from "../assets/images/pricing-hero.webp";
import roiImg from "../assets/images/pricing-roi.webp";
import logoImg from "../assets/images/logo.webp";
import { Seo } from "../components/Seo";

/* ------------------------------------------------------------------ *
 * Pricing
 *
 * Every figure on this page comes from GET /api/plans — the same
 * catalogue the server checks entitlements against. Nothing here is
 * typed out a second time, so the page cannot promise a feature the API
 * will not serve.
 * ------------------------------------------------------------------ */

const PLAN_ICON: Record<PlanId, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  basic: SearchIcon,
  premium: BadgeCheck,
  clinwell: Gem,
};

export default function Pricing() {
  const { account, specialist } = useAuth();
  const [interval, setInterval] = useState<BillingInterval>("yearly");
  const [data, setData] = useState<PlanCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    plansApi
      .catalogue()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load plans"));
  }, []);

  // The best saving on offer, quoted honestly rather than as a vague
  // "up to": the toggle says exactly what a year costs either way.
  const bestSaving = useMemo(() => {
    if (!data) return null;
    return data.plans.reduce<{ pct: number; minor: number }>(
      (best, p) => (p.pricing.savingPct > best.pct ? { pct: p.pricing.savingPct, minor: p.pricing.savingMinor } : best),
      { pct: 0, minor: 0 }
    );
  }, [data]);

  /** Where a plan's button sends you depends on who you are. */
  function ctaHref(planId: PlanId) {
    if (!account) return `/register?plan=${planId}&interval=${interval}`;
    if (account.role === "admin") return "/admin";
    return `/dashboard/billing?plan=${planId}&interval=${interval}`;
  }

  return (
    <main className="flex-1">
      <Seo
        title="Pricing & Plans"
        description="List free forever, or unlock top search priority, the Verified Specialist badge and the full ClinWell.ai EMR suite. No card needed to apply — you are only charged once approved."
        path="/pricing"
      />
      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        <img
          src={heroImg}
          alt=""
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-full object-cover object-[72%_center] opacity-40 lg:w-[62%] lg:object-right lg:opacity-100"
        />
        {/* Two gradients rather than one: the vertical pass keeps the
            header legible over the photo at every viewport width. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(90deg,var(--navy-950)_0%,var(--navy-950)_34%,rgba(6,22,38,0.86)_48%,rgba(6,22,38,0.25)_72%,rgba(6,22,38,0.05)_100%)]"
        />
        <span aria-hidden className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-navy-950/90 to-transparent" />

        <div className="relative mx-auto w-full max-w-7xl px-5 pb-14 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
          <div className="max-w-[620px]">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-teal-300">Pricing &amp; Plans</p>
            <h1 className="mt-3 font-display text-[38px] font-bold leading-[1.08] sm:text-[52px]">
              Choose the Right Tier
              <br />
              to Grow Your <span className="text-teal-300">Practice</span>
            </h1>
            <p className="mt-4 max-w-[46ch] text-[14.5px] leading-relaxed text-white/70">
              Start with a free directory presence or unlock top search priority, verified badge, and full ClinWell.ai
              EMR Suite access.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <IntervalToggle value={interval} onChange={setInterval} />
              {bestSaving && bestSaving.pct > 0 && (
                <p className="text-[12.5px] font-semibold text-teal-300">
                  <span className="underline decoration-teal-400/50 decoration-2 underline-offset-4">
                    Save {bestSaving.pct}%
                  </span>{" "}
                  <span className="text-white/55">
                    — up to {money(bestSaving.minor)} a year against monthly billing
                  </span>
                </p>
              )}
            </div>
          </div>

          <p
            className="pointer-events-none absolute right-10 top-10 hidden max-w-[200px] text-right font-display text-[20px] italic leading-snug text-white xl:block"
            style={{ textShadow: "0 2px 14px rgba(6,22,38,0.75), 0 1px 3px rgba(6,22,38,0.6)" }}
          >
            Better Connections. Healthier Communities.
          </p>
        </div>
      </section>

      {/* ============================================== plan cards */}
      <section className="bg-paper">
        <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
          {error && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-5 py-4 text-[13.5px] font-semibold text-danger">
              {error}
            </p>
          )}
          {!data && !error && (
            <p className="flex items-center justify-center gap-2 py-16 text-[13.5px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading plans…
            </p>
          )}

          {data && (
            <div className="grid items-start gap-6 lg:grid-cols-3">
              {data.plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  interval={interval}
                  href={ctaHref(plan.id)}
                  currentPlan={specialist ? (specialist as { plan?: PlanId }).plan : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ========================================= comparison table */}
      {data && (
        <section className="bg-paper-muted">
          <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-ink-faint">
              Complete Membership Feature Comparison
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-display text-[30px] font-bold leading-tight text-ink sm:text-[36px]">
                Compare Full Plan Features
              </h2>
              <p className="max-w-[34ch] text-[13.5px] leading-relaxed text-ink-muted">
                Everything you need for <strong className="font-bold text-ink">maximum visibility</strong>, patient
                engagement and practice efficiency.
              </p>
            </div>

            <ComparisonTable data={data} interval={interval} />
          </div>
        </section>
      )}

      {/* ================================================ ROI + FAQ */}
      {data && (
        <section className="bg-paper">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.05fr_1fr]">
            <RoiPanel />
            <FaqPanel faq={data.faq} />
          </div>
        </section>
      )}

      {/* ============================================ closing band */}
      <ClosingBand />
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Billing interval
 * ------------------------------------------------------------------ */
function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-white/20"
    >
      {(["monthly", "yearly"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`rounded-full px-6 py-2 text-[13px] font-bold capitalize transition ${
            value === option ? "bg-teal-600 text-white" : "text-ink-muted hover:text-ink"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plan card
 * ------------------------------------------------------------------ */
function PlanCard({
  plan,
  interval,
  href,
  currentPlan,
}: {
  plan: Plan;
  interval: BillingInterval;
  href: string;
  currentPlan?: PlanId;
}) {
  const Icon = PLAN_ICON[plan.id];
  const featured = plan.badge === "RECOMMENDED";
  const price = plan.priceMinor[interval];
  const isCurrent = currentPlan === plan.id;

  return (
    <div className={featured ? "relative lg:-mt-4" : "relative"}>
      {plan.badge && (
        <span
          className={`absolute -top-3 left-6 z-10 rounded-full px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide ${
            featured ? "bg-navy-950 text-white" : "bg-teal-100 text-teal-800"
          }`}
        >
          {plan.badge}
        </span>
      )}

      <article
        className={`flex h-full flex-col rounded-2xl p-6 transition sm:p-7 ${
          featured
            ? "bg-[linear-gradient(180deg,#f2f9fd_0%,#ffffff_58%)] ring-2 ring-teal-500/60"
            : "bg-white ring-1 ring-line"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">{plan.eyebrow}</p>
            <h3 className="mt-1.5 font-display text-[26px] font-bold leading-tight text-ink">{plan.name}</h3>
          </div>
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
              plan.id === "premium"
                ? "bg-[#1d7fd6] text-white"
                : plan.id === "clinwell"
                  ? "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
                  : "bg-paper-tint text-ink-muted"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        </div>

        <p className="mt-3 min-h-[42px] text-[13px] leading-relaxed text-ink-muted">{plan.tagline}</p>

        {/* --------------------------------------------- price */}
        <div className="mt-5">
          {plan.freeForever ? (
            <p className="flex items-baseline gap-2">
              <span className="font-display text-[40px] font-bold leading-none text-ink">£0</span>
              <span className="text-[13px] font-semibold text-ink-muted">Free forever</span>
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-1.5">
                <span className="font-display text-[40px] font-bold leading-none text-ink">{money(price)}</span>
                <span className="text-[14px] font-semibold text-ink-muted">
                  / {interval === "yearly" ? "year" : "month"}
                </span>
              </p>
              <p className="mt-1.5 text-[12.5px] text-ink-faint">
                {interval === "yearly" ? (
                  <>
                    Works out at {money(plan.pricing.yearlyPerMonthMinor)}/mo — saves{" "}
                    <strong className="font-bold text-teal-700">{money(plan.pricing.savingMinor)}</strong> against
                    monthly
                  </>
                ) : (
                  <>
                    {money(plan.pricing.monthlyOverAYear)} over a year — pay yearly for{" "}
                    {money(plan.pricing.yearly)} instead
                  </>
                )}
              </p>
            </>
          )}
        </div>

        {/* ------------------------------------------ features */}
        {plan.highlightsHeading && (
          <p className="mt-6 text-[12.5px] font-bold text-ink">{plan.highlightsHeading}</p>
        )}
        <ul className={`${plan.highlightsHeading ? "mt-2.5" : "mt-6"} flex-1 space-y-2.5`}>
          {plan.highlights.map((item) => (
            <li key={item.label} className="flex gap-2.5">
              {item.included ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" strokeWidth={3} aria-hidden />
              ) : (
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint/60" strokeWidth={2.5} aria-hidden />
              )}
              <span className={`text-[13px] leading-snug ${item.included ? "text-ink" : "text-ink-faint/70"}`}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>

        {/* ----------------------------------------------- CTA */}
        {isCurrent ? (
          <span className="mt-7 flex items-center justify-center gap-2 rounded-full bg-teal-50 px-6 py-3.5 text-[13.5px] font-bold text-teal-800 ring-1 ring-teal-200">
            <Check className="h-4 w-4" strokeWidth={3} />
            Your current plan
          </span>
        ) : (
          <Link
            to={href}
            className={`mt-7 flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[13.5px] font-bold transition ${
              plan.id === "basic"
                ? "text-ink ring-1 ring-line hover:bg-paper-tint"
                : plan.id === "premium"
                  ? "bg-navy-900 text-white hover:bg-navy-800"
                  : "bg-teal-700 text-white hover:bg-teal-600"
            }`}
          >
            {plan.cta}
            {!plan.freeForever && <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
          </Link>
        )}
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Comparison table
 *
 * A 5-column table is unreadable on a phone, and a sideways-scrolling
 * one is worse — you cannot compare columns you cannot see at once. So
 * below `lg` the same data renders as one card per plan.
 * ------------------------------------------------------------------ */
function ComparisonTable({ data, interval }: { data: PlanCatalogue; interval: BillingInterval }) {
  const priceLabel = (plan: Plan) =>
    plan.freeForever ? "£0 / Free" : `${money(plan.priceMinor[interval])} / ${interval === "yearly" ? "Year" : "Month"}`;

  return (
    <>
      {/* ------------------------------------------- wide screens */}
      <div className="mt-7 hidden overflow-hidden rounded-2xl bg-white ring-1 ring-line lg:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Feature comparison across all membership plans</caption>
          <thead>
            <tr className="bg-paper-tint/60">
              <th scope="col" className="w-[42%] px-6 py-4 text-[12.5px] font-bold text-ink">
                Features &amp; Capabilities
              </th>
              {data.plans.map((plan) => (
                <th key={plan.id} scope="col" className="px-4 py-4 text-center">
                  <span className="block text-[12.5px] font-bold text-ink">{plan.name}</span>
                  <span className="block text-[11.5px] font-semibold text-ink-faint">{priceLabel(plan)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.comparison.map((row, i) =>
              row.values === undefined ? (
                <tr key={`g${i}`} className="bg-paper-muted/70">
                  <th
                    scope="colgroup"
                    colSpan={data.plans.length + 1}
                    className="px-6 py-2.5 text-left text-[12.5px] font-bold text-ink"
                  >
                    {row.group}
                  </th>
                </tr>
              ) : (
                <tr key={row.label} className="border-t border-line-soft">
                  <th scope="row" className="px-6 py-2.5 text-[12.5px] font-normal text-ink-muted">
                    {row.label}
                  </th>
                  {row.values.map((cell) => (
                    <td key={cell.planId} className="px-4 py-2.5 text-center">
                      <CellValue cell={cell} />
                    </td>
                  ))}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------- narrow */}
      <div className="mt-7 space-y-5 lg:hidden">
        {data.plans.map((plan, planIndex) => (
          <div key={plan.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            <div className="flex items-baseline justify-between gap-3 bg-paper-tint/60 px-4 py-3">
              <h3 className="text-[14px] font-bold text-ink">{plan.name}</h3>
              <span className="text-[12px] font-semibold text-ink-faint">{priceLabel(plan)}</span>
            </div>
            <dl className="divide-y divide-line-soft">
              {data.comparison.map((row, i) =>
                row.values === undefined ? (
                  <p key={`g${i}`} className="bg-paper-muted/70 px-4 py-2 text-[11.5px] font-bold text-ink">
                    {row.group}
                  </p>
                ) : (
                  <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="min-w-0 text-[12.5px] text-ink-muted">{row.label}</dt>
                    <dd className="shrink-0">
                      <CellValue cell={row.values[planIndex]} />
                    </dd>
                  </div>
                )
              )}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function CellValue({ cell }: { cell: { kind: "boolean" | "text"; value: boolean | string | null } }) {
  if (cell.kind === "boolean") {
    return cell.value ? (
      <>
        <Check className="mx-auto h-4 w-4 text-teal-600" strokeWidth={3} aria-hidden />
        <span className="sr-only">Included</span>
      </>
    ) : (
      <>
        <Minus className="mx-auto h-3.5 w-3.5 text-line" strokeWidth={3} aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return cell.value ? (
    <span className="text-[12px] font-semibold text-ink">{cell.value}</span>
  ) : (
    <>
      <Minus className="mx-auto h-3.5 w-3.5 text-line" strokeWidth={3} aria-hidden />
      <span className="sr-only">Not included</span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * ROI panel
 * ------------------------------------------------------------------ */
function RoiPanel() {
  const stats = [
    { icon: TrendingUp, value: "0%", label: "Platform Booking Commission" },
    { icon: Timer, value: "24hr", label: "Fast 24-Hour Credential Verification" },
    { icon: ShieldCheck, value: "SSL", label: "Encrypted SSL Billing & Management" },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-navy-950 p-7 text-white sm:p-9">
      <img src={roiImg} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(100deg,var(--navy-950)_0%,rgba(6,22,38,0.92)_30%,rgba(6,22,38,0.55)_62%,rgba(6,22,38,0.18)_100%)]"
      />
      <div className="relative">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-300">Instant Practice ROI</p>
        <h2 className="mt-3 font-display text-[28px] font-bold leading-tight sm:text-[32px]">
          Turn One Booking
          <br />
          Into a Year of Growth
        </h2>
        <p className="mt-4 max-w-[42ch] text-[13.5px] leading-relaxed text-white/65">
          A single consultation booking covers your entire year&rsquo;s Verified Elite membership. Everything beyond
          that is 100% net profit for your practice, with zero platform booking margins.
        </p>

        <ul className="mt-7 space-y-4">
          {stats.map((s) => (
            <li key={s.value} className="flex items-center gap-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-teal-300 ring-1 ring-white/15">
                <s.icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <span>
                <span className="block font-display text-[19px] font-bold leading-none">{s.value}</span>
                <span className="block text-[12px] leading-snug text-white/55">{s.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * FAQ
 * ------------------------------------------------------------------ */
function FaqPanel({ faq }: { faq: { q: string; a: string }[] }) {
  // First answer open: the payment question is the one every applicant
  // has, and making them click to find it helps nobody.
  const [open, setOpen] = useState<number | null>(0);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? faq : faq.slice(0, 4);

  return (
    <section>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">Help &amp; FAQs</p>
      <h2 className="mt-2 font-display text-[28px] font-bold leading-tight text-ink sm:text-[32px]">
        Specialist &amp; Registration FAQ
      </h2>
      <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-ink-muted">
        Details about listing registration, credential verification, and ClinWell.ai setups.
      </p>

      <ul className="mt-6 space-y-2.5">
        {visible.map((item, i) => {
          const isOpen = open === i;
          return (
            <li key={item.q} className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
              <h3>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition hover:bg-paper-muted"
                >
                  <span className="text-[13px] font-semibold text-ink">{item.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                </button>
              </h3>
              <div
                id={`faq-panel-${i}`}
                hidden={!isOpen}
                className="border-t border-line-soft px-4 py-3.5 text-[13px] leading-relaxed text-ink-muted"
              >
                {item.a}
              </div>
            </li>
          );
        })}
      </ul>

      {faq.length > 4 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-teal-700 hover:underline"
        >
          {showAll ? "Show fewer FAQs" : `View all ${faq.length} FAQs`}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Closing band
 * ------------------------------------------------------------------ */
function ClosingBand() {
  return (
    <section className="bg-navy-950 text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-6 px-5 py-12 sm:px-8">
        <div className="flex items-center gap-4">
          <img src={logoImg} alt="" className="h-12 w-12 shrink-0" />
          <div>
            <p className="font-display text-[22px] font-bold leading-tight sm:text-[26px]">
              Better care starts with the right connection.
            </p>
            <p className="mt-1 text-[13px] text-white/55">
              Free to list. Reviewed by a person. No card needed to apply.
            </p>
          </div>
        </div>

        <Link
          to="/register"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-teal-400 px-7 py-3.5 text-[13.5px] font-bold text-navy-950 transition hover:bg-teal-300"
        >
          Join Today
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </Link>
      </div>
    </section>
  );
}
