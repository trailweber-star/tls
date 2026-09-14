import { useCallback, useEffect, useState } from "react";
import { Loader2, LogOut, Monitor, Shield, Smartphone } from "lucide-react";
import { Panel } from "../DashboardShell";
import { ApiError, accountApi } from "../../lib/dashboardApi";
import type { DeviceSession } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";
import { relativeTime } from "./ui";

/* ------------------------------------------------------------------ *
 * Where this account is signed in
 *
 * The question somebody opens this for is never "how many devices" —
 * it is "is there one here I don't recognise". So the list leads with
 * what a person can actually recognise (Safari on iPhone, last used
 * twenty minutes ago) and puts the button that does something about it
 * on the same row.
 *
 * A support session — an administrator signed in as this member — is
 * shown and labelled rather than hidden. Somebody whose account was
 * entered has a right to see that it was, and a list that quietly
 * omitted those would be worth less than no list at all.
 * ------------------------------------------------------------------ */
export function DevicesPanel() {
  const { signOut } = useAuth();

  const [rows, setRows] = useState<DeviceSession[]>([]);
  const [listed, setListed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await accountApi.sessions();
      setRows(res.results);
      setListed(res.currentIsListed);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function end(id: string) {
    setBusy(id);
    try {
      const res = await accountApi.endSession(id);
      /* Ending the session you are using is just signing out, and the
         browser has to be told — otherwise it carries on holding a
         token the server has already refused. */
      if (res.endedCurrent) {
        signOut();
        return;
      }
      await load();
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function endOthers() {
    setBusy("others");
    try {
      await accountApi.endOtherSessions();
      await load();
    } finally {
      setBusy(null);
    }
  }

  const others = rows.filter((r) => !r.current).length;

  return (
    /* The heading is drawn here rather than passed to Panel, because the
       list below runs edge to edge (padded={false}) and Panel's own
       header would then sit flush against the panel's edge while every
       other panel's title has a gutter. */
    <Panel padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <h2 className="font-display text-[16px] font-bold text-ink">Where you're signed in</h2>
        {others > 0 && (
          <button
            type="button"
            onClick={endOthers}
            disabled={busy === "others"}
            className="flex items-center gap-1.5 text-[12.5px] font-bold text-teal-700 hover:underline disabled:opacity-60"
          >
            {busy === "others" && <Loader2 className="h-3 w-3 animate-spin" />}
            Sign out the other {others === 1 ? "one" : others}
          </button>
        )}
      </div>

      {error && (
        <p className="px-5 pb-4 text-[13px] font-semibold text-danger sm:px-6">{error}</p>
      )}

      {loading ? (
        <p className="px-5 pb-5 text-[13px] text-ink-faint sm:px-6">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-muted sm:px-6">
          Nothing to show. {listed ? "" : "This session was opened before we started keeping this list."}
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-3 px-5 py-4 sm:px-6">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-tint text-ink-muted">
                {row.support ? (
                  <Shield className="h-4 w-4" strokeWidth={2.2} />
                ) : row.platform === "iPhone" || row.platform === "Android" || row.platform === "iPad" ? (
                  <Smartphone className="h-4 w-4" strokeWidth={2.2} />
                ) : (
                  <Monitor className="h-4 w-4" strokeWidth={2.2} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
                  {row.label}
                  {row.current && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-700 ring-1 ring-teal-500/20">
                      This device
                    </span>
                  )}
                  {row.support && (
                    <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber ring-1 ring-amber/30">
                      Support session
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Last used {relativeTime(row.lastSeenAt)}
                  {row.ip ? ` · ${row.ip}` : ""}
                  {row.country ? ` · ${row.country}` : ""}
                </p>
                {row.support && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                    One of our team signed in to your account to help with something. Ending it here
                    stops that immediately.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => end(row.id)}
                disabled={busy === row.id}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-bold text-ink transition hover:border-ink-faint disabled:opacity-60"
              >
                {busy === row.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" strokeWidth={2.4} />
                )}
                {row.current ? "Sign out" : "End"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
