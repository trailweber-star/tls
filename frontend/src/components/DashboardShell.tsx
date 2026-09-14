import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  BarChart3,
  BookOpen,
  CalendarDays,
  CreditCard,
  HeartPulse,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MessageSquareQuote,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
  UserRound,
  Users,
  X,
  Building2,} from "lucide-react";
import { useAuth } from "../lib/auth";
import { initials } from "./dashboard/ui";
import { NotificationBell } from "./dashboard/NotificationBell";
import { Seo } from "./Seo";
import logoImg from "../assets/images/logo.webp";
import sidebarImg from "../assets/images/admin-sidebar.webp";
import type { VerificationStatus } from "../lib/dashboardApi";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  end?: boolean;
  /** Designed, but with no data behind it yet — labelled rather than hidden. */
  soon?: boolean;
}

/** Sections that exist today; the rest are marked so nothing pretends to work. */
const SPECIALIST_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/dashboard/profile", label: "Profile", icon: UserRound },
  { to: "/dashboard/appointments", label: "Appointments", icon: CalendarDays, soon: true },
  { to: "/dashboard/enquiries", label: "Enquiries", icon: Mail },
  { to: "/dashboard/reviews", label: "Reviews", icon: Star },
  { to: "/dashboard/articles", label: "Write a guide", icon: BookOpen },
  { to: "/dashboard/analytics", label: "Analytics", icon: BarChart3, soon: true },
  { to: "/dashboard/messages", label: "Messages", icon: MessageSquare, soon: true },
  { to: "/dashboard/billing", label: "Plan & billing", icon: CreditCard },
  { to: "/dashboard/settings", label: "Account & security", icon: ShieldCheck },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/members", label: "Members", icon: Users },
  /* Directly under Members, because it is the same job at a different
     scale: Members is the individual doctors, Organisations is the
     clinics and hospitals buying for several of them at once. The work
     in both is reading an application and deciding — account work, not
     accounting, which is why it is not filed under billing. */
  { to: "/admin/organisations", label: "Organisations", icon: Building2 },
  { to: "/admin/verifications", label: "Verifications", icon: ShieldCheck },
  { to: "/admin/reviews", label: "Reviews", icon: MessageSquareQuote },
  { to: "/admin/claims", label: "Claims", icon: UserCheck },
  { to: "/admin/messages", label: "Messages", icon: Mail },
  { to: "/admin/articles", label: "Articles", icon: BookOpen },
  { to: "/admin/audit", label: "Activity log", icon: ScrollText },
  /* Last, and below the queues, because it is the one item here that is
     about the administrator rather than about the site. */
  { to: "/admin/settings", label: "Account & security", icon: ShieldCheck },
];

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  pending: "Pending review",
  info_requested: "Information requested",
  rejected: "Not approved",
  suspended: "Suspended",
  unverified: "Unverified",
};

export const STATUS_TONE: Record<VerificationStatus, string> = {
  verified: "bg-teal-500/15 text-teal-300 ring-teal-400/30",
  pending: "bg-amber/15 text-amber ring-amber/30",
  info_requested: "bg-amber/15 text-amber ring-amber/30",
  rejected: "bg-danger/15 text-danger ring-danger/30",
  suspended: "bg-danger/15 text-danger ring-danger/30",
  unverified: "bg-white/10 text-white/60 ring-white/20",
};

/**
 * The professional workspace shell: dark navy ground, fixed left
 * navigation, top bar. Deliberately a different visual identity from the
 * patient-facing site — this is where specialists and admins work.
 */
export function DashboardShell({
  variant = "specialist",
  title,
  subtitle,
  actions,
  children,
  /** For a page that draws its own banner with the title inside it. */
  hideHeading = false,
  /** Small coloured mark beside the title, so each section is recognisable
   *  from the shape of the page rather than only from its heading. */
  icon: PageIcon,
  /** One or two words above the title naming what this section is for. */
  eyebrow,
}: {
  variant?: "specialist" | "admin";
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  hideHeading?: boolean;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  eyebrow?: string;
}) {
  const { account, specialist, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const nav = variant === "admin" ? ADMIN_NAV : SPECIALIST_NAV;
  /* Both workspaces work on a light ground with a navy navigation rail.
     People read long tables and long forms in here all day, and a navy
     sheet behind them tires the eye and makes every status colour shout;
     the rail keeps the product recognisable. `admin` now only decides
     which of the two navigations and which extras are drawn. */
  const admin = variant === "admin";
  const upgradeLabel =
    specialist?.plan === "clinwell"
      ? null
      : specialist?.plan === "premium"
        ? "Upgrade to Full Suite"
        : "Upgrade to Premium";

  function handleSignOut() {
    signOut();
    navigate("/signin", { replace: true });
  }

  /* ------------------------------------------------------ collapsing
     Folded to icons, remembered between visits. Somebody who works in
     this dashboard all day wants the width back for the table; somebody
     who visits weekly wants the labels. Neither should have to say so
     twice, so the choice is stored.

     localStorage throws in a private window and returns nothing after
     site data is cleared, so both ends are wrapped — a preference is
     not worth a blank screen. */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("tls.sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("tls.sidebar.collapsed", collapsed ? "1" : "0");
    } catch {
      /* private browsing — it simply will not be remembered */
    }
  }, [collapsed]);
  // Collapsing is a desktop affordance. On a phone the sidebar is an
  // off-canvas panel that is either open or gone, and a half-width
  // version of it would be neither.
  const railed = collapsed;

  return (
    <div className="flex min-h-screen bg-navy-950 text-ink">
      {/* Behind a login — never indexed. */}
      <Seo title={title} description="Top Local Specialists workspace" noIndex />
      {/* -------------------------------------------------- sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/10 bg-navy-950 text-white transition-[transform,width] lg:static lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        } ${railed ? "w-[248px] lg:w-[72px]" : "w-[248px]"}`}
      >
        <div className={`flex items-center justify-between py-5 ${railed ? "px-5 lg:justify-center lg:px-0" : "px-5"}`}>
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logoImg} alt="" className="h-9 w-9 shrink-0" />
            <span className={`font-display text-[13px] font-bold leading-none ${railed ? "lg:hidden" : ""}`}>
              TOP LOCAL
              <br />
              <span className="text-teal-400">SPECIALISTS</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-full text-white/60 lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              onClick={() => setMenuOpen(false)}
              /* The label is the accessible name whether or not it is
                 drawn, and the title gives a hover tooltip on the rail —
                 an icon nobody can identify is not a navigation. */
              title={railed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-semibold transition ${
                  railed ? "px-3 lg:justify-center lg:px-0" : "px-3"
                } ${isActive ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
              <span className={`flex-1 ${railed ? "lg:hidden" : ""}`}>{item.label}</span>
              {item.soon && (
                <span
                  className={`rounded-full bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white/50 ${
                    railed ? "lg:hidden" : ""
                  }`}
                >
                  Soon
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* A quiet reminder of what the console is for. Hidden on the
            rail, where there is no room for anything but navigation. */}
        {admin && !railed && (
          <div className="relative mx-3 mb-3 hidden overflow-hidden rounded-2xl lg:block">
            <img src={sidebarImg} alt="" className="h-[180px] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/80 to-navy-950/20" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-500/20 text-teal-300">
                <HeartPulse className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <p className="mt-2.5 font-display text-[14px] font-bold leading-snug text-white">
                Every listing here
                <br />
                is a real clinician.
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-white/55">
                Checked by a person before patients ever see it.
              </p>
            </div>
          </div>
        )}

        <div className={`space-y-1 border-t border-white/10 p-3 ${railed ? "lg:px-2" : ""}`}>
          {/* Only offered when there is something above them to buy —
              telling a Full Practice Suite member to upgrade is noise. */}
          {variant === "specialist" && upgradeLabel && (
            <Link
              to="/dashboard/billing"
              title={railed ? upgradeLabel : undefined}
              className={`flex items-center gap-3 rounded-xl bg-teal-500/10 py-2.5 text-[13.5px] font-semibold text-teal-300 ring-1 ring-teal-400/20 transition hover:bg-teal-500/15 ${
                railed ? "px-3 lg:justify-center lg:px-0" : "px-3"
              }`}
            >
              <Sparkles className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
              <span className={railed ? "lg:hidden" : ""}>{upgradeLabel}</span>
            </Link>
          )}
          <a
            href="mailto:support@toplocalspecialists.test"
            title={railed ? "Help & support" : undefined}
            className={`flex items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-semibold text-white/55 transition hover:bg-white/5 hover:text-white ${
              railed ? "px-3 lg:justify-center lg:px-0" : "px-3"
            }`}
          >
            <LifeBuoy className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            <span className={railed ? "lg:hidden" : ""}>Help &amp; support</span>
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            title={railed ? "Log out" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-semibold text-white/55 transition hover:bg-white/5 hover:text-white ${
              railed ? "px-3 lg:justify-center lg:px-0" : "px-3"
            }`}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            <span className={railed ? "lg:hidden" : ""}>Log out</span>
          </button>

          {/* Desktop only: on a phone the sidebar is already either open
              or gone, and a third state would be one too many. */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-pressed={railed}
            title={railed ? "Expand the sidebar" : "Collapse the sidebar"}
            className={`hidden w-full items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-semibold text-white/40 transition hover:bg-white/5 hover:text-white lg:flex ${
              railed ? "justify-center px-0" : "px-3"
            }`}
          >
            {railed ? (
              <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            )}
            <span className={railed ? "hidden" : ""}>Collapse</span>
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-navy-950/70 lg:hidden"
        />
      )}

      {/* ----------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col bg-paper-muted">
        <header
          className="flex items-center gap-4 border-b border-line bg-white px-5 py-3.5 sm:px-7"
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
          </button>

          {/* An administrator's first move is almost always to find one
              person. Giving that a permanent home in the top bar saves a
              trip through the members screen to reach its search box. */}
          {admin && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const term = query.trim();
                navigate(term ? `/admin/members?q=${encodeURIComponent(term)}` : "/admin/members");
              }}
              className="relative hidden min-w-0 max-w-md flex-1 sm:block"
            >
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                strokeWidth={2}
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members, specialties or towns…"
                aria-label="Search members"
                className="w-full rounded-full border border-line bg-paper-muted py-2.5 pl-10 pr-4 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/15"
              />
            </form>
          )}

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              to="/search"
              className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-paper-tint hover:text-ink"
              aria-label="Search the directory"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </Link>
            <NotificationBell tone="light" />
            <span
              className="grid h-9 w-9 place-items-center rounded-full text-ink-faint"
              aria-hidden
            >
              <HelpCircle className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <div className="flex items-center gap-2.5 border-l border-line pl-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-50 text-[12px] font-bold text-teal-700"
              >
                {specialist?.photoUrl ? (
                  <img src={specialist.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(account?.fullName)
                )}
              </span>
              <span className="hidden min-w-0 flex-col sm:flex">
                <span className="truncate text-[13px] font-bold leading-tight">{account?.fullName}</span>
                <span
                  className="flex items-center gap-1 text-[11px] leading-tight text-ink-faint"
                >
                  {variant === "admin" ? (
                    "Administrator"
                  ) : specialist ? (
                    <>
                      <BadgeCheck
                        className={`h-3 w-3 ${specialist.verificationStatus === "verified" ? "text-teal-600" : "text-amber"}`}
                        strokeWidth={2.5}
                      />
                      {STATUS_LABEL[specialist.verificationStatus]}
                    </>
                  ) : (
                    account?.email
                  )}
                </span>
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-6 sm:px-7 sm:py-8">
          <div className="mx-auto w-full max-w-[1240px]">
            {/* The overview draws its own banner, which carries the
                greeting — a second stacked heading above it would be the
                same sentence twice. */}
            {!hideHeading && (
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3.5">
                  {PageIcon && (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-teal-700 shadow-sm ring-1 ring-line">
                      <PageIcon className="h-5 w-5" strokeWidth={2} />
                    </span>
                  )}
                  <div className="min-w-0">
                    {eyebrow && (
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">{eyebrow}</p>
                    )}
                    <h1 className="font-display text-[24px] font-bold leading-tight sm:text-[28px]">{title}</h1>
                    {subtitle && <p className="mt-1 max-w-[70ch] text-[13.5px] text-ink-muted">{subtitle}</p>}
                  </div>
                </div>
                {actions}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** White information surface used throughout the workspace. */
export function Panel({
  title,
  action,
  children,
  className = "",
  padded = true,
  /** "dark" for the occasional navy card. A passed-in background class
   *  cannot be relied on to beat the default one — two classes of equal
   *  specificity resolve by stylesheet order, not by who wrote them
   *  last — so the choice is a prop rather than a className. */
  tone = "light",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Off for panels whose child draws to the edge — lists, tables. */
  padded?: boolean;
  tone?: "light" | "dark";
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl shadow-sm ${
        tone === "dark" ? "bg-navy-950 text-white" : "bg-white text-ink"
      } ${padded ? "p-5 sm:p-6" : ""} ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className={`font-display text-[16px] font-bold ${tone === "dark" ? "text-white" : "text-ink"}`}>
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
