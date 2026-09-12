import { Link } from "react-router-dom";
import { Logo } from "./Header";
import { SocialLinks } from "./SocialLinks";
import { CONTACT_DETAILS } from "../pages/Contact";

/** One footer link. Every column is a list of these, so they align. */
function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <Link to={to} className="transition hover:text-teal-700">
        {children}
      </Link>
    </li>
  );
}

/**
 * Light footer, matching the reference design (it was previously a dark
 * navy slab, which fought the white page).
 *
 * Five columns, not four. The company's registered name, address and
 * contact details used to sit stacked under the brand blurb, which made
 * the first column twice the height of the other three and left the
 * right-hand side of the footer empty. Giving the legal details their
 * own column is what flattens it: every column is now roughly one
 * column's worth of content, and the footer is a band rather than a
 * slab.
 */
export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-paper text-ink-muted">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-ink-muted">
              Verified specialists and care settings, matched to the condition and
              treatment you&apos;re actually looking for — checked against real
              regulator records, not just claims.
            </p>
            <SocialLinks tone="light" className="mt-5" />
          </div>

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">For patients</h3>
            {/* The ways into the one results page, in the order a patient
                is most likely to want them. Each is the same /search
                screen with its tab preselected. */}
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              <FooterLink to="/search">Find a specialist</FooterLink>
              <FooterLink to="/search?type=hospital">Hospitals</FooterLink>
              <FooterLink to="/search?type=clinic">Clinics</FooterLink>
              <FooterLink to="/search?type=care_home">Care homes</FooterLink>
              <FooterLink to="/search?type=pharmacy">Pharmacies</FooterLink>
              <FooterLink to="/blog">Health guides</FooterLink>
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">For professionals</h3>
            {/* Claiming is per-listing — you claim a specific profile
                from its own page, so a generic link here would lead
                nowhere useful. Search is the way in.

                A "List your hospital, clinic or care home" link belongs
                here too, and is deliberately absent until the facility
                sign-up form exists: a footer link to a form nobody can
                complete costs more trust than it earns. */}
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              <FooterLink to="/pricing">Pricing &amp; plans</FooterLink>
              <FooterLink to="/register">Join as a specialist</FooterLink>
              <FooterLink to="/search">Find your existing listing</FooterLink>
              <FooterLink to="/signin">Specialist sign in</FooterLink>
            </ul>
          </div>

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Specialties</h3>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              <FooterLink to="/search?specialty=orthopaedics">Orthopaedics</FooterLink>
              <FooterLink to="/search?specialty=dentistry">Dentistry</FooterLink>
              <FooterLink to="/about">About us</FooterLink>
              <FooterLink to="/contact">Contact us</FooterLink>
            </ul>
          </div>

          {/* A UK company selling to clinicians should say who it is —
              it is also what makes the contact details verifiable. */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              {CONTACT_DETAILS.legalName}
            </h3>
            <address className="mt-4 space-y-2.5 text-[13px] not-italic leading-relaxed text-ink-muted">
              <p>{CONTACT_DETAILS.address.join(", ")}</p>
              <p>
                <a href={`tel:${CONTACT_DETAILS.phoneHref}`} className="transition hover:text-teal-700">
                  {CONTACT_DETAILS.phone}
                </a>
              </p>
              <p className="break-words">
                <a href={`mailto:${CONTACT_DETAILS.email}`} className="transition hover:text-teal-700">
                  {CONTACT_DETAILS.email}
                </a>
              </p>
            </address>
          </div>
        </div>

        {/* The legal row. Kept in the bottom band rather than in a
            column above it because that is where people look for it, and
            because a directory holding patient enquiries and clinician
            records should never make either document hard to find. */}
        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 text-[12px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Top Local Specialists. Not a substitute for professional medical advice.</span>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <FooterLink to="/privacy">Privacy notice</FooterLink>
            <FooterLink to="/terms">Terms of use</FooterLink>
            <FooterLink to="/privacy#cookies">Cookies</FooterLink>
            <FooterLink to="/contact">Contact</FooterLink>
          </ul>
        </div>
      </div>
    </footer>
  );
}
