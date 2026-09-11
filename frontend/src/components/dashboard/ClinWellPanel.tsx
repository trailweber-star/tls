import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ExternalLink, Gem, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Panel } from "../DashboardShell";
import { plansApi } from "../../lib/plansApi";
import type { ClinWellStatus } from "../../lib/plansApi";

/* ------------------------------------------------------------------ *
 * ClinWell.ai
 *
 * The clinical suite is a separate service, deliberately. This panel
 * shows entitlement and connection state and offers a single sign-on
 * hand-off — it never displays or stores patient data, because none of
 * it crosses into this application.
 *
 * Three states, and each says something true rather than filling space:
 *   not entitled — what tier it needs
 *   entitled, not connected — provisioned, awaiting the integration
 *   entitled and connected — the modules, live from ClinWell
 * ------------------------------------------------------------------ */

export function ClinWellPanel() {
  const [status, setStatus] = useState<ClinWellStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    plansApi
      .clinwell()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Panel title="ClinWell.ai">
        <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your suite…
        </p>
      </Panel>
    );
  }

  if (!status) return null;

  /* ------------------------------------------- not entitled */
  if (!status.entitled) {
    return (
      <Panel title="ClinWell.ai">
        <div className="flex flex-col items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-paper-tint text-ink-faint">
            <Lock className="h-5 w-5" strokeWidth={2} />
          </span>
          <p className="text-[13.5px] font-bold text-ink">Not on your plan</p>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            The EMR suite, AI clinical notes, NHS RTT tracking, e-prescriptions and telehealth come with the{" "}
            <strong className="font-bold text-ink">{status.requiredPlanName ?? "Full Practice Suite"}</strong>.
          </p>
          <Link
            to="/pricing"
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-teal-600"
          >
            <Gem className="h-3.5 w-3.5" strokeWidth={2.5} />
            See the Full Practice Suite
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        </div>
      </Panel>
    );
  }

  /* ------------------------------------------------ entitled */
  return (
    <Panel
      title="ClinWell.ai"
      action={
        <span
          className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${
            status.connected ? "bg-teal-50 text-teal-700" : "bg-amber/15 text-amber"
          }`}
        >
          {status.connected ? "Connected" : "Awaiting connection"}
        </span>
      }
    >
      <ul className="space-y-2.5">
        {(status.modules ?? []).map((m) => (
          <li key={m.key} className="flex gap-2.5">
            {status.connected ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" strokeWidth={3} aria-hidden />
            ) : (
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber"
                aria-hidden
              />
            )}
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{m.name}</span>
              <span className="block text-[12px] leading-snug text-ink-muted">{m.description}</span>
            </span>
          </li>
        ))}
      </ul>

      {status.connected && status.ssoUrl ? (
        <a
          href={status.ssoUrl}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-teal-600"
        >
          Open ClinWell
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
        </a>
      ) : (
        <p className="mt-5 flex gap-2 rounded-xl bg-paper-muted px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.5} />
          <span>
            Your workspace is reserved and your tier includes all five modules. ClinWell runs as a separate secure
            clinical system — no patient data is stored in your directory listing — and it goes live here as soon as the
            integration is switched on.
          </span>
        </p>
      )}
    </Panel>
  );
}
