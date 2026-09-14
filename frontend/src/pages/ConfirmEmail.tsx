import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Clock3, Loader2, ShieldX } from "lucide-react";
import { ApiError, accountApi } from "../lib/dashboardApi";
import { AuthLayout } from "../components/AuthLayout";

/* ------------------------------------------------------------------ *
 * Where an email-change link lands
 *
 * One page for all three links, because the person clicking has no idea
 * which kind they have — they have an email that says either "confirm",
 * "approve" or "this wasn't me", and the server works out which token it
 * actually is.
 *
 * It is deliberately outside the signed-in area. The cancel link is the
 * one somebody clicks precisely when they think their account is being
 * taken, and requiring them to sign in first would be asking them to do
 * the one thing they may no longer be able to do.
 * ------------------------------------------------------------------ */
export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<
    | { status: "working" }
    | { status: "applied"; newEmail?: string }
    | { status: "waiting"; waitingOn?: string; newEmail?: string }
    | { status: "cancelled" }
    | { status: "dead"; message: string }
  >({ status: "working" });

  /* React runs mount effects twice in development, and this call spends
     a single-use token. Without the guard the second run would report
     a perfectly good link as already used. */
  const sent = useRef(false);

  useEffect(() => {
    if (!token) {
      setState({ status: "dead", message: "There's no token in this address. Open the link from the email itself." });
      return;
    }
    if (sent.current) return;
    sent.current = true;

    accountApi
      .confirmEmailChange(token)
      .then((res) => {
        if (res.outcome === "applied") setState({ status: "applied", newEmail: res.newEmail });
        else if (res.outcome === "cancelled") setState({ status: "cancelled" });
        else setState({ status: "waiting", waitingOn: res.waitingOn, newEmail: res.newEmail });
      })
      .catch((err) => {
        setState({
          status: "dead",
          message:
            err instanceof ApiError
              ? err.message
              : "Something went wrong. Try the link again, or ask for a new one from your account settings.",
        });
      });
  }, [token]);

  const shell = (title: string, subtitle: string | undefined, body: React.ReactNode) => (
    <AuthLayout
      title={title}
      subtitle={subtitle}
      aside={{
        heading: "Both addresses have to agree",
        body: "Changing the email on an account needs the new address to confirm and the old one to approve. Either on its own does nothing — that's what stops somebody moving an account to themselves.",
      }}
      footer={
        <Link to="/signin" className="font-bold text-teal-700 hover:underline">
          Go to sign in
        </Link>
      }
    >
      {body}
    </AuthLayout>
  );

  if (state.status === "working") {
    return shell(
      "Just a moment",
      undefined,
      <p className="flex items-center gap-2 text-[14px] text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your link…
      </p>
    );
  }

  if (state.status === "applied") {
    return shell(
      "That's done",
      undefined,
      <div className="flex gap-3.5 rounded-xl bg-teal-50 p-4 ring-1 ring-teal-500/20">
        <Check className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" strokeWidth={2.5} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink">
            The account now signs in with <span className="break-all">{state.newEmail}</span>.
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            Your password hasn't changed. Both addresses have been emailed to say so.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "waiting") {
    return shell(
      "Thanks — one more to go",
      undefined,
      <div className="flex gap-3.5 rounded-xl bg-paper-tint p-4">
        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" strokeWidth={2.2} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink">
            Now waiting on {state.waitingOn ?? "the other address"}.
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            There's a second email, sent at the same time as this one. Open the link in that as well and
            the change goes through. Until then nothing has moved.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "cancelled") {
    return shell(
      "Cancelled",
      undefined,
      <div className="space-y-4">
        <div className="flex gap-3.5 rounded-xl bg-teal-50 p-4 ring-1 ring-teal-500/20">
          <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" strokeWidth={2.2} />
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">The email change has been stopped.</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              Your address is unchanged and the links from that request no longer work.
            </p>
          </div>
        </div>

        {/* The cancel link is clicked by somebody who did not start the
            change. Saying what to do next is the point of the page. */}
        <div className="rounded-xl bg-danger/10 p-4 ring-1 ring-danger/20">
          <p className="text-[13.5px] font-bold text-ink">If you didn't ask for this, change your password now.</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            Somebody was signed in to your account to be able to request it. Changing your password signs
            out every other device, including theirs.
          </p>
          <Link
            to="/forgot-password"
            className="mt-3 inline-block rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700"
          >
            Reset my password
          </Link>
        </div>
      </div>
    );
  }

  return shell(
    "That link didn't work",
    undefined,
    <div className="flex gap-3.5 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-500/30">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={2.2} />
      <p className="text-[13px] leading-relaxed text-ink">
        {state.message} Links expire after a day, work once, and stop working if the change was cancelled
        or replaced by a newer one.
      </p>
    </div>
  );
}
