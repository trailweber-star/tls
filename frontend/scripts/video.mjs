import { chromium } from "playwright";

/* Uploads a real video through the real field, in a real browser, and
   checks the three things that decide whether the feature works:
   it reaches the server, the stored file plays back, and the duration
   the browser read out of it landed in the form. The photo field
   passed a weaker check once and was broken for days, so this one
   insists on a frame actually decoding. */

const B = "http://127.0.0.1:5173";
/* WebM by default, for a reason worth writing down: the Chromium build
   Playwright ships has no proprietary codecs, so it cannot decode H.264
   — an MP4 uploads and stores perfectly here and still shows a blank
   player, which is a limitation of this browser, not of the site.
   Every real browser (Chrome, Safari, Edge, Firefox) plays H.264.
   Point TEST_VIDEO at an .mp4 to exercise that path in a real Chrome. */
const VIDEO = process.env.TEST_VIDEO ?? "/tmp/claude-0/-home-claude/f1176b09-cc1b-5a0a-ac15-x/tls-test-video.webm";
const problems = [];
const ok = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!c) problems.push(n); };

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.route("**://*.googleapis.com/**", (r) => r.abort());
await p.route("**://*.gstatic.com/**", (r) => r.abort());

await p.goto(B + "/signin", { waitUntil: "domcontentloaded" });
await p.waitForSelector('input[type="email"]');
await p.waitForTimeout(1200);
await p.fill('input[type="email"]', "j.whitfield@example.com");
await p.fill('input[type="password"]', "demo1234");
await p.click('button[type="submit"]');
await p.waitForTimeout(2500);

await p.goto(B + "/dashboard/profile#media", { waitUntil: "domcontentloaded" });
await p.waitForSelector("#intro-video", { state: "attached", timeout: 15000 });
await p.waitForTimeout(1500);

ok("the editor has a video upload field", (await p.locator("#intro-video").count()) === 1);
ok(
  "it takes a file from the desktop, not a URL",
  (await p.locator("#intro-video").getAttribute("type")) === "file",
  String(await p.locator("#intro-video").getAttribute("accept"))
);

/* Cleared first: the demo profile already carries a duration, and a
   field that never changed would pass a "was it filled in" check
   without the probe having run at all. */
await p.evaluate(() => {
  const el = document.querySelector("#video-duration");
  if (el) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
/* What is there before, so the wait below is for THIS upload rather
   than for whatever a previous run happened to leave on the profile —
   a check that passes on a stale value is worse than no check. */
const before = await p.evaluate(() => {
  const v = document.querySelector('video[src*="/uploads/"]');
  return v ? (v.currentSrc || v.src) : null;
});

await p.setInputFiles("#intro-video", VIDEO);
await p
  .waitForFunction(
    (previous) => {
      const v = document.querySelector('video[src*="/uploads/"]');
      const src = v ? v.currentSrc || v.src : null;
      return Boolean(src) && src !== previous;
    },
    before,
    { timeout: 90000 }
  )
  .catch(() => {});
// The duration probe finishes a beat after the upload does.
await p.waitForTimeout(1500);

const state = await p.evaluate(async () => {
  const v = document.querySelector('video[src*="/uploads/"]');
  if (!v) return { found: false };
  // readyState >= 1 means the browser parsed the container; a decoded
  // frame (readyState >= 2) is the real proof it will play.
  await new Promise((res) => {
    if (v.readyState >= 2) return res(null);
    v.addEventListener("loadeddata", () => res(null), { once: true });
    setTimeout(() => res(null), 12000);
  });
  const duration = document.querySelector("#video-duration");
  return {
    found: true,
    src: v.currentSrc || v.src,
    readyState: v.readyState,
    w: v.videoWidth,
    h: v.videoHeight,
    seconds: v.duration,
    durationField: duration ? duration.value : null,
  };
});

ok("the upload reached the server and came back", state.found, JSON.stringify(state).slice(0, 160));
ok("the URL is absolute against the API", /^https?:\/\//.test(state.src ?? ""), state.src);
ok("the browser decoded a frame of the stored file", (state.readyState ?? 0) >= 2, `readyState=${state.readyState}`);
ok("it has real dimensions", (state.w ?? 0) > 0 && (state.h ?? 0) > 0, `${state.w}x${state.h}`);
ok("the duration was filled in automatically", Number(state.durationField) > 0, `field="${state.durationField}"`);

// It has to survive a save and come back on the public profile.
await p.click('button[type="submit"]');
await p.waitForTimeout(3000);
await p.goto(B + "/dashboard/profile#media", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const persisted = await p.evaluate(() => {
  const v = document.querySelector('video[src*="/uploads/"]');
  return v ? (v.currentSrc || v.src) : null;
});
ok("it is still there after saving and reloading", Boolean(persisted), String(persisted));

/* And the point of the whole thing: it has to reach the public page.
   The video is a paid feature, so this also confirms the plan gate lets
   it through for a member who has it. */
await p.goto(B + "/specialists/mr-james-whitfield", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const trigger = p.locator('button[aria-label*="intro video" i]');
ok("the public profile offers the video", (await trigger.count()) > 0);
if ((await trigger.count()) > 0) {
  await trigger.first().click();
  await p.waitForTimeout(1500);
  const played = await p.evaluate(async () => {
    const v = document.querySelector('video[src*="/uploads/"]');
    if (!v) return { found: false };
    await new Promise((res) => {
      if (v.readyState >= 2) return res(null);
      v.addEventListener("loadeddata", () => res(null), { once: true });
      setTimeout(() => res(null), 12000);
    });
    return { found: true, readyState: v.readyState, w: v.videoWidth, src: v.currentSrc || v.src };
  });
  ok("and it plays the uploaded file", played.found && played.readyState >= 2, JSON.stringify(played));
  ok("with real dimensions", (played.w ?? 0) > 0, `${played.w}`);
}

await b.close();
console.log(problems.length ? `\n${problems.length} FAILED` : "\nALL PASS");
process.exit(problems.length ? 1 : 0);
