import { Link } from "react-router-dom";
import { BadgeCheck, ShieldCheck, Users } from "lucide-react";
import logoImg from "../assets/images/logo.webp";
import asideImg from "../assets/images/hero-surgeon.webp";
import { Seo } from "./Seo";

/**
 * Split screen used by sign-in and registration: the form on white paper,
 * a navy panel alongside explaining what joining actually involves. Below
 * `lg` the panel drops away and the form fills the screen.
 */
export function AuthLayout({
  title,
  subtitle,
  aside,
  footer,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  aside: { heading: string; body: string };
  footer?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1fr_minmax(420px,46%)]">
      {/* Account pages carry no public value and would compete with the
          pages that do, so none of them are offered to crawlers. */}
      <Seo title={title} description={subtitle ?? "Top Local Specialists"} noIndex />
      {/* ------------------------------------------------------- form */}
      <div className="flex flex-col px-5 py-8 sm:px-10 lg:px-14">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logoImg} alt="" className="h-10 w-10" />
          <span className="font-display text-[13px] font-bold leading-none text-ink">
            TOP LOCAL
            <br />
            <span className="text-teal-700">SPECIALISTS</span>
          </span>
        </Link>

        <div className="flex flex-1 items-center py-10">
          <div className={`mx-auto w-full ${wide ? "max-w-[620px]" : "max-w-[420px]"}`}>
            <h1 className="font-display text-[26px] font-bold leading-tight text-ink sm:text-[30px]">{title}</h1>
            {subtitle && <p className="mt-2 text-[14px] text-ink-muted">{subtitle}</p>}
            <div className="mt-7">{children}</div>
            {footer && <p className="mt-6 text-center text-[13.5px] text-ink-muted">{footer}</p>}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------ aside */}
      <aside className="relative hidden flex-col justify-center overflow-hidden bg-navy-950 px-12 text-white lg:flex">
        {/* A room the people signing in actually work in, blurred back
            almost to texture. Scaled up because a blur fades out at the
            edges of its own element and would show a pale rim. */}
        <img
          src={asideImg}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-75 blur-[6px]"
        />
        {/* The wash is a left-to-right gradient rather than a flat dim,
            because the text all sits in the left third: it is nearly
            solid navy where the words are and thins out towards the
            edge, so the photograph is still visible as a photograph
            without ever being behind a sentence. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/92 to-navy-950/45"
        />
        <div aria-hidden className="absolute inset-0 bg-navy-950/25" />
        <div
          aria-hidden
          className="absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-teal-500/10 blur-3xl"
        />
        <div aria-hidden className="absolute -bottom-32 -left-20 h-[380px] w-[380px] rounded-full bg-teal-400/5 blur-3xl" />
        <div className="relative max-w-[400px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-teal-300 ring-1 ring-white/15">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            Verified directory
          </span>
          <h2 className="mt-5 font-display text-[28px] font-bold leading-snug">{aside.heading}</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-white/65">{aside.body}</p>

          <ul className="mt-8 space-y-4">
            {[
              { icon: BadgeCheck, text: "Registration numbers checked against the regulator before approval" },
              { icon: Users, text: "Patients enquire directly — replies go straight to their inbox" },
              { icon: ShieldCheck, text: "You control what appears on your public profile" },
            ].map((item) => (
              <li key={item.text} className="flex gap-3">
                <item.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-teal-400" strokeWidth={2} />
                <span className="text-[13.5px] leading-relaxed text-white/75">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Labelled form control. Keeps label/hint/error wiring in one place. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline gap-2 text-[13px] font-bold text-ink">
        {label}
        {optional && <span className="text-[11.5px] font-semibold text-ink-faint">Optional</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[12px] text-ink-faint">{hint}</p>}
      {error && <p className="mt-1.5 text-[12px] font-semibold text-danger">{error}</p>}
    </div>
  );
}
