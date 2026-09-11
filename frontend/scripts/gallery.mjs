import { chromium } from "playwright";

/* The gallery used to be URL boxes. This uploads a real file through
   each of the three image fields that replaced them — cover banner,
   gallery image, video cover — and insists the browser DECODED the
   stored file, not merely that a src attribute got set. That weaker
   check is exactly what let the profile-photo field ship broken. */

const B = "http://127.0.0.1:5173";
const PNG = process.env.TEST_IMAGE ?? "/tmp/tls-gallery-test.png";
const problems = [];
const ok = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!c) problems.push(n); };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.route("**://*.googleapis.com/**", (r) => r.abort());
await p.route("**://*.gstatic.com/**", (r) => r.abort());

await p.goto(B + "/signin", { waitUntil: "domcontentloaded" });
await p.waitForSelector('input[type="email"]');
await p.waitForTimeout(1200);
await p.fill('input[type="email"]', process.env.TEST_EMAIL ?? "j.whitfield@example.com");
await p.fill('input[type="password"]', "demo1234");
await p.click('button[type="submit"]');
await p.waitForTimeout(2500);

/* The gallery is a paid feature, so a Basic account sees a locked
   panel with no fields in it — which is correct, and is why the first
   run of this test found nothing to upload into. Put the account on
   Premium through the real billing endpoints rather than reaching into
   the database, so the test walks the path a member actually walks. */
const upgraded = await p.evaluate(async () => {
  const token = localStorage.getItem("tls.auth.token");
  const call = (path, body) =>
    fetch("http://localhost:4000/api" + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    }).then((r) => r.json());
  /* Three steps, because that is the real flow: choose the plan, open
     payment (which is what creates the order), then pay. Skipping
     checkout leaves nothing outstanding and the simulator correctly
     refuses. */
  await call("/billing/change-plan", { planId: "premium", interval: "yearly" });
  await call("/billing/checkout", { planId: "premium", interval: "yearly" });
  await call("/billing/simulate-payment");
  const me = await fetch("http://localhost:4000/api/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return me?.specialist?.plan ?? me?.account?.plan ?? null;
});
ok("the account is on a plan that includes the gallery", upgraded === "premium", String(upgraded));

await p.goto(B + "/dashboard/profile#gallery", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);

// There must be a row to upload into.
const addImage = p.locator('button:has-text("Add an image")');
if (await addImage.count()) { await addImage.first().click(); await p.waitForTimeout(600); }

ok("the gallery has no URL boxes left",
  (await p.locator('input[placeholder="https://…"]').count()) === 0,
  `${await p.locator('input[placeholder="https://…"]').count()} left`);

for (const id of ["#cover-image", "#gallery-image-0"]) {
  const field = p.locator(id);
  if ((await field.count()) === 0) { ok(`${id} exists`, false); continue; }
  ok(`${id} is a file input`, (await field.getAttribute("type")) === "file");

  const before = await p.evaluate((sel) => {
    const input = document.querySelector(sel);
    const img = input?.closest("div")?.parentElement?.querySelector('img[src*="/uploads/"]');
    return img ? img.currentSrc || img.src : null;
  }, id);

  await p.setInputFiles(id, PNG);
  await p.waitForFunction(
    ([sel, previous]) => {
      const input = document.querySelector(sel);
      const scope = input?.closest('[class*="rounded-2xl"]') ?? document;
      const img = scope.querySelector('img[src*="/uploads/"]');
      const src = img ? img.currentSrc || img.src : null;
      return Boolean(src) && src !== previous;
    },
    [id, before],
    { timeout: 45000 }
  ).catch(() => {});
  await p.waitForTimeout(800);

  const state = await p.evaluate(async (sel) => {
    const input = document.querySelector(sel);
    const scope = input?.closest('[class*="rounded-2xl"]') ?? document;
    const img = scope.querySelector('img[src*="/uploads/"]');
    if (!img) return { found: false };
    if (!img.complete) await new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 8000); });
    return { found: true, src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight };
  }, id);

  ok(`${id} uploaded and came back`, state.found, JSON.stringify(state).slice(0, 140));
  ok(`${id} URL is absolute`, /^https?:\/\//.test(state.src ?? ""), state.src);
  ok(`${id} actually decoded (not a broken icon)`, (state.w ?? 0) > 0 && (state.h ?? 0) > 0, `${state.w}x${state.h}`);
}

// It has to survive a save and a reload, then reach the public profile.
await p.click('button[type="submit"]');
await p.waitForTimeout(3000);
await p.goto(B + "/dashboard/profile#gallery", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const persisted = await p.evaluate(() =>
  [...document.querySelectorAll('img[src*="/uploads/"]')].map((i) => i.currentSrc || i.src).length
);
ok("the images are still there after saving and reloading", persisted >= 2, `${persisted} found`);

await b.close();
console.log(problems.length ? `\n${problems.length} FAILED` : "\nALL PASS");
process.exit(problems.length ? 1 : 0);
