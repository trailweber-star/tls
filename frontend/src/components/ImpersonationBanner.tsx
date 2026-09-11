import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EyeOff, LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";

/* ------------------------------------------------------------------ *
 * "You are signed in as somebody else"
 *
 * Present on every screen — public pages included — for as long as a
 * borrowed session is in use, because the dangerous version of this
 * feature is the one an administrator forgets they are inside.
 *
 * It sits along the bottom rather than the top for a practical reason:
 * the public header and the workspace sidebar both occupy the top-left
 * of the viewport, and a bar that fought them for that space would
 * either be covered or cover something that matters. The bottom edge is
 * unoccupied at every breakpoint, so the warning is always whole.
 * ------------------------------------------------------------------ */

export function ImpersonationBanner() {
  const { impersonation, account, stopImpersonation } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = Boolean(impersonation);

  /* Keep the bar from covering the last line of the page. Written and
     unwound here rather than in a stylesheet so nothing is left behind
     when the session ends. */
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "72px";
    return () => {
      document.body.style.paddingBottom = previous;
    };
  }, [active]);

  if (!impersonation) return null;

  async function handleReturn() {
    setLeaving(true);
    setError(null);
    try {
      await stopImpersonation();
      navigate("/admin/members", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the support session");
      setLeaving(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[70] border-t-2 border-amber/60 bg-navy-950/97 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber/20 text-amber">
          <ShieldAlert className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </span>

        <p className="min-w-0 flex-1 text-[13px] leading-snug text-white">
          <span className="font-bold text-amber">Support session.</span>{" "}
          You are viewing the site as{" "}
          <span className="font-bold">{account?.fullName ?? "this member"}</span>
          {account?.email && <span className="text-white/60"> ({account.email})</span>}. Anything
          you change here is changed on their account.
          <span className="ml-1 hidden text-white/45 sm:inline">
            Started by {impersonation.byName}. Ends automatically after 30 minutes.
          </span>
        </p>

        {error && (
          <p role="alert" className="w-full text-[12.5px] font-semibold text-danger sm:w-auto">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleReturn}
          disabled={leaving}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 transition hover:brightness-95 disabled:opacity-60"
        >
          {leaving ? (
            <>
              <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              Returning…
            </>
          ) : (
            <>
              <EyeOff className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              Return to my admin account
            </>
          )}
        </button>
      </div>
    </div>
  );
}
