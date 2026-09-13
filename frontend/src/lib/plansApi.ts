// The plan catalogue and the specialist's own subscription.
//
// Nothing about pricing or features is hard-coded on this side: the
// catalogue is fetched from /api/plans, which serves the same object the
// server enforces entitlements from. That is deliberate — a pricing page
// that keeps its own copy of the feature list will eventually advertise
// something the API refuses to serve.

import { ApiError, getToken } from "./dashboardApi";

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

export type PlanId = "basic" | "premium" | "clinwell";
export type BillingInterval = "monthly" | "yearly";

export interface PlanFeatures {
  dashboard: boolean;
  publicListing: boolean;
  profilePhoto: boolean;
  mapPin: boolean;
  phoneReveal: boolean;
  websiteAndSocial: boolean;
  reviews: boolean;
  searchPriority: "standard" | "top";
  verifiedBadge: boolean;
  subSpecialtyLimit: number | null;
  enquiryForm: boolean;
  enquiryMonthlyCap: number | null;
  instantEnquiryAlerts: boolean;
  publicContactEmail: boolean;
  privateChat: boolean;
  reviewReplies: boolean;
  photoGallery: boolean;
  galleryImageLimit: number;
  videoBio: boolean;
  bookingLink: boolean;
  contentPublishing: boolean;
  subAccounts: boolean;
  clinwell: boolean;
}

export interface PlanPricing {
  monthlyOverAYear: number;
  yearly: number;
  savingMinor: number;
  savingPct: number;
  yearlyPerMonthMinor: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  eyebrow: string;
  badge: string | null;
  tagline: string;
  cta: string;
  freeForever: boolean;
  priceMinor: Record<BillingInterval, number>;
  pricing: PlanPricing;
  highlightsHeading: string | null;
  highlights: { label: string; included: boolean }[];
  features: PlanFeatures;
}

export type ComparisonRow =
  | { group: string; label?: undefined; values?: undefined }
  | {
      group?: undefined;
      label: string;
      values: { planId: PlanId; kind: "boolean" | "text"; value: boolean | string | null }[];
    };

export interface PlanCatalogue {
  currency: string;
  plans: Plan[];
  comparison: ComparisonRow[];
  faq: { q: string; a: string }[];
  payments: { connected: boolean; provider: string | null };
}

export interface Subscription {
  selectedPlan: PlanId;
  selectedPlanName: string;
  effectivePlan: PlanId;
  effectivePlanName: string;
  status: "active" | "pending_verification" | "pending_payment" | "past_due" | "canceled";
  interval: BillingInterval;
  renewsAt: string | null;
  awaitingActivation: boolean;
  verificationStatus: string;
  canPayNow: boolean;
}

export interface Invoice {
  id: string;
  planName: string;
  interval: BillingInterval;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface SubscriptionResponse {
  subscription: Subscription;
  features: PlanFeatures;
  quote: {
    planName: string;
    interval: BillingInterval;
    netMinor: number;
    vatMinor: number;
    totalMinor: number;
    currency: string;
    periodEnd: string;
  } | null;
  invoices: Invoice[];
  payments: { connected: boolean; provider: string | null };
}

export interface ClinWellStatus {
  entitled: boolean;
  connected?: boolean;
  workspaceId?: string | null;
  reason?: string;
  requiredPlan?: PlanId;
  requiredPlanName?: string;
  /* There is no SSO under contract v1.0.1 (§1, §6.1) — a practitioner
     gets in through ClinWell's invitation email. This stays because the
     provider seam can supply one, but the panel must not rely on it. */
  ssoUrl?: string | null;
  /* pending_invite | active | suspended (§4.2). Null until a workspace
     exists. There is no per-module status on ClinWell's side. */
  status?: "pending_invite" | "active" | "suspended" | null;
  updatedAt?: string | null;
  /* The address the invitation went to, which becomes their login
     identity — a different Google account is not recognised, so the
     dashboard has to say which one to use (§6.1). */
  invitationEmail?: string | null;
  signInUrl?: string | null;
  modules?: { key: string; name: string; description: string; status: string; value: string | null }[];
}

export const plansApi = {
  catalogue: () => request<PlanCatalogue>("/plans"),
  subscription: () => request<SubscriptionResponse>("/billing/subscription"),
  changePlan: (planId: PlanId, interval: BillingInterval) =>
    request<{ ok: boolean; outcome: string; subscription: Subscription }>("/billing/change-plan", {
      method: "POST",
      body: JSON.stringify({ planId, interval }),
    }),
  checkout: (planId?: PlanId, interval?: BillingInterval) =>
    request<{
      status: "free" | "redirect" | "unconfigured" | "error";
      checkoutUrl: string | null;
      order: { id: string; totalMinor: number; currency: string } | null;
      reason: string | null;
    }>("/billing/checkout", { method: "POST", body: JSON.stringify({ planId, interval }) }),
  simulatePayment: () =>
    request<{ ok: boolean; simulated: boolean; subscription: Subscription }>("/billing/simulate-payment", {
      method: "POST",
      body: "{}",
    }),
  clinwell: () => request<ClinWellStatus>("/billing/clinwell"),
};

/** £299, £29.90 — trailing pence only when there are any. */
export function money(minor: number, currency = "GBP") {
  const major = minor / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}
