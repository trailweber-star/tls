import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, Loader2, Mail } from "lucide-react";
import { Panel } from "../DashboardShell";
import { Field } from "../AuthLayout";
import { ApiError, accountApi } from "../../lib/dashboardApi";
import type { EmailChangeRequest } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * The address on the account
 *
 * The screen's whole job is to make one thing obvious: this does not
 * happen when you press the button. Two emails go out, both have to be
 * answered, and until they are, the address has not moved. A panel that
 * said "saved" and then quietly did nothing for a day would be worse
 * than no panel.
 *
 * So once a change is in flight the form is replaced by its state —
 * which of the two has confirmed, which is still waiting — and the way
 * out is a cancel button rather than a second form.
 * ------------------------------------------------------------------ */
export function EmailAddressPanel() {
  const { account, impersonation, refresh } = useAuth();

  const [pending, setPending] = useState<EmailChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devLinks, setDevLinks] = useState<{ confirm: string; approve: string; cancel: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await accountApi.emailChange();
      setPending(res.request);
    } catch {
      setPending(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await accountApi.startEmailChange(newEmail.trim(), password);
      setPending(res.request);
      setDevLinks(res.devLinks ?? null);
      setNewEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await accountApi.cancelEmailChange();
      setPending(null);
      setDevLinks(null);
      /* The address may have moved while this screen was open — a
         confirmation from the other mailbox does not tell the browser
         anything. */
      await refresh();
    } catch {
      /* Already gone. Reloading shows whatever the truth is. */
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (impersonation) {
    return (
      <Panel title="Email address">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          You're signed in as {account?.fullName ?? "this member"} from your admin account. The address on
          an account can only be changed by the person who owns it.
        </p>
      </Panel>
    );
  }

  const input =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

  return (
    <Panel title="Email address">
      {loading ? (
        <p className="text-[13px] text-ink-faint">Checking…</p>
      ) : pending ? (
        <div className="space-y-4">
          <div>
            <p className="text-[13.5px] text-ink-muted">Moving to</p>
            <p className="break-all text-[15px] font-bold text-ink">{pending.newEmail}</p>
          </div>

          {/* Both, or nothing. Saying which is outstanding is the
              difference between "waiting" and "broken". */}
          <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
            <ConfirmRow
              done={pending.newConfirmed}
              label="The new address confirms it's real"
              address={pending.newEmail}
            />
            <ConfirmRow
              done={pending.oldConfirmed}
              label="This address approves the move"
              address={pending.oldEmail}
            />
          </ul>

          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Until both are done, you keep signing in with{" "}
            <span className="font-semibold text-ink">{pending.oldEmail}</span>. The links expire{" "}
            {relativeExpiry(pending.expiresAt)}.
          </p>

          {devLinks && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-500/30">
              <p className="text-[12px] font-bold uppercase tracking-wide text-amber-800">
                No mail provider configured
              </p>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                These are the links that would have been emailed. They won't appear on a deployed site.
              </p>
              <div className="mt-2 space-y-1">
                {(
                  [
                    ["Confirm (new address)", devLinks.confirm],
                    ["Approve (this address)", devLinks.approve],
                    ["Cancel", devLinks.cancel],
                  ] as const
                ).map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    className="block break-all text-[12px] font-semibold text-teal-700 hover:underline"
                  >
                    {label}: {href}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-ink-faint"
            >
              Check again
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-danger transition hover:border-danger/40 disabled:opacity-60"
            >
              Cancel this change
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={start} className="max-w-md space-y-4" noValidate>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
            >
              {error}
            </p>
          )}

          <div className="flex items-start gap-3 rounded-xl bg-paper-tint px-4 py-3">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2.2} />
            <div className="min-w-0">
              <p className="break-all text-[14px] font-bold text-ink">{account?.email}</p>
              <p className="text-[12.5px] text-ink-muted">The address you sign in with today</p>
            </div>
          </div>

          <Field label="New email address" htmlFor="new-email">
            <input
              id="new-email"
              type="email"
              required
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={input}
            />
          </Field>

          <Field label="Current password" htmlFor="email-change-password">
            <input
              id="email-change-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </Field>

          <p className="rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
            We'll email both addresses. The new one confirms it's real, and this one approves the move —
            nothing changes until both have. That's what stops somebody who gets a minute at your open
            laptop from pointing the account at themselves.
          </p>

          <button
            type="submit"
            disabled={busy || newEmail.trim().length === 0 || password.length === 0}
            className="flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Sending…" : "Send confirmation emails"}
          </button>
        </form>
      )}
    </Panel>
  );
}

function ConfirmRow({ done, label, address }: { done: boolean; label: string; address: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          done ? "bg-teal-600 text-white" : "bg-paper-tint text-ink-faint"
        }`}
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <Clock3 className="h-3 w-3" strokeWidth={2.5} />}
      </span>
      <div className="min-w-0">
        <p className={`text-[13px] font-bold ${done ? "text-ink" : "text-ink-muted"}`}>{label}</p>
        <p className="break-all text-[12px] text-ink-faint">
          {done ? "Done" : "Waiting"} — {address}
        </p>
      </div>
    </li>
  );
}

/** "in about 20 hours", "in under an hour", or "any moment now". */
function relativeExpiry(at: string) {
  const ms = new Date(at).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "in under an hour";
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}
