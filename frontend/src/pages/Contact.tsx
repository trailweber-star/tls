import { useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Lock, Mail, MapPin, Phone } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import { Seo, ORGANISATION_JSON_LD } from "../components/Seo";
import { contactApi } from "../lib/contactApi";
import type { ContactTopic } from "../lib/contactApi";
import { ApiError } from "../lib/dashboardApi";
import { SocialLinks } from "../components/SocialLinks";
import heroImg from "../assets/images/contact-hero.webp";

/* ------------------------------------------------------------------ *
 * Contact
 *
 * The form posts to /api/contact, which stores the message, raises it in
 * the admin's notification bell and emails support with reply-to set to
 * the sender. It is a real submission path — the only piece not yet
 * connected is the mailer itself, and the message is recorded either
 * way, so nothing is lost while that is outstanding.
 * ------------------------------------------------------------------ */

export const CONTACT_DETAILS = {
  legalName: "TopLocalSpecialists.com Limited",
  email: "admin@toplocalspecialists.com",
  phone: "01527 919848",
  phoneHref: "+441527919848",
  address: ["27 New Road", "Bromsgrove B60 2JL", "United Kingdom"],
};

const DESKS: { id: ContactTopic; title: string; body: string; cue: string }[] = [
  {
    id: "patient",
    title: "Patient Support",
    body: "Need help finding the right specialist?",
    cue: "Find care with confidence.",
  },
  {
    id: "practitioner",
    title: "Practitioner Support",
    body: "Questions about your profile or verification?",
    cue: "We're here for professionals.",
  },
  {
    id: "partnership",
    title: "Partnerships",
    body: "Interested in working together?",
    cue: "Let's explore the opportunity.",
  },
];

const inputClass =
  "w-full rounded-xl border border-line bg-paper-muted px-4 py-3 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20";

export default function Contact() {
  const [topic, setTopic] = useState<ContactTopic>("patient");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Captured before the await: currentTarget is null by the time an
    // async handler resumes, which would throw on reset() and send a
    // successful submission down the error path.
    const formEl = event.currentTarget;
    const data = new FormData(formEl);

    setStatus("sending");
    setError(null);
    try {
      await contactApi.submit({
        fullName: String(data.get("fullName") ?? ""),
        email: String(data.get("email") ?? ""),
        phone: String(data.get("phone") ?? "") || undefined,
        topic,
        message: String(data.get("message") ?? ""),
        company: String(data.get("company") ?? ""),
      });
      formEl.reset();
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  function focusForm(next: ContactTopic) {
    setTopic(next);
    const el = document.getElementById("contact-form");
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (HEADER_HEIGHT + 16);
    window.scrollTo({ top, behavior: "smooth" });
    window.setTimeout(() => formRef.current?.querySelector("input")?.focus(), 500);
  }

  return (
    <main className="flex-1 bg-paper">
      <Seo
        title="Contact Us"
        description="Questions, support, partnerships or practitioner enquiries — get in touch with the Top Local Specialists team. We reply within one working day."
        path="/contact"
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "ContactPage",
            name: "Contact Top Local Specialists",
            description: "Patient support, practitioner support and partnership enquiries.",
          },
        ]}
      />

      {/* ==================================================== hero */}
      <div>
        <div className="mx-auto w-full max-w-7xl px-5 pt-6 sm:px-8 sm:pt-8">
          <section className="grid overflow-hidden rounded-[1.75rem] bg-navy-950 text-white lg:grid-cols-[1fr_1fr]">
            <div className="flex flex-col justify-center px-7 py-11 sm:px-11 sm:py-16">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-teal-300">We&rsquo;re here to help</p>
              <h1 className="mt-3 font-display text-[34px] font-bold leading-[1.1] sm:text-[46px]">
                Let&rsquo;s Talk About Better Healthcare Access.
              </h1>
              <p className="mt-4 max-w-[40ch] text-[14.5px] leading-relaxed text-white/70">
                Questions, support, partnerships or practitioner enquiries.
              </p>
              <button
                type="button"
                onClick={() => focusForm(topic)}
                className="mt-7 inline-flex w-fit items-center gap-2 rounded-full bg-teal-400 px-7 py-3.5 text-[13.5px] font-bold text-navy-950 shadow-lg transition hover:bg-teal-300"
              >
                Send a Message
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="order-first min-h-[220px] lg:order-none lg:min-h-[400px]">
              <img
                src={heroImg}
                alt="A clinician talking with a patient in a consulting room"
                className="h-full w-full object-cover"
              />
            </div>
          </section>
        </div>
      </div>

      {/* ================================================== desks */}
      <section className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-teal-700">Get in touch</p>
        <h2 className="mt-2 font-display text-[30px] font-bold leading-tight text-ink sm:text-[38px]">
          We&rsquo;re just a message away.
        </h2>
        <p className="mt-2 text-[14px] text-ink-muted">Choose the support that fits your needs.</p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {DESKS.map((desk) => (
            <button
              key={desk.id}
              type="button"
              onClick={() => focusForm(desk.id)}
              aria-pressed={topic === desk.id}
              className={`rounded-2xl bg-white p-6 text-left transition ring-1 ${
                topic === desk.id ? "ring-2 ring-teal-500" : "ring-line hover:ring-teal-300"
              }`}
            >
              <h3 className="font-display text-[18px] font-bold text-ink">{desk.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{desk.body}</p>
              <p className="mt-5 flex items-center gap-1.5 text-[13px] font-bold text-teal-700">
                {desk.cue}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* =========================================== form + details */}
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          {/* ------------------------------------------- form */}
          <div id="contact-form" className="scroll-mt-24 rounded-[1.5rem] bg-white p-7 ring-1 ring-line sm:p-9">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-teal-700">Send us a message</p>
            <h2 className="mt-2 font-display text-[26px] font-bold leading-tight text-ink sm:text-[30px]">
              How can we help?
            </h2>
            <p className="mt-1.5 text-[13.5px] text-ink-muted">
              Our team will get back to you as soon as possible — usually within one working day.
            </p>

            {status === "sent" ? (
              <div className="mt-7 rounded-2xl bg-teal-50 p-6">
                <p className="flex items-center gap-2 text-[15px] font-bold text-teal-900">
                  <Check className="h-4 w-4" strokeWidth={3} />
                  Message sent
                </p>
                <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-teal-900/80">
                  Thank you — we&rsquo;ve got it, and a copy is on its way to your inbox. Someone from the team will
                  reply as soon as possible.
                </p>
                <button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-teal-800 ring-1 ring-teal-200 transition hover:bg-teal-50"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
                {error && (
                  <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
                    {error}
                  </p>
                )}

                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wide text-ink">
                    Full name <span className="text-danger">*</span>
                  </span>
                  <input name="fullName" required autoComplete="name" placeholder="Your name" className={inputClass} />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wide text-ink">
                    Email address <span className="text-danger">*</span>
                  </span>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wide text-ink">
                    Phone number
                  </span>
                  <input name="phone" type="tel" autoComplete="tel" placeholder="Optional" className={inputClass} />
                </label>

                <fieldset>
                  <legend className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-ink">
                    What&rsquo;s this about?
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {DESKS.map((desk) => (
                      <button
                        key={desk.id}
                        type="button"
                        onClick={() => setTopic(desk.id)}
                        aria-pressed={topic === desk.id}
                        className={`rounded-full px-4 py-2 text-[12.5px] font-bold transition ${
                          topic === desk.id
                            ? "bg-teal-600 text-white"
                            : "bg-paper-muted text-ink-muted ring-1 ring-line hover:text-ink"
                        }`}
                      >
                        {desk.title}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wide text-ink">
                    Your message <span className="text-danger">*</span>
                  </span>
                  <textarea
                    name="message"
                    required
                    rows={6}
                    minLength={10}
                    maxLength={4000}
                    placeholder="Tell us how we can help…"
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                </label>

                {/* Honeypot. Hidden from people and from screen readers;
                    bots fill it, and a filled one is dropped server-side
                    with a normal-looking response. */}
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />

                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-navy-950 px-7 py-4 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
                >
                  {status === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {status === "sending" ? "Sending…" : "Send Message"}
                  {status !== "sending" && <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
                </button>
              </form>
            )}
          </div>

          {/* ---------------------------------------- details */}
          <aside className="rounded-[1.5rem] bg-navy-950 p-7 text-white sm:p-9">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-teal-300">Contact details</p>
            <h2 className="mt-3 font-display text-[24px] font-bold leading-tight sm:text-[27px]">
              {CONTACT_DETAILS.legalName}
            </h2>

            <dl className="mt-8 space-y-6">
              <div>
                <dt className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
                  <Mail className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Email
                </dt>
                <dd className="mt-1.5">
                  <a
                    href={`mailto:${CONTACT_DETAILS.email}`}
                    className="text-[14px] text-white/85 transition hover:text-teal-300"
                  >
                    {CONTACT_DETAILS.email}
                  </a>
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
                  <Phone className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Phone
                </dt>
                <dd className="mt-1.5">
                  <a
                    href={`tel:${CONTACT_DETAILS.phoneHref}`}
                    className="text-[14px] text-white/85 transition hover:text-teal-300"
                  >
                    {CONTACT_DETAILS.phone}
                  </a>
                </dd>
              </div>

              <div>
                <dt className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Address
                </dt>
                <dd className="mt-1.5 space-y-1 text-[14px] leading-relaxed text-white/85">
                  {CONTACT_DETAILS.address.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </dd>
              </div>
            </dl>

            <div className="mt-9">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">Follow us</p>
              <SocialLinks tone="dark" className="mt-3" />
            </div>

            <div className="mt-9 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <p className="flex items-center gap-2 text-[13.5px] font-bold text-white">
                <Lock className="h-3.5 w-3.5 text-teal-300" strokeWidth={2.5} />
                Your privacy matters.
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">
                Information submitted through this form is not publicly visible or searchable. It reaches our support
                inbox and nowhere else.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
