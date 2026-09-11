import { chromium } from "playwright";
const B = "http://127.0.0.1:5173";
const problems = [];
const ok = (n, c, d="") => { console.log(`${c?"PASS":"FAIL"}  ${n}${d?" — "+d:""}`); if(!c) problems.push(n); };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
await p.route("**://*.googleapis.com/**", r => r.abort());
await p.route("**://*.gstatic.com/**", r => r.abort());
// The tile server is unreachable from this sandbox; abort it so the
// page does not sit waiting. The <iframe> is still created either way,
// which is what we are checking.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await p.route("**://tile.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
await p.route("**://www.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>map</title>" }));

await p.goto(B + "/signin", { waitUntil: "domcontentloaded" });
await p.waitForSelector('input[type="email"]');
await p.waitForTimeout(1200);
await p.fill('input[type="email"]', "j.whitfield@example.com");
await p.fill('input[type="password"]', "demo1234");
await p.click('button[type="submit"]');
await p.waitForTimeout(2500);

await p.goto(B + "/dashboard/profile#locations", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const inEditor = await p.evaluate(() => {
  const f = [...document.querySelectorAll("iframe")].filter(i => /openstreetmap|google\.com\/maps/.test(i.src));
  return { count: f.length, src: f[0]?.src ?? null, h: f[0]?.getBoundingClientRect().height ?? 0 };
});
ok("the editor shows a map under a pinned address", inEditor.count > 0, JSON.stringify(inEditor).slice(0,140));

await p.goto(B + "/specialists/mr-james-whitfield#locations", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const onProfile = await p.evaluate(() => {
  const f = [...document.querySelectorAll("iframe")].filter(i => /openstreetmap|google\.com\/maps/.test(i.src));
  const btn = [...document.querySelectorAll("button")].find(b => /larger map/i.test(b.getAttribute("aria-label")||b.textContent||""));
  const r = f[0]?.getBoundingClientRect();
  return { count: f.length, h: Math.round(r?.height ?? 0), w: Math.round(r?.width ?? 0), hasButton: Boolean(btn) };
});
ok("the profile shows a map for the address", onProfile.count > 0, JSON.stringify(onProfile));
/* Square, and a sensible size — not a letterbox strip and not a
   full-page slab. The width is checked against the height rather than
   against a fixed number, because the frame fills the column it is in
   and that column is a different width at every breakpoint. */
ok("the map is square", Math.abs(onProfile.h - onProfile.w) <= 1, `${onProfile.w}x${onProfile.h}`);
ok("and a sensible size", onProfile.h >= 150 && onProfile.h <= 520, `height ${onProfile.h}`);
ok("there is a way to open a larger one", onProfile.hasButton);

// And that clicking it opens the large map.
if (onProfile.hasButton) {
  await p.click('button[aria-label*="larger map" i]');
  await p.waitForTimeout(900);
  const dlg = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!d) return null;
    const f = d.querySelector("iframe");
    return { h: Math.round(f?.getBoundingClientRect().height ?? 0), w: Math.round(f?.getBoundingClientRect().width ?? 0),
             link: d.querySelector('a[target="_blank"]')?.textContent?.trim() ?? null,
             bodyLocked: getComputedStyle(document.body).overflow };
  });
  ok("clicking opens a large map", Boolean(dlg), JSON.stringify(dlg));
  ok("the large map is substantially bigger", (dlg?.h ?? 0) > 380, `height ${dlg?.h}`);
  ok("it offers a link out to the map service", Boolean(dlg?.link), dlg?.link ?? "");
  ok("the page behind is locked while it is open", dlg?.bodyLocked === "hidden", dlg?.bodyLocked ?? "");
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/f1176b09-cc1b-5a0a-ac15-879677cfd363/scratchpad/map-dialog.png" });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  const closed = await p.evaluate(() => ({
    gone: !document.querySelector('[role="dialog"][aria-modal="true"]'),
    overflow: getComputedStyle(document.body).overflow,
  }));
  ok("Escape closes it", closed.gone);
  ok("and the page can scroll again", closed.overflow !== "hidden", closed.overflow);
}
/* And the state that matters most on a real machine: the map service
   unreachable — an ad blocker, a corporate proxy, an offline laptop.
   It must leave a line of text and a working link, never a grey box. */
const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p2.route("**://*.googleapis.com/**", r => r.abort());
await p2.route("**://*.gstatic.com/**", r => r.abort());
await p2.route("**://*.openstreetmap.org/**", r => r.abort());
await p2.goto(B + "/specialists/mr-james-whitfield#locations", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(4000);
const degraded = await p2.evaluate(() => ({
  message: [...document.querySelectorAll("span")].find(s => /couldn.t be loaded/i.test(s.textContent||""))?.textContent?.trim() ?? null,
  frameGone: !document.querySelector('iframe[src*="openstreetmap"]'),
  link: [...document.querySelectorAll("a")].find(a=>/open the map/i.test(a.textContent||""))?.href ?? null,
}));
ok("a blocked map service degrades to a message", Boolean(degraded.message), JSON.stringify(degraded));
ok("the empty frame is removed rather than left grey", degraded.frameGone);
ok("and it still offers a way to see the map", Boolean(degraded.link));

await b.close();
console.log(problems.length ? `\n${problems.length} FAILED` : "\nALL PASS");
process.exit(problems.length ? 1 : 0);
