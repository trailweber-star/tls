import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Mail,
  MessageSquare,
  Pencil,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import heroImg from "../../assets/images/dashboard-hero.webp";
import { EmptyState, ErrorBlock, KpiCard, LoadingBlock, ProgressBar, Sparkline, relativeTime, initials } from "../../components/dashboard/ui";
import { VerificationCard } from "../../components/dashboard/VerificationCard";
import { dashboardApi } from "../../lib/dashboardApi";
import type { Overview as OverviewData } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/** "Mr James Whitfield" → "James": drop the honorific, take the first name. */
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "dame"]);

function givenName(fullName: string | undefined | null) {
  const parts = (fullName ?? "").split(/\s+/).filter(Boolean);
  const first = parts.find((w) => !HONORIFICS.has(w.replace(/\.$/, "").toLowerCase()));
  return first ?? "there";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const ENQUIRY_TONE: Record<string, string> = {
  new: "bg-teal-50 text-teal-700",
  responded: "bg-paper-tint text-ink-muted",
  in_progress: "bg-amber/15 text-amber",
  closed: "bg-paper-tint text-ink-faint",
};

export default function DashboardOverview() {
  const { account, specialist } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const justRegistered = params.get("welcome") === "1";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await dashboardApi.overview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = givenName(account?.fullName);

  const verified = specialist?.verificationStatus === "verified";

  return (
    <DashboardShell title={`${greeting()}, ${firstName}`} hideHeading>
      {/* ==================================================== welcome
          The same treatment as the admin console, in the member's own
          register: their name, the one fact that decides whether patients
          can see them at all, and the two things they came here to do. */}
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-navy-950 text-white">
        <img src={heroImg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/92 to-navy-950/75" />

        <div className="relative flex flex-wrap items-end justify-between gap-6 p-6 sm:p-8">
          <div className="max-w-[52ch]">
            <p className="text-[12.5px] font-bold text-teal-300">
              {greeting()}, {firstName} 👋
            </p>
            <h1 className="mt-2 font-display text-[26px] font-bold leading-[1.12] sm:text-[32px]">
              {verified ? "Your profile is live and findable" : "Let's get your profile in front of patients"}
            </h1>
            <p className="mt-2.5 max-w-[46ch] text-[13.5px] leading-relaxed text-white/65">
              {verified
                ? "Patients can find you in search and send enquiries. Keep your details current and they stay accurate everywhere they appear."
                : "Your listing goes live once our team has checked your registration. Filling your profile in now makes that quicker."}
            </p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link
                to="/dashboard/profile"
                className="inline-flex items-center gap-2 rounded-full bg-teal-500 px-5 py-2.5 text-[13px] font-bold text-navy-950 transition hover:bg-teal-400"
              >
                <Pencil className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                Update your profile
              </Link>
              {specialist && (
                <Link
                  to={`/specialists/${specialist.slug}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-[13px] font-bold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                >
                  <Eye className="h-4 w-4" strokeWidth={2} aria-hidden />
                  View public profile
                </Link>
              )}
            </div>
          </div>

          {/* Two numbers they actually care about, on the photograph. */}
          {data && (
            <dl className="hidden gap-8 sm:flex">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Profile views</dt>
                <dd className="mt-1 font-display text-[28px] font-bold leading-none">
                  {data.kpis.profileViews.value}
                  <span className="ml-1.5 text-[12px] font-semibold text-white/45">30 days</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Rating</dt>
                <dd className="mt-1 font-display text-[28px] font-bold leading-none">
                  {data.kpis.rating.count ? data.kpis.rating.value.toFixed(1) : "—"}
                  <span className="ml-1.5 text-[12px] font-semibold text-white/45">
                    {data.kpis.rating.count ? `${data.kpis.rating.count} reviews` : "no reviews yet"}
                  </span>
                </dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      {justRegistered && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-teal-500/10 px-5 py-4 ring-1 ring-teal-400/25">
          <p className="text-[13.5px] text-ink">
            <strong className="font-bold text-ink">Application received.</strong> Complete your profile while our team
            reviews it — the more you fill in, the faster verification goes.
          </p>
          <button
            type="button"
            onClick={() => {
              params.delete("welcome");
              setParams(params, { replace: true });
            }}
            className="rounded-full bg-paper-tint px-3.5 py-1.5 text-[12px] font-bold text-ink transition hover:bg-line-soft"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && <LoadingBlock label="Loading your dashboard…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {data && !loading && (
        <div className="space-y-5">
          {/* ------------------------------- completion + verification */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-[16px] font-bold text-ink">Profile completion</h2>
                  <p className="mt-0.5 text-[13px] text-ink-muted">
                    {data.completion.percent === 100
                      ? "Everything patients look for is filled in."
                      : `${data.completion.missing.length} ${data.completion.missing.length === 1 ? "item" : "items"} left to add.`}
                  </p>
                </div>
                <span className="font-display text-[26px] font-bold leading-none text-teal-700">
                  {data.completion.percent}%
                </span>
              </div>

              <div className="mt-4">
                <ProgressBar percent={data.completion.percent} tone={data.completion.percent < 60 ? "amber" : "teal"} />
              </div>

              {data.completion.missing.length > 0 && (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {data.completion.missing.slice(0, 6).map((item) => (
                    <li key={item.key}>
                      <Link
                        to={`/dashboard/profile#${item.section}`}
                        className="flex items-center gap-2.5 rounded-xl bg-paper-muted px-3 py-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-paper-tint"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.5} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                to="/dashboard/profile"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
                Update profile
              </Link>
            </Panel>

            <VerificationCard
              status={data.specialist.verificationStatus}
              history={data.specialist.verificationHistory}
            />
          </div>

          {/* ------------------------------------------------ KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={CalendarDays}
              tone="slate"
              label="Today's appointments"
              value={data.kpis.todaysAppointments ?? 0}
            />
            <KpiCard
              icon={Mail}
              tone="navy"
              label="New enquiries"
              value={data.kpis.newEnquiries.value}
              delta={data.kpis.newEnquiries.changeFromYesterday}
              deltaLabel="vs. the previous 24 hours"
            />
            <KpiCard
              icon={Eye}
              tone="teal"
              label="Profile views (30 days)"
              value={data.kpis.profileViews.value}
              delta={data.kpis.profileViews.changePct}
              suffix="%"
              deltaLabel="vs. the previous 30 days"
            >
              <Sparkline series={data.kpis.profileViews.series} />
            </KpiCard>
            <KpiCard
              icon={Star}
              tone="amber"
              label="Average rating"
              value={data.kpis.rating.count ? data.kpis.rating.value.toFixed(1) : "—"}
              deltaLabel={
                data.kpis.rating.count
                  ? `From ${data.kpis.rating.count} ${data.kpis.rating.count === 1 ? "review" : "reviews"}`
                  : "No reviews yet"
              }
            />
          </div>

          {/* ------------------------------ appointments + calendar */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel
              title="Today's appointments"
              action={
                <Link
                  to="/dashboard/appointments"
                  className="inline-flex items-center gap-1 text-[12.5px] font-bold text-teal-700 hover:underline"
                >
                  View all
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </Link>
              }
            >
              <EmptyState
                icon={Clock3}
                title={
                  data.kpis.todaysAppointments
                    ? `${data.kpis.todaysAppointments} appointment${data.kpis.todaysAppointments === 1 ? "" : "s"} today`
                    : "Nothing booked for today"
                }
                body="See the full schedule, confirm or cancel a booking, and set the hours patients can book straight from your profile."
                action={
                  <Link
                    to="/dashboard/appointments"
                    className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
                  >
                    <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Go to appointments
                  </Link>
                }
              />
            </Panel>

            <BookingCalendar />
          </div>

          {/* -------------------------- enquiries + quick actions */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel
              title="Recent enquiries"
              action={
                <Link
                  to="/dashboard/enquiries"
                  className="inline-flex items-center gap-1 text-[12.5px] font-bold text-teal-700 hover:underline"
                >
                  View all
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </Link>
              }
            >
              {data.recentEnquiries.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No enquiries yet"
                  body="When a patient sends you a message from your profile, it lands here and in your email."
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {data.recentEnquiries.map((e) => (
                    <li key={e.id}>
                      <Link
                        to={`/dashboard/enquiries?focus=${e.id}`}
                        className="flex items-center gap-3 py-3 transition hover:opacity-80"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-tint text-[12px] font-bold text-ink-muted">
                          {initials(e.patientName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-bold text-ink">{e.patientName}</span>
                          <span className="block truncate text-[12.5px] text-ink-muted">{e.subject}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${ENQUIRY_TONE[e.status] ?? "bg-paper-tint text-ink-muted"}`}
                          >
                            {e.status.replace("_", " ")}
                          </span>
                          <span className="mt-1 block text-[11.5px] text-ink-faint">{relativeTime(e.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <div className="space-y-5">
              <Panel title="Quick actions">
                <ul className="space-y-2">
                  {[
                    { to: "/dashboard/profile", icon: UserRound, label: "Edit your profile" },
                    { to: "/dashboard/enquiries", icon: Mail, label: "Answer enquiries" },
                    { to: "/dashboard/reviews", icon: Star, label: "Read your reviews" },
                    {
                      to: specialist ? `/specialists/${specialist.slug}` : "/search",
                      icon: Eye,
                      label: "See what patients see",
                    },
                  ].map((a) => (
                    <li key={a.label}>
                      <Link
                        to={a.to}
                        className="flex items-center gap-3 rounded-xl bg-paper-muted px-3.5 py-3 text-[13px] font-bold text-ink transition hover:bg-paper-tint"
                      >
                        <a.icon className="h-4 w-4 shrink-0 text-teal-700" strokeWidth={2} />
                        <span className="flex-1">{a.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.5} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>

              <section className="relative overflow-hidden rounded-2xl bg-navy-950 p-5">
                <div
                  aria-hidden
                  className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-500/15 blur-2xl"
                />
                <div className="relative">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-teal-300">
                    <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                    Premium
                  </span>
                  <h2 className="mt-3 font-display text-[17px] font-bold leading-snug text-white">
                    Reach more patients with ClinWell Premium
                  </h2>
                  <ul className="mt-3 space-y-1.5 text-[12.5px] text-white/70">
                    <li className="flex gap-2">
                      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" strokeWidth={2.5} />
                      Priority placement in search results
                    </li>
                    <li className="flex gap-2">
                      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" strokeWidth={2.5} />
                      Full analytics on views and enquiries
                    </li>
                    <li className="flex gap-2">
                      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" strokeWidth={2.5} />
                      Introduction video on your profile
                    </li>
                  </ul>
                  <Link
                    to="/dashboard/upgrade"
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2.5 text-[12.5px] font-bold text-navy-950 transition hover:bg-teal-400"
                  >
                    See plans
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * Booking calendar
 *
 * A real, navigable month grid — it knows today, the weeks and the month
 * boundaries. It carries no invented bookings: there is no appointment
 * model behind it yet, and the footnote says so rather than dotting the
 * grid with fictional patients.
 * ------------------------------------------------------------------ */
function BookingCalendar() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first week, matching UK convention.
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const shift = (by: number) => setCursor(new Date(year, month + by, 1));

  return (
    <Panel
      title="Booking calendar"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition hover:bg-paper-tint"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <span className="min-w-[104px] text-center text-[12.5px] font-bold text-ink">
            {cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition hover:bg-paper-tint"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
            {d}
          </span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`b${i}`} aria-hidden />
          ) : (
            <span
              key={day}
              className={`grid h-8 place-items-center rounded-lg text-[12.5px] font-semibold ${
                isToday(day) ? "bg-teal-600 text-white" : "text-ink-muted"
              }`}
            >
              {day}
            </span>
          )
        )}
      </div>
      <p className="mt-4 border-t border-line-soft pt-3 text-[11.5px] leading-relaxed text-ink-faint">
        Appointments booked through Top Local Specialists will be marked here. Online booking is not switched on for
        your profile yet.
      </p>
    </Panel>
  );
}
