import { chromium } from "playwright";

/* ------------------------------------------------------------------ *
 * The deployed preview, driven the way the client will open it
 *
 *   node scripts/preview.mjs http://127.0.0.1:4100 client:password
 *
 * This checks the thing that separates "it works on my machine" from "it
 * works on the link I sent": one origin serving both the built site and
 * the API, behind a password, with client-side routes that survive a
 * refresh and assets that actually load from the built bundle rather
 * than from a dev server.
 * ------------------------------------------------------------------ */

const BASE = process.argv[2] ?? "http://127.0.0.1:4100";
const credentials = process.argv[3] ?? null;
const [user, password] = credentials ? credentials.split(":") : [null, null];

const problems = [];
let checks = 0;
function ok(label, condition, detail = "") {
  checks += 1;
  if (!condition) problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/* --------------------------------------------- the gate itself */

if (credentials) {
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => null);
  ok(
    "without the password the site is not served",
    new URL(anonPage.url()).pathname === "/__preview",
    anonPage.url()
  );
  ok("it asks for the password", await anonPage.locator('input[name="password"]').isVisible());
  ok(
    "a wrong password is refused",
    await (async () => {
      await anonPage.fill('input[name="password"]', "not-the-password");
      await anonPage.click('button[type="submit"]');
      await anonPage.waitForTimeout(600);
      return anonPage.locator("text=not right").isVisible();
    })()
  );
  const api = await anonPage.request.get(`${BASE}/api/specialists/search?limit=1`);
  ok("and the API behind it is closed too", api.status() === 401, `HTTP ${api.status()}`);
  const robots = await anonPage.request.get(`${BASE}/robots.txt`);
  ok("robots.txt disallows everything", (await robots.text()).includes("Disallow: /"));
  await anonymous.close();
}

const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.route("**://tile.openstreetmap.org/**", (r) => r.abort());
await ctx.route("**://*.googleapis.com/**", (r) => r.abort());

const page = await ctx.newPage();

/* Through the gate the way a person does: the form, once, and then the
   cookie carries every request after it — including the fetch() calls
   the single-page app makes, which is the part HTTP Basic auth got
   wrong. */
if (credentials) {
  await page.goto(`${BASE}/__preview`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname !== "/__preview", { timeout: 15000 });
  ok("the right password lets you in", new URL(page.url()).pathname === "/", page.url());
}
const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  /* Aborted map tiles and blocked webfonts are this harness's doing.
     Everything else — including a resource the deployed build cannot
     find — is a real finding. */
  if (/ERR_FAILED|net::ERR_ABORTED|ERR_TUNNEL|fonts\.googleapis|favicon/i.test(t)) return;
  consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  // A 4xx/5xx on anything the page asked for — a missing bundle, a
  // missing image, an API call to the wrong origin.
  if (r.status() >= 400 && !/tile\.openstreetmap|googleapis|gstatic/.test(r.url())) {
    failedRequests.push(`${r.status()} ${r.url()}`);
  }
});

/* -------------------------------------------- the site, as built */

await page.goto(BASE, { waitUntil: "networkidle" });
ok("the home page loads from the built bundle", (await page.locator("h1").count()) > 0);
ok(
  "and it is the production build, not a dev server",
  (await page.locator('script[type="module"][src*="/assets/"]').count()) > 0 ||
    (await page.evaluate(() => !document.querySelector('script[src*="/@vite/client"]')))
);

await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const results = await page.locator("a[href^='/specialists/']").count();
ok("the directory returns results from the API on the same origin", results > 0, `${results} cards`);

/* The single-origin check that matters: every API call the page made
   went to this host, not to localhost:4000 baked in at build time. */
const apiHosts = await page.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .filter((e) => e.name.includes("/api/"))
    .map((e) => new URL(e.name).origin)
);
ok(
  "every API call goes to the preview's own origin",
  apiHosts.length > 0 && apiHosts.every((o) => o === new URL(BASE).origin),
  [...new Set(apiHosts)].join(", ") || "no API calls seen"
);

/* ------------------------------------------ routes after a refresh */

for (const path of ["/pricing", "/about", "/privacy", "/terms", "/signin"]) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  ok(`${path} survives a direct hit`, res?.status() === 200, `HTTP ${res?.status()}`);
}

/* ------------------------------------------------- signing in */

await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', process.env.PREVIEW_ADMIN_EMAIL || "admin@tls.test");
await page.fill('input[type="password"]', process.env.PREVIEW_ADMIN_PASSWORD || "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 20000 }).catch(() => {});
ok("an administrator can sign in on the preview", /\/admin/.test(page.url()), page.url());

await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => {});
ok("the members workspace loads", (await page.locator("table tbody tr").count()) > 0);

// Refreshing a deep route is the classic single-page-app deploy failure.
const deep = await page.goto(`${BASE}/admin/members?status=verified`, { waitUntil: "networkidle" });
ok("a deep admin route survives a refresh", deep?.status() === 200, `HTTP ${deep?.status()}`);
await page.waitForTimeout(800);
ok("and still renders after it", (await page.locator("table tbody tr").count()) > 0);

/* --------------------------------------------- uploaded photos */

const brokenImages = await page.evaluate(() =>
  [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.currentSrc || img.src)
);
ok("no image on the page failed to load", brokenImages.length === 0, brokenImages.slice(0, 3).join(", "));

/* ----------------------------------------------------- health */

const health = await page.request.get(`${BASE}/api/health`);
ok("the health check answers without a password", health.status() === 200, `HTTP ${health.status()}`);

ok("nothing 404'd or 500'd along the way", failedRequests.length === 0, failedRequests.slice(0, 4).join(" | "));
ok("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n${checks - problems.length}/${checks} checks passed`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
