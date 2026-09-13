import { useState } from "react";
import { ArrowRight, Building2, Check, Loader2, Plus, X } from "lucide-react";
import { organisationsApi } from "../lib/organisationsApi";
import type { OrganisationType } from "../lib/organisationsApi";

/* ------------------------------------------------------------------ *
 * The organisation application
 *
 * A clinician sees three prices and picks one. A hospital cannot: its
 * price depends on how many clinicians it wants covered, so there is no
 * figure to publish and this form takes its place.
 *
 * Two decisions shape it.
 *
 * ALMOST NOTHING IS REQUIRED. The organisation, a name and an email —
 * that is all. A practice manager filling this in on a phone between
 * two other jobs may not know the doctor count, and a required field
 * they cannot answer is a form they abandon. Every optional field here
 * makes the quote faster if answered and costs nothing if not, which is
 * exactly what the copy says.
 *
 * IT ASKS THE PRICING QUESTIONS FIRST. Doctor count, sites and whether
 * ClinWell is wanted are the three things that determine the figure, so
 * they sit above the free-text box rather than below it. A form that
 * buries its own pricing inputs produces enquiries somebody has to
 * chase before they can even start.
 * ------------------------------------------------------------------ */

const TYPES: { value: OrganisationType; label: string; hint: string }[] = [
  { value: "hospital", label: "Hospital", hint: "NHS trust or private hospital" },
  { value: "clinic", label: "Clinic", hint: "Single or multi-site practice" },
  { value: "pharmacy", label: "Pharmacy", hint: "Community or online" },
  { value: "care_home", label: "Care home", hint: "Residential or nursing" },
];

function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-bold text-ink">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : <span className="ml-1.5 font-medium text-ink-faint">optional</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border-2 border-ink/10 bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition focus:border-teal-600";

export function OrganisationEnquiry() {
  const [form, setForm] = useState({
    organisationName: "",
    organisationType: "clinic" as OrganisationType,
    websiteUrl: "",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",
    doctorCount: "",
    siteCount: "",
    needsClinwell: false,
    notes: "",
  });
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyDraft, setSpecialtyDraft] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  function addSpecialty() {
    /* Comma-separated pastes are the common case — somebody copies a
       list out of a document rather than typing them one at a time. */
    const parts = specialtyDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setSpecialties((current) => [...new Set([...current, ...parts])].slice(0, 40));
    setSpecialtyDraft("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setState("sending");
    try {
      const result = await organisationsApi.apply({
        ...form,
        doctorCount: form.doctorCount ? Number(form.doctorCount) : null,
        siteCount: form.siteCount ? Number(form.siteCount) : null,
        specialties,
      });
      setReference(result.reference);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that. Please try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="mx-auto max-w-[620px] rounded-2xl border-2 border-teal-600/20 bg-teal-50/60 p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal-600 text-white">
          <Check className="h-6 w-6" strokeWidth={3} />
        </span>
        <h3 className="mt-4 font-display text-[24px] font-bold text-ink">We have your enquiry</h3>
        <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-ink-muted">
          Somebody will come back to you with a figure and the detail behind it. We have emailed a copy of what you
          told us — if anything is wrong, just reply to it and we will correct it before quoting.
        </p>
        {reference && (
          <p className="mt-4 text-[11.5px] text-ink-faint">
            Your reference: <span className="font-mono font-semibold text-ink-muted">{reference}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-navy-950 text-teal-300">
          <Building2 className="h-6 w-6" strokeWidth={2} />
        </span>
        <h2 className="mt-4 font-display text-[30px] font-bold leading-tight text-ink sm:text-[36px]">
          Organisations are priced on the clinicians they cover
        </h2>
        <p className="mx-auto mt-3 max-w-[52ch] text-[14px] leading-relaxed text-ink-muted">
          A hospital covering sixty consultants and a two-partner clinic are not the same subscription, so we work the
          figure out rather than publish one. Tell us roughly what you need and we will come back with a price.
        </p>
      </div>

      <form onSubmit={submit} className="mt-9 space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
        {/* ------------------------------------------ who you are */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Organisation name" required>
              <input
                required
                className={inputClass}
                value={form.organisationName}
                onChange={(e) => set("organisationName", e.target.value)}
                placeholder="Droitwich Knee & Shoulder Clinic"
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <span className="block text-[12.5px] font-bold text-ink">
              What kind of organisation? <span className="text-danger">*</span>
            </span>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => set("organisationType", type.value)}
                  aria-pressed={form.organisationType === type.value}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                    form.organisationType === type.value
                      ? "border-teal-600 bg-teal-50/70"
                      : "border-ink/10 bg-white hover:border-ink/20"
                  }`}
                >
                  <span className="block text-[13px] font-bold text-ink">{type.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">{type.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* --------------------------------- what decides the price */}
        <div className="rounded-xl bg-paper-muted p-5">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-faint">What sets your price</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Rough numbers are fine — we are working out a ballpark, not invoicing you.
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Clinicians to cover" hint="How many doctors would appear under your listing?">
              <input
                type="number"
                min={1}
                max={5000}
                className={inputClass}
                value={form.doctorCount}
                onChange={(e) => set("doctorCount", e.target.value)}
                placeholder="12"
              />
            </Field>
            <Field label="Sites" hint="Separate addresses patients could visit.">
              <input
                type="number"
                min={1}
                max={500}
                className={inputClass}
                value={form.siteCount}
                onChange={(e) => set("siteCount", e.target.value)}
                placeholder="2"
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Specialties covered" hint="Type or paste a comma-separated list.">
              <span className="flex gap-2">
                <input
                  className={inputClass}
                  value={specialtyDraft}
                  onChange={(e) => setSpecialtyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      /* Enter adds a specialty rather than submitting
                         the whole form, which is what it would
                         otherwise do and is never what is meant here. */
                      e.preventDefault();
                      addSpecialty();
                    }
                  }}
                  placeholder="Orthopaedic surgery, Sports medicine"
                />
                <button
                  type="button"
                  onClick={addSpecialty}
                  className="shrink-0 rounded-xl border-2 border-ink/10 px-3 text-ink-muted transition hover:border-ink/20 hover:text-ink"
                  aria-label="Add specialty"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </span>
            </Field>
            {specialties.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {specialties.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => setSpecialties((c) => c.filter((x) => x !== s))}
                      className="inline-flex items-center gap-1.5 rounded-full bg-navy-950/5 py-1 pl-3 pr-2 text-[12px] font-semibold text-ink transition hover:bg-navy-950/10"
                    >
                      {s}
                      <X className="h-3 w-3 text-ink-faint" strokeWidth={3} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-white p-4 ring-1 ring-ink/5">
            <input
              type="checkbox"
              checked={form.needsClinwell}
              onChange={(e) => set("needsClinwell", e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
            />
            <span>
              <span className="block text-[13px] font-bold text-ink">We want ClinWell.ai as well</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
                The clinical suite — records, AI consultation notes, NHS RTT tracking, e-prescribing and telehealth. It
                is priced per clinician who uses it, which may be fewer than you list.
              </span>
            </span>
          </label>
        </div>

        {/* ------------------------------------------- who we reply to */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Your name" required>
            <input
              required
              className={inputClass}
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
          </Field>
          <Field label="Your role">
            <input
              className={inputClass}
              value={form.contactRole}
              onChange={(e) => set("contactRole", e.target.value)}
              placeholder="Practice manager"
            />
          </Field>
          <Field label="Email" required>
            <input
              required
              type="email"
              className={inputClass}
              value={form.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputClass}
              value={form.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Website">
              <input
                className={inputClass}
                value={form.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                placeholder="https://"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Anything else" hint="Timescales, a tender deadline, how you are set up now.">
              <textarea
                rows={4}
                className={inputClass}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={state === "sending"}
            className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-6 py-3 text-[13.5px] font-bold text-white transition hover:bg-teal-600 disabled:opacity-60"
          >
            {state === "sending" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                Ask for a quote
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </>
            )}
          </button>
          <p className="text-[12px] text-ink-muted">No card, no commitment — a figure and the reasoning behind it.</p>
        </div>
      </form>
    </div>
  );
}
