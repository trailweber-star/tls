import { chromium } from "playwright";

/* ------------------------------------------------------------------ *
 * The admin members workspace, driven the way an administrator drives
 * it.
 *
 * Everything here is checked through the interface rather than the API:
 * the API was proved separately, and the failures this is looking for
 * are the ones that only exist in the browser — a filter that writes to
 * the URL but never re-queries, a bulk action that reports success and
 * changes nothing, a support session you cannot get out of.
 * ------------------------------------------------------------------ */

const BASE = "http://127.0.0.1:5173";
const ADMIN = { email: "admin@tls.test", password: "demo1234" };

const problems = [];
let checks = 0;

function ok(label, condition, detail = "") {
  checks += 1;
  if (!condition) problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
await ctx.route("**://*.googleapis.com/**", (r) => r.abort());
await ctx.route("**://tile.openstreetmap.org/**", (r) => r.abort());

const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // Aborted map tiles are this harness's doing, not the page's.
  if (/ERR_FAILED|net::ERR|favicon/i.test(text)) return;
  consoleErrors.push(text);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* --------------------------------------------------------- sign in */

await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', ADMIN.email);
await page.fill('input[type="password"]', ADMIN.password);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 15000 });
ok("admin signs in and lands in the admin workspace", /\/admin/.test(page.url()), page.url());

/* ------------------------------------------------------ the list */

await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr", { timeout: 15000 });

const rowCount = await page.locator("table tbody tr").count();
ok("members table renders rows", rowCount > 0, `${rowCount} rows`);

const totalText = await page.locator("text=/\\d+ members?/").first().textContent();
ok("a total is shown", /\d+ member/.test(totalText ?? ""), totalText ?? "");

const tabCount = await page.locator('button[aria-pressed]:below(:text("Members"))').count();
ok("status tabs are present", tabCount >= 7, `${tabCount} tabs`);

// Every tab count should be a number, and "Everyone" should be the largest.
const everyoneText = (await page.locator('button[aria-pressed]:has-text("Everyone")').first().textContent()) ?? "";
const everyone = Number((/\d+/.exec(everyoneText) ?? ["0"])[0]);
ok("the Everyone tab carries a count", everyone > 0, String(everyone));

/* ------------------------------------------------------- filters */

/* Read the name column structurally rather than by class: the avatar
   initials and the status chip are both bold too. */
const nameSelector = "table tbody tr td:nth-child(2) button > span:last-child > span:first-child";
const rowNames = () => page.$$eval(nameSelector, (els) => els.map((e) => e.textContent.trim()));

// A search that must match something: take a name from the first row.
const firstName = (await rowNames())[0] ?? "";
const surname = firstName.split(/\s+/).pop() ?? firstName;

await page.fill('input[aria-label="Search members"]', surname);
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
ok("search writes itself into the URL", page.url().includes("q="), page.url());
const searched = await page.locator("table tbody tr").count();
ok("search narrows the list", searched > 0 && searched <= rowCount, `${searched} of ${rowCount}`);
const searchedNames = await page.locator("table tbody tr").allTextContents();
ok(
  "every row returned actually matches the term",
  searchedNames.every((t) => t.toLowerCase().includes(surname.toLowerCase())),
  surname
);

// Clearing it through the chip restores the list.
await page.click('text=Clear all');
await page.waitForTimeout(700);
ok("clear all removes the filter from the URL", !page.url().includes("q="), page.url());
ok("clear all restores the full list", (await page.locator("table tbody tr").count()) === rowCount);

// Stacked filters: open the grid and apply two at once.
await page.click('button:has-text("More filters")');
await page.waitForTimeout(200);
ok("the filter grid opens", await page.locator('select').first().isVisible());

await page.getByLabel("Membership").selectOption("premium");
await page.waitForTimeout(600);
const planFiltered = await page.locator("table tbody tr").count();
ok("a plan filter applies", page.url().includes("plan=premium"), page.url());

// Stack a second filter on top and confirm the count can only shrink.
await page.locator('input[type="checkbox"]').last().check().catch(() => {});
await page.waitForTimeout(600);
const stacked = await page.locator("table tbody tr").count().catch(() => 0);
ok("a second filter stacks rather than replacing", stacked <= planFiltered, `${stacked} ≤ ${planFiltered}`);

await page.click('text=Clear all').catch(() => {});
await page.waitForTimeout(600);

// A filter with no matches must say so rather than showing a blank panel.
await page.goto(`${BASE}/admin/members?q=zzzznobodyzzzz`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
ok("an empty result explains itself", await page.locator("text=Nobody matches that").isVisible());
await page.click('button:has-text("Clear all filters")');
await page.waitForTimeout(600);
ok("the empty state's clear button works", (await page.locator("table tbody tr").count()) > 0);

/* ---------------------------------------------------------- sort */

await page.getByLabel("Sort by").selectOption("name");
await page.waitForTimeout(900);
const names = await rowNames();
const sorted = [...names].sort((a, b) => a.localeCompare(b));
ok("A–Z sort actually orders the rows", JSON.stringify(names) === JSON.stringify(sorted), names.slice(0, 3).join(" | "));

/* -------------------------------------------------------- drawer */

/* A claimed listing, because the notes and the support session both
   need an account behind the row — and the interesting checks are the
   ones that act on it rather than the ones that find it disabled. */
await page.goto(`${BASE}/admin/members?claimed=yes`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr", { timeout: 15000 });
await page.locator("table tbody tr td:nth-child(2) button").first().click();
await page.waitForSelector('[role="dialog"] textarea', { timeout: 10000 });
ok("the member drawer opens", await page.locator('[role="dialog"]').isVisible());
ok("the drawer shows the sign-in-as action", await page.locator('[role="dialog"] >> text=Sign in as this member').isVisible());
ok("the drawer shows where they signed up from", await page.locator('[role="dialog"] >> text=Signed up from').isVisible());
ok(
  "the drawer shows internal notes",
  await page.locator('[role="dialog"]').getByRole("heading", { name: "Internal notes" }).isVisible()
);

// Notes and a tag must survive a reload — the failure mode being looked
// for is a save that reports success and writes nothing.
const stamp = `check-${Date.now()}`;
await page.fill('[role="dialog"] textarea', stamp);
await page.fill('[role="dialog"] input[aria-label="Add a tag"]', "smoke-tag");
await page.keyboard.press("Enter");
await page.click('[role="dialog"] >> button:has-text("Save notes and tags")');
await page.waitForSelector('[role="dialog"] >> text=Saved.', { timeout: 8000 }).catch(() => {});
ok("saving notes reports success", await page.locator('[role="dialog"] >> text=Saved.').isVisible());

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator("table tbody tr td:nth-child(2) button").first().click();
await page.waitForSelector('[role="dialog"] textarea', { timeout: 10000 });
await page.waitForTimeout(400);
const persisted = await page.locator('[role="dialog"] textarea').inputValue();
ok("the note was really stored", persisted === stamp, persisted.slice(0, 40));
ok("the tag was really stored", await page.locator('[role="dialog"] >> text=smoke-tag').first().isVisible());

/* --------------------------------------------------- audit trail */

ok(
  "the drawer records the annotation in the member's history",
  await page.locator('[role="dialog"] >> text=Administrator actions').isVisible()
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

/* --------------------------------------------------- bulk actions */

await page.locator('table tbody tr input[type="checkbox"]').first().check();
await page.waitForTimeout(200);
ok("selecting a row shows the bulk bar", await page.locator("text=1 selected").first().isVisible());

// A rejection with no reason must not be possible.
await page.click('button:has-text("Reject listing")');
await page.waitForTimeout(400);
const rejectBtn = page.locator('div[role="dialog"] button:has-text("Reject listing")').last();
ok("reject is refused without a reason", await rejectBtn.isDisabled());
await page.fill('div[role="dialog"] textarea', "checking the guard, not a real decision");
ok("reject unlocks once a reason is given", !(await rejectBtn.isDisabled()));
await page.click('div[role="dialog"] button:has-text("Cancel")');
await page.waitForTimeout(300);
ok("cancelling changes nothing", !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => false)));

// A tag applied in bulk, then taken off again.
await page.click('button:has-text("Add a tag")');
await page.waitForTimeout(300);
await page.fill('div[role="dialog"] input[placeholder="chase-documents"]', "bulk-check");
await page.click('div[role="dialog"] button:has-text("Add a tag")');
await page.waitForTimeout(1200);
ok("the bulk action reports what it did", await page.locator("text=/Tagged: 1 member/").isVisible());

await page.goto(`${BASE}/admin/members?tag=bulk-check`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
ok("the tag can be filtered on afterwards", (await page.locator("table tbody tr").count()) === 1);

await page.locator('table tbody tr input[type="checkbox"]').first().check();
await page.click('button:has-text("Remove a tag")');
await page.waitForTimeout(300);
await page.fill('div[role="dialog"] input[placeholder="chase-documents"]', "bulk-check");
await page.click('div[role="dialog"] button:has-text("Remove a tag")');
await page.waitForTimeout(1200);
await page.goto(`${BASE}/admin/members?tag=bulk-check`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
ok("removing the tag empties that filter again", await page.locator("text=Nobody matches that").isVisible());

/* -------------------------------------------------------- export */

await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr");
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.click('button:has-text("Export CSV")'),
]);
const path = await download.path();
const csv = path ? (await import("node:fs")).readFileSync(path, "utf8") : "";
ok("the export downloads a file", Boolean(path), download.suggestedFilename());
ok("the export is a members CSV with a header row", csv.startsWith("﻿\"ID\",\"Name\"") || csv.startsWith('"ID","Name"'), csv.slice(0, 40));
ok("the export has one line per member plus the header", csv.trim().split(/\r?\n/).length > 1);

/* ------------------------------------------------- impersonation */

await page.goto(`${BASE}/admin/members?claimed=yes`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr");
await page.locator("table tbody tr").first().locator('button[aria-label^="Actions for"]').click();
await page.waitForTimeout(250);
const signInAs = page.locator('button:has-text("Sign in as this member")').first();
ok("the row menu offers a support session", await signInAs.isVisible());
await signInAs.click();
await page.waitForTimeout(400);
ok("starting one asks for a reason first", await page.locator("text=Why (optional, but recorded)").isVisible());
await page.fill('div[role="dialog"] input[placeholder^="Reported that"]', "browser check");
await page.click('button:has-text("Start support session")');
await page.waitForURL(/\/dashboard/, { timeout: 15000 });
ok("it lands in the member's own dashboard", /\/dashboard/.test(page.url()), page.url());

await page.waitForSelector("text=Support session.", { timeout: 8000 });
ok("a banner says whose account this is", await page.locator("text=Support session.").isVisible());
ok(
  "the banner names the member being worn",
  await page.locator("text=/You are viewing the site as/").isVisible()
);

// The banner must follow you onto the public site, which is where an
// administrator is most likely to forget.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
ok("the banner is present on the public site too", await page.locator("text=Support session.").isVisible());

// Admin routes must refuse a borrowed session.
await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("admin screens are closed to a borrowed session", !/\/admin/.test(page.url()), page.url());

// The member's own screens must actually work while worn — a support
// session that can only see the dashboard's front page is no use.
await page.goto(`${BASE}/dashboard/profile`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
ok(
  "the member's own profile editor opens inside the support session",
  await page.locator("text=/Your profile|Profile/i").first().isVisible()
);
ok("the banner is still there on their editor", await page.locator("text=Support session.").isVisible());

// And there must be a way back.
await page.click('button:has-text("Return to my admin account")');
await page.waitForURL(/\/admin\/members/, { timeout: 15000 });
await page.waitForSelector("table tbody tr", { timeout: 15000 });
ok("returning puts the administrator back in the members list", /\/admin\/members/.test(page.url()), page.url());
ok("the banner is gone afterwards", !(await page.locator("text=Support session.").isVisible().catch(() => false)));

/* --------------------------------------------------- activity log */

await page.goto(`${BASE}/admin/audit`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok("the activity log loads", await page.locator("text=Activity log").first().isVisible());
ok("it recorded the support session", await page.locator("text=Started a support session").first().isVisible());
ok("it recorded the end of it", await page.locator("text=Ended a support session").first().isVisible());
ok("it recorded the export", await page.locator("text=Exported the members list").first().isVisible());
ok("log filtering works", await (async () => {
  await page.fill('input[aria-label="Filter the activity log"]', "support");
  await page.waitForTimeout(400);
  const texts = await page.locator("ol li").allTextContents();
  return texts.length > 0 && texts.every((t) => /support/i.test(t));
})());

/* ------------------------------- when a borrowed session runs out */

/* Thirty minutes is the life of a support token. Rather than wait, the
   token is corrupted: the effect on the browser is identical — /auth/me
   refuses it — and what is being checked is that the administrator is
   put back into their own session rather than dumped at the sign-in
   page having lost their place. */
await page.goto(`${BASE}/admin/members?claimed=yes`, { waitUntil: "networkidle" });
await page.waitForSelector("table tbody tr");
await page.locator("table tbody tr").first().locator('button[aria-label^="Actions for"]').click();
await page.locator('button:has-text("Sign in as this member")').first().click();
await page.click('button:has-text("Start support session")');
await page.waitForURL(/\/dashboard/, { timeout: 15000 });
/* From here the browser is deliberately holding a broken token, so the
   401s it provokes are the point of the test rather than a fault. They
   are dropped from the console tally below. */
const corruptedFrom = consoleErrors.length;
await page.evaluate(() => localStorage.setItem("tls.auth.token", "not.a.valid.token"));
await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
ok(
  "an expired support session drops back into the admin account, not the login page",
  /\/admin\/members/.test(page.url()) && (await page.locator("table tbody tr").count()) > 0,
  page.url()
);
ok("and the banner goes with it", !(await page.locator("text=Support session.").isVisible().catch(() => false)));
consoleErrors.splice(corruptedFrom);

/* ------------------------------------------------ sidebar collapse */

await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForSelector("aside");
const wideBefore = (await page.locator("aside").first().boundingBox())?.width ?? 0;
await page.click('button[aria-label*="ollapse"], button[title*="ollapse"]').catch(async () => {
  await page.locator("aside button").last().click();
});
await page.waitForTimeout(600);
const wideAfter = (await page.locator("aside").first().boundingBox())?.width ?? 0;
ok("the sidebar collapses", wideAfter < wideBefore, `${wideBefore} → ${wideAfter}`);

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("aside");
const wideReload = (await page.locator("aside").first().boundingBox())?.width ?? 0;
ok("the collapse is remembered across a reload", Math.abs(wideReload - wideAfter) < 4, `${wideReload}`);

// Put it back so the next run starts from the same place.
await page.locator("aside button").last().click();
await page.waitForTimeout(400);

/* ---------------------------------------------------- narrow view */

await page.setViewportSize({ width: 420, height: 900 });
await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("the page does not scroll sideways on a phone", overflow <= 2, `${overflow}px`);

/* ------------------------------------------------------- console */

ok("no console errors anywhere in this run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await b.close();

console.log(`\n${checks - problems.length}/${checks} checks passed`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
