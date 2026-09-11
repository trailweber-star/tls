import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:5173";
const problems = [];
const ok = (n, c, d = "") => console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`) || (c || problems.push(n + (d ? ` — ${d}` : "")));

// A visibly non-blank PNG so "did it render" is answerable.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAT0lEQVR42u3PQREAAAgDIE1u9FvDOwbcIJfamlgBAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIfLcAcOAAAWJ7yEEAAAAASUVORK5CYII=",
  "base64"
);
writeFileSync("/tmp/tls-test-photo.png", PNG);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
await p.route("**://*.googleapis.com/**", (r) => r.abort());
await p.route("**://*.gstatic.com/**", (r) => r.abort());

await p.goto(BASE + "/signin", { waitUntil: "domcontentloaded" });
await p.waitForSelector('input[type="email"]');
await p.waitForTimeout(1200);
await p.fill('input[type="email"]', "j.whitfield@example.com");
await p.fill('input[type="password"]', "demo1234");
await p.click('button[type="submit"]');
await p.waitForTimeout(2500);

await p.goto(BASE + "/dashboard/profile", { waitUntil: "domcontentloaded" });
await p.waitForSelector("#profile-photo", { state: "attached", timeout: 15000 });
await p.waitForTimeout(1200);

// Upload through the real field, exactly as a person would.
await p.setInputFiles("#profile-photo", "/tmp/tls-test-photo.png");
await p.waitForTimeout(3500);

const preview = p.locator('img').first();
const shown = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll("img")];
  const up = imgs.find((i) => /\/uploads\//.test(i.currentSrc || i.src));
  if (!up) return { found: false };
  return { found: true, src: up.currentSrc || up.src, w: up.naturalWidth, h: up.naturalHeight, complete: up.complete };
});
ok("the uploaded photo appears in the form", shown.found);
ok("its URL is absolute against the API", /^https?:\/\//.test(shown.src ?? ""), shown.src);
ok("the browser actually decoded the image (not a broken icon)", shown.w > 0 && shown.h > 0,
   `naturalWidth=${shown.w} naturalHeight=${shown.h}`);

// Save, and check the confirmation is visible rather than behind the sidebar.
await p.click('button[type="submit"]');
await p.waitForTimeout(2500);

const toast = await p.evaluate(() => {
  const el = [...document.querySelectorAll("p,span")].find((n) => /changes have been saved/i.test(n.textContent || ""));
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  // Is anything painted on top of its centre point? If the sidebar is,
  // elementFromPoint returns the sidebar rather than the message.
  /* The toast deliberately does not take pointer events, so
     elementFromPoint reports what is underneath it. What matters is
     whether anything PAINTED ON TOP: the sidebar sits on a higher
     layer, which is what used to hide the message. So look at the whole
     stack at that point and fail if the sidebar is above the toast. */
  const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const toastIndex = stack.findIndex((n) => n === el || n.contains(el) || el.contains(n));
  const sidebarIndex = stack.findIndex((n) => n.tagName === "ASIDE");
  return {
    found: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    covered: sidebarIndex !== -1 && (toastIndex === -1 || sidebarIndex < toastIndex),
    inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
  };
});
ok("a save confirmation is shown", toast.found);
ok("the confirmation is not covered by the sidebar", toast.found && !toast.covered, JSON.stringify(toast.rect));
ok("the confirmation is fully on screen", toast.found && toast.inViewport, JSON.stringify(toast.rect));

await p.screenshot({ path: "/tmp/claude-0/-home-claude/f1176b09-cc1b-5a0a-ac15-879677cfd363/scratchpad/saved.png" });

// And the photo must render on the public profile too.
const slug = await p.evaluate(() => document.location.pathname);
await p.goto(BASE + "/specialists/dr-james-whitfield", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const pub = await p.evaluate(() => {
  const up = [...document.querySelectorAll("img")].find((i) => /\/uploads\//.test(i.currentSrc || i.src));
  return up ? { w: up.naturalWidth, h: up.naturalHeight, src: up.currentSrc } : null;
});
ok("the photo renders on the public profile", Boolean(pub && pub.w > 0), JSON.stringify(pub));

await b.close();
console.log(problems.length ? `\n${problems.length} FAILED` : "\nALL PASS");
process.exit(problems.length ? 1 : 0);
