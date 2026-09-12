// Thin fetch client for the Express API. The backend itself handles the
// demo-vs-live-MongoDB split (src/config/db.js on the backend), so the
// frontend doesn't need its own separate mock dataset — it always talks
// to the API, and the API is what decides where the data comes from.
import type {
  City,
  ClinicWithRelations,
  FacilityCategory,
  FacilityType,
  FacilityWithRelations,
  Review,
  FeaturedReview,
  SearchResponse,
  SpecialistWithRelations,
  Specialty,
} from "./types";

import { getToken } from "./dashboardApi";
import { absolutiseAssets } from "./assetUrl";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`);
  } catch {
    throw new ApiError(
      `Could not reach the API at ${API_URL}. Is the backend running (npm run dev in tls-mern/backend)?`,
      0
    );
  }
  if (!res.ok) {
    if (res.status === 404) throw new ApiError("Not found", 404);
    throw new ApiError(`API error (${res.status})`, res.status);
  }
  // Uploaded-image paths are made absolute here rather than at each
  // <img>, so no page can be the one that forgets. See assetUrl.ts.
  return absolutiseAssets(await res.json());
}

/**
 * The write half. Kept as thin as `get`: the backend owns every rule
 * about what a submission may contain, so this only carries the body and
 * surfaces the server's own error message rather than inventing one.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      `Could not reach the API at ${API_URL}. Is the backend running (npm run dev in tls-mern/backend)?`,
      0
    );
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(payload?.error ?? `API error (${res.status})`, res.status);
  }
  return absolutiseAssets(payload) as T;
}

export { ApiError };

/* ------------------------------------------------------ writing reviews */

export interface ReviewInput {
  rating: number;
  comment?: string;
  patientName?: string;
  /** The condition or treatment they were seen for, if they picked one. */
  conditionId?: string | null;
  scores?: {
    communication?: number | null;
    expertise?: number | null;
    care?: number | null;
    waitTime?: number | null;
  };
}

/**
 * What comes back. Deliberately no rating: the review is created pending
 * and changes no public figure until a moderator publishes it, so there
 * is nothing new to show and the caller cannot accidentally display one.
 */
export interface ReviewSubmitted {
  ok: boolean;
  moderationStatus: "pending";
  message?: string;
}

export function createSpecialistReview(slug: string, review: ReviewInput): Promise<ReviewSubmitted> {
  return post(`/specialists/${encodeURIComponent(slug)}/reviews`, review);
}

export function createFacilityReview(slug: string, review: ReviewInput): Promise<ReviewSubmitted> {
  return post(`/facilities/${encodeURIComponent(slug)}/reviews`, review);
}

export function getAllSpecialties(): Promise<Specialty[]> {
  return get("/specialties");
}

export function getTopLevelSpecialties(): Promise<Specialty[]> {
  return get("/specialties/top-level");
}

export function getCities(): Promise<City[]> {
  return get("/cities");
}

export function getFeaturedSpecialists(limit = 4): Promise<SpecialistWithRelations[]> {
  return get(`/specialists/featured?limit=${limit}`);
}

export async function getSpecialistBySlug(slug: string): Promise<SpecialistWithRelations | null> {
  try {
    return await get(`/specialists/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getClinicBySlug(slug: string): Promise<ClinicWithRelations | null> {
  try {
    return await get(`/clinics/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface ReviewPage {
  results: Review[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Paginated reviews for one specialist — powers "View all reviews". */
export function getSpecialistReviews(slug: string, page = 1, pageSize = 10): Promise<ReviewPage> {
  return get(`/specialists/${encodeURIComponent(slug)}/reviews?page=${page}&pageSize=${pageSize}`);
}

export interface SearchParams {
  /** Free text: a name, specialty, treatment, condition, clinic or town. */
  q?: string;
  /** Which people directory: one of the specialist tab keys
   *  ("specialist-doctors", "physiotherapists", "dentists",
   *  "aesthetics"). Narrows to that tab's root specialties, so a search
   *  launched from a tab returns that tab's directory. */
  group?: string;
  specialty?: string;
  /** Any depth of the taxonomy; repeatable (the sidebar checkboxes). */
  subspecialties?: string[];
  location?: string;
  radiusKm?: number;
  minRating?: number | null;
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
  verifiedOnly?: boolean;
  availableWithinDays?: number | null;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function buildSearchQuery(params: SearchParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.group) qs.set("group", params.group);
  if (params.specialty) qs.set("specialty", params.specialty);
  (params.subspecialties ?? []).forEach((slug) => qs.append("subspecialty", slug));
  if (params.location) qs.set("location", params.location);
  if (params.radiusKm != null) qs.set("radiusKm", String(params.radiusKm));
  if (params.minRating != null) qs.set("minRating", String(params.minRating));
  if (params.minPriceMinor != null) qs.set("minPrice", String(params.minPriceMinor));
  if (params.maxPriceMinor != null) qs.set("maxPrice", String(params.maxPriceMinor));
  if (params.verifiedOnly) qs.set("verifiedOnly", "true");
  if (params.availableWithinDays != null) qs.set("availableWithinDays", String(params.availableWithinDays));
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return qs;
}

// Returns the full envelope — results plus total, page info, facet counts
// and the resolved location — so the results page renders its header,
// sidebar counts and pagination from one round trip.
export function searchSpecialists(params: SearchParams): Promise<SearchResponse> {
  return get(`/specialists/search?${buildSearchQuery(params).toString()}`);
}

export function getAllFacilityCategories(): Promise<FacilityCategory[]> {
  return get("/facility-categories");
}

export function getTopLevelFacilityCategories(): Promise<FacilityCategory[]> {
  return get("/facility-categories/top-level");
}

export function getFeaturedFacilities(limit = 4): Promise<FacilityWithRelations[]> {
  return get(`/facilities/featured?limit=${limit}`);
}

export async function getFacilityBySlug(slug: string): Promise<FacilityWithRelations | null> {
  try {
    return await get(`/facilities/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface FacilitySearchParams {
  /** Free text: a name, a category or a town. */
  q?: string;
  type?: FacilityType | "";
  category?: string;
  location?: string;
  radiusKm?: number;
  /* -------------------------------------------- place-only filters
     A place is not chosen on consultation price or next appointment,
     so these are deliberately not the specialist filter set. */
  minRating?: number;
  verified?: boolean;
  regulatorRating?: string;
  amenities?: string[];
  openNow?: boolean;
  emergency?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * One page of places, plus the filters this result set can actually
 * offer.
 *
 * The facets come back with the results rather than being worked out in
 * the browser: doing it here meant downloading every place of a type
 * just to list its categories, which is fine with eight of them and a
 * multi-megabyte page once the directory is full.
 */
export interface FacilitySearchResponse {
  results: FacilityWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    categories: { slug: string; name: string }[];
    amenities: string[];
  };
}

export function searchFacilities(params: FacilitySearchParams): Promise<FacilitySearchResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.type) qs.set("type", params.type);
  if (params.category) qs.set("category", params.category);
  if (params.location) qs.set("location", params.location);
  if (params.radiusKm) qs.set("radiusKm", String(params.radiusKm));
  if (params.minRating) qs.set("minRating", String(params.minRating));
  if (params.verified) qs.set("verified", "true");
  if (params.regulatorRating) qs.set("regulatorRating", params.regulatorRating);
  if (params.amenities?.length) qs.set("amenities", params.amenities.join(","));
  if (params.openNow) qs.set("openNow", "true");
  if (params.emergency) qs.set("emergency", "true");
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return get(`/facilities/search?${qs.toString()}`);
}

export function getFacilityReviews(
  slug: string,
  page = 1,
  pageSize = 10
): Promise<ReviewPage> {
  return get(`/facilities/${encodeURIComponent(slug)}/reviews?page=${page}&pageSize=${pageSize}`);
}

export interface LeadInput {
  patientName: string;
  email?: string;
  phone?: string;
  message?: string;
  specialistId?: string;
  clinicId?: string;
  facilityId?: string;
}

export async function createLead(input: LeadInput): Promise<{ ok: boolean; demo?: boolean }> {
  const res = await fetch(`${API_URL}/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError("Could not send enquiry", res.status);
  return res.json();
}

/**
 * Approved reviews for the homepage strip. Never returns anything a
 * moderator has not published, so the section cannot show a review that
 * is still in the queue.
 */
export function getFeaturedReviews(limit = 12): Promise<FeaturedReview[]> {
  return get(`/reviews/featured?limit=${limit}`);
}

/* ------------------------------------------------------------- uploads */

/**
 * The signed-in token, read from where dashboardApi keeps it. Uploads
 * are the only thing in this file that needs it — everything else here
 * is public — so it is imported rather than duplicating the storage key.
 */
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface UploadConfig {
  maxBytes: number;
  maxMb: number;
  accept: string[];
  /** Video has its own, much larger cap and its own accepted types. */
  video?: { maxBytes: number; maxMb: number; accept: string[] };
  provider: string;
}

export function getUploadConfig(): Promise<UploadConfig> {
  return get("/uploads/config");
}

/**
 * Send the file itself as the body, with its own Content-Type.
 *
 * No multipart, no base64: Express parses the raw bytes with a built-in,
 * which means no extra dependency on the server and none of the 33%
 * inflation base64 would add to every photo.
 */
export async function uploadImage(
  file: File,
  kind = "image"
): Promise<{ url: string; bytes: number; contentType: string; provider: string }> {
  const res = await fetch(`${API_URL}/uploads/image?kind=${encodeURIComponent(kind)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", ...authHeaders() },
    body: file,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(payload?.error ?? `Upload failed (${res.status})`, res.status);
  return absolutiseAssets(payload);
}

/**
 * Send a video the same way, but over XHR rather than fetch.
 *
 * fetch cannot report upload progress. For a 5MB photo that does not
 * matter; for a 60MB video on a domestic connection it is the
 * difference between a progress bar and a button that appears to have
 * done nothing for two minutes — which is when people press it again,
 * or give up and decide the field is broken.
 */
export function uploadVideo(
  file: File,
  kind = "intro-video",
  onProgress?: (percent: number) => void
): Promise<{ url: string; bytes: number; contentType: string; provider: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/uploads/video?kind=${encodeURIComponent(kind)}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    const token = getToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let payload: { url?: string; error?: string } | null = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.url) {
        resolve(absolutiseAssets(payload) as { url: string; bytes: number; contentType: string; provider: string });
      } else {
        reject(new ApiError(payload?.error ?? `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    // A dropped connection and an abort both land here. Neither is a
    // server error, and neither should read like one.
    xhr.onerror = () => reject(new ApiError("The upload was interrupted. Check your connection and try again.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));
    xhr.send(file);
  });
}

export async function deleteUpload(url: string): Promise<void> {
  await fetch(`${API_URL}/uploads/image`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url }),
  });
}

/* ----------------------------------------------------------- addresses */

export interface AddressSuggestion {
  label: string;
  secondary: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  /** Google place_id, resolved on pick. Absent for postcodes.io. */
  ref: string | null;
}

export function suggestAddresses(q: string): Promise<{ results: AddressSuggestion[]; provider: string }> {
  return get(`/geo/suggest?q=${encodeURIComponent(q)}`);
}

export function resolveAddress(
  picked: Pick<AddressSuggestion, "ref" | "label" | "postcode">
): Promise<{ label: string; postcode: string | null; town: string | null; lat: number; lng: number }> {
  return post("/geo/resolve", picked);
}

/* ---------------------------------------------------------------- maps */

/**
 * One map, as the server says to draw it.
 *
 * Which service answers is the server's decision — OpenStreetMap today,
 * Google the moment GOOGLE_MAPS_API_KEY is set in the backend .env —
 * so nothing here changes when the key arrives, and no key is ever
 * shipped in this bundle.
 */
export interface MapView {
  provider: "google" | "osm" | string;
  /** The frame to embed. Null when there is nothing truthful to show. */
  embedUrl: string | null;
  /** Where "open the full map" goes. */
  linkUrl: string | null;
  /**
   * A tiny image on the map service, used to find out whether the
   * browser can reach it at all. A cross-origin iframe never reports
   * its own failure — a blocked frame fires `load` on an error page
   * exactly as a working one fires `load` on a map — so without this a
   * privacy extension leaves a grey rectangle nothing can detect.
   */
  probeUrl?: string | null;
  /** False for an address that was typed rather than picked. */
  pinned: boolean;
  label: string;
}

export function getMapView(params: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  zoom?: number;
}): Promise<MapView> {
  const qs = new URLSearchParams();
  if (params.lat != null) qs.set("lat", String(params.lat));
  if (params.lng != null) qs.set("lng", String(params.lng));
  if (params.address) qs.set("address", params.address);
  if (params.zoom) qs.set("zoom", String(params.zoom));
  return get(`/geo/map?${qs.toString()}`);
}
