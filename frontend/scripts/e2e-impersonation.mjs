#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Impersonation / dashboard E2E smoke
 *
 * Run with `npm run e2e` in frontend/, against a backend that already
 * has migrations applied and the demo accounts seeded (see
 * backend/scripts/smoke.mjs's comment for the same convention — this
 * is that suite's browser-rendered counterpart).
 *
 * backend/scripts/smoke.mjs calls the API directly, so it can prove a
 * route returns 200. It cannot prove the PAGE that calls that route
 * renders — a React crash from a Rules-of-Hooks violation, like the
 * one in ImpersonationBanner.tsx fixed on 2026-10-05, throws inside
 * the browser with every API response still a clean 200. The only way
 * to catch that class of bug is to actually open the page in a real
 * browser and watch for an uncaught error, which is what this does.
 *
 * The scenario it reproduces end to end, because this is exactly the
 * shape of the incident that prompted it: a brand-new specialist
 * registers, is still "pending" review, and an admin opens a Support
 * session (impersonation) and clicks through every dashboard page.
 * ------------------------------------------------------------------ */

import { chromium } from "playwright";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4000/api";
const APP_BASE = process.env.E2E_APP_BASE ?? "http://localhost:4173";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@tls.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "demo1234";

const DASHBOARD_ROUTES = [
  "/dashboard",
  "/dashboard/messages",
  "/dashboard/billing",
  "/dashboard/team",
  "/dashboard/analytics",
];

const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`E2E impersonation smoke — API ${API_BASE}, app ${APP_BASE}\n`);

  /* -------------------------------------------------------- set the scene */
  const email = `e2e-${Date.now()}@example.com`;
  const registered = await api("POST", "/auth/register", {
    body: { fullName: "E2E Pending Specialist", email, password: "password123", plan: "basic" },
  });
  check("a new specialist can register", registered.status === 201, `HTTP ${registered.status} ${registered.text.slice(0, 160)}`);
  const specialistId = registered.json?.user?.specialistId;
  check("registration returns a specialistId", Boolean(specialistId));

  const adminLogin = await api("POST", "/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check("the seeded admin can sign in", Boolean(adminLogin.json?.token), `HTTP ${adminLogin.status}`);
  const adminToken = adminLogin.json?.token;

  const impersonation = await api("POST", `/admin/members/${specialistId}/impersonate`, { token: adminToken });
  check("the admin can start a support session", Boolean(impersonation.json?.token), `HTTP ${impersonation.status} ${impersonation.text.slice(0, 160)}`);
  const impersonationToken = impersonation.json?.token;

  if (!specialistId || !adminToken || !impersonationToken) {
    console.log("\nCannot proceed without all three — stopping here.");
    process.exit(1);
  }

  /* -------------------------------------------------------- walk the pages */
  // Only ever set in local/manual testing when the cached browser
  // revision doesn't match this npm package's expected one -- CI
  // installs the matching browser itself (see the workflow step) and
  // never sets this.
  const launchOpts = process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const pageErrors = [];
  const serverErrors = [];
  const crashLogs = [];
  // A render-phase crash here is caught by the app's own ErrorBoundary
  // (components/ErrorBoundary.tsx) -- that is the whole point of it, so
  // it never reaches window.onerror/pageerror. It does two other things
  // unconditionally though: logs "[TLS] A component crashed" via
  // console.error, and renders a page whose heading is literally
  // "Something broke on this page". Those are the two signals actually
  // worth watching; a bare pageerror listener alone misses this entire
  // class of bug, which is exactly how the hooks crash slipped through
  // once already.
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("A component crashed")) crashLogs.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(APP_BASE);
  await page.evaluate(
    ({ token, adminToken }) => {
      localStorage.setItem("tls.auth.token", token);
      localStorage.setItem("tls.auth.adminToken", adminToken);
    },
    { token: impersonationToken, adminToken }
  );

  for (const route of DASHBOARD_ROUTES) {
    const errorsBefore = pageErrors.length;
    const crashesBefore = crashLogs.length;
    await page.goto(`${APP_BASE}${route}`);
    // Settling time for any state transition (like the one that caused
    // the original hook-count mismatch, which only showed up once
    // `impersonation` resolved from empty to set) to finish.
    await page.waitForTimeout(800);
    const newErrors = pageErrors.slice(errorsBefore);
    const newCrashes = crashLogs.slice(crashesBefore);
    const fellBackToErrorBoundary = await page
      .getByText("Something broke on this page")
      .isVisible()
      .catch(() => false);
    check(
      `${route} renders without a script error`,
      newErrors.length === 0 && newCrashes.length === 0 && !fellBackToErrorBoundary,
      [...newErrors, ...newCrashes, fellBackToErrorBoundary ? "ErrorBoundary fallback shown" : null]
        .filter(Boolean)
        .join(" | ")
    );
  }

  check("no route returned a 5xx while this ran", serverErrors.length === 0, serverErrors.join(" | "));

  await browser.close();

  console.log(`\n${failures.length === 0 ? "All checks passed." : `${failures.length} check(s) failed:`}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("the suite itself failed:", err);
  process.exit(1);
});
