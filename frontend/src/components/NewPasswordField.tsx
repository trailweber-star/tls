import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Field } from "./AuthLayout";

/* ------------------------------------------------------------------ *
 * Choosing a new password
 *
 * Used by the reset screen and by the Security panel on every
 * dashboard, so the rules a person is shown are the same wherever they
 * meet them — and the same as the ones the server actually enforces.
 * Two lists that drift apart produce the worst possible screen: one
 * that says the password is fine and a server that rejects it.
 *
 * The bar is length, not punctuation. "One capital, one number, one
 * symbol" reliably produces Password1! — it rules out the strong
 * passphrase and waves through the weak password, which is the wrong
 * way round. So the meter rewards length, and the only hard rules are
 * the two the server also applies: eight characters, and not something
 * an attacker would type first.
 * ------------------------------------------------------------------ */

const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "letmein1",
  "iloveyou",
  "welcome1",
  "abc12345",
  "demo1234",
]);

export interface PasswordVerdict {
  /** Would the server accept it? Nothing is submitted while this is false. */
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** The one thing standing in the way, or null. */
  problem: string | null;
}

/** Mirrors the server's checks in password.controller.js. */
export function judgePassword(value: string, account?: { email?: string; fullName?: string }): PasswordVerdict {
  if (!value) return { ok: false, score: 0, label: "", problem: null };

  if (value.length < 8) {
    return { ok: false, score: 0, label: "Too short", problem: "Use at least 8 characters" };
  }
  if (OBVIOUS.has(value.toLowerCase())) {
    return {
      ok: false,
      score: 0,
      label: "Guessable",
      problem: "That password is one of the first anybody would try. Pick another.",
    };
  }

  const lowered = value.toLowerCase();
  const local = (account?.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const names = (account?.fullName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 4);
  if ((local.length >= 4 && lowered.includes(local)) || names.some((n) => lowered.includes(n))) {
    return {
      ok: false,
      score: 0,
      label: "Too personal",
      problem: "Don't use your name or email address as your password",
    };
  }

  /* Length carries most of the weight, with a small credit for using
     more than one kind of character — which is a hint, not a rule. */
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  const raw = (value.length >= 16 ? 3 : value.length >= 12 ? 2 : value.length >= 10 ? 1 : 0) + (variety >= 3 ? 1 : 0);
  const score = Math.min(4, Math.max(1, raw)) as 1 | 2 | 3 | 4;

  return {
    ok: true,
    score,
    label: ["", "Weak", "Fair", "Good", "Strong"][score],
    problem: null,
  };
}

const BAR = ["bg-danger", "bg-danger", "bg-amber-500", "bg-teal-500", "bg-teal-600"];

/**
 * The new-password pair: the password itself with a strength read-out,
 * and a confirmation field that only appears once the first one is
 * worth confirming.
 */
export function NewPasswordField({
  value,
  confirm,
  onChange,
  onConfirmChange,
  account,
  label = "New password",
  id = "new-password",
  autoFocus = false,
}: {
  value: string;
  confirm: string;
  onChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  account?: { email?: string; fullName?: string };
  label?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const verdict = useMemo(() => judgePassword(value, account), [value, account]);
  const mismatch = confirm.length > 0 && confirm !== value;

  const input =
    "w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

  return (
    <>
      <Field label={label} htmlFor={id} error={value ? verdict.problem : null}>
        <div className="relative">
          <input
            id={id}
            name="newPassword"
            type={show ? "text" : "password"}
            required
            autoFocus={autoFocus}
            autoComplete="new-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${input} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-faint transition hover:text-ink"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {/* The meter appears with the first character and never blocks
            anything: it is advice, where the message above it is a rule. */}
        {value.length > 0 && (
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex h-1.5 flex-1 gap-1" aria-hidden>
              {[1, 2, 3, 4].map((step) => (
                <div
                  key={step}
                  className={`h-full flex-1 rounded-full transition-colors ${
                    verdict.ok && verdict.score >= step ? BAR[verdict.score] : "bg-line"
                  }`}
                />
              ))}
            </div>
            <span
              className={`w-14 shrink-0 text-right text-[11.5px] font-bold ${
                verdict.ok ? "text-ink-muted" : "text-danger"
              }`}
            >
              {verdict.label}
            </span>
          </div>
        )}

        {!value && (
          <p className="mt-1.5 text-[12px] text-ink-faint">
            Eight characters minimum. Length beats punctuation — three unrelated words is a better password
            than P@ssw0rd.
          </p>
        )}
      </Field>

      {/* Only once there is something to confirm. Asking somebody to
          type a password twice before they have typed it once is noise. */}
      {verdict.ok && (
        <Field label="Confirm new password" htmlFor={`${id}-confirm`} error={mismatch ? "These don't match" : null}>
          <div className="relative">
            <input
              id={`${id}-confirm`}
              name="confirmPassword"
              type={show ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => onConfirmChange(e.target.value)}
              className={`${input} pr-12`}
            />
            <span className="absolute inset-y-0 right-0 grid w-12 place-items-center">
              {confirm.length > 0 &&
                (mismatch ? (
                  <X className="h-4 w-4 text-danger" strokeWidth={2.5} />
                ) : (
                  <Check className="h-4 w-4 text-teal-600" strokeWidth={2.5} />
                ))}
            </span>
          </div>
        </Field>
      )}
    </>
  );
}

/** One place for "can this form be submitted", so no screen invents its own. */
export function passwordPairReady(value: string, confirm: string, account?: { email?: string; fullName?: string }) {
  return judgePassword(value, account).ok && confirm === value;
}
