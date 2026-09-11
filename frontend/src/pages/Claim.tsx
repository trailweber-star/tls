import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, ShieldCheck, Star, UserCheck } from "lucide-react";
import { ApiError, claimsApi, setToken } from "../lib/dashboardApi";
import type { ClaimEligibility } from "../lib/dashboardApi";
import { money, plansApi } from "../lib/plansApi";
import type { BillingInterval, PlanCatalogue, PlanId } from "../lib/plansApi";
import { useAuth } from "../lib/auth";
import { AuthLayout, Field } from "../components/AuthLayout";
import { initials } from "../components/dashboard/ui";

/* ------------------------------------------------------------------ *
 * Claiming an existing listing
 *
 * Most profiles here were compiled from public registers rather than
 * created by the clinician they describe. Claiming is how the real
 * person takes ownership, and it has to be the obviously better path
 * than registering again — because the profile already carries reviews
 * and a rating that a fresh signup would abandon. So the first thing
 * this page does is show them exactly what they stand to inherit.
 *
 * The proof asked for is the registration number already held against
 * the listing. Someone who can state it is almost certainly the
 * registrant; someone who cannot is not refused, but the admin is told
 * loudly. A person decides either way.
 * ------------------------------------------------------------------ */

const inputClass =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

const isPlanId = (v: string | null): v is PlanId => v === "basic" || v === "premium" || v === "clinwell";

export default function Claim() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const { refresh } = useAuth();

  const [listing, setListing] = useState<ClaimEligibility | null>(null);
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plan, setPlan] = useState<PlanId>(isPlanId(params.get("plan")) ? (params.get("plan") as PlanId) : "basic");
  const [interval] = useState<BillingInterval>(params.get("interval") === "monthly" ? "monthly" : "yearly");
  const [values, setValues] = useState({
    registrationNumber: "",
    fullName: "",
    email: "",
    password: "",
    confirm: "",
    phone: "",
    message: "",
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    claimsApi
      .eligibility(slug)
      .then((res) => {
        setListing(res);
        setValues((v) => ({ ...v, fullName: res.fullName }));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this listing"));
    plansApi.catalogue().then(setCatalogue).catch(() => setCatalogue(null));
  }, [slug]);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const errors = useMemo(() => {
    const e: Partial<Record<keyof typeof values, string>> = {};
    if (values.registrationNumber.trim().length < 3) e.registrationNumber = "Enter the registration number on file";
    if (values.fullName.trim().length < 2) e.fullName = "Please enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) e.email = "Please enter a valid email address";
    if (values.password.length < 8) e.password = "Use at least 8 characters";
    if (values.confirm !== values.password) e.confirm = "Passwords do not match";
    return e;
  }, [values]);

  const STEP_FIELDS: Record<number, (keyof typeof values)[]> = {
    1: [],
    2: ["registrationNumber"],
    3: ["fullName", "email", "password", "confirm"],
  };

  const errorFor = (k: keyof typeof values) => (touched[k] ? (errors[k] ?? null) : null);
  const markTouched = (k: keyof typeof values) => () => setTouched((t) => ({ ...t, [k]: true }));

  function advance() {
    const fields = STEP_FIELDS[step];
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((k) => [k, true])) }));
    if (fields.every((k) => !errors[k])) setStep((s) => (Math.min(3, s + 1) as 1 | 2 | 3));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(Object.fromEntries(Object.keys(values).map((k) => [k, true])));
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setFormError(null);
    try {
      const res = await claimsApi.submit({
        slug,
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
        registrationNumber: values.registrationNumber.trim(),
        phone: values.phone.trim() || undefined,
        message: values.message.trim() || undefined,
        plan,
        planInterval: interval,
      });
      // Signed in immediately, but owning nothing until an admin agrees.
      setToken(res.token);
      await refresh();
      setDone(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------- states */

  if (loadError) {
    return (
      <ClaimShell>
        <p className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">{loadError}</p>
      </ClaimShell>
    );
  }

  if (!listing) {
    return (
      <ClaimShell>
        <p className="flex items-center gap-2 py-10 text-[13.5px] text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading listing…
        </p>
      </ClaimShell>
    );
  }

  if (done) {
    return (
      <ClaimShell title="Claim submitted" subtitle="We'll email you as soon as it has been reviewed.">
        <div className="rounded-2xl bg-teal-50 p-5">
          <p className="flex items-center gap-2 text-[14px] font-bold text-teal-900">
            <Check className="h-4 w-4" strokeWidth={3} />
            Your claim for {listing.fullName} is with our team
          </p>
          <ol className="mt-4 space-y-3">
            {[
              "We check the registration number you gave against the public register.",
              "If it matches our record, approval is usually the same working day.",
              plan === "basic"
                ? "Once approved, the profile and everything on it becomes yours to edit."
                : "Once approved, the profile becomes yours and your dashboard asks for payment — nothing is charged before then.",
            ].map((line, i) => (
              <li key={line} className="flex gap-3 text-[13px] leading-relaxed text-teal-900/80">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        </div>
        <Link
          to="/dashboard"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-3 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
        >
          Go to your dashboard
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </Link>
      </ClaimShell>
    );
  }

  if (!listing.claimable) {
    return (
      <ClaimShell title="This listing isn't available to claim">
        <p className="rounded-xl bg-paper-tint px-4 py-3.5 text-[13.5px] leading-relaxed text-ink-muted">
          {listing.claimPending
            ? `Someone has already claimed ${listing.fullName} and we're reviewing it. If that was you, sign in to follow progress — if it wasn't, please contact us.`
            : `${listing.fullName} is already managed by its owner. If you believe that's wrong, contact us and we'll look into it.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to={`/specialists/${listing.slug}`}
            className="rounded-full px-5 py-3 text-[13.5px] font-bold text-ink ring-1 ring-line transition hover:bg-paper-tint"
          >
            View the profile
          </Link>
          <Link
            to="/signin"
            className="rounded-full bg-teal-600 px-5 py-3 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
          >
            Sign in
          </Link>
        </div>
      </ClaimShell>
    );
  }

  /* ------------------------------------------------- the form */

  return (
    <AuthLayout
      title="Claim your profile"
      subtitle="Take ownership of a listing that's already on Top Local Specialists."
      aside={{
        heading: "Your reviews come with you",
        body: "Claiming keeps the rating and reviews already on your listing. Registering a second profile would start you at zero and leave a duplicate behind.",
      }}
      footer={
        <>
          Not your profile?{" "}
          <Link to="/pricing" className="font-bold text-teal-700 hover:underline">
            Create a new listing
          </Link>
        </>
      }
    >
      {/* ------------------------------------ what you're claiming */}
      <div className="mb-6 flex items-center gap-4 rounded-xl bg-paper-tint px-4 py-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-white text-[15px] font-bold text-ink-muted ring-1 ring-line">
          {listing.photoUrl ? (
            <img src={listing.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(listing.fullName)
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-ink">{listing.fullName}</p>
          <p className="truncate text-[12.5px] text-ink-muted">
            {[listing.title, listing.primarySpecialty].filter(Boolean).join(" · ") || "Listed specialist"}
          </p>
          {listing.ratingCount > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
              <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={2} aria-hidden />
              {listing.ratingAvg.toFixed(1)}
              <span className="font-normal text-ink-muted">
                from {listing.ratingCount} review{listing.ratingCount === 1 ? "" : "s"} — these stay with the profile
              </span>
            </p>
          )}
        </div>
      </div>

      <ol className="mb-6 flex items-center gap-3" aria-label="Progress">
        {["Confirm", "Verify", "Your account"].map((label, i) => {
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
              {i < 2 && <span className="h-px flex-1 bg-line" aria-hidden />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">
            {formError}
          </p>
        )}

        {step === 1 && (
          <>
            <p className="rounded-xl bg-white px-4 py-4 text-[13.5px] leading-relaxed text-ink-muted ring-1 ring-line">
              <strong className="font-bold text-ink">Is this you?</strong> Claiming transfers this listing to your
              account. You&rsquo;ll be able to edit everything on it, answer patient enquiries sent to it, and reply to
              its reviews.
            </p>

            {catalogue && (
              <fieldset>
                <legend className="mb-2 text-[13px] font-bold text-ink">Choose a plan to start on</legend>
                <div className="space-y-2">
                  {catalogue.plans.map((option) => (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 transition ${
                        plan === option.id ? "bg-teal-50 ring-teal-400" : "bg-white ring-line hover:bg-paper-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={option.id}
                        checked={plan === option.id}
                        onChange={() => setPlan(option.id)}
                        className="h-4 w-4 accent-teal-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-bold text-ink">{option.name}</span>
                        <span className="block text-[12px] text-ink-muted">
                          {option.freeForever
                            ? "Free forever"
                            : `${money(option.priceMinor[interval])} / ${interval === "yearly" ? "year" : "month"} — charged only after approval`}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <p className="flex gap-2.5 rounded-xl bg-teal-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-teal-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" strokeWidth={2.5} />
              <span>
                We hold a regulator registration number against this listing. Entering the one that belongs to you is
                how we know the claim is genuine — we never show it on this page.
              </span>
            </p>

            <Field
              label="Your registration number"
              htmlFor="registrationNumber"
              error={errorFor("registrationNumber")}
              hint="GMC, GDC, NMC or HCPC. If it doesn't match what we hold we'll still review your claim by hand."
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
              label="Anything else we should know?"
              htmlFor="message"
              optional
              hint="A link to your entry on the public register speeds this up considerably."
            >
              <textarea
                id="message"
                value={values.message}
                onChange={set("message")}
                rows={3}
                maxLength={1000}
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <Field label="Your full name" htmlFor="fullName" error={errorFor("fullName")}>
              <input
                id="fullName"
                value={values.fullName}
                onChange={set("fullName")}
                onBlur={markTouched("fullName")}
                autoComplete="name"
                className={inputClass}
              />
            </Field>

            <Field
              label="Email address"
              htmlFor="email"
              error={errorFor("email")}
              hint="You'll sign in with this, and patient enquiries will arrive here once the profile is yours."
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

            <Field label="Contact phone" htmlFor="phone" optional>
              <input
                id="phone"
                type="tel"
                value={values.phone}
                onChange={set("phone")}
                autoComplete="tel"
                className={inputClass}
              />
            </Field>
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

          {/* Distinct keys: without them React reuses one <button> node and
              flips its type mid-click, submitting a step early. */}
          {step < 3 ? (
            <button
              key="advance"
              type="button"
              onClick={advance}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700"
            >
              {step === 1 ? "Yes, this is me" : "Continue"}
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          ) : (
            <button
              key="submit"
              type="submit"
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" strokeWidth={2.5} />}
              {busy ? "Submitting…" : "Submit claim"}
            </button>
          )}
        </div>

        {/* Where consent is actually given. A signup that never shows
            these has nothing to point at later when a member says they
            never agreed to them. */}
        <p className="mt-5 text-center text-[12px] leading-relaxed text-ink-faint">
          By submitting this claim you agree to our{" "}
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

/** Simple wrapper for the loading, error and finished states. */
function ClaimShell({
  title = "Claim your profile",
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <AuthLayout
      title={title}
      subtitle={subtitle}
      aside={{
        heading: "Your reviews come with you",
        body: "Claiming keeps the rating and reviews already on your listing. Registering a second profile would start you at zero and leave a duplicate behind.",
      }}
    >
      {children}
    </AuthLayout>
  );
}

