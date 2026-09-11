import { chromium } from "playwright";

/* ------------------------------------------------------------------ *
 * The legal pages
 *
 * Checked the way they will actually be used: a footer link somebody
 * clicks before trusting the site, a link in an email that has to land
 * on one clause, and the old URL wordings a cookie banner or an ICO
 * complaint form might carry.
 * ------------------------------------------------------------------ */

const BASE = "http://127.0.0.1:5173";

const problems = [];
let checks = 0;
function ok(label, condition, detail = "") {
  checks += 1;
  if (!condition) problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.route("**://*.googleapis.com/**", (r) => r.abort());
await ctx.route("**://tile.openstreetmap.org/**", (r) => r.abort());

const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/ERR_FAILED|net::ERR|favicon/i.test(t)) return;
  consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* --------------------------------------------------- both documents */

for (const [path, heading, minSections] of [
  ["/privacy", "Privacy Notice", 14],
  ["/terms", "Terms of Use", 16],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  ok(`${path} renders its heading`, (await page.locator("h1").first().textContent())?.trim() === heading);
  ok(
    `${path} says when it was last updated`,
    /Last updated \d+ \w+ \d{4}/.test((await page.locator("body").innerText()).slice(0, 4000))
  );

  const tocLinks = await page.locator('nav[aria-label="On this page"] a').count();
  ok(`${path} has a contents list`, tocLinks >= minSections, `${tocLinks} entries`);

  /* Every contents entry must point at a section that exists, and every
     section must be reachable from the contents. A legal page where one
     clause has quietly lost its anchor is a page whose links go nowhere. */
  const audit = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll('nav[aria-label="On this page"] a')].map((a) =>
      a.getAttribute("href").slice(1)
    );
    const ids = [...document.querySelectorAll("article > section[id]")].map((s) => s.id);
    return {
      missing: hrefs.filter((h) => !ids.includes(h)),
      unlisted: ids.filter((i) => !hrefs.includes(i)),
      duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
      empty: [...document.querySelectorAll("article > section[id]")]
        .filter((s) => s.innerText.trim().length < 60)
        .map((s) => s.id),
    };
  });
  ok(`${path}: every contents link has a section`, audit.missing.length === 0, audit.missing.join(", "));
  ok(`${path}: every section is in the contents`, audit.unlisted.length === 0, audit.unlisted.join(", "));
  ok(`${path}: no duplicate anchors`, audit.duplicates.length === 0, audit.duplicates.join(", "));
  ok(`${path}: no empty sections`, audit.empty.length === 0, audit.empty.join(", "));

  // Nobody else's company name, and no unfilled placeholders.
  const text = await page.locator("body").innerText();
  for (const stray of ["kneeclinics", "bromsgroveprivateclinic", "[COOKIE POLICY]", "[OUR Cookie Policy]", "lorem"]) {
    ok(`${path} contains no "${stray}"`, !text.toLowerCase().includes(stray.toLowerCase()));
  }
  ok(`${path} carries the right company`, text.includes("TopLocalSpecialists.com Limited"));
  ok(`${path} carries the contact email`, text.includes("admin@toplocalspecialists.com"));
  ok(`${path} carries the registered address`, text.includes("27 New Road"));
}

/* ------------------------------------------------------- the anchors */

await page.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
await page.click('nav[aria-label="On this page"] a[href="#cookies"]');
await page.waitForTimeout(600);
const afterClick = await page.evaluate(() => {
  const el = document.getElementById("cookies");
  return el ? Math.round(el.getBoundingClientRect().top) : null;
});
ok("clicking a contents entry scrolls to that clause", afterClick !== null && afterClick < 200, `${afterClick}px`);

/* ------------------------------------------------------- the aliases */

for (const [from, to] of [
  ["/privacy-policy", "/privacy"],
  ["/terms-of-use", "/terms"],
  ["/terms-and-conditions", "/terms"],
]) {
  await page.goto(`${BASE}${from}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  ok(`${from} redirects to ${to}`, new URL(page.url()).pathname === to, page.url());
}

await page.goto(`${BASE}/cookies`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const cookiesLanding = await page.evaluate(() => {
  const el = document.getElementById("cookies");
  return { path: location.pathname, hash: location.hash, top: el ? Math.round(el.getBoundingClientRect().top) : null };
});
ok(
  "/cookies lands on the cookies clause, not just the top of the page",
  cookiesLanding.path === "/privacy" && cookiesLanding.hash === "#cookies" && cookiesLanding.top < 200,
  JSON.stringify(cookiesLanding)
);

/* -------------------------------------------------------- the footer */

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
for (const [label, href] of [
  ["Privacy notice", "/privacy"],
  ["Terms of use", "/terms"],
  ["Cookies", "/privacy#cookies"],
]) {
  const link = page.locator(`footer a[href="${href}"]`);
  ok(`the footer links to ${label}`, (await link.count()) > 0, href);
}

await page.locator('footer a[href="/terms"]').first().click();
await page.waitForURL(/\/terms/, { timeout: 8000 });
ok("the footer link actually opens the terms", new URL(page.url()).pathname === "/terms");

/* ------------------------------------------------- consent at signup */

for (const [path, label] of [
  ["/register", "the sign-up form"],
  ["/claim/mr-david-okonkwo", "the claim form"],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const hasTerms = (await page.locator('a[href="/terms"]').count()) > 0;
  const hasPrivacy = (await page.locator('a[href="/privacy"]').count()) > 0;
  ok(`${label} shows what the person is agreeing to`, hasTerms && hasPrivacy, `terms:${hasTerms} privacy:${hasPrivacy}`);
}

/* ------------------------------------------------------ narrow view */

await page.setViewportSize({ width: 400, height: 900 });
for (const path of ["/privacy", "/terms"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(`${path} does not scroll sideways on a phone`, overflow <= 2, `${overflow}px`);
}

ok("no console errors anywhere in this run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await b.close();

console.log(`\n${checks - problems.length}/${checks} checks passed`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
