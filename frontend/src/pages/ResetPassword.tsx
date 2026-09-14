import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ApiError, authApi } from "../lib/dashboardApi";
import { useAuth } from "../lib/auth";
import { AuthLayout } from "../components/AuthLayout";
import { NewPasswordField, passwordPairReady } from "../components/NewPasswordField";

/* ------------------------------------------------------------------ *
 * Setting a new password from a link
 *
 * The token is in the query string, which is where a link can carry it
 * and nowhere else. Nothing on this page reveals whose account it
 * belongs to — not the name, not the email — because a link that has
 * been forwarded, logged by a mail scanner, or found in a browser
 * history should not also hand over the address it unlocks.
 *
 * Redeeming it signs the person in. They have just proved they hold the
 * mailbox on the account; making them immediately type the password
 * they set four seconds ago proves nothing further, and the server
 * issues the session token for exactly that reason.
 * ------------------------------------------------------------------ */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* A spent or expired link. Distinguished from an ordinary error
     because the only useful thing to offer is a new link, not a retry. */
  const [dead, setDead] = useState(false);

  const ready = passwordPairReady(password, confirm);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.resetPassword(token, password);
      const user = await adoptSession(res.token, res.user);
      navigate(user?.role === "admin" ? "/admin" : "/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err as ApiError & { code?: string }).status === 400) {
        const message = err.message;
        if (/expired|already been used/i.test(message)) setDead(true);
        else setError(message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  /* No token at all — somebody opened the bare URL. Same screen as a
     dead link: there is nothing to do here but ask for a new one. */
  if (!token || dead) {
    return (
      <AuthLayout
        title="That link has expired"
        aside={{
          heading: "Links last one hour",
          body: "A reset link works once and then stops working, so a link sitting in a mailbox can't be used by whoever reads it next.",
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
        <div className="space-y-5">
          <div className="flex gap-3.5 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-500/30">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={2.2} />
            <p className="text-[13px] leading-relaxed text-ink">
              {token
                ? "This link has already been used, or it's more than an hour old. Your password hasn't changed — ask for a new link and it'll work straight away."
                : "There's no reset token in this address. Open the link from the email itself rather than typing the page in."}
            </p>
          </div>
          <Link
            to="/forgot-password"
            className="block w-full rounded-full bg-teal-600 px-6 py-3.5 text-center text-[14px] font-bold text-white transition hover:bg-teal-700"
          >
            Send me a new link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Once you save it, you'll be signed in and every other session on this account will end."
      aside={{
        heading: "This signs out everywhere else",
        body: "If somebody else had your password, changing it is what puts them out — not just on this device, but on every browser and phone your account was open on.",
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
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
          >
            {error}
          </p>
        )}

        <NewPasswordField
          value={password}
          confirm={confirm}
          onChange={setPassword}
          onConfirmChange={setConfirm}
          autoFocus
        />

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Saving…" : "Save password and sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
