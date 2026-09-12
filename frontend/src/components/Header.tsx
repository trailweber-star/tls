import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { AccountMenu } from "./AccountMenu";
import { MobileMenu } from "./MobileMenu";
import { Search } from "lucide-react";
import logoImg from "../assets/images/logo.webp";

/**
 * One results page, four ways in. Each place link lands on the same
 * /search route with its tab preselected, so the header, the search bar
 * tabs and a shared URL all describe the same screen — nothing here
 * routes to a second, parallel directory.
 */
const NAV = [
  { to: "/search", label: "Find a Specialist", match: "/search" },
  { to: "/search?type=hospital", label: "Hospitals", match: "hospital" },
  { to: "/search?type=clinic", label: "Clinics", match: "clinic" },
  { to: "/search?type=care_home", label: "Care Homes", match: "care_home" },
  { to: "/pricing", label: "Pricing", match: "/pricing" },
  { to: "/about", label: "About", match: "/about" },
  /* Guides rather than Contact. Contact appears twice in the footer —
     in its own column and in the legal row — and a directory's header
     is better spent on something a patient will actually click than on
     a link they only look for once they already have a problem. */
  { to: "/blog", label: "Guides", match: "/blog" },
];

// Fixed header height, shared with Home.tsx: the homepage pulls its hero
// up by exactly this much so the (transparent) header floats over the
// dark hero photo, as in the reference design.
export const HEADER_HEIGHT = 72;

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img src={logoImg} alt="Top Local Specialists" className="h-10 w-10 shrink-0 sm:h-11 sm:w-11" />
      {/* The wordmark used to be `hidden sm:inline`, which left a phone
          with a bare roundel and no site name. It fits at 375px next to
          a single menu button, so it stays. */}
      <span
        className={`font-display text-[13px] font-bold leading-none tracking-tight sm:text-[14px] ${
          dark ? "text-white" : "text-ink"
        }`}
      >
        TOP LOCAL
        <br />
        <span className="text-teal-500">SPECIALISTS</span>
      </span>
    </Link>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname, search } = useLocation();
  const { account } = useAuth();
  const placeType = new URLSearchParams(search).get("type") ?? "";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pages whose first section is a dark photo hero sitting directly under
  // the header — there the header starts transparent and only paints
  // itself once you scroll off the hero.
  const DARK_HERO = ["/", "/pricing", "/about"];
  const overHero = DARK_HERO.includes(pathname) && !scrolled;

  return (
    <header
      style={{ height: HEADER_HEIGHT }}
      className={`sticky top-0 z-40 flex items-center transition-colors ${
        overHero ? "border-b border-transparent bg-transparent" : "border-b border-line bg-paper/90 backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Logo dark={overHero} />

        <nav
          className={`hidden items-center gap-5 text-[13px] font-semibold lg:flex xl:gap-7 xl:text-[13.5px] ${
            overHero ? "text-white/75" : "text-ink-muted"
          }`}
        >
          {NAV.map((item) => {
            // NavLink's own `isActive` ignores the query string, so all
            // four /search entries would light up at once. Which place
            // tab you are on lives in ?type=, so that is what decides.
            const active =
              pathname === "/search"
                ? item.match === (placeType || "/search")
                : pathname.startsWith(item.match) && item.match.startsWith("/");
            return (
              <Link
                key={item.label}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`transition ${overHero ? "hover:text-white" : "hover:text-ink"} ${
                  active ? (overHero ? "text-white" : "text-ink") : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {/* Everything in this group is desktop-only. Below `lg` it all
              moves into the off-canvas panel, so a phone gets one clear
              control instead of a row that has quietly dropped most of
              itself to fit. */}
          {!account && (
            <Link
              to="/signin"
              className={`hidden rounded-full px-4 py-2.5 text-[13px] font-bold transition lg:block ${
                overHero ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-ink-muted hover:bg-paper-muted hover:text-ink"
              }`}
            >
              Sign in
            </Link>
          )}
          <Link
            to="/search"
            aria-label="Search"
            className={`hidden h-10 w-10 place-items-center rounded-full transition lg:grid ${
              overHero ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-ink-muted hover:bg-paper-muted hover:text-ink"
            }`}
          >
            <Search className="h-[18px] w-[18px]" strokeWidth={2} />
          </Link>
          <div className="hidden lg:block">
            <AccountMenu dark={overHero} />
          </div>

          <MobileMenu nav={NAV} dark={overHero} placeType={placeType} />
        </div>
      </div>
    </header>
  );
}
