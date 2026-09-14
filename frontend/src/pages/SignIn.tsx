import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError, authApi, isRemembered, rememberedEmail } from "../lib/dashboardApi";
import { AuthLayout, Field } from "../components/AuthLayout";

export default function SignIn() {
  const { signIn, completeSignIn, account, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ email: string; role: string; password: string }[]>([]);
  const [prefill, setPrefill] = useState({ email: rememberedEmail(), password: "" });
  /* The address is filled in from last time when the box was ticked;
     the password never is. A browser's own password manager is the
     right place for that, and this field is not it. */
  const [remember, setRemember] = useState(isRemembered());
  /* Set when the password was accepted and a code is wanted as well.
     Its presence is what swaps the form over. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;

  // Already signed in (e.g. hit /signin from a bookmark): go to the
  // workspace that matches the role rather than showing a dead form.
  useEffect(() => {
    if (!loading && account) {
      navigate(from ?? (account.role === "admin" ? "/admin" : "/dashboard"), { replace: true });
    }
  }, [account, loading, from, navigate]);

  // Demo mode publishes its logins so the build can be tried without a
  // seeded database. Against a real Mongo this 404s and nothing renders.
  useEffect(() => {
    authApi
      .demoCredentials()
      .then((res) => setDemo(res.accounts))
      .catch(() => setDemo([]));
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(String(form.get("email")), String(form.get("password")), remember);
      if (result.account) {
        navigate(from ?? (result.account.role === "admin" ? "/admin" : "/dashboard"), { replace: true });
        return;
      }
      /* The password was right and a code is needed too. Not an error,
         and not a different page — the form is replaced in place, so
         nothing about the browser's back button or a password manager's
         save prompt gets confused by a navigation in the middle of
         signing in. */
      setChallenge(result.challenge);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const { account: signedIn, usedRecoveryCode, recoveryCodesRemaining } = await completeSignIn(
        challenge,
        code,
        remember
      );
      navigate(from ?? (signedIn.role === "admin" ? "/admin" : "/dashboard"), {
        replace: true,
        /* Carried through so the dashboard can say it once, at the
           moment it is true. Somebody who has just spent a recovery
           code is somebody whose phone may well be gone. */
        state: usedRecoveryCode ? { recoveryCodeUsed: recoveryCodesRemaining } : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        /* The challenge ran out. Back to the password, because there is
           nothing left to complete. */
        setChallenge(null);
        setCode("");
        setError("That took too long. Enter your password again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------ the second step
     A separate render rather than fields hidden inside the first form.
     The password is done; showing it greyed out beside a code box
     invites somebody to retype it, and a browser's password manager
     behaves better when the form it saved has gone. */
  if (challenge) {
    return (
      <AuthLayout
        title="Enter your code"
        subtitle="Your password was right. Now the six digits from your authenticator app."
        aside={{
          heading: "Why the second step",
          body: "A password can be guessed, reused, or typed into a page that only looked like ours. A code from your own phone can't be any of those.",
        }}
        footer={
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
            className="font-bold text-teal-700 hover:underline"
          >
            Back to sign in
          </button>
        }
      >
        <form onSubmit={handleCode} className="space-y-4" noValidate>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
            >
              {error}
            </p>
          )}

          <Field label="Six-digit code" htmlFor="code">
            <input
              id="code"
              name="code"
              type="text"
              required
              autoFocus
              /* inputMode rather than type="number": a numeric keypad on
                 a phone, without the spinner arrows and scroll-wheel
                 behaviour of a number input. autoComplete tells iOS and
                 Android to offer the code straight from the SMS or
                 keychain where they have it. */
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={14}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-center font-mono text-[20px] tracking-[0.3em] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </Field>

          <button
            type="submit"
            disabled={busy || code.trim().length < 6}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Checking…" : "Sign in"}
          </button>

          {/* Named here rather than hidden behind "having trouble?" —
              somebody reading this screen has already lost their phone
              or they would have typed the code by now. */}
          <p className="rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
            Lost the phone with your authenticator on it? Type one of your recovery codes in the box
            instead. Each one works once.
          </p>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to your workspace"
      subtitle="Manage your profile, enquiries and reviews."
      aside={{
        heading: "Every profile is checked by a human",
        body: "Applications are reviewed by our team before they appear in search. Nothing goes live automatically.",
      }}
      footer={
        <>
          New to Top Local Specialists?{" "}
          <Link to="/register" className="font-bold text-teal-700 hover:underline">
            Apply to join
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
          >
            {error}
          </p>
        )}

        <Field label="Email address" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={prefill.email}
            onChange={(e) => setPrefill((p) => ({ ...p, email: e.target.value }))}
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          /* Beside the field, not buried under the button: somebody who
             cannot remember their password has already stopped reading
             the rest of this form. The address they have typed is carried
             across so they do not type it twice. */
          action={
            <Link
              to="/forgot-password"
              state={{ email: prefill.email }}
              className="text-[12.5px] text-teal-700 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={prefill.password}
              onChange={(e) => setPrefill((p) => ({ ...p, password: e.target.value }))}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 pr-12 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label htmlFor="remember" className="flex cursor-pointer items-center gap-2.5 select-none">
            <input
              id="remember"
              name="remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-line text-teal-600 accent-teal-600 focus:ring-2 focus:ring-teal-500/30"
            />
            <span className="text-[13px] font-semibold text-ink">Keep me signed in</span>
          </label>
          <span className="text-[12.5px] text-ink-faint">
            {remember ? "On this device" : "Until you close the browser"}
          </span>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {demo.length > 0 && (
        <div className="mt-6 rounded-xl bg-paper-tint p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            Demo logins
          </p>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            The backend is running without a database, so these accounts stand in for real ones.
          </p>
          <div className="mt-3 space-y-1.5">
            {demo.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => setPrefill({ email: a.email, password: a.password })}
                className="flex w-full items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-left text-[12.5px] ring-1 ring-line transition hover:ring-teal-400"
              >
                <span className="min-w-0 truncate font-semibold text-ink">{a.email}</span>
                <span className="shrink-0 rounded-full bg-paper-tint px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                  {a.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
