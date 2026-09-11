// Contact form client. Deliberately separate from the directory and
// dashboard clients: this endpoint is public, takes no credentials, and
// is the one place an anonymous visitor can write to the platform.

import { ApiError } from "./dashboardApi";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export type ContactTopic = "patient" | "practitioner" | "partnership" | "other";

export interface ContactInput {
  fullName: string;
  email: string;
  phone?: string;
  topic: ContactTopic;
  message: string;
  /** Honeypot — always empty when a person fills the form. */
  company?: string;
}

export const contactApi = {
  async submit(input: ContactInput): Promise<{ ok: boolean; id?: string }> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      throw new ApiError("Could not reach us just now. Please try again, or email us directly.", 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError((body as { error?: string })?.error ?? "Please check the form and try again", res.status);
    }
    return body as { ok: boolean; id?: string };
  },
};
