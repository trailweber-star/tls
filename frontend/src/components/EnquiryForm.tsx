import { useState } from "react";
import type { FormEvent } from "react";
import { createLead } from "../lib/api";

interface EnquiryFormProps {
  specialistId?: string;
  clinicId?: string;
  facilityId?: string;
  recipientName: string;
}

export function EnquiryForm({ specialistId, clinicId, facilityId, recipientName }: EnquiryFormProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");

    // Hold a reference to the element: the browser clears
    // event.currentTarget once the handler yields, so reading it after
    // the await below throws — which previously sent successful
    // submissions down the error path.
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await createLead({
        patientName: String(form.get("patientName") || ""),
        email: String(form.get("email") || ""),
        phone: String(form.get("phone") || ""),
        message: String(form.get("message") || ""),
        specialistId,
        clinicId,
        facilityId,
      });
      formEl.reset();
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-sm text-ink">
        Thanks — your enquiry has been sent to {recipientName}. They (or their clinic) will get back
        to you directly.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor="patientName" className="text-xs font-semibold text-ink-muted">
          Your name
        </label>
        <input
          id="patientName"
          name="patientName"
          required
          className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className="text-xs font-semibold text-ink-muted">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
          />
        </div>
        <div>
          <label htmlFor="phone" className="text-xs font-semibold text-ink-muted">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
          />
        </div>
      </div>
      <div>
        <label htmlFor="message" className="text-xs font-semibold text-ink-muted">
          What would you like to ask?
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-teal-500"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-1 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : `Send enquiry to ${recipientName}`}
      </button>
      {status === "error" && (
        <p className="text-xs text-danger">Something went wrong — please try again.</p>
      )}
    </form>
  );
}
