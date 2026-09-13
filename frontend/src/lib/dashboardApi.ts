// Client for the authenticated half of the API (auth, specialist
// dashboard, admin). Kept separate from lib/api.ts, which is the public
// directory client and deliberately sends no credentials.

import { absolutiseAssets } from "./assetUrl";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const TOKEN_KEY = "tls.auth.token";

/**
 * Where an administrator's own token waits while they are signed in as
 * somebody else.
 *
 * Kept under a separate key rather than in memory on purpose: the whole
 * point of a support session is that the admin walks around the member's
 * dashboard, and a page refresh in the middle of that must not strand
 * them inside the borrowed session with no way back.
 */
const ADMIN_TOKEN_KEY = "tls.auth.adminToken";

/* ------------------------------------------------------------------ *
 * Staying signed in
 *
 * "Remember me" is the difference between two stores, not a longer
 * token: localStorage outlives the browser being closed, sessionStorage
 * does not. The server's token expiry is unchanged either way — this
 * only decides whether the browser still has it tomorrow morning.
 *
 * Both are read on the way in, so a session started before the choice
 * existed keeps working, and every write clears the other store first:
 * a token left behind in localStorage after somebody unticked the box
 * is exactly the thing the box was meant to prevent.
 * ------------------------------------------------------------------ */

const REMEMBER_KEY = "tls.auth.remember";
const EMAIL_KEY = "tls.auth.email";

/** Session storage first: it is the more specific of the two. */
function readEither(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeEither(key: string, value: string | null, remember = isRemembered()) {
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
    if (value) (remember ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* private browsing — the session simply won't persist across reloads */
  }
}

/** Ticked by default: signing in again every time is nobody's idea of a
 *  feature, and this is a workspace people come back to daily. */
export function isRemembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Remembers the choice, and the address — never the password. */
export function setRemembered(remember: boolean, email?: string | null) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
    if (remember && email) localStorage.setItem(EMAIL_KEY, email);
    if (!remember) localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* as above */
  }
}

export function rememberedEmail(): string {
  try {
    return isRemembered() ? (localStorage.getItem(EMAIL_KEY) ?? "") : "";
  } catch {
    return "";
  }
}

export function getToken(): string | null {
  return readEither(TOKEN_KEY);
}

export function setToken(token: string | null, remember?: boolean) {
  writeEither(TOKEN_KEY, token, remember ?? isRemembered());
}

export function getAdminToken(): string | null {
  return readEither(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  writeEither(ADMIN_TOKEN_KEY, token);
}

export class ApiError extends Error {
  status: number;
  issues?: unknown;
  constructor(message: string, status: number, issues?: unknown) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

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

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.issues);
  }
  // Uploaded-image paths resolved against the API's origin, not the
  // page's — see assetUrl.ts.
  return absolutiseAssets(body) as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) });
const patch = <T,>(path: string, data: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(data) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

/* ----------------------------------------------------------- types */

export interface Account {
  id: string;
  email: string;
  fullName: string;
  role: "specialist" | "admin";
  specialistId: string | null;
}

export interface LinkedSpecialist {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  photoUrl: string | null;
  verificationStatus: VerificationStatus;
  /** What they are actually getting right now, not what they picked. */
  plan: "basic" | "premium" | "clinwell";
  planName: string;
  selectedPlan: "basic" | "premium" | "clinwell";
  planStatus: "active" | "pending_verification" | "pending_payment" | "past_due" | "canceled";
  awaitingActivation: boolean;
  features: Record<string, boolean | number | string | null>;
}

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "info_requested"
  | "verified"
  | "rejected"
  | "suspended";

export interface CompletionItem {
  key: string;
  label: string;
  section: string;
}

export interface Overview {
  /**
   * Only these fields. This used to be typed as the full
   * LinkedSpecialist, which promised `plan`, `planName`, `features` and
   * the rest — none of which this endpoint puts on `specialist`; the
   * plan lives in the sibling `plan` key below, under different names.
   * Anything reading `overview.specialist.features.x` would have been
   * reading undefined and thrown, with the type saying it was safe.
   */
  specialist: {
    id: string;
    slug: string;
    fullName: string;
    title: string | null;
    photoUrl: string | null;
    verificationStatus: VerificationStatus;
    verificationHistory: HistoryEntry[];
  };
  completion: { percent: number; missing: CompletionItem[] };
  plan: {
    id: "basic" | "premium" | "clinwell";
    name: string;
    status: "active" | "pending_verification" | "pending_payment" | "past_due" | "canceled";
    awaitingActivation: boolean;
    selectedPlan: "basic" | "premium" | "clinwell";
    selectedPlanName: string;
  };
  kpis: {
    todaysAppointments: number | null;
    newEnquiries: { value: number; changeFromYesterday: number };
    profileViews: { value: number; changePct: number | null; series: { date: string; count: number }[] };
    rating: { value: number; count: number };
  };
  recentEnquiries: { id: string; patientName: string; subject: string; status: string; createdAt: string }[];
}

export interface HistoryEntry {
  action: string;
  byName?: string;
  note?: string | null;
  at: string;
}

export interface Enquiry {
  id: string;
  patientName: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: "new" | "responded" | "in_progress" | "closed" | string;
  response: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface DashboardProfile {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  yearsExperience: number | null;
  registrationNumber: string | null;
  consultationPriceMinor: number | null;
  currency: string;
  languages: string[];
  contactEmail: string | null;
  contactPhone: string | null;
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  nextAvailableAt: string | null;
  coverImageUrl: string | null;
  gallery: { url: string; caption: string | null }[];
  websiteUrl: string | null;
  socials: { linkedin?: string | null; x?: string | null; instagram?: string | null; facebook?: string | null; youtube?: string | null } | null;
  bookingUrl: string | null;
  verificationStatus: VerificationStatus;
  primarySpecialty: { slug: string | null; name: string | null } | null;
  treatments: { id: string; name: string }[];
  clinicLocations: {
    id: string;
    address: string;
    city: string | null;
    cityId?: string | null;
    postcode?: string | null;
    phone?: string | null;
    /** The address's own coordinates, once it has been geocoded. */
    lat?: number | null;
    lng?: number | null;
    /**
     * The clinic this address belongs to, or null for one the
     * specialist added themselves. The editor shows a clinic's address
     * read-only and leaves it out of the save, because it is the
     * clinic's record and shared with everyone who practises there.
     */
    clinic?: { id: string; name: string; slug: string } | null;
  }[];
}

/** What the profile form sends. Joined sets are sent whole, not diffed. */
export interface ProfilePatch {
  fullName?: string;
  title?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  yearsExperience?: number | null;
  registrationNumber?: string | null;
  consultationPriceMinor?: number | null;
  currency?: string;
  languages?: string[];
  contactEmail?: string | null;
  contactPhone?: string | null;
  videoUrl?: string | null;
  videoThumbnailUrl?: string | null;
  videoDurationSeconds?: number | null;
  nextAvailableAt?: string | null;
  coverImageUrl?: string | null;
  gallery?: { url: string; caption?: string | null }[];
  websiteUrl?: string | null;
  socials?: Record<string, string | null> | null;
  bookingUrl?: string | null;
  primarySpecialtySlug?: string | null;
  treatmentNames?: string[];
  locations?: {
    address: string;
    cityId: string;
    postcode?: string | null;
    phone?: string | null;
    /** Sent when the address was picked from the geocoded suggestions,
     *  so distance search measures from the door rather than the town. */
    lat?: number | null;
    lng?: number | null;
  }[];
}

export interface TrendDay {
  date: string;
  applications: number;
  approvals: number;
  enquiries: number;
}

export interface SystemLine {
  ok: boolean;
  label: string;
  note?: string | null;
}

export interface AdminOverview {
  counts: {
    totalSpecialists: number;
    verified: number;
    pendingVerification: number;
    infoRequested: number;
    rejected: number;
    newRegistrations7d: number;
    totalEnquiries: number;
    enquiries24h: number;
    accounts: number;
  };
  recentActivity: {
    specialistId: string;
    specialistName: string;
    slug: string;
    action: string;
    by: string;
    note: string | null;
    at: string;
  }[];
  /** Fourteen days of real events — see buildTrend in the API. */
  trend: { days: TrendDay[]; window: number; empty: boolean };
  topSpecialties: { slug: string; name: string; total: number; verified: number }[];
  recentEnquiries: {
    id: string;
    patientName: string;
    subject: string;
    specialistName: string | null;
    status: string;
    createdAt: string;
  }[];
  /** What is actually configured in the running server, not a claim. */
  system: {
    storage: SystemLine;
    email: SystemLine;
    payments: SystemLine;
    media: SystemLine;
    maps: SystemLine;
    push: SystemLine;
  };
}

export interface VerificationRow {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  photoUrl: string | null;
  registrationNumber: string | null;
  contactEmail: string | null;
  verificationStatus: VerificationStatus;
  primarySpecialty: string | null;
  documentCount: number;
  submittedAt: string | null;
}

export interface VerificationDetail extends VerificationRow {
  bio: string | null;
  contactPhone: string | null;
  regulator: { code: string; name: string } | null;
  yearsExperience: number | null;
  /**
   * The registration payload, stored as free-form jsonb. Every field
   * here is optional because the column genuinely holds whatever was
   * submitted — an older row, a partial application or an import can
   * arrive without any of it, and a type that promised otherwise would
   * only mean the admin screen crashed instead of coping.
   */
  application: {
    submittedAt?: string | null;
    documents?: { type?: string | null; name?: string | null; url?: string | null }[] | null;
    notes?: string | null;
  } | null;
  verificationHistory: HistoryEntry[];
  clinicLocations: { address: string; city: string | null }[];
}

/* ------------------------------------------------------------ auth */

export const authApi = {
  login: (email: string, password: string) =>
    post<{ token: string; user: Account }>("/auth/login", { email, password }),
  register: (input: {
    fullName: string;
    email: string;
    password: string;
    title?: string;
    registrationNumber?: string;
    primarySpecialtySlug?: string;
    phone?: string;
    plan?: "basic" | "premium" | "clinwell";
    planInterval?: "monthly" | "yearly";
    websiteUrl?: string;
    bookingUrl?: string;
    linkedin?: string;
    instagram?: string;
  }) => post<{ token: string; user: Account }>("/auth/register", input),
  me: () =>
    get<{
      user: Account;
      specialist: LinkedSpecialist | null;
      /** Present only when this token is a borrowed one. */
      impersonation?: { active: true; byUserId: string; byName: string };
    }>("/auth/me"),
  demoCredentials: () =>
    get<{ accounts: { email: string; role: string; password: string }[] }>("/auth/demo-credentials"),
};

/* ------------------------------------------------------- dashboard */

export const dashboardApi = {
  overview: () => get<Overview>("/dashboard/overview"),
  profile: () => get<{ profile: DashboardProfile; completion: Overview["completion"] }>("/dashboard/profile"),
  updateProfile: (patchBody: ProfilePatch) =>
    patch<{ ok: boolean; completion: Overview["completion"] }>("/dashboard/profile", patchBody),
  enquiries: (status?: string) =>
    get<{ results: Enquiry[]; counts: Record<string, number> }>(
      `/dashboard/enquiries${status && status !== "all" ? `?status=${status}` : ""}`
    ),
  respond: (id: string, message: string, status?: string) =>
    post<{ ok: boolean; delivery: { sent: boolean; reason?: string } }>(`/dashboard/enquiries/${id}/respond`, {
      message,
      status,
    }),
  reviews: () => get<ReviewsResponse>("/dashboard/reviews"),
};

export interface OwnReview {
  id: string;
  rating: number;
  comment: string | null;
  patientName: string | null;
  verified: boolean;
  scores?: { communication?: number; expertise?: number; care?: number; waitTime?: number } | null;
  createdAt: string;
}

export interface ReviewsResponse {
  results: OwnReview[];
  ratingAvg: number;
  ratingCount: number;
  scores: { communication: number | null; expertise: number | null; care: number | null; waitTime: number | null } | null;
  distribution: Record<string, number>;
}

/* ----------------------------------------------------------- admin */

export interface AdminSpecialistRow {
  id: string;
  slug: string;
  fullName: string;
  specialty: string | null;
  verificationStatus: VerificationStatus;
  ratingAvg: number;
  ratingCount: number;
  contactEmail: string | null;
}

export type ModerationStatus = "pending" | "approved" | "rejected";

/** One row of the review moderation queue. */
export interface ModerationRow {
  id: string;
  subjectType: "specialist" | "facility" | "clinic";
  rating: number;
  comment: string | null;
  patientName: string | null;
  verified: boolean;
  scores: { communication: number | null; expertise: number | null; care: number | null; waitTime: number | null } | null;
  moderationStatus: ModerationStatus;
  moderationNote: string | null;
  moderatedAt: string | null;
  createdAt: string;
  seenFor: string | null;
  waitingHours: number;
  subject: { kind: string; name: string; slug: string | null; href: string } | null;
}

export const adminApi = {
  overview: () => get<AdminOverview>("/admin/overview"),
  verifications: (status = "pending", page = 1) =>
    get<{
      results: VerificationRow[];
      total: number;
      page: number;
      totalPages: number;
      counts: Record<string, number>;
    }>(`/admin/verifications?status=${status}&page=${page}`),
  verification: (id: string) => get<{ application: VerificationDetail }>(`/admin/verifications/${id}`),
  decide: (id: string, action: string, note?: string) =>
    post<{ ok: boolean; verificationStatus: VerificationStatus; verificationHistory: HistoryEntry[] }>(
      `/admin/verifications/${id}/decide`,
      { action, note }
    ),
  /* -------------------------------------------------- review moderation */
  reviews: (status: ModerationStatus = "pending") =>
    get<{ results: ModerationRow[]; counts: Record<string, number>; status: ModerationStatus }>(
      `/admin/reviews?status=${status}`
    ),
  moderateReview: (id: string, status: "approved" | "rejected", note?: string) =>
    post<{ ok: boolean; id: string; status: string; subject: string }>(`/admin/reviews/${id}/moderate`, {
      status,
      note,
    }),

  specialists: (params: { q?: string; status?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    return get<{ results: AdminSpecialistRow[]; total: number; page: number; totalPages: number }>(
      `/admin/specialists?${qs.toString()}`
    );
  },
};

/* ------------------------------------------------------------ members
 *
 * The admin members workspace. One list, every filter stacked above it,
 * and actions that operate on a selection — mirrored from
 * controllers/members.controller.js, which is where the vocabulary is
 * defined.
 * ------------------------------------------------------------------ */

export interface MemberRow {
  id: string;
  slug: string;
  fullName: string;
  title: string | null;
  qualifications: string | null;
  photoUrl: string | null;
  specialty: string | null;
  specialtySlug: string | null;

  verificationStatus: VerificationStatus;
  claimed: boolean;
  /** null when no account has ever been created for this listing. */
  accountActive: boolean | null;

  plan: "basic" | "premium" | "clinwell";
  planName: string;
  planStatus: "active" | "pending_verification" | "pending_payment" | "past_due" | "canceled";
  selectedPlan: "basic" | "premium" | "clinwell";
  awaitingActivation: boolean;

  email: string | null;
  contactPhone: string | null;
  city: string | null;
  address: string | null;

  signupIp: string | null;
  signupCountry: string | null;
  lastLoginIp: string | null;
  lastLoginCountry: string | null;
  lastLoginAt: string | null;
  joinedAt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;

  ratingAvg: number;
  ratingCount: number;
  hasPhoto: boolean;
  tags: string[];
  adminNotes: string | null;
  userId: string | null;
  canImpersonate: boolean;
}

export interface MemberFacets {
  statuses: { key: VerificationStatus; label: string; tone: string }[];
  specialties: { slug: string; name: string }[];
  cities: string[];
  countries: string[];
  tags: string[];
  sources: string[];
}

export interface MembersResponse {
  results: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: string;
  counts: Record<string, number>;
  facets: MemberFacets;
}

/** Every filter the list understands. Absent keys are simply not applied. */
export interface MemberQuery {
  q?: string;
  email?: string;
  status?: string;
  plan?: string;
  planStatus?: string;
  claimed?: string;
  accountActive?: string;
  specialty?: string;
  city?: string;
  country?: string;
  ip?: string;
  hasPhoto?: string;
  source?: string;
  tag?: string;
  joinedFrom?: string;
  joinedTo?: string;
  loginFrom?: string;
  loginTo?: string;
  neverLoggedIn?: string;
  sort?: string;
  page?: number | string;
  pageSize?: number | string;
}

export interface AuditEntry {
  id: string;
  actorName: string;
  actorEmail: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export type BulkAction =
  | "approve"
  | "hold"
  | "request-info"
  | "reject"
  | "suspend"
  | "deactivate-account"
  | "reactivate-account"
  | "tag"
  | "untag";

export interface BulkResult {
  ok: boolean;
  action: string;
  label: string;
  changed: number;
  skippedCount: number;
  done: { id: string; name: string }[];
  skipped: { id: string; name?: string; reason: string }[];
}

/** Drop empty values so the URL only carries filters that are actually set. */
function memberParams(query: MemberQuery): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    qs.set(key, String(value));
  }
  return qs;
}

export const membersApi = {
  list: (query: MemberQuery = {}) => get<MembersResponse>(`/admin/members?${memberParams(query).toString()}`),
  get: (id: string) => get<{ member: MemberRow; history: AuditEntry[] }>(`/admin/members/${id}`),
  annotate: (id: string, body: { adminNotes?: string | null; tags?: string[] }) =>
    patch<{ ok: boolean }>(`/admin/members/${id}`, body),
  bulk: (body: { action: BulkAction; ids: string[]; note?: string; tag?: string }) =>
    post<BulkResult>("/admin/members/bulk", body),
  impersonate: (id: string, reason?: string) =>
    post<{
      ok: boolean;
      token: string;
      expiresInSeconds: number;
      member: { id: string; slug: string; fullName: string; email: string | null };
    }>(`/admin/members/${id}/impersonate`, { reason }),
  stopImpersonating: () =>
    post<{ ok: boolean; token: string; account: Account }>("/admin/members/stop-impersonating"),
  audit: (limit = 100) => get<{ results: AuditEntry[]; note?: string }>(`/admin/audit?limit=${limit}`),

  /**
   * The current filter as a CSV file.
   *
   * Fetched rather than linked because the endpoint needs the bearer
   * token, which cannot ride on an <a href>. The blob is handed back for
   * the caller to save, so the failure path is an error message on the
   * page rather than a browser tab full of JSON.
   */
  async exportCsv(query: MemberQuery = {}): Promise<{ blob: Blob; filename: string }> {
    const token = getToken();
    const res = await fetch(`${API_URL}/admin/members/export.csv?${memberParams(query).toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body?.error ?? `Export failed (${res.status})`, res.status);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const named = /filename="?([^";]+)"?/.exec(disposition);
    return { blob: await res.blob(), filename: named?.[1] ?? "members.csv" };
  },
};

/* --------------------------------------------------- system & mail */

export interface MailAttempt {
  at: string;
  to: string;
  subject: string;
  provider: string;
  ok: boolean;
  reason?: string;
  detail?: string;
  ms?: number;
}

export interface SystemReport {
  mail: {
    configured: boolean;
    provider: string;
    from: string;
    replyTo: string | null;
    redirectTo: string | null;
    allowlist: string[];
    sent24h: number;
    failed24h: number;
    skipped24h: number;
    lastAttempt: MailAttempt | null;
    lastSuccess: MailAttempt | null;
    lastFailure: MailAttempt | null;
  };
  recentMail: MailAttempt[];
  payments: { configured: boolean; provider: string | null; mode: "live" | "test" };
  storage: { mode: "postgres" | "demo" };
  media: { provider: string };
  maps: { provider: string };
  site: string;
}

/** One enquiry, as the platform-wide admin view sees it. */
export interface AdminEnquiry {
  id: string;
  patientName: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: string;
  held: boolean;
  response: string | null;
  respondedAt: string | null;
  createdAt: string | null;
  source: string;
  specialist: {
    id: string;
    slug: string;
    fullName: string;
    contactEmail: string | null;
    verificationStatus: VerificationStatus;
  } | null;
  answered: boolean;
  waitingHours: number | null;
}

export interface AdminEnquiriesResponse {
  results: AdminEnquiry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: Record<string, number>;
  stats: {
    longestWaitHours: number | null;
    medianReplyHours: number | null;
    answeredPct: number | null;
  };
  specialists: { id: string; fullName: string }[];
}

export const systemApi = {
  status: () => get<SystemReport>("/admin/system"),
  sendTestEmail: (to: string) =>
    post<{ sent: boolean; reason?: string; detail?: string; to: string; provider: string; message: string }>(
      "/admin/system/test-email",
      { to }
    ),
  enquiries: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "" || v === "all") continue;
      qs.set(k, String(v));
    }
    return get<AdminEnquiriesResponse>(`/admin/enquiries?${qs.toString()}`);
  },
};

/* ------------------------------------------------------- notifications */

export interface Notification {
  id: string;
  type:
    | "signup_pending"
    | "claim_pending"
    | "approval_overdue"
    | "payment_received"
    | "enquiry_received"
    | "application_decided"
    | "review_pending"
    | "review_overdue";
  title: string;
  /** Optional — the column is nullable, and some notifications are a
      headline and nothing more. */
  body: string | null;
  url: string | null;
  subjectId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  results: Notification[];
  /** Everything unread. */
  unread: number;
  /** The subset that is outstanding work — this is what the badge shows. */
  actionable: number;
  push: {
    connected: boolean;
    provider: string | null;
    devices: number;
    /** The browser's half of the VAPID pair. Null when push is off. */
    publicKey: string | null;
  };
}

export const notificationsApi = {
  list: (unreadOnly = false) => get<NotificationFeed>(`/notifications${unreadOnly ? "?unread=1" : ""}`),
  count: () => get<{ unread: number; actionable: number }>("/notifications/count"),
  markRead: (id: string) => post<{ ok: boolean; unread: number }>(`/notifications/${id}/read`),
  markAllRead: () => post<{ ok: boolean; marked: number }>("/notifications/read-all"),
  subscribePush: (subscription: unknown) =>
    post<{ ok: boolean; connected: boolean; devices: number }>("/notifications/subscribe", subscription),
  unsubscribePush: (endpoint: string) =>
    post<{ ok: boolean; devices: number }>("/notifications/unsubscribe", { endpoint }),
};

/* ------------------------------------------------------- my articles *
 * A member's own half of the article workflow. Separate from
 * articlesApi, which is the administrator's.
 * ------------------------------------------------------------------ */

export interface MyArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: ArticleStatus;
  heroImageUrl: string | null;
  tags: string[];
  specialty: { slug: string; name: string } | null;
  readingMinutes: number;
  viewCount: number;
  /** What an administrator said when sending it back. */
  reviewNote: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  /** True when it was drafted for them and is waiting on them. */
  writtenForYou: boolean;
}

export interface MyArticleDetail extends MyArticle {
  body: string;
  bodyFormat: "auto" | "markdown" | "html";
  heroImageAlt: string | null;
  specialtySlug: string | null;
}

export interface MyArticleInput {
  title: string;
  body: string;
  format?: "auto" | "markdown" | "html";
  excerpt?: string;
  tags?: string[];
  specialtySlug?: string | null;
  heroImageUrl?: string;
  heroImageAlt?: string;
  /** True sends it for review in the same call as saving. */
  submit?: boolean;
}

export const myArticlesApi = {
  list: () =>
    get<{ results: MyArticle[]; counts: { awaitingYou: number; inReview: number; published: number } }>(
      "/dashboard/articles"
    ),
  get: (id: string) => get<{ article: MyArticleDetail }>(`/dashboard/articles/${id}`),
  create: (body: MyArticleInput) => post<{ article: MyArticle }>("/dashboard/articles", body),
  update: (id: string, body: MyArticleInput) =>
    patch<{ article: MyArticle }>(`/dashboard/articles/${id}`, body),
};

/* -------------------------------------------------------------- claims */

export interface ClaimEligibility {
  slug: string;
  fullName: string;
  title: string | null;
  photoUrl: string | null;
  primarySpecialty: string | null;
  ratingAvg: number;
  ratingCount: number;
  reviewCount: number;
  claimable: boolean;
  claimed: boolean;
  claimPending: boolean;
  requiresRegistrationNumber: boolean;
}

export interface ClaimRow {
  id: string;
  specialistId: string;
  specialistSlug: string;
  specialistName: string;
  fullName: string;
  email: string;
  phone: string | null;
  registrationNumber: string;
  /** The core signal an admin judges on. */
  registrationMatches: boolean;
  message: string | null;
  plan: "basic" | "premium" | "clinwell";
  planInterval: "monthly" | "yearly";
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
}

export const claimsApi = {
  eligibility: (slug: string) => get<ClaimEligibility>(`/claims/eligibility/${slug}`),
  submit: (input: {
    slug: string;
    fullName: string;
    email: string;
    password: string;
    registrationNumber: string;
    phone?: string;
    message?: string;
    plan?: "basic" | "premium" | "clinwell";
    planInterval?: "monthly" | "yearly";
  }) => post<{ ok: boolean; claimId: string; token: string; user: Account }>("/claims", input),
  adminList: (status = "pending") =>
    get<{ results: ClaimRow[]; counts: Record<string, number> }>(`/admin/claims?status=${status}`),
  adminGet: (id: string) =>
    get<{
      claim: ClaimRow;
      specialist: {
        id: string;
        slug: string;
        fullName: string;
        title: string | null;
        photoUrl: string | null;
        registrationNumber: string | null;
        regulator: { code: string; name: string } | null;
        primarySpecialty: string | null;
        ratingAvg: number;
        ratingCount: number;
        contactEmail: string | null;
      } | null;
    }>(`/admin/claims/${id}`),
  decide: (id: string, action: "approve" | "reject", note?: string) =>
    post<{ ok: boolean; status: string }>(`/admin/claims/${id}/decide`, { action, note }),
};


/* ------------------------------------------------------------------ *
 * Articles
 *
 * The blog's admin side. Abun has no API, webhook or Zapier action —
 * only auto-publish to WordPress, Webflow, Wix, Shopify and Ghost — so
 * an article arrives here as a paste of what Abun exports, and this is
 * the door it comes through. If Abun ever ships an API, it feeds the
 * same `import` call and nothing on this screen changes.
 * ------------------------------------------------------------------ */

export type ArticleStatus =
  | "draft"
  | "awaiting_author"
  | "in_review"
  | "changes_requested"
  | "published";

export interface AdminArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: ArticleStatus;
  tags: string[];
  publishedAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  source: string;
  readingMinutes: number;
  viewCount: number;
  heroImageUrl: string | null;
  reviewNote: string | null;
  /** Who the article is by, when it is by a member rather than by us. */
  author: { id: string; slug: string; fullName: string; photoUrl: string | null } | null;
}

/** One article as the edit form needs it: the source that was typed,
 *  not the HTML it became. */
export interface AdminArticleDetail extends AdminArticleRow {
  body: string;
  bodyFormat: "auto" | "markdown" | "html";
  heroImageAlt: string | null;
  authorName: string | null;
  specialtySlug: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ArticleImportInput {
  title: string;
  body: string;
  format?: "auto" | "markdown" | "html";
  excerpt?: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  authorName?: string;
  specialtySlug?: string;
  tags?: string[];
  status?: "draft" | "published";
  seoTitle?: string;
  seoDescription?: string;
  source?: string;
  sourceRef?: string;
}

export const articlesApi = {
  list: (status?: string) =>
    get<{ results: AdminArticleRow[]; counts: Record<string, number>; demo: boolean }>(
      `/admin/articles${status ? `?status=${encodeURIComponent(status)}` : ""}`
    ),
  /** Hand a draft to the member it is about, for them to read and edit. */
  assign: (id: string, specialistId: string, note?: string) =>
    post<{ article: AdminArticleRow }>(`/admin/articles/${id}/assign`, { specialistId, note }),
  /** The decision at the end of the queue. A note is required to send one back. */
  review: (id: string, decision: "publish" | "changes", note?: string) =>
    post<{ article: AdminArticleRow }>(`/admin/articles/${id}/review`, { decision, note }),
  import: (body: ArticleImportInput) =>
    post<{ article: { slug: string; title: string; status: string }; created: boolean }>(
      "/admin/articles/import",
      body
    ),
  get: (id: string) => get<{ article: AdminArticleDetail }>(`/admin/articles/${id}`),
  update: (
    id: string,
    body: Partial<{
      status: ArticleStatus;
      title: string;
      body: string;
      format: "auto" | "markdown" | "html";
      excerpt: string;
      tags: string[];
      specialtySlug: string | null;
      heroImageUrl: string;
      heroImageAlt: string;
      authorName: string;
      seoTitle: string;
      seoDescription: string;
    }>
  ) => patch<{ article: AdminArticleRow }>(`/admin/articles/${id}`, body),
  remove: (id: string) => del<{ deleted: boolean }>(`/admin/articles/${id}`),
  /* Rendered by the server rather than in the browser: one parser, one
     sanitiser, so a preview cannot promise markup the page then drops. */
  preview: (body: string, format: "auto" | "markdown" | "html" = "auto") =>
    post<{ html: string; readingMinutes?: number; excerpt?: string }>("/admin/articles/preview", {
      body,
      format,
    }),
};
