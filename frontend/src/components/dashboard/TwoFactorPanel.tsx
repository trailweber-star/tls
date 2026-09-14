import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Panel } from "../DashboardShell";
import { Field } from "../AuthLayout";
import { ApiError, accountApi } from "../../lib/dashboardApi";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * Two-factor sign-in
 *
 * Setting it up is a sequence, and the panel is written as one: off,
 * then scanning, then confirmed with the recovery codes on screen.
 * Each state shows one thing to do.
 *
 * The two decisions worth knowing about:
 *
 * The typed secret is shown next to the QR code rather than behind a
 * "can't scan?" link. A good proportion of people set this up on the
 * phone that is displaying this page, and for them the camera is not an
 * option at all — hiding the fallback makes the flow fail for exactly
 * the people it is hardest for.
 *
 * The recovery codes cannot be dismissed by accident. They exist in
 * readable form on this screen and nowhere else, ever again, and
 * somebody who closes the panel without keeping them has quietly made
 * a lost phone into a lost account.
 * ------------------------------------------------------------------ */

type Stage = "loading" | "off" | "scanning" | "codes" | "on";

export function TwoFactorPanel() {
  const { account, impersonation } = useAuth();

  const [stage, setStage] = useState<Stage>("loading");
  const [remaining, setRemaining] = useState(0);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await accountApi.twoFactor();
      setRemaining(res.recoveryCodesRemaining);
      setStage(res.enabled ? "on" : "off");
    } catch {
      setStage("off");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setPassword("");
    setCode("");
    setError(null);
  };

  async function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSetup(await accountApi.startTwoFactor(password));
      setPassword("");
      setStage("scanning");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await accountApi.enableTwoFactor(code.trim());
      setCodes(res.recoveryCodes);
      setKept(false);
      setCode("");
      setStage("codes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.disableTwoFactor(password, code.trim());
      reset();
      setDisabling(false);
      setSetup(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function newCodes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await accountApi.regenerateRecoveryCodes(password);
      setCodes(res.recoveryCodes);
      setKept(false);
      setPassword("");
      setStage("codes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (impersonation) {
    return (
      <Panel title="Two-factor sign-in">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          You're signed in as {account?.fullName ?? "this member"} from your admin account. Two-factor can
          only be changed by the person who owns the account.
        </p>
      </Panel>
    );
  }

  const input =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";
  const codeInput =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-center font-mono text-[18px] tracking-[0.3em] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

  const problem = error && (
    <p
      role="alert"
      className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger ring-1 ring-danger/20"
    >
      {error}
    </p>
  );

  /* ------------------------------------------------- the codes */
  if (stage === "codes" && codes) {
    return (
      <Panel title="Save your recovery codes">
        <div className="space-y-4">
          <p className="text-[13.5px] leading-relaxed text-ink">
            These are the way back into your account if you lose the phone with your authenticator on it.
            Each one works once. <span className="font-bold">This is the only time they're shown.</span>
          </p>

          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-paper-tint p-4 font-mono text-[13.5px] text-ink">
            {codes.map((c) => (
              <li key={c} className="tracking-wide">
                {c}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(codes.join("\n")).catch(() => null)}
              className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-ink-faint"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={2.4} />
              Copy all
            </button>
          </div>

          {/* A tick rather than a close button: the panel does not move
              on until somebody has actually said they have them. */}
          <label className="flex cursor-pointer items-start gap-2.5 select-none">
            <input
              type="checkbox"
              checked={kept}
              onChange={(e) => setKept(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-line accent-teal-600"
            />
            <span className="text-[13px] font-semibold text-ink">
              I've saved these somewhere I'll still have them if my phone is gone
            </span>
          </label>

          <button
            type="button"
            disabled={!kept}
            onClick={() => {
              setCodes(null);
              setSetup(null);
              void load();
            }}
            className="rounded-full bg-teal-600 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            Done
          </button>
        </div>
      </Panel>
    );
  }

  /* ------------------------------------------------ scanning */
  if (stage === "scanning" && setup) {
    return (
      <Panel title="Set up two-factor">
        <form onSubmit={confirm} className="space-y-4" noValidate>
          {problem}

          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            Open your authenticator app — Google Authenticator, 1Password, Authy, whichever you use — and
            add this account.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              className="h-44 w-44 shrink-0 self-start rounded-xl ring-1 ring-line"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">
                Or type this in instead
              </p>
              <p className="break-all rounded-xl bg-paper-tint p-3 font-mono text-[13px] tracking-wide text-ink">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </p>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(setup.secret).catch(() => null)}
                className="flex items-center gap-2 text-[12.5px] font-bold text-teal-700 hover:underline"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={2.4} />
                Copy the key
              </button>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                Setting this up on the same phone you're reading this on? The camera can't see its own
                screen — use the key.
              </p>
            </div>
          </div>

          <Field label="Now enter the six digits it shows" htmlFor="setup-code">
            <input
              id="setup-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={codeInput}
            />
          </Field>

          <p className="rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
            Nothing changes about signing in until you enter a code here — so a QR code that didn't scan
            properly can't lock you out.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Checking…" : "Turn on two-factor"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                reset();
                setStage("off");
              }}
              className="rounded-full border border-line px-5 py-3 text-[13px] font-bold text-ink transition hover:border-ink-faint"
            >
              Cancel
            </button>
          </div>
        </form>
      </Panel>
    );
  }

  /* ------------------------------------------------------ on */
  if (stage === "on") {
    return (
      <Panel title="Two-factor sign-in">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-teal-50 px-4 py-3 ring-1 ring-teal-500/20">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" strokeWidth={2.2} />
            <div>
              <p className="text-[14px] font-bold text-ink">It's on.</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
                Signing in asks for a code from your authenticator app as well as your password.
              </p>
            </div>
          </div>

          <p className="text-[13px] text-ink-muted">
            <span className="font-bold text-ink">{remaining}</span> recovery code
            {remaining === 1 ? "" : "s"} left.
            {remaining <= 3 && remaining > 0 && " Worth issuing a new set."}
            {remaining === 0 && " Issue a new set — with none left, a lost phone means a lost account."}
          </p>

          {problem}

          {disabling ? (
            <form onSubmit={turnOff} className="max-w-md space-y-3" noValidate>
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Turning it off needs your password and a current code — the same as turning it on, because
                somebody who has got hold of your session would want this more than anything.
              </p>
              <input
                type="password"
                required
                placeholder="Current password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={14}
                placeholder="Code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={codeInput}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || !password || code.trim().length < 6}
                  className="flex items-center gap-2 rounded-full bg-danger px-6 py-3 text-[14px] font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Turn off two-factor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDisabling(false);
                    reset();
                  }}
                  className="rounded-full border border-line px-5 py-3 text-[13px] font-bold text-ink transition hover:border-ink-faint"
                >
                  Keep it on
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={newCodes} className="max-w-md space-y-3" noValidate>
              <Field label="New recovery codes" htmlFor="regen-password">
                <input
                  id="regen-password"
                  type="password"
                  placeholder="Current password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={input}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || !password}
                  className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-ink-faint disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Issue a new set
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDisabling(true);
                    reset();
                  }}
                  className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-bold text-danger transition hover:border-danger/40"
                >
                  <ShieldOff className="h-3.5 w-3.5" strokeWidth={2.4} />
                  Turn it off
                </button>
              </div>
              <p className="text-[12px] text-ink-faint">
                A new set replaces the old one — anything written down before stops working.
              </p>
            </form>
          )}
        </div>
      </Panel>
    );
  }

  /* ----------------------------------------------------- off */
  return (
    <Panel title="Two-factor sign-in">
      <form onSubmit={begin} className="max-w-md space-y-4" noValidate>
        {problem}

        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" strokeWidth={2.2} />
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            Ask for a six-digit code from your phone as well as your password. It's the single most
            effective thing you can do for this account: a password can be guessed, reused somewhere that
            was breached, or typed into a page that only looked like ours — a code from your own phone
            can't be any of those.
          </p>
        </div>

        <Field label="Current password" htmlFor="twofactor-password">
          <input
            id="twofactor-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </Field>

        <button
          type="submit"
          disabled={busy || stage === "loading" || !password}
          className="flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
          {busy ? "Starting…" : "Set up two-factor"}
        </button>
      </form>
    </Panel>
  );
}
