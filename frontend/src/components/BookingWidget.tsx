import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CalendarX, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { ApiError, createAppointment, getAvailableSlots } from "../lib/api";

/* ------------------------------------------------------------------ *
 * Booking, inline on the public profile
 *
 * No account needed on this side, same reasoning as the enquiry form --
 * see backend/booking.controller.js for the slot logic this mirrors.
 * ------------------------------------------------------------------ */

const DAYS_OFFERED = 14;

function isoDate(d: Date) {
  // The LOCAL calendar date, not the UTC one -- toISOString().slice(0, 10)
  // reports whatever date UTC is on, which briefly disagrees with the
  // visitor's own "today" every night (from midnight local until
  // midnight UTC catches up), sending the wrong date to the backend and
  // showing the wrong day label right next to it. dayLabel below already
  // uses the visitor's local calendar via toLocaleDateString; this keeps
  // the two in agreement for the same Date object.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dayLabel(d: Date, isFirst: boolean) {
  if (isFirst) return "Today";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function BookingWidget({ slug, recipientName }: { slug: string; recipientName: string }) {
  const days = Array.from({ length: DAYS_OFFERED }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const [dayIndex, setDayIndex] = useState(0);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [checkedEmpty, setCheckedEmpty] = useState<Set<number>>(new Set());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    setSelectedSlot(null);
    getAvailableSlots(slug, isoDate(days[dayIndex]))
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        if (res.slots.length === 0) setCheckedEmpty((prev) => new Set(prev).add(dayIndex));
      })
      .catch(() => !cancelled && setSlots([]))
      .finally(() => !cancelled && setLoadingSlots(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIndex, slug]);

  const everythingCheckedEmpty = checkedEmpty.size >= DAYS_OFFERED;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;
    setStatus("sending");
    setErrorMessage(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await createAppointment(slug, {
        startsAt: selectedSlot,
        patientName: String(form.get("patientName") || ""),
        patientEmail: String(form.get("email") || "") || null,
        patientPhone: String(form.get("phone") || "") || null,
        notes: String(form.get("notes") || "") || null,
      });
      setStatus("sent");
    } catch (err) {
      // A slot taken between loading the list and submitting is the one
      // failure worth explaining specifically -- everything else is a
      // generic try-again.
      setErrorMessage(
        err instanceof ApiError && err.status === 409
          ? "That time was just taken. Please pick another."
          : "Something went wrong — please try again."
      );
      if (err instanceof ApiError && err.status === 409) {
        setSlots((s) => (s ?? []).filter((slot) => slot !== selectedSlot));
        setSelectedSlot(null);
      }
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-sm text-ink">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" strokeWidth={2.5} />
        <span>
          Booked for{" "}
          {selectedSlot &&
            new Date(selectedSlot).toLocaleString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          . {recipientName}&apos;s team will be expecting you.
        </span>
      </div>
    );
  }

  if (everythingCheckedEmpty) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line bg-paper-muted p-4 text-sm text-ink-muted">
        <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
        <span>
          {recipientName} isn&apos;t taking online bookings right now — send an enquiry instead and their team will
          get back to you directly.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Day strip */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          aria-label="Earlier days"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <div className="flex flex-1 gap-1.5 overflow-x-auto">
          {days.map((d, i) => (
            <button
              key={isoDate(d)}
              type="button"
              onClick={() => setDayIndex(i)}
              aria-pressed={i === dayIndex}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold transition ${
                i === dayIndex
                  ? "bg-navy-900 text-white"
                  : checkedEmpty.has(i)
                  ? "text-ink-faint hover:bg-paper-muted"
                  : "text-ink-muted hover:bg-paper-muted"
              }`}
            >
              {dayLabel(d, i === 0)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDayIndex((i) => Math.min(DAYS_OFFERED - 1, i + 1))}
          disabled={dayIndex === DAYS_OFFERED - 1}
          aria-label="Later days"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-paper-muted disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Slots */}
      {loadingSlots ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking availability…
        </div>
      ) : slots && slots.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => setSelectedSlot(slot)}
              aria-pressed={selectedSlot === slot}
              className={`rounded-lg px-3 py-2 text-[12.5px] font-bold transition ${
                selectedSlot === slot ? "bg-teal-600 text-white" : "bg-paper-muted text-ink hover:bg-line-soft"
              }`}
            >
              {timeLabel(slot)}
            </button>
          ))}
        </div>
      ) : (
        <p className="py-2 text-[13px] text-ink-faint">Nothing open this day — try another.</p>
      )}

      {/* Booking form, once a slot is picked */}
      {selectedSlot && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div>
            <label htmlFor="bw-patientName" className="text-xs font-semibold text-ink-muted">
              Your name
            </label>
            <input
              id="bw-patientName"
              name="patientName"
              required
              minLength={2}
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="bw-email" className="text-xs font-semibold text-ink-muted">
                Email
              </label>
              <input
                id="bw-email"
                name="email"
                type="email"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <label htmlFor="bw-phone" className="text-xs font-semibold text-ink-muted">
                Phone
              </label>
              <input
                id="bw-phone"
                name="phone"
                type="tel"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
              />
            </div>
          </div>
          <p className="text-[11.5px] text-ink-faint">
            An email or phone number so {recipientName.split(" ").slice(-1)[0]}&apos;s team can reach you.
          </p>
          <div>
            <label htmlFor="bw-notes" className="text-xs font-semibold text-ink-muted">
              Anything they should know? (optional)
            </label>
            <textarea
              id="bw-notes"
              name="notes"
              rows={2}
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
            />
          </div>
          <button
            type="submit"
            disabled={status === "sending"}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {status === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === "sending"
              ? "Booking…"
              : `Confirm ${timeLabel(selectedSlot)} on ${dayLabel(days[dayIndex], dayIndex === 0)}`}
          </button>
          {status === "error" && errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}
