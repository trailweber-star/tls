import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BadgeCheck, ChevronDown, ExternalLink, LayoutDashboard, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../lib/auth";
import { initials } from "./dashboard/ui";

/* ------------------------------------------------------------------ *
 * The header's right-hand slot
 *
 * Signed out it is the way in for specialists; signed in it becomes the
 * account menu. Same position, so the control never appears to move —
 * the button simply changes what it is once you have an account.
 * ------------------------------------------------------------------ */

export function AccountMenu({ dark = false }: { dark?: boolean }) {
  const { account, specialist, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Close on an outside click or Escape, and hand focus back to the
  // button so keyboard users are not dropped at the top of the page.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!account) {
    return (
      <Link
        to="/pricing"
        className={`hidden rounded-full px-5 py-2.5 text-[13px] font-bold shadow-sm transition sm:inline-flex sm:items-center sm:gap-2 ${
          dark ? "bg-teal-400 text-navy-950 hover:bg-teal-300" : "bg-navy-950 text-white hover:bg-teal-700"
        }`}
      >
        Sign up as a Specialist
      </Link>
    );
  }

  const isAdmin = account.role === "admin";
  const dashboardHref = isAdmin ? "/admin" : "/dashboard";
  const displayName = account.fullName;
  const photo = specialist?.photoUrl ?? null;
  const verified = specialist?.verificationStatus === "verified";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-bold transition ${
          dark
            ? "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15"
            : "bg-white text-ink ring-1 ring-line hover:bg-paper-muted"
        }`}
      >
        <Avatar photo={photo} name={displayName} />
        <span className="hidden max-w-[130px] truncate sm:block">{displayName}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2.5}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[268px] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-line"
        >
          <div className="flex flex-col items-center gap-2 px-5 pb-4 pt-5 text-center">
            <Avatar photo={photo} name={displayName} size={56} />
            <p className="mt-1 text-[14px] font-bold leading-tight text-ink">{displayName}</p>
            <p className="max-w-full truncate text-[12.5px] text-ink-muted">{account.email}</p>
            {!isAdmin && specialist && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${
                  verified ? "bg-teal-50 text-teal-700" : "bg-amber/15 text-amber"
                }`}
              >
                <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                {verified ? "Verified specialist" : "Awaiting verification"}
              </span>
            )}
            {isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-paper-tint px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
                Administrator
              </span>
            )}
          </div>

          <div className="border-t border-line-soft py-1.5">
            <MenuLink to={dashboardHref} icon={LayoutDashboard} onClick={() => setOpen(false)}>
              Dashboard
            </MenuLink>
            {!isAdmin && specialist && (
              <>
                <MenuLink to="/dashboard/profile" icon={UserRound} onClick={() => setOpen(false)}>
                  My listing profile
                </MenuLink>
                {/* Only offered once approved — a link to a page that
                    404s while under review reads as a broken site. */}
                {verified && (
                  <MenuLink
                    to={`/specialists/${specialist.slug}`}
                    icon={ExternalLink}
                    onClick={() => setOpen(false)}
                  >
                    View public profile
                  </MenuLink>
                )}
              </>
            )}
          </div>

          <div className="border-t border-line-soft py-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                signOut();
                navigate("/");
              }}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13px] font-bold text-danger transition hover:bg-danger/5"
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
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
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-2.5 text-[13px] font-semibold text-ink transition hover:bg-paper-muted"
    >
      <Icon className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={2} />
      {children}
    </Link>
  );
}

function Avatar({ photo, name, size = 30 }: { photo: string | null; name: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-paper-tint text-[11px] font-bold text-ink-muted ring-1 ring-line"
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            // A dead image URL should fall back to initials, not a
            // broken-image icon in the header.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
