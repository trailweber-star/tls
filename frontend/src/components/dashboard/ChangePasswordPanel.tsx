import { useState } from "react";
import { Check, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Panel } from "../DashboardShell";
import { Field } from "../AuthLayout";
import { NewPasswordField, passwordPairReady } from "../NewPasswordField";
import { ApiError, authApi } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * Change your password
 *
 * On every dashboard, the same panel, because the question "how do I
 * change my password" should have one answer for an administrator, a
 * consultant and a clinic alike.
 *
 * It asks for the current password even though the person is already
 * signed in. Those are not the same claim: a session only means a
 * browser was left open, and somebody who sits down at an unattended
 * laptop should not be able to lock its owner out of their own account
 * in four keystrokes.
 *
 * Saving ends every other session on the account. That is the whole
 * point of changing a password you think somebody else has, so the
 * screen says so before and after rather than leaving it as a surprise.
 * ------------------------------------------------------------------ */
export function ChangePasswordPanel() {
  const { account, impersonation, adoptSession } = useAuth();

  const [current, setCurrent] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = current.length > 0 && passwordPairReady(password, confirm, account ?? undefined);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.changePassword(current, password);
      /* The change killed every token older than it, this tab's
         included. The replacement is minted after the change, so
         swapping it in is what keeps the person where they are instead
         of bouncing them to the sign-in screen for doing the right
         thing. */
      await adoptSession(res.token);
      setCurrent("");
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /* A borrowed session cannot do this, and the server refuses it. Saying
     so here rather than letting somebody fill the form in first. */
  if (impersonation) {
    return (
      <Panel title="Password">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          You're signed in as {account?.fullName ?? "this member"} from your admin account. A password can
          only be changed by the person who owns it — return to your own session to change yours.
        </p>
      </Panel>
    );
  }

  const input =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

  return (
    <Panel title="Password">
      {done ? (
        <div className="space-y-4">
          <div className="flex gap-3.5 rounded-xl bg-teal-50 p-4 ring-1 ring-teal-500/20">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" strokeWidth={2.5} />
            <div>
              <p className="text-[14px] font-bold text-ink">Your password has been changed.</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                Every other browser and phone that was signed in to this account has been signed out. This
                tab stayed in, so there's nothing else to do.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDone(false)}
            className="text-[13px] font-bold text-teal-700 hover:underline"
          >
            Change it again
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-md space-y-4" noValidate>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
            >
              {error}
            </p>
          )}

          {/* A hidden field so password managers know which account this
              form belongs to and offer to update the saved entry. */}
          <input type="hidden" name="username" autoComplete="username" value={account?.email ?? ""} readOnly />

          <Field label="Current password" htmlFor="current-password">
            <div className="relative">
              <input
                id="current-password"
                name="currentPassword"
                type={showCurrent ? "text" : "password"}
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={`${input} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-faint transition hover:text-ink"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <NewPasswordField
            value={password}
            confirm={confirm}
            onChange={setPassword}
            onConfirmChange={setConfirm}
            account={account ?? undefined}
          />

          <p className="flex gap-2.5 rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
            <span>
              Saving signs this account out of every other browser and phone. That's deliberate — it's what
              puts somebody else out if they had your password.
            </span>
          </p>

          <button
            type="submit"
            disabled={busy || !ready}
            className="flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      )}
    </Panel>
  );
}
