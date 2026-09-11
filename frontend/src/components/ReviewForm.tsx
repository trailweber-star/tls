import { useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Star } from "lucide-react";
import { createFacilityReview, createSpecialistReview } from "../lib/api";
import type { ReviewInput } from "../lib/api";

/* ------------------------------------------------------------------ *
 * Writing a review
 *
 * The endpoint has existed since the directory was built; nothing on the
 * site ever called it, so the specialist dashboard's line about patients
 * leaving reviews "from your public profile" was describing a button
 * that did not exist. This is that button.
 *
 * Two things are said plainly on the form rather than buried: the review
 * is read by a person before it appears, and it is published under the
 * name you type. Both are true, both change what someone writes, and
 * finding either out afterwards is how a directory loses trust.
 * ------------------------------------------------------------------ */

/** The four things a patient is asked to score, beyond the headline. */
const CATEGORIES = [
  { key: "communication", label: "Communication", hint: "Did they explain things clearly?" },
  { key: "expertise", label: "Expertise", hint: "Did you feel in capable hands?" },
  { key: "care", label: "Care", hint: "Were you treated with kindness?" },
  { key: "waitTime", label: "Wait time", hint: "How long did you wait to be seen?" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function ReviewForm({
  subject,
  slug,
  name,
  /** Conditions and treatments this listing is tagged with, for "Seen for". */
  seenForOptions = [],
  onSubmitted,
}: {
  subject: "specialist" | "facility";
  slug: string;
  name: string;
  seenForOptions?: { id: string; name: string }[];
  onSubmitted?: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [scores, setScores] = useState<Record<CategoryKey, number>>({
    communication: 0,
    expertise: 0,
    care: 0,
    waitTime: 0,
  });
  const [comment, setComment] = useState("");
  const [patientName, setPatientName] = useState("");
  const [conditionId, setConditionId] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating < 1) {
      setError("Please choose a star rating.");
      return;
    }
    setStatus("sending");
    setError(null);

    const payload: ReviewInput = {
      rating,
      comment: comment.trim() || undefined,
      patientName: patientName.trim() || undefined,
      conditionId: conditionId || null,
      // Untouched categories are sent as null rather than 0 — a score of
      // zero would drag the breakdown down for a question nobody
      // answered.
      scores: {
        communication: scores.communication || null,
        expertise: scores.expertise || null,
        care: scores.care || null,
        waitTime: scores.waitTime || null,
      },
    };

    try {
      if (subject === "facility") await createFacilityReview(slug, payload);
      else await createSpecialistReview(slug, payload);
      setStatus("sent");
      onSubmitted?.();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send your review. Please try again.");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl bg-paper-muted p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-teal-600" strokeWidth={1.75} />
        <p className="mt-3 font-display text-[18px] font-bold text-ink">Thank you</p>
        {/* Says exactly what happens next. "Submitted!" would leave
            someone refreshing the page looking for words that are not
            going to appear for a day. */}
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-muted">
          Your review has been sent to our team. Someone reads every review before it goes live, so it will appear on
          {" "}{name}&apos;s profile once it has been checked — usually within a day.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset>
        <legend className="text-[13px] font-bold text-ink">
          Overall, how was your experience with {name}?
        </legend>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setRating(n);
                  setError(null);
                }}
                onMouseEnter={() => setHovered(n)}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                aria-pressed={rating === n}
                className="rounded p-0.5 transition hover:scale-110"
              >
                <Star
                  className={`h-8 w-8 ${
                    n <= (hovered || rating) ? "fill-amber text-amber" : "fill-line text-line"
                  }`}
                  strokeWidth={0}
                />
              </button>
            ))}
          </div>
          {(hovered || rating) > 0 && (
            <span className="text-[13.5px] font-bold text-ink">{RATING_WORDS[hovered || rating]}</span>
          )}
        </div>
      </fieldset>

      {/* Optional by design. Requiring four more scores after the star
          rating is how you turn a review into a form nobody finishes. */}
      <fieldset>
        <legend className="text-[13px] font-bold text-ink">
          Rate the details <span className="font-normal text-ink-faint">— optional</span>
        </legend>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          {CATEGORIES.map((cat) => (
            <div key={cat.key} className="rounded-xl bg-paper-muted px-3.5 py-2.5">
              <p className="text-[12.5px] font-semibold text-ink">{cat.label}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-faint">{cat.hint}</p>
              <div className="mt-1.5 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScores((s) => ({ ...s, [cat.key]: s[cat.key] === n ? 0 : n }))}
                    aria-label={`${cat.label}: ${n} of 5`}
                    className="rounded p-0.5 transition hover:scale-110"
                  >
                    <Star
                      className={`h-4 w-4 ${n <= scores[cat.key] ? "fill-amber text-amber" : "fill-line text-line"}`}
                      strokeWidth={0}
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {seenForOptions.length > 0 && (
        <label className="block">
          <span className="text-[13px] font-bold text-ink">
            What were you seen for? <span className="font-normal text-ink-faint">— optional</span>
          </span>
          <select
            id="review-seen-for"
            value={conditionId}
            onChange={(e) => setConditionId(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none transition focus:border-teal-500"
          >
            <option value="">Prefer not to say</option>
            {seenForOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] text-ink-faint">
            Shown on your review, so other patients can find people with the same problem.
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-[13px] font-bold text-ink">
          Tell others about it <span className="font-normal text-ink-faint">— optional</span>
        </span>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="What happened, what was handled well, and what someone in your position would want to know."
          className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500"
        />
        <span className="mt-1 block text-right text-[11.5px] text-ink-faint">{comment.length}/2000</span>
      </label>

      <label className="block">
        <span className="text-[13px] font-bold text-ink">Your name</span>
        <input
          id="review-name"
          type="text"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          maxLength={120}
          placeholder="e.g. Janet H."
          className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500"
        />
        <span className="mt-1 block text-[11.5px] text-ink-faint">
          Published exactly as you type it. A first name and an initial is plenty — please don&apos;t include anything
          you would not want a stranger to read. Leave it blank to appear as Anonymous.
        </span>
      </label>

      {/* The moderation promise, made before you write rather than after
          you press send. */}
      <p className="flex items-start gap-2 rounded-xl bg-paper-tint px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" strokeWidth={2} />
        <span>
          A member of our team reads every review before it appears. Nothing you write is published straight away, and
          nothing about your health is stored beyond what you type here.
        </span>
      </p>

      {error && <p className="text-[13px] font-semibold text-danger">{error}</p>}

      <button
        type="submit"
        disabled={status === "sending"}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-navy-950 px-6 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
      >
        {status === "sending" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
        {status === "sending" ? "Sending…" : "Submit review"}
      </button>
    </form>
  );
}
