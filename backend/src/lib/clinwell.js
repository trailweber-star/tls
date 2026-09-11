/* ------------------------------------------------------------------ *
 * ClinWell.ai — the clinical suite, behind a boundary
 *
 * ClinWell handles patient history, AI-drafted SOAP notes, NHS RTT
 * tracking, e-prescriptions and telehealth. All of that is regulated
 * patient data, and it deliberately does NOT live in this application's
 * database.
 *
 * What Top Local Specialists stores is exactly two things: whether a
 * practice is entitled to ClinWell (their plan), and an opaque
 * workspace id. Everything else is fetched at request time from the
 * ClinWell service and never persisted here. That boundary is far
 * cheaper to build now than to retrofit after clinical records have
 * been mixed into a marketing directory's tables.
 *
 * To connect the real service:
 *
 *   import { setClinWellClient } from "./lib/clinwell.js";
 *   setClinWellClient({
 *     name: "clinwell-production",
 *     async provisionWorkspace({ specialist }) { ... },
 *     async summary({ workspaceId }) { ... },
 *     async ssoUrl({ workspaceId, userId }) { ... },
 *   });
 *
 * Until then every function below returns a clearly-marked placeholder
 * and `connected: false`, which is what the dashboard renders as "not
 * connected" instead of inventing clinical figures.
 * ------------------------------------------------------------------ */

let client = null;

export function setClinWellClient(impl) {
  client = impl;
}

export function isClinWellConnected() {
  return Boolean(client);
}

export function clinWellProviderName() {
  return client?.name ?? null;
}

/** The five modules the Full Practice Suite advertises. */
export const CLINWELL_MODULES = [
  {
    key: "emr",
    name: "ClinWell.ai EMR Suite",
    description: "Complete patient history, consultation records and document store.",
  },
  {
    key: "ai_notes",
    name: "AI Clinical Assistant",
    description: "Drafts SOAP notes from your consultation, for you to check and sign.",
  },
  {
    key: "rtt",
    name: "NHS RTT Breach Tracker",
    description: "Referral-to-treatment clocks and waiting times, with breach warnings.",
  },
  {
    key: "prescriptions",
    name: "Secure e-Prescriptions",
    description: "Electronic prescribing and the NHS patient portal.",
  },
  {
    key: "telehealth",
    name: "Telehealth Consultations",
    description: "Video consulting room with waiting area and recording consent.",
  },
];

/**
 * Create (or fetch) the practice's ClinWell workspace. Called when a
 * Full Practice Suite subscription becomes active.
 *
 * Returns a workspace id, which is the only ClinWell value this
 * application is allowed to store.
 */
export async function provisionWorkspace(specialist) {
  if (!client) {
    return {
      connected: false,
      // Deterministic so the demo is stable across restarts, and
      // obviously not a real credential.
      workspaceId: `cw_demo_${specialist.id}`,
      reason: "clinwell-not-connected",
    };
  }
  const res = await client.provisionWorkspace({ specialist });
  return { connected: true, workspaceId: res.workspaceId };
}

/**
 * The module status strip shown in the dashboard.
 *
 * With no client configured this reports every module as provisioned but
 * carrying no data — which is the truth: the tier grants access, the
 * service is not wired up yet. It never fabricates patient counts.
 */
export async function workspaceSummary({ workspaceId }) {
  if (!client) {
    return {
      connected: false,
      workspaceId,
      reason: "clinwell-not-connected",
      modules: CLINWELL_MODULES.map((m) => ({ ...m, status: "awaiting_connection", value: null })),
    };
  }
  const res = await client.summary({ workspaceId });
  return { connected: true, workspaceId, ...res };
}

/**
 * A one-time signed URL that drops the specialist into ClinWell already
 * signed in. No clinical data crosses into this application.
 */
export async function ssoUrl({ workspaceId, userId }) {
  if (!client) return { connected: false, url: null, reason: "clinwell-not-connected" };
  const url = await client.ssoUrl({ workspaceId, userId });
  return { connected: true, url };
}
