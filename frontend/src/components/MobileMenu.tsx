import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { initials } from "./dashboard/ui";
import logoImg from "../assets/images/logo.webp";

/* ------------------------------------------------------------------ *
 * The mobile header menu
 *
 * Below `lg` the header is a logo and this button, and everything else —
 * every nav item, sign in, sign up, and the whole account menu — lives
 * in the panel it opens. Before this, the narrow header quietly dropped
 * most of itself: the nav was `hidden lg:flex`, Sign in was `hidden
 * lg:block` and the Sign up button `hidden sm:inline-flex`, so on a
 * phone the site had a logo, a magnifying glass and no way to reach
 * pricing, contact, or an account.
 *
 * The panel takes its links from the same NAV array the desktop bar
 * uses, passed in rather than copied, so the two can never drift.
 * ------------------------------------------------------------------ */

export interface MobileNavItem {
  to: string;
  label: string;
  match: string;
}

export function MobileMenu({
  nav,
  dark = false,
  placeType,
}: {
  nav: MobileNavItem[];
  /** True while the header floats over a dark photo hero. */
  dark?: boolean;
  /** The ?type= of the current search page, for marking the active item. */
  placeType: string;
}) {
  const [open, setOpen] = useState(false);
  const { account, specialist, signOut } = useAuth();
  const { pathname, key: locationKey } = useLocation();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Navigating closes it. Without this, tapping a link leaves the panel
  // sitting over the page you just asked for.
  useEffect(() => {
    setOpen(false);
  }, [locationKey]);

  useEffect(() => {
    if (!open) return;

    // The page behind must not scroll under the panel.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    // Move focus into the panel so a keyboard or screen-reader user is
    // taken to the menu rather than left behind it.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      // Hand focus back to the button that opened it.
      buttonRef.current?.focus();
    };
  }, [open]);

  const isAdmin = account?.role === "admin";
  const verified = specialist?.verificationStatus === "verified";

  function isActive(item: MobileNavItem) {
    if (pathname === "/search") return item.match === (placeType || "/search");
    return item.match.startsWith("/") && pathname.startsWith(item.match);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className={`grid h-10 w-10 place-items-center rounded-full transition lg:hidden ${
          dark ? "text-white/85 hover:bg-white/10 hover:text-white" : "text-ink hover:bg-paper-muted"
        }`}
      >
        <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[90] lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute inset-0 h-full w-full cursor-default bg-navy-950/50 backdrop-blur-sm"
            />

            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col bg-paper shadow-2xl outline-none motion-safe:animate-[slideIn_.22s_ease-out]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
                <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
                  <img src={logoImg} alt="" className="h-9 w-9 shrink-0" />
                  <span className="font-display text-[13px] font-bold leading-none tracking-tight text-ink">
                    TOP LOCAL
                    <br />
                    <span className="text-teal-500">SPECIALISTS</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="grid h-10 w-10 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted hover:text-ink"
                >
                  <X className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
                <ul className="space-y-0.5">
                  {nav.map((item) => (
                    <li key={item.label}>
                      <Link
                        to={item.to}
                        onClick={() => setOpen(false)}
                        aria-current={isActive(item) ? "page" : undefined}
                        className={`block rounded-xl px-4 py-3 text-[15px] font-bold transition ${
                          isActive(item) ? "bg-paper-tint text-teal-700" : "text-ink hover:bg-paper-muted"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link
                      to="/search"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold text-ink transition hover:bg-paper-muted"
                    >
                      <Search className="h-[18px] w-[18px] text-ink-muted" strokeWidth={2} />
                      Search the directory
                    </Link>
                  </li>
                </ul>

                {account && (
                  <div className="mt-4 border-t border-line pt-4">
                    <div className="flex items-center gap-3 px-4 pb-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-tint text-[13px] font-bold text-ink-muted ring-1 ring-line">
                        {specialist?.photoUrl ? (
                          <img src={specialist.photoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          initials(account.fullName)
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-bold text-ink">{account.fullName}</span>
                        <span className="block truncate text-[12.5px] text-ink-muted">{account.email}</span>
                      </span>
                    </div>

                    {!isAdmin && specialist && (
                      <p className="px-4 pb-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${
                            verified ? "bg-teal-50 text-teal-700" : "bg-amber/15 text-amber"
                          }`}
                        >
                          <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                          {verified ? "Verified specialist" : "Awaiting verification"}
                        </span>
                      </p>
                    )}
                    {isAdmin && (
                      <p className="px-4 pb-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-paper-tint px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                          <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
                          Administrator
                        </span>
                      </p>
                    )}

                    <ul className="space-y-0.5">
                      <li>
                        <PanelLink to={isAdmin ? "/admin" : "/dashboard"} icon={LayoutDashboard} onClick={() => setOpen(false)}>
                          Dashboard
                        </PanelLink>
                      </li>
                      {!isAdmin && specialist && (
                        <>
                          <li>
                            <PanelLink to="/dashboard/profile" icon={UserRound} onClick={() => setOpen(false)}>
                              My listing profile
                            </PanelLink>
                          </li>
                          {/* Only once approved — a link to a page that
                              404s while under review reads as broken. */}
                          {verified && (
                            <li>
                              <PanelLink
                                to={`/specialists/${specialist.slug}`}
                                icon={ExternalLink}
                                onClick={() => setOpen(false)}
                              >
                                View public profile
                              </PanelLink>
                            </li>
                          )}
                        </>
                      )}
                    </ul>
                  </div>
                )}
              </nav>

              {/* The actions sit on the panel floor, in thumb reach, and
                  stay put while the links above them scroll. */}
              <div className="border-t border-line bg-white px-5 py-4">
                {account ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      signOut();
                      navigate("/");
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-danger/30 px-5 py-3 text-[14px] font-bold text-danger transition hover:bg-danger/5"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={2} />
                    Log out
                  </button>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <Link
                      to="/pricing"
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-center rounded-full bg-navy-950 px-5 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700"
                    >
                      Sign up as a Specialist
                    </Link>
                    <Link
                      to="/signin"
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-center rounded-full border border-line px-5 py-3 text-[14px] font-bold text-ink transition hover:bg-paper-muted"
                    >
                      Sign in
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function PanelLink({
  to,
  icon: Icon,
  onClick,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl px-4 py-3 text-[14.5px] font-semibold text-ink transition hover:bg-paper-muted"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-ink-muted" strokeWidth={2} />
      {children}
    </Link>
  );
}
