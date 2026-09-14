import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { authApi } from "../lib/dashboardApi";
import { AuthLayout, Field } from "../components/AuthLayout";

/* ------------------------------------------------------------------ *
 * Forgot your password
 *
 * The screen has exactly one outcome, and that is the point. Whether
 * the address is on an account, on no account, or on one an
 * administrator switched off, the server answers the same and so does
 * this page.
 *
 * That is not politeness — a page that says "no account with that
 * email" is a free tool for working out which doctors have accounts
 * here, one address at a time, which is the first step of a credential
 * stuffing run. The cost is that somebody who mistypes their address
 * waits for an email that never comes, so the confirmation says which
 * address it went to and offers a way back.
 * ------------------------------------------------------------------ */
export default function ForgotPassword() {
  const location = useLocation();
  const carried = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(carried);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Only ever set on a machine with no mail provider configured. It is
     what makes this flow walkable on a laptop, and the server will not
     produce it on a deployed site. */
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.forgotPassword(email.trim());
      setDevUrl(res.devResetUrl ?? null);
      setSent(email.trim());
    } catch {
      /* The only failure the server has is a malformed address — it
         answers the same for everything else. */
      setError("That doesn't look like an email address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={sent ? "Check your email" : "Reset your password"}
      subtitle={
        sent
          ? undefined
          : "Enter the address on your account and we'll send you a link to set a new password."
      }
      aside={{
        heading: "Links last one hour",
        body: "A reset link works once and then stops working. If it expires before you get to it, ask for another — there's no limit that matters.",
      }}
      footer={
        <>
          Remembered it?{" "}
          <Link to="/signin" className="font-bold text-teal-700 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="space-y-5">
          <div className="flex gap-3.5 rounded-xl bg-teal-50 p-4 ring-1 ring-teal-500/20">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" strokeWidth={2.2} />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink">
                If <span className="break-all">{sent}</span> is on an account, a reset link is on its way.
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                It arrives within a minute or two and works for one hour. Check your spam folder before
                asking for another.
              </p>
            </div>
          </div>

          {/* Development only — see the comment on devUrl above. */}
          {devUrl && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-500/30">
              <p className="text-[12px] font-bold uppercase tracking-wide text-amber-800">
                No mail provider configured
              </p>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                This link is shown because nothing is set up to send it. It will not appear on a deployed
                site.
              </p>
              <a href={devUrl} className="mt-2 block break-all text-[12.5px] font-semibold text-teal-700 hover:underline">
                {devUrl}
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setSent(null);
              setDevUrl(null);
            }}
            className="w-full rounded-full border border-line px-6 py-3 text-[14px] font-bold text-ink transition hover:border-ink-faint"
          >
            Use a different address
          </button>
        </div>
      ) : (
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
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </Field>

          <button
            type="submit"
            disabled={busy || email.trim().length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
