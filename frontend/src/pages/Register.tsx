import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError, documentsApi } from "../lib/dashboardApi";
import { getAllSpecialties, getCities, getTopLevelSpecialties } from "../lib/api";
import { money, plansApi } from "../lib/plansApi";
import type { BillingInterval, Plan, PlanCatalogue, PlanId } from "../lib/plansApi";
import type { City, Specialty } from "../lib/types";
import { AuthLayout, Field } from "../components/AuthLayout";

/* ------------------------------------------------------------------ *
 * Specialist registration
 *
 * The form is built from the chosen plan. A field only appears when the
 * plan actually grants the feature behind it — asking a Basic applicant
 * for a booking URL they cannot publish wastes their time and teaches
 * them the wrong thing about what they bought.
 *
 * No card is taken here. A paid plan records the intent and enters the
 * verification queue; payment is asked for from the dashboard once an
 * admin has approved the application. That way nobody pays for a listing
 * we might decline.
 * ------------------------------------------------------------------ */

type Values = {
  fullName: string;
  title: string;
  email: string;
  password: string;
  confirm: string;
  registrationNumber: string;
  primarySpecialtySlug: string;
  /** Where they practise. Required: approval needs a location. */
  locationAddress: string;
  locationCityId: string;
  locationPostcode: string;
  /* Expert Witness only -- see the conditional fields below and
     ProfileEditor.tsx's two guided second steps, which these mirror. */
  caseTypeSlugs: string[];
  clinicalSpecialtySlugs: string[];
  phone: string;
  websiteUrl: string;
  linkedin: string;
  instagram: string;
  bookingUrl: string;
  /** Honeypot — always empty when a person fills the form. */
  company: string;
};

const EMPTY: Values = {
  fullName: "",
  title: "",
  email: "",
  password: "",
  confirm: "",
  registrationNumber: "",
  primarySpecialtySlug: "",
  locationAddress: "",
  locationCityId: "",
  locationPostcode: "",
  caseTypeSlugs: [],
  clinicalSpecialtySlugs: [],
  phone: "",
  websiteUrl: "",
  linkedin: "",
  instagram: "",
  bookingUrl: "",
  company: "",
};

const inputClass =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

const isPlanId = (v: string | null): v is PlanId => v === "basic" || v === "premium" || v === "clinwell";

/* ------------------------------------------------------------------ *
 * Expert Witness -- the same two guided multi-selects
 * ProfileEditor.tsx's dashboard editor offers (see its own comment on
 * isExpertWitnessBranch), shown at signup instead of only after the
 * fact. The dropdown above is top-level only ("Expert Witness" is
 * itself a top-level specialty here), so there is no branch to walk up
 * -- picking it IS picking the branch.
 * ------------------------------------------------------------------ */
const EXPERT_WITNESS_SLUG = "expert-witness";

/** The "type of report" options -- direct children of the Medicolegal
 *  branch (Personal Injury, Clinical Negligence, and so on). */
function expertWitnessPracticeAreas(all: Specialty[]) {
  const medicolegal = all.find((s) => s.slug === "expert-witness-medicolegal");
  if (!medicolegal) return [];
  return all.filter((s) => s.parentId === medicolegal.id);
}

/** The "narrow it down" options under a single type of report -- e.g.
 *  Clinical Negligence's seven (Surgical Error, Birth Injury &
 *  Obstetric Negligence, ...). Same third taxonomy level the homepage
 *  search's "Narrow it down" picker reads. */
function expertWitnessReportSubOptions(all: Specialty[], parentSlug: string) {
  const parent = all.find((s) => s.slug === parentSlug);
  if (!parent) return [];
  return all.filter((s) => s.parentId === parent.id);
}

/** The "medical specialty" options -- the clinical-discipline leaves
 *  under expert-witness-medical-specialty. Sorted by name: there are
 *  close to ninety of these, in no useful order for a flat checkbox
 *  grid. */
function expertWitnessMedicalSpecialties(all: Specialty[]) {
  const branch = all.find((s) => s.slug === "expert-witness-medical-specialty");
  if (!branch) return [];
  return all.filter((s) => s.parentId === branch.id).sort((a, b) => a.name.localeCompare(b.name));
}

/** Add/remove a value from a small multi-select array. */
const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

/** The shared look for one tile in a checkbox grid -- teal when picked,
 *  muted otherwise, dimmed once the plan's sub-specialty cap is reached
 *  and this tile is not one of the ones already picked. */
function checkboxTileClass(checked: boolean, disabled: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-2 text-[13.5px] font-medium ${
    checked
      ? "border-teal-300 bg-teal-50 text-teal-800"
      : disabled
        ? "border-line text-ink-muted/50"
        : "border-line text-ink-muted"
  }`;
}

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const planId: PlanId = isPlanId(params.get("plan")) ? (params.get("plan") as PlanId) : "basic";
  const interval: BillingInterval = params.get("interval") === "monthly" ? "monthly" : "yearly";

  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  // The full taxonomy, fetched only to build the two Expert Witness
  // checkbox grids below -- the dropdown above stays driven by
  // getTopLevelSpecialties(), unchanged.
  const [allSpecialties, setAllSpecialties] = useState<Specialty[]>([]);
  const [cities, setCities] = useState<City[]>([]);

  useEffect(() => {
    plansApi.catalogue().then(setCatalogue).catch(() => setCatalogue(null));
    getTopLevelSpecialties().then(setSpecialties).catch(() => setSpecialties([]));
    getAllSpecialties().then(setAllSpecialties).catch(() => setAllSpecialties([]));
    getCities().then(setCities).catch(() => setCities([]));
  }, []);

  const plan: Plan | null = catalogue?.plans.find((p) => p.id === planId) ?? null;
  const features = plan?.features ?? null;

  // Which extra fields this plan unlocks. An empty list means step 3 has
  // nothing to ask, so the form is two steps instead of three.
  const extras = useMemo(() => {
    if (!features) return [] as ("website" | "socials" | "booking")[];
    const list: ("website" | "socials" | "booking")[] = [];
    if (features.websiteAndSocial) list.push("website", "socials");
    if (features.bookingLink) list.push("booking");
    return list;
  }, [features]);

  const totalSteps = extras.length > 0 ? 3 : 2;

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const toggleArrayValue = (key: "caseTypeSlugs" | "clinicalSpecialtySlugs", value: string) =>
    setValues((v) => ({ ...v, [key]: toggleValue(v[key], value) }));

  const isExpertWitness = values.primarySpecialtySlug === EXPERT_WITNESS_SLUG;
  const subSpecialtyLimit = features?.subSpecialtyLimit ?? null;
  const subSpecialtyCount = values.caseTypeSlugs.length + values.clinicalSpecialtySlugs.length;
  const atSubSpecialtyLimit = subSpecialtyLimit != null && subSpecialtyCount >= subSpecialtyLimit;

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Values, string>> = {};
    if (values.fullName.trim().length < 2) e.fullName = "Please enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) e.email = "Please enter a valid email address";
    if (values.password.length < 8) e.password = "Use at least 8 characters";
    if (values.confirm !== values.password) e.confirm = "Passwords do not match";
    if (!values.registrationNumber.trim()) e.registrationNumber = "We check this against the regulator";
    if (!values.primarySpecialtySlug) e.primarySpecialtySlug = "Choose the specialty you practise in";
    if (values.locationAddress.trim().length < 3) e.locationAddress = "Enter the address where you practise";
    if (!values.locationCityId) e.locationCityId = "Choose the city you practise in";
    return e;
  }, [values]);

  const STEP_FIELDS: Record<number, (keyof Values)[]> = {
    1: ["fullName", "email", "password", "confirm"],
    2: ["registrationNumber", "primarySpecialtySlug", "locationAddress", "locationCityId"],
    3: [],
  };

  const errorFor = (key: keyof Values) => (touched[key] ? (errors[key] ?? null) : null);
  const markTouched = (key: keyof Values) => () => setTouched((t) => ({ ...t, [key]: true }));

  function advance() {
    const fields = STEP_FIELDS[step];
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((k) => [k, true])) }));
    if (fields.every((k) => !errors[k])) setStep((s) => (Math.min(totalSteps, s + 1) as 1 | 2 | 3));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (Object.keys(errors).length > 0) {
      setStep(errors.fullName || errors.email || errors.password || errors.confirm ? 1 : 2);
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await signUp({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
        title: values.title.trim() || undefined,
        registrationNumber: values.registrationNumber.trim() || undefined,
        primarySpecialtySlug: values.primarySpecialtySlug || undefined,
        locationAddress: values.locationAddress.trim(),
        locationCityId: values.locationCityId,
        locationPostcode: values.locationPostcode.trim() || undefined,
        phone: values.phone.trim() || undefined,
        plan: planId,
        planInterval: interval,
        // Sent only when the plan grants them — the server discards
        // anything else regardless, but there is no reason to send it.
        ...(features?.websiteAndSocial
          ? {
              websiteUrl: values.websiteUrl.trim() || undefined,
              linkedin: values.linkedin.trim() || undefined,
              instagram: values.instagram.trim() || undefined,
            }
          : {}),
        ...(features?.bookingLink ? { bookingUrl: values.bookingUrl.trim() || undefined } : {}),
        ...(isExpertWitness
          ? { caseTypeSlugs: values.caseTypeSlugs, clinicalSpecialtySlugs: values.clinicalSpecialtySlugs }
          : {}),
        company: values.company,
      });
      // The certificate is optional and goes up once the account exists.
      // A failure here must never undo a successful sign up; they can
      // attach it again from their dashboard.
      if (certFile) await documentsApi.upload(certFile).catch(() => {});
      // A paid plan lands on billing, where the next step is explained;
      // a free one goes straight to the dashboard.
      navigate(planId === "basic" ? "/dashboard?welcome=1" : "/dashboard/billing?welcome=1", { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      if (err instanceof ApiError && err.status === 409) setStep(1);
    } finally {
      setBusy(false);
    }
  }

  const stepLabels = ["Your account", "Professional details", "Profile extras"].slice(0, totalSteps);

  return (
    <AuthLayout
      title="Apply to join the directory"
      subtitle="A member of our team reviews every application by hand. No card is needed to apply."
      aside={{
        heading: "Reviewed by a person, not an algorithm",
        body: "Your details go into our verification queue and we check your registration before your profile appears anywhere on the site. Paid plans are only charged once you have been approved.",
      }}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/signin" className="font-bold text-teal-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {/* ------------------------------------------- chosen plan */}
      {plan && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper-tint px-4 py-3.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
              Applying for
            </p>
            <p className="mt-1 text-[14px] font-bold text-ink">
              {plan.name}
              <span className="ml-2 font-semibold text-ink-muted">
                {plan.freeForever
                  ? "Free forever"
                  : `${money(plan.priceMinor[interval])} / ${interval === "yearly" ? "year" : "month"}`}
              </span>
            </p>
          </div>
          <Link to="/pricing" className="text-[12.5px] font-bold text-teal-700 hover:underline">
            Change plan
          </Link>
        </div>
      )}

      {!plan?.freeForever && plan && (
        <p className="mb-5 flex gap-2.5 rounded-xl bg-teal-50 px-4 py-3 text-[12.5px] leading-relaxed text-teal-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" strokeWidth={2.5} />
          <span>
            <strong className="font-bold">You won&rsquo;t be charged today.</strong> We ask for payment from your
            dashboard only after your application has been approved.
          </span>
        </p>
      )}

      {/* ----------------------------------------------- steps */}
      <ol className="mb-6 flex items-center gap-3" aria-label="Progress">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          return (
            <li key={label} className="flex flex-1 items-center gap-2.5">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ring-1 ${
                  step > n
                    ? "bg-teal-600 text-white ring-teal-600"
                    : step === n
                      ? "bg-teal-50 text-teal-700 ring-teal-500"
                      : "bg-white text-ink-faint ring-line"
                }`}
                aria-current={step === n ? "step" : undefined}
              >
                {step > n ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
              </span>
              <span className={`hidden text-[12px] font-bold sm:block ${step >= n ? "text-ink" : "text-ink-faint"}`}>
                {label}
              </span>
              {i < stepLabels.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Honeypot. Hidden from people and from screen readers; bots
            fill it, and a filled one is dropped server-side with a
            normal-looking response. */}
        <input
          type="text"
          name="company"
          value={values.company}
          onChange={set("company")}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {formError && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
            {formError}
          </p>
        )}

        {step === 1 && (
          <>
            <Field label="Full name" htmlFor="fullName" error={errorFor("fullName")}>
              <input
                id="fullName"
                value={values.fullName}
                onChange={set("fullName")}
                onBlur={markTouched("fullName")}
                autoComplete="name"
                placeholder="Mr James Whitfield"
                className={inputClass}
              />
            </Field>

            <Field
              label="Email address"
              htmlFor="email"
              error={errorFor("email")}
              hint={
                features?.publicContactEmail
                  ? "You sign in with this, and it's where patient enquiries arrive."
                  : "You sign in with this, and it's where patient enquiries arrive. It is never shown publicly."
              }
            >
              <input
                id="email"
                type="email"
                value={values.email}
                onChange={set("email")}
                onBlur={markTouched("email")}
                autoComplete="email"
                className={inputClass}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errorFor("password")} hint="At least 8 characters.">
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={values.password}
                  onChange={set("password")}
                  onBlur={markTouched("password")}
                  autoComplete="new-password"
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-faint transition hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <Field label="Confirm password" htmlFor="confirm" error={errorFor("confirm")}>
              <input
                id="confirm"
                type={showPassword ? "text" : "password"}
                value={values.confirm}
                onChange={set("confirm")}
                onBlur={markTouched("confirm")}
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Professional title" htmlFor="title" optional hint="Shown under your name on your profile.">
              <input
                id="title"
                value={values.title}
                onChange={set("title")}
                placeholder="Consultant Orthopaedic Surgeon"
                className={inputClass}
              />
            </Field>

            <Field
              label="Primary specialty"
              htmlFor="primarySpecialtySlug"
              error={errorFor("primarySpecialtySlug")}
              hint={
                features && features.subSpecialtyLimit !== null
                  ? `Your plan lists ${features.subSpecialtyLimit} specialty category. You can add more sub-specialties on Premium.`
                  : "You can add unlimited sub-specialties from your dashboard."
              }
            >
              <select
                id="primarySpecialtySlug"
                value={values.primarySpecialtySlug}
                onChange={set("primarySpecialtySlug")}
                onBlur={markTouched("primarySpecialtySlug")}
                className={inputClass}
              >
                <option value="">Select a specialty…</option>
                {specialties.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Practice address"
              htmlFor="locationAddress"
              error={errorFor("locationAddress")}
              hint="Where patients see you. It appears on your profile and puts you in that city's search results."
            >
              <input
                id="locationAddress"
                value={values.locationAddress}
                onChange={set("locationAddress")}
                onBlur={markTouched("locationAddress")}
                autoComplete="street-address"
                placeholder="e.g. 12 Harley Street"
                className={inputClass}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City" htmlFor="locationCityId" error={errorFor("locationCityId")}>
                <select
                  id="locationCityId"
                  value={values.locationCityId}
                  onChange={set("locationCityId")}
                  onBlur={markTouched("locationCityId")}
                  className={inputClass}
                >
                  <option value="">Select a city…</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Postcode" htmlFor="locationPostcode" optional>
                <input
                  id="locationPostcode"
                  value={values.locationPostcode}
                  onChange={set("locationPostcode")}
                  autoComplete="postal-code"
                  className={inputClass}
                />
              </Field>
            </div>

            {isExpertWitness && (
              <>
                <Field
                  label="Type of report"
                  hint="Every kind of expert witness report you write — Personal Injury, Clinical Negligence and so on. Solicitors search by this, so an empty list means you won't turn up in a report-type search. Pick as many as apply, then narrow down each one."
                >
                  <div className="flex flex-col gap-3">
                    {expertWitnessPracticeAreas(allSpecialties).map((opt) => {
                      const checked = values.caseTypeSlugs.includes(opt.slug);
                      const disabled = !checked && atSubSpecialtyLimit;
                      const subOptions = expertWitnessReportSubOptions(allSpecialties, opt.slug);
                      return (
                        <div key={opt.slug} className="flex flex-col gap-2">
                          <label className={checkboxTileClass(checked, disabled)}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => {
                                // Unchecking the parent also drops its
                                // sub-options -- otherwise they stay
                                // active but vanish from view.
                                if (checked) {
                                  setValues((v) => ({
                                    ...v,
                                    caseTypeSlugs: v.caseTypeSlugs.filter(
                                      (s) => s !== opt.slug && !subOptions.some((sub) => sub.slug === s)
                                    ),
                                  }));
                                } else {
                                  toggleArrayValue("caseTypeSlugs", opt.slug);
                                }
                              }}
                              className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                            />
                            {opt.name}
                          </label>

                          {checked && subOptions.length > 0 && (
                            <div className="ml-6 grid grid-cols-1 gap-2 border-l border-line pl-4 sm:grid-cols-2">
                              {subOptions.map((sub) => {
                                const subChecked = values.caseTypeSlugs.includes(sub.slug);
                                const subDisabled = !subChecked && atSubSpecialtyLimit;
                                return (
                                  <label key={sub.slug} className={checkboxTileClass(subChecked, subDisabled)}>
                                    <input
                                      type="checkbox"
                                      checked={subChecked}
                                      disabled={subDisabled}
                                      onChange={() => toggleArrayValue("caseTypeSlugs", sub.slug)}
                                      className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                                    />
                                    {sub.name}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[12.5px] text-ink-muted">
                    Narrowing down is optional — picking just "Clinical Negligence" still matches searches for its
                    sub-types below it, but naming the specific one helps you turn up in a more targeted search too.
                  </p>
                </Field>

                <Field
                  label="Medical specialty"
                  optional
                  hint="Every clinical discipline you're instructed on as an expert witness — filtered separately from the type of report above, so solicitors can search by either."
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {expertWitnessMedicalSpecialties(allSpecialties).map((opt) => {
                      const checked = values.clinicalSpecialtySlugs.includes(opt.slug);
                      const disabled = !checked && atSubSpecialtyLimit;
                      return (
                        <label key={opt.slug} className={checkboxTileClass(checked, disabled)}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleArrayValue("clinicalSpecialtySlugs", opt.slug)}
                            className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                          />
                          {opt.name}
                        </label>
                      );
                    })}
                  </div>
                </Field>

                {subSpecialtyLimit != null && (
                  <p className="text-[12.5px] text-ink-muted">
                    Your plan covers {subSpecialtyLimit} of these in total — the rest are available once you
                    upgrade to Premium.
                  </p>
                )}
              </>
            )}

            <Field
              label="Registration number"
              htmlFor="registrationNumber"
              error={errorFor("registrationNumber")}
              hint="GMC, GDC, NMC or HCPC. We verify this before approving your profile."
            >
              <input
                id="registrationNumber"
                value={values.registrationNumber}
                onChange={set("registrationNumber")}
                onBlur={markTouched("registrationNumber")}
                placeholder="GMC 1234567"
                className={inputClass}
              />
            </Field>

            <Field
              label="Registration certificate"
              htmlFor="certFile"
              optional
              error={certError}
              hint="Your GDC, GMC or HCPC certificate. We need it before we can approve your profile, and you can also add it later from your dashboard. PDF, JPG, PNG or WebP, up to 8MB."
            >
              <input
                id="certFile"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 8 * 1024 * 1024) {
                    setCertFile(null);
                    setCertError("That file is over 8MB. Please send a smaller scan or photo.");
                    e.target.value = "";
                    return;
                  }
                  setCertError(null);
                  setCertFile(f);
                }}
                className="block w-full text-[13px] text-ink-muted file:mr-3 file:rounded-full file:border-0 file:bg-paper-tint file:px-4 file:py-2 file:text-[12.5px] file:font-bold file:text-teal-700"
              />
            </Field>

            <Field label="Contact phone" htmlFor="phone" optional hint="Shown on your profile as a click-to-call button.">
              <input
                id="phone"
                type="tel"
                value={values.phone}
                onChange={set("phone")}
                autoComplete="tel"
                placeholder="020 7946 0000"
                className={inputClass}
              />
            </Field>
          </>
        )}

        {step === 3 && features && (
          <>
            <p className="rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
              These are unlocked by {plan?.name}. All optional — you can add them later from your dashboard.
            </p>

            {features.websiteAndSocial && (
              <>
                <Field label="Practice website" htmlFor="websiteUrl" optional>
                  <input
                    id="websiteUrl"
                    value={values.websiteUrl}
                    onChange={set("websiteUrl")}
                    placeholder="https://www.yourpractice.co.uk"
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="LinkedIn" htmlFor="linkedin" optional>
                    <input
                      id="linkedin"
                      value={values.linkedin}
                      onChange={set("linkedin")}
                      placeholder="linkedin.com/in/…"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Instagram" htmlFor="instagram" optional>
                    <input
                      id="instagram"
                      value={values.instagram}
                      onChange={set("instagram")}
                      placeholder="instagram.com/…"
                      className={inputClass}
                    />
                  </Field>
                </div>
              </>
            )}

            {features.bookingLink && (
              <Field
                label="Booking or calendar link"
                htmlFor="bookingUrl"
                optional
                hint="Patients land here from the Book an appointment button on your profile."
              >
                <input
                  id="bookingUrl"
                  value={values.bookingUrl}
                  onChange={set("bookingUrl")}
                  placeholder="https://calendly.com/…"
                  className={inputClass}
                />
              </Field>
            )}

            {features.photoGallery && (
              <p className="rounded-xl bg-teal-50 px-4 py-3 text-[12.5px] leading-relaxed text-teal-900">
                Your plan also includes a clinical photo gallery
                {features.galleryImageLimit ? ` of up to ${features.galleryImageLimit} images` : ""}
                {features.videoBio ? " and a video bio" : ""}. Add those from your dashboard once you&rsquo;re approved —
                they need files rather than links.
              </p>
            )}
          </>
        )}

        <div className="flex gap-3 pt-1">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (Math.max(1, s - 1) as 1 | 2 | 3))}
              className="flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[14px] font-bold text-ink-muted ring-1 ring-line transition hover:bg-paper-tint"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
              Back
            </button>
          )}

          {/* Distinct keys matter here. Without them React reconciles the
              two branches into the SAME <button> node, so clicking
              "Continue" advances the step and then flips that very
              element to type="submit" — whose default action fires on the
              click already in flight, submitting the form a step early. */}
          {step < totalSteps ? (
            <button
              key="advance"
              type="button"
              onClick={advance}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700"
            >
              Continue
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          ) : (
            <button
              key="submit"
              type="submit"
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Submitting…" : "Submit application"}
            </button>
          )}
        </div>

        {/* Where consent is actually given. A signup that never shows
            these has nothing to point at later when a member says they
            never agreed to them. */}
        <p className="mt-5 text-center text-[12px] leading-relaxed text-ink-faint">
          By submitting this application you agree to our{" "}
          <Link to="/terms" className="font-semibold text-teal-700 underline-offset-2 hover:underline">
            terms of use
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="font-semibold text-teal-700 underline-offset-2 hover:underline">
            privacy notice
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
