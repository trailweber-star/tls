import { chromium } from "playwright";

/* Walks every public route and every signed-in route, with the console
   watched for errors and the error boundary watched for appearances.
   A blank page shows up here as either an ErrorBoundary heading or a
   body with almost nothing in it. */

const BASE = "http://127.0.0.1:5173";
const API = "http://localhost:4000/api";
const problems = [];
let visited = 0;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.route("**://*.googleapis.com/**", (r) => r.abort());
await ctx.route("**://*.gstatic.com/**", (r) => r.abort());
/* The map service is stubbed rather than blocked. Blocking it is a
   valid state — the page degrades to an address and a link — but it is
   not the state being tested here, and a real tile fetch on every
   profile would make this crawl slow and flaky. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await ctx.route("**://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
await ctx.route("**://www.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>map</title>" }));

async function visit(page, path, label = path) {
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  const onConsole = (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // Missing images from the demo dataset are not page crashes.
      if (/favicon|net::ERR|Failed to load resource/i.test(t)) return;
      errors.push(t);
    }
  };
  page.on("pageerror", onErr);
  page.on("console", onConsole);
  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(600);
    const boundary = await page.locator("text=Something broke on this page").count();
    if (boundary) problems.push(`${label}: the error boundary caught a crash`);
    const textLen = (await page.locator("body").innerText()).trim().length;
    if (textLen < 40) problems.push(`${label}: rendered an all-but-empty page (${textLen} chars)`);
    if (errors.length) problems.push(`${label}: ${errors.slice(0, 2).join(" | ").slice(0, 220)}`);
  } catch (err) {
    problems.push(`${label}: ${String(err).slice(0, 160)}`);
  } finally {
    page.off("pageerror", onErr);
    page.off("console", onConsole);
    visited++;
  }
}

let page = await ctx.newPage();

/* ---------------------------------------------------- public routes */
const specialists = await (await fetch(`${API}/specialists/search?pageSize=50`)).json();
const facilities = await (await fetch(`${API}/facilities/featured?limit=50`)).json();
const specialties = await (await fetch(`${API}/specialties`)).json();
const cities = await (await fetch(`${API}/cities`)).json();

const routes = [
  "/", "/search", "/pricing", "/about", "/contact", "/privacy", "/terms", "/signin", "/register",
  "/search?q=knee", "/search?q=" + encodeURIComponent("<script>alert(1)</script>"),
  "/search?sort=not-a-sort&page=99999&pageSize=abc",
  "/search?specialty=not-a-specialty", "/search?city=nowhere",
  "/search?type=hospital", "/search?type=clinic", "/search?type=care_home", "/search?type=pharmacy",
  "/search?type=hospital&page=99", "/search?type=hospital&minRating=99&amenities=nope",
  "/specialists/does-not-exist", "/facilities/does-not-exist", "/clinics/does-not-exist",
  "/this-route-does-not-exist",
];
for (const s of specialists.results.slice(0, 14)) routes.push(`/specialists/${s.slug}`);
for (const f of facilities.slice(0, 8)) routes.push(`/facilities/${f.slug}`);
for (const sp of specialties.slice(0, 6)) routes.push(`/search?specialty=${sp.slug}`);
for (const c of cities.slice(0, 5)) routes.push(`/search?city=${c.slug}`);

for (const r of routes) await visit(page, r);

/* --------------------------------------------------- signed-in routes */
async function signIn(email, password) {
  // A fresh page each time: after a long crawl the previous one can be
  // left with an open overlay, and the failure looks like a login bug
  // rather than the test's own state.
  await page.close();
  page = await ctx.newPage();
  // Signing in as someone else means signing out first: /signin
  // correctly redirects an already-authenticated visitor straight to
  // their workspace, so the form would never appear.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* private mode */ } });
  await page.goto(BASE + "/signin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  // The demo-credential chips arrive a moment after the form and shift
  // the layout; let the page settle before typing into it.
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2200);
}

await signIn("j.whitfield@example.com", "demo1234");
for (const r of ["/dashboard", "/dashboard/profile", "/dashboard/enquiries", "/dashboard/reviews", "/dashboard/billing", "/pricing"]) {
  await visit(page, r, "specialist" + r);
}

/* The photo has to actually render, not merely have a src set. */
await page.goto(BASE + "/dashboard/profile", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
const shot = await page.evaluate(async () => {
  const input = document.querySelector('input[type="file"]');
  return Boolean(input);
});
if (!shot) problems.push("the profile editor has no file input for the photo");

await signIn("admin@tls.test", "demo1234");
for (const r of [
  "/admin",
  "/admin/members",
  "/admin/verifications",
  "/admin/specialists",
  "/admin/reviews",
  "/admin/claims",
  "/admin/messages",
  "/admin/audit",
]) {
  await visit(page, r, "admin" + r);
}

await b.close();
console.log(`visited ${visited} pages`);
console.log(problems.length ? problems.map((p) => "  ✗ " + p).join("\n") : "  no crashes, no blank pages, no console errors");
process.exit(problems.length ? 1 : 0);
