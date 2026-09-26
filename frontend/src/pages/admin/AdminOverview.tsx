import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleSlash,
  Clock3,
  CreditCard,
  Mail,
  MapPin,
  MessageSquareQuote,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, initials, relativeTime } from "../../components/dashboard/ui";
import { ActivityChart } from "../../components/admin/ActivityChart";
import { adminApi, membersApi, systemApi } from "../../lib/dashboardApi";
import type { AdminOverview as AdminOverviewData, SystemLine } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";
import heroImg from "../../assets/images/admin-hero.webp";

/* ------------------------------------------------------------------ *
 * The admin dashboard
 *
 * Three bands, in the order the questions get asked: what needs me
 * today, what has been happening, and what is the state of the place.
 *
 * The photograph at the top is doing a job rather than decorating: this
 * console is where somebody decides whether a real clinician appears in
 * front of real patients, and opening on a clinician's face — behind a
 * wash of brand colour so the words stay first — is a truer welcome than
 * another grey bar. Every number beneath it is measured; nothing on this
 * page is a placeholder figure, and where a thing is not switched on it
 * says so plainly instead of showing a green tick.
 * ------------------------------------------------------------------ */

const ACTION_LABEL: Record<string, string> = {
  submitted: "applied to join",
  approved: "was approved",
  verified: "was approved",
  rejected: "was not approved",
  info_requested: "was asked for more information",
  suspended: "was suspended",
  reinstated: "was reinstated",
  unverified: "was set back to unverified",
};

const ACTION_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  submitted: UserPlus,
  approved: BadgeCheck,
  verified: BadgeCheck,
  rejected: CircleSlash,
  info_requested: CircleAlert,
  suspended: CircleSlash,
  reinstated: BadgeCheck,
};

/** Greeting by the clock, because "Good morning" at 9pm reads as canned. */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------ tiles */

const TILE_TONES = {
  amber: { chip: "bg-amber/12 text-amber", rule: "bg-amber" },
  teal: { chip: "bg-teal-50 text-teal-700", rule: "bg-teal-500" },
  navy: { chip: "bg-navy-950/8 text-navy-800", rule: "bg-navy-800" },
  violet: { chip: "bg-paper-tint text-teal-700", rule: "bg-teal-600" },
} as const;

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  to,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number | string;
  sub: string;
  tone: keyof typeof TILE_TONES;
  to: string;
}) {
  const t = TILE_TONES[tone];
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-teal-300"
    >
      {/* The colour is a stripe rather than a fill: four saturated cards
          in a row compete with each other and with the status chips in
          the tables below. */}
      <span className={`absolute inset-x-0 top-0 h-[3px] ${t.rule}`} aria-hidden />
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.chip}`}>
        <Icon className="h-[19px] w-[19px]" strokeWidth={2} />
      </span>
      <p className="mt-4 font-display text-[30px] font-bold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-2 text-[13px] font-bold text-ink">{label}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-faint">{sub}</p>
      <ArrowRight
        className="absolute bottom-5 right-5 h-4 w-4 text-ink-faint opacity-0 transition group-hover:opacity-100"
        strokeWidth={2.5}
        aria-hidden
      />
    </Link>
  );
}

/* ------------------------------------------------------- system card */

function SystemRow({ name, line }: { name: string; line: SystemLine }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${line.ok ? "bg-teal-500" : "bg-amber"}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-muted">{name}</span>
          <span className={`text-[12.5px] font-bold ${line.ok ? "text-ink" : "text-amber"}`}>{line.label}</span>
        </span>
        {line.note && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-faint">{line.note}</span>}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------ page */

export default function AdminOverview() {
  const { account } = useAuth();
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [memberCounts, setMemberCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* The test-email control. It lives on the dashboard rather than in a
     settings screen because the question it answers — "is email actually
     going out?" — is asked in the same breath as "what needs doing", and
     because the honest answer changes the moment credentials are added. */
  const [testTo, setTestTo] = useState(account?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ sent: boolean; message: string } | null>(null);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await systemApi.sendTestEmail(testTo.trim());
      setTestResult({ sent: res.sent, message: res.message });
    } catch (err) {
      setTestResult({ sent: false, message: err instanceof Error ? err.message : "That did not go through" });
    } finally {
      setTesting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview, members] = await Promise.all([
        adminApi.overview(),
        // A shortcut panel must not be able to take the dashboard down.
        membersApi.list({ pageSize: 1 }).catch(() => null),
      ]);
      setData(overview);
      setMemberCounts(members?.counts ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the admin dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = (account?.fullName ?? "").split(" ")[0] || "there";

  /* Defended against an older API. These four blocks were added after
     the first version of this screen shipped, and a dashboard that
     white-screens because the server it is talking to predates them is a
     worse failure than a dashboard with one panel missing. */
  const trend = data?.trend ?? { days: [], window: 0, empty: true };
  const specialties = data?.topSpecialties ?? [];
  const enquiries = data?.recentEnquiries ?? [];
  const system = data?.system ?? null;
  const counts = data?.counts;
  const waiting = counts?.pendingVerification ?? 0;

  return (
    <DashboardShell variant="admin" title="Dashboard" hideHeading>
      {/* ================================================== welcome */}
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-teal-50">
        <img
          src={heroImg}
          alt=""
          className="absolute inset-y-0 right-0 h-full w-[58%] object-cover object-[42%_28%]"
        />
        {/* Two washes, not one: a horizontal fade that keeps the left half
            solid enough for text at any width, and a light tint over the
            photograph so it reads as brand rather than stock. */}
        <div className="absolute inset-0 bg-gradient-to-r from-teal-50 via-teal-50/95 to-teal-50/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent" />

        <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div className="max-w-[46ch]">
            <p className="text-[12.5px] font-bold text-teal-700">
              {greeting()}, {firstName} 👋
            </p>
            <h1 className="mt-2 font-display text-[27px] font-bold leading-[1.12] text-ink sm:text-[34px]">
              Welcome back to Top Local Specialists
            </h1>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">
              {waiting > 0 ? (
                <>
                  <strong className="font-bold text-ink">
                    {waiting} application{waiting === 1 ? "" : "s"}
                  </strong>{" "}
                  {waiting === 1 ? "is" : "are"} waiting on you. Nothing is visible to patients until you approve it.
                </>
              ) : (
                <>
                  Nothing is waiting for a decision. Verify credentials, moderate reviews and keep the directory
                  honest — every listing here was checked by a person first.
                </>
              )}
            </p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link
                to="/admin/verifications"
                className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-navy-900"
              >
                <ShieldCheck className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                {waiting > 0 ? "Review the queue" : "Verification centre"}
              </Link>
              <Link
                to="/admin/members"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-ink ring-1 ring-line transition hover:ring-teal-300"
              >
                <Users className="h-4 w-4 text-teal-700" strokeWidth={2.5} aria-hidden />
                All members
              </Link>
            </div>
          </div>

        </div>

        {/* The brand line, tucked into the corner rather than floated over
            the photograph's subject — a caption on a face reads as a
            mistake however well it is styled. */}
        <div className="absolute bottom-5 right-5 hidden rounded-2xl bg-white/85 px-4 py-3 shadow-sm backdrop-blur-sm xl:block">
          <p className="font-display text-[14px] font-bold leading-snug text-ink">
            Better specialists.
            <br />
            Healthier communities.
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">
            {counts ? `${counts.verified} verified of ${counts.totalSpecialists} listings` : "Loading the directory…"}
          </p>
        </div>
      </section>

      {loading && <LoadingBlock label="Loading platform data…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {data && !loading && (
        <div className="space-y-5">
          {/* ================================================ tiles */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              icon={Clock3}
              tone="amber"
              label="Pending verification"
              value={data.counts.pendingVerification}
              sub={data.counts.infoRequested > 0 ? `${data.counts.infoRequested} awaiting information` : "Awaiting a decision"}
              to="/admin/verifications"
            />
            <StatTile
              icon={BadgeCheck}
              tone="teal"
              label="Verified specialists"
              value={data.counts.verified}
              sub={`of ${data.counts.totalSpecialists} listings in the directory`}
              to="/admin/members?status=verified"
            />
            <StatTile
              icon={UserPlus}
              tone="navy"
              label="New applications"
              value={data.counts.newRegistrations7d}
              sub="Submitted in the last 7 days"
              to="/admin/members?sort=newest"
            />
            <StatTile
              icon={Mail}
              tone="violet"
              label="Patient enquiries"
              value={data.counts.totalEnquiries}
              sub={`${data.counts.enquiries24h} in the last 24 hours`}
              to="/admin/messages"
            />
          </div>

          {/* ====================================== chart + right rail */}
          <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
            <div className="space-y-5">
              <Panel>
                <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Platform activity</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      Applications submitted against decisions taken.
                    </p>
                  </div>
                  <Link
                    to="/admin/audit"
                    className="inline-flex items-center gap-1 text-[12.5px] font-bold text-teal-700 hover:underline"
                  >
                    Activity log
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </Link>
                </div>

                {trend.empty || trend.days.length < 2 ? (
                  <EmptyState
                    icon={ScrollText}
                    title="Nothing recorded in the last fortnight"
                    body="Applications and decisions are plotted here as they happen. A flat line means a quiet two weeks, not a broken chart."
                  />
                ) : (
                  <ActivityChart days={trend.days} />
                )}
              </Panel>

              <div className="grid gap-5 sm:grid-cols-2">
                <Panel
                  title="Recent decisions"
                  action={
                    <Link
                      to="/admin/verifications"
                      className="text-[12.5px] font-bold text-teal-700 hover:underline"
                    >
                      View all
                    </Link>
                  }
                >
                  {data.recentActivity.length === 0 ? (
                    <EmptyState
                      icon={ShieldCheck}
                      title="No decisions yet"
                      body="Every approval, rejection and suspension is written to an audit trail and appears here."
                    />
                  ) : (
                    <ul className="divide-y divide-line-soft">
                      {data.recentActivity.slice(0, 5).map((entry, i) => {
                        const Icon = ACTION_ICON[entry.action] ?? ShieldCheck;
                        return (
                          <li key={`${entry.specialistId}-${entry.at}-${i}`} className="flex items-start gap-3 py-3">
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper-tint text-[10.5px] font-bold text-teal-700">
                              {ACTION_ICON[entry.action] ? (
                                <Icon className="h-4 w-4" strokeWidth={2} />
                              ) : (
                                initials(entry.specialistName)
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] leading-snug text-ink">
                                <Link
                                  to={`/admin/verifications?open=${entry.specialistId}`}
                                  className="font-bold hover:underline"
                                >
                                  {entry.specialistName}
                                </Link>{" "}
                                <span className="text-ink-muted">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                              </span>
                              <span className="block text-[11.5px] text-ink-faint">
                                {entry.by && entry.by !== entry.specialistName ? `${entry.by} · ` : ""}
                                {relativeTime(entry.at)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>

                <Panel
                  title="Members at a glance"
                  action={
                    <Link to="/admin/members" className="text-[12.5px] font-bold text-teal-700 hover:underline">
                      Open
                    </Link>
                  }
                >
                  {memberCounts ? (
                    <ul className="space-y-2">
                      {[
                        { label: "Never signed in", to: "/admin/members?neverLoggedIn=yes", value: null, icon: UserRound },
                        {
                          label: "Unclaimed listings",
                          to: "/admin/members?claimed=no",
                          value: memberCounts.unclaimed,
                          icon: Users,
                        },
                        {
                          label: "Imported listings",
                          to: "/admin/members?source=imported",
                          value: memberCounts.imported,
                          icon: Stethoscope,
                        },
                        {
                          label: "Deactivated accounts",
                          to: "/admin/members?accountActive=no",
                          value: memberCounts.suspendedAccounts,
                          icon: CircleSlash,
                        },
                      ].map((row) => (
                        <li key={row.label}>
                          <Link
                            to={row.to}
                            className="flex items-center gap-3 rounded-xl bg-paper-muted px-3.5 py-2.5 transition hover:bg-paper-tint"
                          >
                            <row.icon className="h-4 w-4 shrink-0 text-teal-700" strokeWidth={2} aria-hidden />
                            <span className="flex-1 text-[13px] font-semibold text-ink">{row.label}</span>
                            {row.value != null && (
                              <span className="font-display text-[15px] font-bold tabular-nums text-ink">
                                {row.value}
                              </span>
                            )}
                            <ArrowRight className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.5} aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-ink-muted">The members list could not be reached just now.</p>
                  )}
                </Panel>
              </div>

              {specialties.length > 0 && (
                <Panel
                  title="Where the directory is deep"
                  action={
                    <Link to="/admin/members" className="text-[12.5px] font-bold text-teal-700 hover:underline">
                      Filter members
                    </Link>
                  }
                >
                  <p className="-mt-2 mb-4 text-[12.5px] text-ink-muted">
                    Listings by specialty. The solid part of each bar is the share that has been verified.
                  </p>
                  <ul className="space-y-3">
                    {specialties.map((s) => {
                      /* Bar length is this specialty's size against the
                         largest one, so twelve orthopaedic surgeons draw a
                         longer bar than one dentist — a bar scaled to its
                         own total would make every row look identical. */
                      const widest = Math.max(...specialties.map((x) => x.total), 1);
                      const width = Math.max((s.total / widest) * 100, 6);
                      const verifiedShare = s.total ? (s.verified / s.total) * 100 : 0;
                      return (
                        <li key={s.slug}>
                          <Link to={`/admin/members?specialty=${s.slug}`} className="group block">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-[13px] font-semibold text-ink group-hover:text-teal-700">
                                {s.name}
                              </span>
                              <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                                <span className="font-bold text-ink">{s.total}</span> listing{s.total === 1 ? "" : "s"} ·{" "}
                                {s.verified} verified
                              </span>
                            </span>
                            <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-paper-tint">
                              <span
                                className="block h-full rounded-full bg-teal-100"
                                style={{ width: `${width}%` }}
                              >
                                <span
                                  className="block h-full rounded-full bg-teal-500"
                                  style={{ width: `${verifiedShare}%` }}
                                />
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              )}
            </div>

            {/* ------------------------------------------ right rail */}
            <div className="space-y-5">
              <Panel title="What needs doing">
                <ul className="space-y-2">
                  {[
                    {
                      to: "/admin/verifications",
                      icon: ShieldCheck,
                      label: "Verify a specialist",
                      sub: "Check credentials and approve",
                      badge: data.counts.pendingVerification || null,
                    },
                    {
                      to: "/admin/verifications?tab=claims",
                      icon: UserPlus,
                      label: "Review claims",
                      sub: "People claiming an existing listing",
                      badge: null,
                    },
                    {
                      to: "/admin/reviews",
                      icon: MessageSquareQuote,
                      label: "Moderate reviews",
                      sub: "Nothing publishes unread",
                      badge: null,
                    },
                    {
                      to: "/search",
                      icon: MapPin,
                      label: "See the public directory",
                      sub: "What patients actually see",
                      badge: null,
                    },
                  ].map((a) => (
                    <li key={a.label}>
                      <Link
                        to={a.to}
                        className="flex items-center gap-3 rounded-xl bg-paper-muted px-3.5 py-3 transition hover:bg-paper-tint"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-teal-700 ring-1 ring-line">
                          <a.icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-ink">{a.label}</span>
                          <span className="block text-[11.5px] text-ink-faint">{a.sub}</span>
                        </span>
                        {a.badge ? (
                          <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-bold text-amber">
                            {a.badge}
                          </span>
                        ) : (
                          <ArrowRight className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.5} aria-hidden />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>

              {system && (
                <Panel title="System status">
                  <p className="-mt-2 mb-3 text-[12px] text-ink-muted">
                    Read from the running server, not assumed.
                  </p>
                  <ul className="space-y-3">
                    <SystemRow name="Database" line={system.storage} />
                    <SystemRow name="Email delivery" line={system.email} />
                    <SystemRow name="Payments" line={system.payments} />
                    <SystemRow name="Uploads" line={system.media} />
                    <SystemRow name="Maps" line={system.maps} />
                  </ul>

                  {/* Proof, not assertion. This sends one real message
                      through the same path every approval email uses. */}
                  <div className="mt-4 border-t border-line-soft pt-4">
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                      Send a test email
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="email"
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        placeholder="you@yourdomain.com"
                        aria-label="Address to send the test email to"
                        className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                      />
                      <button
                        type="button"
                        onClick={sendTest}
                        disabled={testing || !testTo.trim()}
                        className="shrink-0 rounded-xl bg-navy-950 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-navy-900 disabled:opacity-40"
                      >
                        {testing ? "Sending…" : "Send"}
                      </button>
                    </div>
                    {testResult && (
                      <p
                        role="status"
                        className={`mt-2 text-[12px] leading-relaxed ${
                          testResult.sent ? "text-teal-700" : "text-amber"
                        }`}
                      >
                        {testResult.message}
                      </p>
                    )}
                  </div>
                </Panel>
              )}

              <Panel
                title="Latest enquiries"
                action={
                  <Link to="/admin/messages" className="text-[12.5px] font-bold text-teal-700 hover:underline">
                    View all
                  </Link>
                }
              >
                {enquiries.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-ink-muted">
                    No patient has sent an enquiry yet. They appear here the moment one does.
                  </p>
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {enquiries.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 py-2.5">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper-tint text-[10.5px] font-bold text-ink-muted">
                          {initials(e.patientName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-ink">{e.patientName}</span>
                          <span className="block truncate text-[12px] text-ink-muted">{e.subject}</span>
                          <span className="block text-[11px] text-ink-faint">
                            {e.specialistName
                              ? `to ${e.specialistName} · `
                              : e.facilityName
                                ? `to ${e.facilityName} (facility) · `
                                : ""}
                            {relativeTime(e.createdAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel tone="dark">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-500/15 text-teal-700">
                    <CreditCard className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-[14px] font-bold">Memberships</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">
                      {system?.payments.ok
                        ? "Payments are live. Plan changes take money immediately."
                        : "Payments are simulated in this environment — checkout completes without charging anyone."}
                    </p>
                    <Link
                      to="/admin/members?planStatus=pending_payment"
                      className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-teal-300 hover:underline"
                    >
                      Members awaiting payment
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </Link>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
