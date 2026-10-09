import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EyeOff, LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { getAdminToken, getToken, membersApi, setAdminToken, setToken } from "../lib/dashboardApi";

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
  const { impersonation, account, stopImpersonation, refresh } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  /* Set while the parked-admin-token recovery in auth.tsx's refresh()
     is running, after stopImpersonation() itself has failed. */
  const [recovering, setRecovering] = useState(false);
  /* Set once refresh() has run and there is no account to show for
     it — the borrowed token was dead AND the parked admin token
     either didn't exist or was dead too. Nothing left to recover. */
  const [sessionExpired, setSessionExpired] = useState(false);

  // The session-expired message is a fixed bottom bar too, same as the
  // live banner — the page below still needs the room reserved for it.
  const active = Boolean(impersonation) || sessionExpired;

  /* Keep the bar from covering the last line of the page. Written and
     unwound here rather than in a stylesheet so nothing is left behind
     when the session ends. */
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "72px";
    /* Any other fixed bottom-0 bar (the profile editor's save bar, for
       one) needs to know this banner is there so it can stack above it
       instead of hiding underneath it -- see ProfileEditor.tsx. */
    document.documentElement.style.setProperty("--impersonation-bar-h", "72px");
    return () => {
      document.body.style.paddingBottom = previous;
      document.documentElement.style.removeProperty("--impersonation-bar-h");
    };
  }, [active]);

  /* refresh() resolves once the recovery attempt is fully settled, but
     it updates auth state through the context rather than returning an
     outcome — so the result is read back here, from the next render,
     rather than off the resolved promise. Both paths refresh() can end
     on clear `impersonation`, so that transition is what wakes this up;
     `account` is what tells the two paths apart.

     This has to run every render, not just while the banner is showing
     — it's declared before the early return below on purpose. Skipping
     it on some renders (it used to sit after that return) made this
     component call a different number of hooks from one render to the
     next, which is exactly what React's Rules of Hooks forbid: the
     moment `impersonation` resolved from empty to set, React would
     throw "Rendered more hooks than during the previous render" and
     take down the whole dashboard, not just this banner. */
  useEffect(() => {
    if (!recovering || impersonation) return;
    setRecovering(false);
    if (account) {
      navigate("/admin/members", { replace: true });
    } else {
      setSessionExpired(true);
    }
  }, [recovering, impersonation, account, navigate]);

  /* The banner also has to stay up once impersonation itself has
     gone — that's exactly the moment refresh() finished recovering
     (or failing to) and there's a message to show for it. */
  if (!impersonation && !sessionExpired) return null;

  async function handleReturn() {
    setLeaving(true);

    /* Put the administrator's own login back and reload the admin page.
       No waiting on the server and no in-memory state to untangle: a
       full page load is the one path that has always come back clean.
       The borrowed session is closed on the server in the background. */
    const borrowed = getToken();
    const parked = getAdminToken();
    if (parked) {
      setToken(parked);
      setAdminToken(null);
      if (borrowed) void membersApi.stopImpersonating(borrowed).catch(() => {});
      window.location.assign("/admin/members");
      return;
    }

    try {
      await stopImpersonation();
      navigate("/admin/members", { replace: true });
    } catch {
      /* The borrowed token is most likely already dead server-side —
         a 401 on the very call meant to end it cleanly. That's the
         situation refresh() exists to recover from: it holds the
         administrator's own token aside for exactly this case and
         swaps it back in. Call into that instead of leaving the
         admin stuck behind a banner whose only button doesn't work. */
      setLeaving(false);
      setRecovering(true);
      await refresh();
    }
  }

  // Nothing left to hand back to: the borrowed token was dead and so
  // was the parked one. The only way out is signing in again.
  if (sessionExpired) {
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
            <span className="font-bold text-amber">Support session ended.</span>{" "}
            It expired before it could be closed normally, and we couldn't reconnect your admin
            account either — sign in again to get back to the admin workspace.
          </p>

          <a
            href="/signin"
            onClick={(e) => {
              e.preventDefault();
              navigate("/signin", { replace: true });
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 transition hover:brightness-95"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            Sign in again
          </a>
        </div>
      </div>
    );
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
            Started by {impersonation?.byName}. Ends automatically after 30 minutes.
          </span>
        </p>

        <button
          type="button"
          onClick={handleReturn}
          disabled={leaving || recovering}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 transition hover:brightness-95 disabled:opacity-60"
        >
          {leaving || recovering ? (
            <>
              <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              {recovering ? "Reconnecting…" : "Returning…"}
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
