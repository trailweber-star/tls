/* ------------------------------------------------------------------ *
 * The real ClinWell client, chosen at boot
 *
 * Same seam as the mailer, the payment provider and the geocoder: the
 * application talks to lib/clinwell.js, which knows nothing about HTTP,
 * and this file is the one place that knows the contract exists. With
 * nothing configured, lib/clinwell.js keeps returning
 * `connected: false` and the dashboard renders "not connected" rather
 * than inventing clinical figures.
 *
 * What this client does NOT do is provision a workspace. Under contract
 * v1.0.1 the workspace is created by the subscription.activated event
 * and its id comes back in ClinWell's response, so provisioning is the
 * outbox's job (lib/clinwellSender.js) and there is no synchronous call
 * to make. The `provisionWorkspace` seam function therefore reports
 * that the request is queued rather than pretending to have an id — an
 * invented one would be stored against a practice and then disagree
 * with every nightly push for ever.
 * ------------------------------------------------------------------ */
import { setClinWellClient, CLINWELL_MODULES } from "./clinwell.js";
import { clinwellConfig } from "./clinwellSender.js";

const REQUEST_TIMEOUT_MS = Number(process.env.CLINWELL_TIMEOUT_MS ?? 15_000);

/** Statuses §4.2 can return. Anything else is a contract change. */
const STATUSES = new Set(["pending_invite", "active", "suspended"]);

async function readJson(url, { partnerKey }) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${partnerKey}` },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error ?? `ClinWell answered ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(abort);
  }
}

export function buildClient({ baseUrl, partnerKey }) {
  return {
    name: "clinwell-http",

    /**
     * Reports the truth: the activated event is queued and the id will
     * arrive with ClinWell's response. Returning a made-up id here
     * would poison the one ClinWell value this application stores.
     */
    async provisionWorkspace() {
      return { workspaceId: null, queued: true };
    },

    /**
     * §4.2. Status is all the dashboard strip shows — there is no
     * per-module status on ClinWell's side, so the module list is
     * derived from the one status rather than invented per module.
     */
    async summary({ workspaceId }) {
      if (!workspaceId) {
        return {
          status: null,
          modules: CLINWELL_MODULES.map((m) => ({ ...m, status: "awaiting_workspace", value: null })),
        };
      }

      const body = await readJson(
        `${baseUrl}/api/partners/tls/workspaces/${encodeURIComponent(workspaceId)}`,
        { partnerKey }
      );

      const status = STATUSES.has(body?.status) ? body.status : null;
      if (!status) {
        console.warn(`[clinwell] unrecognised workspace status ${JSON.stringify(body?.status)}`);
      }

      return {
        status,
        updatedAt: body?.updatedAt ?? null,
        modules: CLINWELL_MODULES.map((m) => ({
          ...m,
          /* One status for the workspace, repeated per module, because
             claiming to know more per module than ClinWell reports
             would be a fabrication in a clinical context. */
          status: status === "active" ? "available" : (status ?? "unknown"),
          value: null,
        })),
      };
    },

    /**
     * There is no SSO (§1, §6.1). A practitioner gets in through the
     * invitation email ClinWell sends, and TLS never handles a ClinWell
     * login. Returning null keeps the dashboard from rendering an
     * "Open ClinWell" link that could only ever fail.
     */
    async ssoUrl() {
      return null;
    },
  };
}

export function registerClinWell() {
  const forced = String(process.env.CLINWELL_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "none" || forced === "off") {
    console.log("[clinwell] disabled (CLINWELL_PROVIDER=none) — the dashboard shows 'not connected'");
    return { provider: "none" };
  }

  const { baseUrl, partnerKey, configured } = clinwellConfig();

  /* Refuse to half-connect, the same as the mailer and the payment
     provider: a base URL with no key would fail every read with a 401
     that looks like a ClinWell outage rather than a missing value. */
  if (baseUrl && !partnerKey) {
    console.log("[clinwell] CLINWELL_BASE_URL is set but CLINWELL_PARTNER_KEY is not — reads stay disconnected");
    return { provider: "none", reason: "missing-partner-key" };
  }

  if (!baseUrl) {
    console.log("[clinwell] not connected — clinical panels show 'not connected' (see .env.example)");
    return { provider: "none", reason: "no-base-url" };
  }

  setClinWellClient(buildClient({ baseUrl, partnerKey }));
  console.log(
    `[clinwell] connected to ${baseUrl}${configured ? "" : " (no webhook secret — events will queue unsent)"}`
  );
  return { provider: "clinwell-http", eventsConfigured: configured };
}
