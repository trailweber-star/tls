import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, Lock, Trash2, UserPlus, Users } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { ApiError, dashboardApi } from "../../lib/dashboardApi";
import type { TeamMember } from "../../lib/dashboardApi";

/** Sub-Accounts & Multi-Practice Profiles is a Premium feature (checked
 *  server-side), so a 402 here locks the whole page -- same upgrade
 *  prompt used on Messages and Reviews rather than a generic error. */
function TeamLocked() {
  return (
    <Panel>
      <div className="flex flex-col items-start gap-3 py-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-tint px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-muted ring-1 ring-line">
          <Lock className="h-3 w-3" strokeWidth={2.4} />
          Premium
        </span>
        <h2 className="font-display text-[16px] font-bold text-ink">Sub-accounts are part of the Premium listing</h2>
        <p className="max-w-[56ch] text-[13.5px] leading-relaxed text-ink-muted">
          Bring a practice manager or receptionist into your dashboard without handing over your own login. They see
          enquiries, messages, reviews, analytics and the profile itself — never your plan or billing.
        </p>
        <a
          href="/dashboard/billing"
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-navy-950 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-navy-900"
        >
          See the plans
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
        </a>
      </div>
    </Panel>
  );
}

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLocked(false);
    try {
      const res = await dashboardApi.team();
      setMembers(res.results);
      setIsOwner(res.isOwner);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setLocked(true);
      else setError(err instanceof Error ? err.message : "Could not load your team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const res = await dashboardApi.inviteTeamMember(email.trim(), role.trim());
      setMembers((rows) => [...rows, res.member]);
      setEmail("");
      setRole("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send that invite");
    } finally {
      setInviting(false);
    }
  }

  async function remove(userId: string) {
    setRemovingId(userId);
    try {
      await dashboardApi.removeTeamMember(userId);
      setMembers((rows) => rows.filter((m) => m.userId !== userId));
    } catch {
      // Left in the list on failure — a vanished row the request didn't
      // actually remove would be a worse surprise than a static one.
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <DashboardShell
      title="Team"
      subtitle="Everyone who can sign in and help run this listing, alongside you."
    >
      {loading && <LoadingBlock label="Loading your team…" />}
      {locked && !loading && <TeamLocked />}
      {error && !loading && !locked && <ErrorBlock message={error} onRetry={load} />}

      {!loading && !error && !locked && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          {isOwner && (
            <Panel>
              <h2 className="font-display text-[15px] font-bold text-ink">Invite someone</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                They'll get an email to set their own password. Your plan and billing stay with your account only.
              </p>
              <form onSubmit={invite} className="mt-4 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-[12.5px] font-bold text-ink">
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="practice.manager@example.com"
                    className="rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] font-normal text-ink outline-none focus:border-teal-500"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[12.5px] font-bold text-ink">
                  Role (optional)
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Practice Manager"
                    className="rounded-lg border border-line bg-white px-3 py-2 text-[13.5px] font-normal text-ink outline-none focus:border-teal-500"
                  />
                </label>
                {inviteError && <p className="text-[12.5px] text-red-600">{inviteError}</p>}
                <button
                  type="submit"
                  disabled={inviting}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-navy-950 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-navy-900 disabled:opacity-60"
                >
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" strokeWidth={2.4} />}
                  Send invite
                </button>
              </form>
            </Panel>
          )}

          <Panel padded={false}>
            {members.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={Users}
                  title="Just you, for now"
                  body={
                    isOwner
                      ? "Invite a colleague with the form alongside to bring them into the dashboard."
                      : "Nobody else has been added to this listing yet."
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line-soft">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-ink">{m.email}</p>
                      <p className="text-[12px] text-ink-muted">
                        {m.role ? `${m.role} · ` : ""}
                        {m.acceptedAt ? `Joined ${relativeTime(m.acceptedAt)}` : "Invited, waiting to sign in"}
                      </p>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => remove(m.userId)}
                        disabled={removingId === m.userId}
                        className="shrink-0 rounded-full p-2 text-ink-faint transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label={`Remove ${m.email}`}
                      >
                        {removingId === m.userId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}
