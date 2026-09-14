import { KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { DashboardShell, Panel } from "../components/DashboardShell";
import { ChangePasswordPanel } from "../components/dashboard/ChangePasswordPanel";
import { useAuth } from "../lib/auth";

/* ------------------------------------------------------------------ *
 * Account & security
 *
 * One screen, mounted on both workspaces. An administrator, a
 * consultant and a clinic all reach it from the same place in their own
 * sidebar and see the same thing, because "where do I change my
 * password" is not a question that should have three answers.
 *
 * It is deliberately short. Everything on it is something a person can
 * actually do today; the things that are coming — changing the address
 * on the account, notification preferences — are named at the bottom
 * rather than shown as controls that do nothing.
 * ------------------------------------------------------------------ */
export default function AccountSecurity({ variant = "specialist" }: { variant?: "specialist" | "admin" }) {
  const { account } = useAuth();

  return (
    <DashboardShell
      variant={variant}
      title="Account & security"
      eyebrow="Your account"
      icon={ShieldCheck}
      subtitle="Your sign-in details. Nobody else can see or change these, including us."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-5">
          <ChangePasswordPanel />
        </div>

        <div className="space-y-5">
          <Panel title="Signing in">
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
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
                <div className="min-w-0">
                  <dt className="font-bold break-all text-ink">{account?.email ?? "—"}</dt>
                  <dd className="text-ink-muted">The address you sign in with</dd>
                </div>
              </div>
            </dl>
          </Panel>

          <Panel title="If you're ever locked out">
            <p className="flex gap-3 text-[13px] leading-relaxed text-ink-muted">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
              <span>
                Use <span className="font-semibold text-ink">Forgot password?</span> on the sign-in page. It
                emails a link to the address above that works once, for an hour. You don't need to contact
                anybody.
              </span>
            </p>
          </Panel>

          <Panel title="Not here yet">
            <ul className="divide-y divide-line text-[13px] leading-relaxed text-ink-muted">
              {[
                "Changing the email address on the account — it needs confirming at both addresses",
                "Two-factor sign-in",
                "A list of the devices currently signed in",
              ].map((item) => (
                <li key={item} className="py-2 first:pt-0 last:pb-0">
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </DashboardShell>
  );
}
