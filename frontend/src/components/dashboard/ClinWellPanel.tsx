import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, ExternalLink, Gem, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { Panel } from "../DashboardShell";
import { plansApi } from "../../lib/plansApi";
import type { ClinWellStatus } from "../../lib/plansApi";

/* ------------------------------------------------------------------ *
 * ClinWell.ai
 *
 * The clinical suite is a separate service, deliberately. This panel
 * shows entitlement and workspace state and never displays or stores
 * patient data, because none of it crosses into this application.
 *
 * THERE IS NO SINGLE SIGN-ON, AND THAT CHANGES THIS PANEL'S JOB.
 *
 * Contract §1 and §6.1: a practitioner gets into ClinWell through an
 * invitation email ClinWell sends when the workspace is created, and
 * TLS never handles a ClinWell login. An earlier version of this panel
 * offered an "Open ClinWell" button, which meant that once SSO turned
 * out not to exist, it said "Connected" and then showed no way in at
 * all.
 *
 * So the panel's job is not a hand-off link. It is telling the
 * practitioner the two things the contract makes TLS responsible for
 * saying, and which nothing else in the product says:
 *
 *   1. Sign in with the SAME email address the invitation went to. A
 *      different Google account is not recognised — and the failure is
 *      silent, so somebody who tries their personal Google account
 *      simply cannot get in and has no idea why.
 *   2. Expect two-step verification on first sign-in. A minute with an
 *      authenticator app, but alarming if unannounced.
 *
 * Four states, each saying something true rather than filling space:
 *   not entitled        — what tier it needs
 *   no workspace yet    — being prepared, nothing to do
 *   pending_invite      — check your email, and which address
 *   active              — how to get in, plus the two warnings
 *   suspended           — §6.5, and that it is fixed here, not there
 * ------------------------------------------------------------------ */

/** Where a practitioner signs in. Not an SSO hand-off — just the door. */
const SIGN_IN_FALLBACK = "https://app.clinwell.ai/";

function Badge({ tone, children }: { tone: "live" | "waiting" | "bad"; children: React.ReactNode }) {
  const tones = {
    live: "bg-teal-50 text-teal-700",
    waiting: "bg-amber/15 text-amber",
    bad: "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Note({
  icon,
  children,
  tone = "quiet",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "quiet" | "warn";
}) {
  return (
    <p
      className={`mt-4 flex gap-2 rounded-xl px-4 py-3 text-[12px] leading-relaxed ${
        tone === "warn" ? "bg-amber/10 text-ink" : "bg-paper-muted text-ink-muted"
      }`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * The two things §6.1 requires us to tell them, in both the
 * pending-invite and active states — because somebody who signed in
 * once on a laptop hits the same wall on a phone six months later.
 */
function SignInRules({ email }: { email?: string | null }) {
  return (
    <ul className="mt-4 space-y-2 text-[12px] leading-relaxed text-ink-muted">
      <li className="flex gap-2">
        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.5} aria-hidden />
        <span>
          Sign in with{" "}
          {email ? (
            <strong className="font-bold text-ink">{email}</strong>
          ) : (
            <strong className="font-bold text-ink">the address your invitation was sent to</strong>
          )}
          . A different Google account will not be recognised, and it fails without saying why.
        </span>
      </li>
      <li className="flex gap-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2.5} aria-hidden />
        <span>
          ClinWell may ask you to set up two-step verification the first time. It takes a minute with an authenticator
          app.
        </span>
      </li>
    </ul>
  );
}

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

  const workspaceStatus = status.status ?? null;
  const hasWorkspace = Boolean(status.workspaceId);
  const signInUrl = status.signInUrl ?? SIGN_IN_FALLBACK;

  /* ------------------------------------------- suspended (§6.5) */
  if (workspaceStatus === "suspended") {
    return (
      <Panel title="ClinWell.ai" action={<Badge tone="bad">Suspended</Badge>}>
        <div className="flex flex-col items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-rose-50 text-rose-700">
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          </span>
          <p className="text-[13.5px] font-bold text-ink">Your workspace is suspended</p>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Your clinical records are untouched — ClinWell never deletes a record because a subscription lapsed. Access
            comes back as soon as the subscription is sorted out, and that is done here rather than in ClinWell.
          </p>
          <Link
            to="/dashboard/billing"
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-teal-600"
          >
            Sort out billing
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        </div>
      </Panel>
    );
  }

  /* --------------------------------- entitled, no workspace yet */
  if (!hasWorkspace) {
    return (
      <Panel title="ClinWell.ai" action={<Badge tone="waiting">Being prepared</Badge>}>
        <ul className="space-y-2.5">
          {(status.modules ?? []).map((m) => (
            <li key={m.key} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{m.name}</span>
                <span className="block text-[12px] leading-snug text-ink-muted">{m.description}</span>
              </span>
            </li>
          ))}
        </ul>
        <Note icon={<ShieldCheck className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.5} />}>
          Your tier includes all five modules and your workspace is being set up now. ClinWell will email your
          invitation when it is ready — there is nothing for you to do, and nothing has gone wrong.
        </Note>
      </Panel>
    );
  }

  /* -------------------------------- workspace exists, awaiting sign-in */
  if (workspaceStatus === "pending_invite") {
    return (
      <Panel title="ClinWell.ai" action={<Badge tone="waiting">Check your email</Badge>}>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          Your workspace is ready and ClinWell has emailed your invitation. It expires after 7 days; you can ask for a
          new one from their sign-in page if it lapses.
        </p>
        <SignInRules email={status.invitationEmail} />
        <a
          href={signInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-ink/10 px-4 py-2.5 text-[12.5px] font-bold text-ink transition hover:border-ink/20"
        >
          Go to ClinWell sign-in
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
        </a>
      </Panel>
    );
  }

  /* ------------------------------------------------ active */
  return (
    <Panel title="ClinWell.ai" action={<Badge tone="live">Active</Badge>}>
      <ul className="space-y-2.5">
        {(status.modules ?? []).map((m) => (
          <li key={m.key} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" strokeWidth={3} aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{m.name}</span>
              <span className="block text-[12px] leading-snug text-ink-muted">{m.description}</span>
            </span>
          </li>
        ))}
      </ul>

      <SignInRules email={status.invitationEmail} />

      <a
        href={signInUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-teal-600"
      >
        Open ClinWell
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
      </a>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
        ClinWell runs as a separate secure clinical system. No patient data is stored in your directory listing.
      </p>
    </Panel>
  );
}
