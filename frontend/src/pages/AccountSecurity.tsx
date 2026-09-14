import { useState } from "react";
import { useLocation } from "react-router-dom";
import { KeyRound, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { DashboardShell, Panel } from "../components/DashboardShell";
import { ChangePasswordPanel } from "../components/dashboard/ChangePasswordPanel";
import { EmailAddressPanel } from "../components/dashboard/EmailAddressPanel";
import { TwoFactorPanel } from "../components/dashboard/TwoFactorPanel";
import { DevicesPanel } from "../components/dashboard/DevicesPanel";
import { useAuth } from "../lib/auth";

/* ------------------------------------------------------------------ *
 * Account & security
 *
 * One screen, mounted on both workspaces. An administrator, a
 * consultant and a clinic all reach it from the same place in their own
 * sidebar and see the same thing, because "where do I change my
 * password" is not a question that should have three answers.
 *
 * Ordered by how often somebody comes here for it: the password, the
 * address, the second factor, then the list of devices — which is the
 * one people arrive at in a hurry, so it is also the one the summary at
 * the top points to.
 * ------------------------------------------------------------------ */
export default function AccountSecurity({ variant = "specialist" }: { variant?: "specialist" | "admin" }) {
  const { account } = useAuth();
  const location = useLocation();

  /* Signing in with a recovery code is carried here from the sign-in
     screen, so it can be said once, at the moment it is true. Somebody
     who has just spent one has probably lost their phone, and that is
     the moment to mention it — not in a settings panel they may not
     open for a month. */
  const spent = (location.state as { recoveryCodeUsed?: number } | null)?.recoveryCodeUsed;
  /* Initialised from the navigation state rather than synced to it by an
     effect: the state is fixed for the life of this mount, and an effect
     would only add a second render to arrive at the same value. */
  const [notice, setNotice] = useState<number | null>(typeof spent === "number" ? spent : null);

  return (
    <DashboardShell
      variant={variant}
      title="Account & security"
      eyebrow="Your account"
      icon={ShieldCheck}
      subtitle="Your sign-in details, and where this account is open. Nobody else can see or change these, including us."
    >
      <div className="space-y-5">
        {notice !== null && (
          <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-500/30 sm:p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={2.2} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-ink">You signed in with a recovery code.</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                {notice === 0
                  ? "That was your last one. Set two-factor up again on a device you have now, or a lost phone will mean a lost account."
                  : `${notice} left. If you've lost the phone your authenticator was on, set it up again below — the codes on this account are only useful until they run out.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-[12.5px] font-bold text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-5">
            <ChangePasswordPanel />
            <EmailAddressPanel />
            <TwoFactorPanel />
            <DevicesPanel />
          </div>

          <div className="space-y-5">
            <Panel title="This account">
              <dl className="space-y-3.5 text-[13.5px]">
                <div className="flex gap-3">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
                  <div className="min-w-0">
                    <dt className="font-bold text-ink">{account?.fullName ?? "—"}</dt>
                    <dd className="text-ink-muted">
                      {account?.role === "admin" ? "Administrator" : "Member"}
                    </dd>
                  </div>
                </div>
                <div className="flex gap-3">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
                  <div className="min-w-0">
                    <dt className="font-bold break-all text-ink">{account?.email ?? "—"}</dt>
                    <dd className="text-ink-muted">The address you sign in with</dd>
                  </div>
                </div>
              </dl>
            </Panel>

            <Panel title="If you're ever locked out">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Use <span className="font-semibold text-ink">Forgot password?</span> on the sign-in page.
                It emails a link that works once, for an hour. With two-factor on, one of your recovery
                codes gets you past the code step. You don't need to contact anybody for either.
              </p>
            </Panel>

            <Panel title="What we'd suggest">
              <ul className="divide-y divide-line text-[13px] leading-relaxed text-ink-muted">
                {[
                  "Turn on two-factor. It's the one change here that makes a stolen password useless.",
                  "Keep your recovery codes somewhere that isn't the phone your authenticator is on.",
                  "Glance at the device list now and then. Anything you don't recognise, end it and change your password.",
                ].map((line) => (
                  <li key={line} className="py-2 first:pt-0 last:pb-0">
                    {line}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
