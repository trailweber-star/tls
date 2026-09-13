import { ApiError, getToken } from "./dashboardApi";

/* ------------------------------------------------------------------ *
 * Organisations
 *
 * Hospitals, clinics, pharmacies and care homes are priced on how many
 * clinicians they want covered, so there is no catalogue price and no
 * self-serve checkout. They apply, an admin quotes, and the agreed
 * figure becomes an ordinary order.
 * ------------------------------------------------------------------ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(`Could not reach the API at ${API_URL}. Is the backend running?`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export type OrganisationType = "hospital" | "clinic" | "care_home" | "pharmacy";

export type OrgApplicationStatus = "new" | "reviewing" | "quoted" | "won" | "lost" | "declined";

export interface OrganisationApplicationInput {
  organisationName: string;
  organisationType: OrganisationType;
  websiteUrl?: string;
  contactName: string;
  contactRole?: string;
  contactEmail: string;
  contactPhone?: string;
  /** The pricing input. Null is allowed: an applicant may not know yet. */
  doctorCount?: number | null;
  siteCount?: number | null;
  specialties?: string[];
  needsClinwell?: boolean;
  notes?: string;
}

export interface OrganisationApplication extends OrganisationApplicationInput {
  id: string;
  status: OrgApplicationStatus;
  quotedNetMinor: number | null;
  quotedCurrency: string;
  quotedInterval: "monthly" | "yearly" | null;
  quotedPlan: "basic" | "premium" | "clinwell" | null;
  quotedAt: string | null;
  quoteNote: string | null;
  orderId: string | null;
  createdAt: string;
}

export const organisationsApi = {
  /** Public. Returns a reference the applicant can quote back at us. */
  apply: (input: OrganisationApplicationInput) =>
    request<{ ok: true; reference: string; next: string }>("/organisations/apply", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /* ------------------------------------------------------ admin */

  list: (status?: OrgApplicationStatus) =>
    request<{ results: OrganisationApplication[]; counts: Record<string, number> }>(
      `/admin/organisations${status ? `?status=${status}` : ""}`
    ),

  get: (id: string) =>
    request<{ application: OrganisationApplication; history: OrganisationApplication[] }>(
      `/admin/organisations/${id}`
    ),

  /**
   * `amount` is in pounds, because that is what a person types. The
   * server converts it once — the only place that conversion happens,
   * so a quote can never be out by a factor of a hundred depending on
   * which screen entered it.
   */
  quote: (id: string, input: { amount: number; plan: string; interval: "monthly" | "yearly"; note?: string }) =>
    request<{
      ok: true;
      application: OrganisationApplication;
      pricing: { netMinor: number; vatMinor: number; totalMinor: number; currency: string; planName: string };
    }>(`/admin/organisations/${id}/quote`, { method: "POST", body: JSON.stringify(input) }),

  setStatus: (id: string, status: OrgApplicationStatus, note?: string) =>
    request<{ ok: true; application: OrganisationApplication }>(`/admin/organisations/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    }),

  /** Needs a listing to attach the subscription to. */
  paymentLink: (id: string, specialistId: string) =>
    request<{ ok: true; paymentUrl: string; orderId: string; totalMinor: number; currency: string }>(
      `/admin/organisations/${id}/payment-link`,
      { method: "POST", body: JSON.stringify({ specialistId }) }
    ),
};
