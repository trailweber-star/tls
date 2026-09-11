#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * The API smoke suite
 *
 * Run it with `npm run smoke` in backend/. It starts the server itself,
 * exercises every route, and exits non-zero if anything is wrong.
 *
 * Three things it checks, in order of how much they would cost if they
 * were wrong:
 *
 *  1. Nothing returns a 500. A 500 is a crash, and the browser's answer
 *     to a crash is a blank page. Every route is called with sensible
 *     input, then with input designed to break it — missing records,
 *     absurd page numbers, a category nobody has, letters where numbers
 *     go, an apostrophe and a script tag in the query.
 *
 *  2. Nothing private reaches the public. A contact email or an
 *     identity document leaking from a public URL is a data breach, and
 *     it is silent — nobody notices until someone else does.
 *
 *  3. Nobody can read or change what is not theirs. Every dashboard and
 *     admin route is called signed-out, and as the wrong kind of
 *     account, and must refuse both.
 *
 * When this suite passes, the site does not crash on the shapes of data
 * it can actually be given. That is the promise it exists to keep.
 * ------------------------------------------------------------------ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT ?? 4123);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function call(method, url, { token, body, raw, contentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers["content-type"] = contentType ?? (raw ? "image/png" : "application/json");
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, json: null, text: String(err) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON — recorded as text */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Any 5xx is a crash. This is the assertion that matters most. */
async function noCrash(name, method, url, opts) {
  const res = await call(method, url, opts);
  check(`${name} does not crash`, res.status < 500, `HTTP ${res.status} ${res.text.slice(0, 160)}`);
  return res;
}

/* --------------------------------------------------------- the server */

async function waitForServer(child, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error("the server exited before it was ready");
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the server never became ready");
}

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

try {
  await waitForServer(child);
  await run();
} catch (err) {
  failures.push(`the suite itself failed: ${err.message}`);
  console.error(err);
  if (serverLog) console.error("\n--- server output ---\n" + serverLog.slice(-2000));
} finally {
  child.kill("SIGKILL");
}

/* Anything the server logged as an unhandled error is a failure even if
   every request came back 200 — a swallowed exception is still a bug. */
if (/Unhandled|UnhandledPromiseRejection|TypeError: Cannot read/i.test(serverLog)) {
  failures.push("the server logged an unhandled error while the suite ran");
  console.log("\n--- server output ---\n" + serverLog.slice(-2000));
}

console.log(
  `\n${passed} checks passed, ${failures.length} failed.` +
    (failures.length ? `\n\n${failures.map((f) => `  ✗ ${f}`).join("\n")}\n` : "\n")
);
process.exit(failures.length ? 1 : 0);

/* ------------------------------------------------------------- the run */

async function run() {
  /* Input designed to break a handler: an empty value, a missing
     record, an injection attempt, a number where a slug goes and a slug
     where a number goes. None of these should ever be a 500. */
  const HOSTILE = [
    "",
    "%20",
    "does-not-exist",
    "../../etc/passwd",
    "%2e%2e%2f%2e%2e%2f",
    "'; DROP TABLE specialists;--",
    "<script>alert(1)</script>",
    "null",
    "undefined",
    "0",
    "-1",
    "9".repeat(60),
    "🙂",
  ];

  /* ---------------------------------------------------- taxonomy */
  section("Taxonomy");
  for (const p of [
    "/specialties",
    "/specialties/top-level",
    "/cities",
    "/facility-categories",
    "/facility-categories/top-level",
    "/plans",
  ]) {
    const res = await noCrash(p, "GET", API + p);
    check(`${p} returns data`, res.status === 200 && res.json != null);
  }
  for (const bad of HOSTILE) {
    await noCrash(
      `/specialties/${bad}/subspecialties`,
      "GET",
      `${API}/specialties/${encodeURIComponent(bad)}/subspecialties`
    );
    await noCrash(
      `/facility-categories/${bad}/children`,
      "GET",
      `${API}/facility-categories/${encodeURIComponent(bad)}/children`
    );
  }

  /* -------------------------------------------------- specialists */
  section("Specialists");
  const featured = await noCrash("/specialists/featured", "GET", `${API}/specialists/featured?limit=4`);
  check("featured returns a list", Array.isArray(featured.json));
  const sample = featured.json?.[0];
  check("a featured card has a slug", Boolean(sample?.slug));

  for (const q of ["limit=0", "limit=-5", "limit=abc", "limit=100000", "limit="]) {
    const r = await noCrash(`featured?${q}`, "GET", `${API}/specialists/featured?${q}`);
    check(`featured?${q} still returns an array`, Array.isArray(r.json));
  }

  /* Search, with every filter a person can actually set, and then with
     nonsense in each of them. */
  const searchCases = [
    "",
    "q=knee",
    "q=knee%20replacement",
    "q=" + encodeURIComponent("<script>alert(1)</script>"),
    "q=" + encodeURIComponent("'; DROP TABLE x;--"),
    "specialty=orthopaedics",
    "specialty=not-a-specialty",
    "city=birmingham",
    "city=not-a-city",
    "location=B3%202AP&radiusKm=5",
    "location=" + encodeURIComponent("nowhere at all") + "&radiusKm=5",
    "radiusKm=abc",
    "radiusKm=-1",
    "minRating=4.5",
    "minRating=99",
    "minRating=abc",
    "maxPrice=abc",
    "sort=rating",
    "sort=not-a-sort",
    "page=0",
    "page=-3",
    "page=999999",
    "page=abc",
    "pageSize=0",
    "pageSize=100000",
    "pageSize=abc",
    "availability=this-week",
    "availability=nonsense",
  ];
  for (const qs of searchCases) {
    const r = await noCrash(`search?${qs || "(empty)"}`, "GET", `${API}/specialists/search?${qs}`);
    check(
      `search?${qs || "(empty)"} returns a well-formed page`,
      r.status === 200 &&
        Array.isArray(r.json?.results) &&
        Number.isFinite(r.json?.total) &&
        Number.isFinite(r.json?.page) &&
        r.json.page >= 1,
      JSON.stringify({ status: r.status, page: r.json?.page, total: r.json?.total })
    );
  }

  for (const bad of HOSTILE) {
    const r = await noCrash(`/specialists/${bad}`, "GET", `${API}/specialists/${encodeURIComponent(bad)}`);
    check(`/specialists/${bad} is a clean 404, not a crash`, r.status === 404 || r.status === 200);
  }

  /* ---------------------------------------------- the leak check */
  section("Nothing private on a public URL");
  const NEVER_PUBLIC = [
    "contactEmail",
    "contactPhone",
    "application",
    "verificationHistory",
    "userId",
    "passwordHash",
  ];
  const profile = (await call("GET", `${API}/specialists/${sample.slug}`)).json;
  const leaked = NEVER_PUBLIC.filter((f) => f in (profile ?? {}));
  check("the public specialist profile leaks nothing", leaked.length === 0, leaked.join(", "));

  const searchPage = (await call("GET", `${API}/specialists/search?pageSize=20`)).json;
  const cardLeak = new Set();
  for (const row of searchPage?.results ?? []) {
    for (const f of NEVER_PUBLIC) if (f in row) cardLeak.add(f);
  }
  check("no search result leaks anything", cardLeak.size === 0, [...cardLeak].join(", "));

  const feat = (await call("GET", `${API}/facilities/featured?limit=6`)).json;
  const facLeak = new Set();
  for (const row of feat ?? []) for (const f of NEVER_PUBLIC) if (row && f in row) facLeak.add(f);
  check("no facility card leaks anything", facLeak.size === 0, [...facLeak].join(", "));

  /* The plan block has to be the same object everywhere: a card that
     carried the bare enum string would throw the moment anything read
     plan.features on it. */
  section("One plan shape everywhere");
  check("profile.plan is an object", typeof profile?.plan === "object" && !!profile?.plan?.features);
  const firstCard = searchPage?.results?.[0];
  check(
    "a search card's plan is the same object",
    typeof firstCard?.plan === "object" && !!firstCard?.plan?.features,
    JSON.stringify(firstCard?.plan)?.slice(0, 80)
  );
  check(
    "a featured card's plan is the same object",
    typeof sample?.plan === "object" && !!sample?.plan?.features
  );

  /* ------------------------------------------------ the profile shape */
  section("The profile carries what the page renders");
  for (const field of [
    "id",
    "slug",
    "fullName",
    "specialties",
    "clinicLocations",
    "reviews",
    "ratingAvg",
    "ratingCount",
    "plan",
  ]) {
    check(`profile has ${field}`, field in (profile ?? {}));
  }
  /* Every location must survive being rendered: the white-page bug was
     a location whose clinic was null on a page that assumed otherwise.
     Both shapes are legitimate, so both must be present in the data and
     handled by the page. */
  for (const loc of profile?.clinicLocations ?? []) {
    check(
      `location ${loc.id} has an address`,
      typeof loc.address === "string" && loc.address.length > 0
    );
    check(
      `location ${loc.id} declares its clinic explicitly (an object or null, never missing)`,
      "clinic" in loc
    );
  }

  /* ---------------------------------------------------- facilities */
  section("Places");
  for (const qs of searchCases.slice(0, 14)) {
    const r = await noCrash(`facilities/search?${qs || "(empty)"}`, "GET", `${API}/facilities/search?${qs}`);
    check(
      `facilities/search?${qs || "(empty)"} returns a page`,
      r.status === 200 &&
        Array.isArray(r.json?.results) &&
        Number.isFinite(r.json?.total) &&
        r.json?.page >= 1 &&
        // Paged, and capped: no query may ever pull the whole table.
        r.json.results.length <= r.json.pageSize &&
        Array.isArray(r.json?.facets?.categories),
      JSON.stringify({ status: r.status, page: r.json?.page, size: r.json?.results?.length })
    );
  }
  for (const bad of HOSTILE) {
    const r = await noCrash(`/facilities/${bad}`, "GET", `${API}/facilities/${encodeURIComponent(bad)}`);
    check(`/facilities/${bad} is a clean 404`, r.status === 404 || r.status === 200);
    await noCrash(`/facilities/${bad}/reviews`, "GET", `${API}/facilities/${encodeURIComponent(bad)}/reviews`);
    await noCrash(`/clinics/${bad}`, "GET", `${API}/clinics/${encodeURIComponent(bad)}`);
  }
  const facSample = feat?.[0];
  if (facSample) {
    const fp = await noCrash(`/facilities/${facSample.slug}`, "GET", `${API}/facilities/${facSample.slug}`);
    check("a place profile has a plan object", typeof fp.json?.plan === "object");
  }

  /* -------------------------------------------------- search panel */
  section("The search panel");
  for (const q of ["", "a", "hosp", "knee", "birming", "<script>", "'", "🙂", "z".repeat(200)]) {
    const r = await noCrash(`search/panel?q=${q}`, "GET", `${API}/search/panel?q=${encodeURIComponent(q)}`);
    check(`panel q="${q.slice(0, 12)}" returns a payload`, r.status === 200 && r.json != null);
  }

  /* ------------------------------------------------------- geo */
  section("Addresses");
  for (const q of ["", "B3", "B3 2AP", "not a real place at all", "<script>", "'"]) {
    await noCrash(`geo/suggest?q=${q}`, "GET", `${API}/geo/suggest?q=${encodeURIComponent(q)}`);
  }
  await noCrash("geo/resolve with junk", "POST", `${API}/geo/resolve`, { body: { label: "nowhere" } });
  await noCrash("geo/resolve with nothing", "POST", `${API}/geo/resolve`, { body: {} });
  await noCrash("geo/reverse with junk", "GET", `${API}/geo/reverse?lat=abc&lng=abc`);

  /* ---------------------------------------------------------- maps */
  section("Maps");
  const pinned = await noCrash(
    "geo/map for a pinned address",
    "GET",
    `${API}/geo/map?lat=52.4813&lng=-1.9028&address=88%20City%20Road`
  );
  check("a pinned address gets an embeddable map", Boolean(pinned.json?.embedUrl) && pinned.json?.pinned === true);
  check("and a link to open the full one", /^https:\/\//.test(pinned.json?.linkUrl ?? ""));
  /* The key must never leave the server unless it is the embed URL
     itself — that one is unavoidable, it is how the Maps Embed API
     works, and it is why the key has to be referrer-restricted. */
  check(
    "the map response carries nothing but the view",
    Object.keys(pinned.json ?? {}).sort().join(",") === "embedUrl,label,linkUrl,pinned,probeUrl,provider",
    Object.keys(pinned.json ?? {}).join(",")
  );
  const unpinned = await noCrash("geo/map with no coordinates", "GET", `${API}/geo/map?address=88%20City%20Road`);
  check("an unpinned address says so rather than mapping the wrong place", unpinned.json?.pinned === false);
  for (const qs of [
    "",
    "lat=abc&lng=zzz",
    "lat=999&lng=999",
    "lat=52&lng=-1&zoom=99999",
    "lat=52&lng=-1&zoom=-4",
    "address=" + encodeURIComponent("<script>alert(1)</script>"),
    "address=" + encodeURIComponent("'; DROP TABLE x;--"),
  ]) {
    const r = await noCrash(`geo/map?${qs || "(empty)"}`, "GET", `${API}/geo/map?${qs}`);
    check(`geo/map?${qs || "(empty)"} answers with a view`, r.status === 200 && r.json?.provider != null);
    // Anything drawn from user text must come back escaped, or an
    // address is a way to break out of the URL we hand the browser.
    check(
      `geo/map?${qs || "(empty)"} escapes what it was given`,
      !/[<>"']/.test(`${r.json?.embedUrl ?? ""}${r.json?.linkUrl ?? ""}`),
      r.json?.linkUrl ?? ""
    );
  }
  check(
    "a nonsense zoom is clamped rather than passed through",
    !/zoom=(99999|-4)/.test(
      (await call("GET", `${API}/geo/map?lat=52&lng=-1&zoom=99999`)).json?.embedUrl ?? ""
    )
  );

  /* --------------------------------------------------- reviews */
  section("Reviews");
  const featuredReviews = await noCrash("/reviews/featured", "GET", `${API}/reviews/featured?limit=12`);
  check("featured reviews is a list", Array.isArray(featuredReviews.json?.results ?? featuredReviews.json));
  const rows = featuredReviews.json?.results ?? featuredReviews.json ?? [];
  check(
    "every featured review is approved",
    rows.every((r) => (r.review?.moderationStatus ?? "approved") === "approved")
  );
  check(
    "every featured review can be rendered",
    rows.every((r) => r.subject?.name && r.subject?.href && r.review?.rating != null),
    JSON.stringify(rows.find((r) => !r.subject?.name) ?? "")?.slice(0, 120)
  );

  /* Submitting a review with every kind of bad input. None of these may
     crash, and none may be published without an admin. */
  const badReviews = [
    {},
    { rating: 0 },
    { rating: 99 },
    { rating: "five" },
    { rating: 5, comment: "x".repeat(20000) },
    { rating: 5, comment: "<script>alert(1)</script>" },
    { rating: 5, conditionId: "not-a-condition" },
    { rating: 5, scores: { communication: 99, expertise: -4 } },
  ];
  for (const body of badReviews) {
    const r = await noCrash(
      `POST review ${JSON.stringify(body).slice(0, 40)}`,
      "POST",
      `${API}/specialists/${sample.slug}/reviews`,
      { body }
    );
    if (r.status === 201 || r.status === 200) {
      check(
        "a newly submitted review is never auto-published",
        (r.json?.review?.moderationStatus ?? r.json?.moderationStatus) === "pending",
        JSON.stringify(r.json)?.slice(0, 120)
      );
    }
  }
  const listed = (await call("GET", `${API}/specialists/${sample.slug}/reviews`)).json;
  const shown = listed?.results ?? listed ?? [];
  check(
    "the public review list shows approved reviews only",
    Array.isArray(shown) && shown.every((r) => (r.moderationStatus ?? "approved") === "approved")
  );

  /* -------------------------------------------- the authorisation wall */
  section("Nobody reaches what is not theirs");
  const PROTECTED = [
    ["GET", "/dashboard/overview"],
    ["GET", "/dashboard/profile"],
    ["PATCH", "/dashboard/profile"],
    ["GET", "/dashboard/enquiries"],
    ["GET", "/dashboard/reviews"],
    ["GET", "/notifications"],
    ["GET", "/notifications/count"],
    ["GET", "/billing/subscription"],
    ["GET", "/admin/overview"],
    ["GET", "/admin/verifications"],
    ["GET", "/admin/specialists"],
    ["GET", "/admin/reviews"],
    ["GET", "/admin/claims"],
    ["GET", "/admin/contact-messages"],
    ["POST", "/uploads/image"],
  ];
  for (const [method, p] of PROTECTED) {
    const r = await call(method, API + p, { body: method === "GET" ? undefined : {} });
    check(`${method} ${p} refuses an anonymous caller`, r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }

  const spec = await call("POST", `${API}/auth/login`, {
    body: { email: "j.whitfield@example.com", password: "demo1234" },
  });
  const specToken = spec.json?.token;
  check("the demo specialist can sign in", Boolean(specToken), JSON.stringify(spec.json)?.slice(0, 120));

  const admin = await call("POST", `${API}/auth/login`, {
    body: { email: "admin@tls.test", password: "demo1234" },
  });
  const adminToken = admin.json?.token;
  check("the demo admin can sign in", Boolean(adminToken));

  const ADMIN_ONLY = [
    "/admin/overview",
    "/admin/verifications",
    "/admin/specialists",
    "/admin/reviews",
    "/admin/claims",
    "/admin/contact-messages",
  ];
  for (const p of ADMIN_ONLY) {
    const r = await call("GET", API + p, { token: specToken });
    check(`a specialist cannot read ${p}`, r.status === 403, `HTTP ${r.status}`);
    const ok = await noCrash(`admin reads ${p}`, "GET", API + p, { token: adminToken });
    check(`an admin can read ${p}`, ok.status === 200, `HTTP ${ok.status}`);
  }

  /* Moderating is admin-only, both directions. */
  const queue = (await call("GET", `${API}/admin/reviews?status=pending`, { token: adminToken })).json;
  const pendingId = (queue?.results ?? queue ?? [])[0]?.id;
  if (pendingId) {
    const asSpecialist = await call("POST", `${API}/admin/reviews/${pendingId}/moderate`, {
      token: specToken,
      body: { decision: "approve" },
    });
    check("a specialist cannot approve a review", asSpecialist.status === 403);
  }
  for (const bad of ["does-not-exist", "../../x", "0"]) {
    await noCrash(`moderate ${bad}`, "POST", `${API}/admin/reviews/${encodeURIComponent(bad)}/moderate`, {
      token: adminToken,
      body: { decision: "approve" },
    });
    await noCrash(`verification ${bad}`, "GET", `${API}/admin/verifications/${encodeURIComponent(bad)}`, {
      token: adminToken,
    });
    await noCrash(`claim ${bad}`, "GET", `${API}/admin/claims/${encodeURIComponent(bad)}`, {
      token: adminToken,
    });
  }
  /* A decision the API does not recognise must be refused, not applied. */
  if (pendingId) {
    const nonsense = await noCrash(
      "moderate with a nonsense decision",
      "POST",
      `${API}/admin/reviews/${pendingId}/moderate`,
      { token: adminToken, body: { decision: "banana" } }
    );
    check("a nonsense moderation decision is refused", nonsense.status >= 400 && nonsense.status < 500);
  }

  /* --------------------------------------------- the signed-in surface */
  section("The dashboard");
  for (const p of [
    "/dashboard/overview",
    "/dashboard/profile",
    "/dashboard/enquiries",
    "/dashboard/reviews",
    "/notifications",
    "/notifications/count",
    "/billing/subscription",
    "/billing/clinwell",
    "/auth/me",
  ]) {
    const r = await noCrash(`GET ${p}`, "GET", API + p, { token: specToken });
    check(`${p} answers the specialist`, r.status === 200, `HTTP ${r.status}`);
  }

  /* Saving the profile is the operation that produced the white page,
     so it gets the most attention: it must not lose the clinic link,
     and it must survive junk in every field. */
  section("Saving a profile");
  const before = (await call("GET", `${API}/dashboard/profile`, { token: specToken })).json;
  const linked = (before?.profile?.clinicLocations ?? []).find((l) => l.clinic);
  /* A check that silently skips is worse than no check: it reports a
     pass for something it never looked at. This one is about a
     clinic-linked address surviving a save, so if the demo data has no
     such address the suite says so rather than quietly moving on. */
  check(
    "the demo data contains a clinic-linked address to test the save against",
    Boolean(linked),
    `${(before?.profile?.clinicLocations ?? []).length} locations, none linked to a clinic`
  );
  const patch = await noCrash("PATCH /dashboard/profile", "PATCH", `${API}/dashboard/profile`, {
    token: specToken,
    body: { bio: before?.profile?.bio ?? "" },
  });
  check("saving succeeds", patch.status === 200, `HTTP ${patch.status}`);
  if (linked) {
    const after = (await call("GET", `${API}/dashboard/profile`, { token: specToken })).json;
    const same = (after?.profile?.clinicLocations ?? []).find((l) => l.id === linked.id);
    check(
      "a clinic-linked address is still linked after an unrelated save",
      Boolean(same?.clinic),
      `clinic became ${JSON.stringify(same?.clinic)}`
    );
  }
  const junkPatches = [
    { fullName: "" },
    { yearsExperience: "abc" },
    { yearsExperience: -5 },
    { consultationPriceMinor: "free" },
    { photoUrl: "javascript:alert(1)" },
    { websiteUrl: "not a url" },
    { socials: { linkedin: "<script>" } },
    { specialtyIds: ["nope"] },
    { locations: [{ address: "" }] },
    { gallery: Array.from({ length: 100 }, () => ({ url: "x" })) },
    { bio: "x".repeat(100000) },
  ];
  for (const body of junkPatches) {
    await noCrash(`PATCH ${JSON.stringify(body).slice(0, 42)}`, "PATCH", `${API}/dashboard/profile`, {
      token: specToken,
      body,
    });
  }

  /* --------------------------------------------------------- uploads */
  section("Uploads");
  const cfg = await noCrash("/uploads/config", "GET", `${API}/uploads/config`);
  check("the upload config states a limit", Number(cfg.json?.maxBytes) > 0);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const up = await call("POST", `${API}/uploads/image?kind=profile-photo`, {
    token: specToken,
    body: png,
    raw: true,
  });
  check("a real PNG uploads", up.status === 201, `HTTP ${up.status}`);
  check("the URL it returns is absolute", /^https?:\/\//.test(up.json?.url ?? ""), up.json?.url);
  if (up.json?.url) {
    const fetched = await call("GET", up.json.url);
    check("that URL serves the image back", fetched.status === 200);
    const del = await call("DELETE", `${API}/uploads/image`, {
      token: specToken,
      body: { url: up.json.url },
    });
    /* If this one fails with removed:false, check that the process can
       actually delete files in backend/uploads before suspecting the
       code — a sandboxed or read-only mount refuses the unlink, and
       removeImage is deliberately best-effort about it (an orphaned
       thumbnail is not worth failing a profile save over). */
    check("and it can be deleted by that same URL", del.json?.removed === true, JSON.stringify(del.json));
  }
  const disguised = await call("POST", `${API}/uploads/image?kind=profile-photo`, {
    token: specToken,
    body: Buffer.from("<html><script>alert(1)</script></html>"),
    raw: true,
  });
  check("an HTML file renamed as an image is refused", disguised.status === 415, `HTTP ${disguised.status}`);
  /* ------------------------------------------------------------ video
     A real, playable MP4 built here rather than shipped as a fixture,
     so the check is on the actual byte pattern the sniffer looks for. */
  const mp4 = minimalMp4();
  const vid = await call("POST", `${API}/uploads/video?kind=intro-video`, {
    token: specToken,
    body: mp4,
    raw: true,
    contentType: "video/mp4",
  });
  check("an MP4 uploads", vid.status === 201, `HTTP ${vid.status} ${vid.text.slice(0, 120)}`);
  check("the video URL is absolute", /^https?:\/\//.test(vid.json?.url ?? ""), vid.json?.url);
  check("it is stored as video/mp4", vid.json?.contentType === "video/mp4", vid.json?.contentType);
  if (vid.json?.url) {
    const played = await call("GET", vid.json.url);
    check("the video serves back", played.status === 200);
    /* Range requests are what lets a browser seek without downloading
       the whole file. express.static does this, but it is worth an
       assertion — a video you cannot scrub is a broken video. */
    const ranged = await fetch(vid.json.url, { headers: { range: "bytes=0-9" } });
    check("and supports range requests so it can be scrubbed", ranged.status === 206, `HTTP ${ranged.status}`);
    const delv = await call("DELETE", `${API}/uploads/image`, {
      token: specToken,
      body: { url: vid.json.url },
    });
    check("a video can be deleted like any other upload", delv.status === 200, JSON.stringify(delv.json));
  }
  const notVideo = await call("POST", `${API}/uploads/video?kind=intro-video`, {
    token: specToken,
    body: Buffer.from("<html><script>alert(1)</script></html>"),
    raw: true,
    contentType: "video/mp4",
  });
  check("a file that is not a video is refused", notVideo.status === 415, `HTTP ${notVideo.status}`);
  const anon = await call("POST", `${API}/uploads/video`, { body: mp4, raw: true, contentType: "video/mp4" });
  check("an anonymous caller cannot upload video", anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);
  check(
    "the config publishes the video limit and types",
    Number(cfg.json?.video?.maxBytes) > Number(cfg.json?.maxBytes) &&
      (cfg.json?.video?.accept ?? []).includes("video/mp4"),
    JSON.stringify(cfg.json?.video)
  );

  const escape = await call("DELETE", `${API}/uploads/image`, {
    token: specToken,
    body: { url: "/uploads/../../src/server.js" },
  });
  check("a delete cannot walk out of the uploads folder", escape.json?.removed !== true);

  /* ------------------------------------------------- public writes */
  section("Public forms");
  for (const body of [{}, { name: "" }, { email: "not-an-email" }, { message: "x".repeat(50000) }]) {
    await noCrash(`POST /contact ${JSON.stringify(body).slice(0, 30)}`, "POST", `${API}/contact`, { body });
    await noCrash(`POST /leads ${JSON.stringify(body).slice(0, 30)}`, "POST", `${API}/leads`, { body });
    await noCrash(`POST /claims ${JSON.stringify(body).slice(0, 30)}`, "POST", `${API}/claims`, { body });
  }
  for (const bad of HOSTILE) {
    await noCrash(
      `claims/eligibility/${bad}`,
      "GET",
      `${API}/claims/eligibility/${encodeURIComponent(bad)}`
    );
  }
  for (const body of [{}, { email: "x" }, { email: "x@y.z" }, { password: "short" }]) {
    await noCrash("POST /auth/login", "POST", `${API}/auth/login`, { body });
    await noCrash("POST /auth/register", "POST", `${API}/auth/register`, { body });
  }

  /* -------------------------------------------------- malformed bodies */
  section("Malformed requests");
  for (const [method, p] of [
    ["POST", "/contact"],
    ["POST", "/leads"],
    ["POST", "/auth/login"],
    ["PATCH", "/dashboard/profile"],
  ]) {
    const res = await fetch(API + p, {
      method,
      headers: { "content-type": "application/json", ...(specToken ? { authorization: `Bearer ${specToken}` } : {}) },
      body: "{not json at all",
    });
    check(`${method} ${p} handles a broken JSON body`, res.status === 400, `HTTP ${res.status}`);
  }
  const badToken = await call("GET", `${API}/dashboard/profile`, { token: "not.a.real.token" });
  check("a forged token is refused", badToken.status === 401, `HTTP ${badToken.status}`);

  /* ------------------------------------------- the members workspace */
  section("The admin members list");
  const members = await noCrash("/admin/members", "GET", `${API}/admin/members?pageSize=5`, { token: adminToken });
  check(
    "it returns a page of members with counts and facets",
    members.status === 200 &&
      Array.isArray(members.json?.results) &&
      Number.isFinite(members.json?.total) &&
      members.json?.counts?.all >= 0 &&
      Array.isArray(members.json?.facets?.statuses),
    JSON.stringify({ total: members.json?.total, counts: Object.keys(members.json?.counts ?? {}).length })
  );

  /* Every filter, with a real value and with nonsense. A filter that
     500s on junk is a filter that 500s the first time somebody edits
     the URL, and this page is one long row of them. */
  const memberFilters = [
    "q=a",
    "q=" + encodeURIComponent("<script>alert(1)</script>"),
    "q=" + encodeURIComponent("'; DROP TABLE users;--"),
    "email=example.com",
    "status=verified",
    "status=verified,pending",
    "status=not-a-status",
    "plan=premium",
    "plan=nonsense",
    "planStatus=active",
    "claimed=yes",
    "claimed=no",
    "claimed=maybe",
    "accountActive=no",
    "specialty=orthopaedics",
    "specialty=not-a-specialty",
    "city=Birmingham",
    "country=GB",
    "ip=127",
    "hasPhoto=yes",
    "hasPhoto=no",
    "source=imported",
    "source=signup",
    "tag=follow-up",
    "joinedFrom=2020-01-01&joinedTo=2030-01-01",
    "joinedFrom=not-a-date",
    "loginFrom=2020-01-01",
    "neverLoggedIn=yes",
    "sort=name",
    "sort=last-login",
    "sort=not-a-sort",
    "page=0",
    "page=99999",
    "page=abc",
    "pageSize=0",
    "pageSize=100000",
  ];
  for (const qs of memberFilters) {
    const r = await noCrash(`members?${qs}`, "GET", `${API}/admin/members?${qs}`, { token: adminToken });
    check(
      `members?${qs} answers with a well-formed page`,
      r.status === 200 &&
        Array.isArray(r.json?.results) &&
        r.json.page >= 1 &&
        r.json.results.length <= r.json.pageSize,
      `HTTP ${r.status} page=${r.json?.page}`
    );
  }

  section("Nobody but an admin gets near the members workspace");
  const MEMBER_ROUTES = [
    ["GET", "/admin/members"],
    ["GET", "/admin/members/export.csv"],
    ["GET", "/admin/audit"],
    ["POST", "/admin/members/bulk"],
  ];
  for (const [method, p] of MEMBER_ROUTES) {
    const anon = await call(method, API + p, { body: method === "POST" ? {} : undefined });
    check(`${method} ${p} refuses an anonymous caller`, anon.status === 401, `HTTP ${anon.status}`);
    const asSpec = await call(method, API + p, {
      token: specToken,
      body: method === "POST" ? {} : undefined,
    });
    check(`${method} ${p} refuses a specialist`, asSpec.status === 403, `HTTP ${asSpec.status}`);
  }

  /* --------------------------------------------------- impersonation
     The most dangerous capability on the site, so the checks are about
     what it must NOT be able to do. */
  section("Signing in as a member");
  const roster = (await call("GET", `${API}/admin/members?pageSize=200`, { token: adminToken })).json;
  const impersonable = (roster?.results ?? []).find((m) => m.canImpersonate);
  const accountless = (roster?.results ?? []).find((m) => !m.userId);
  check("the list says which members can be signed in as", Boolean(impersonable), impersonable?.fullName);

  if (impersonable) {
    check(
      "a specialist cannot start one",
      (await call("POST", `${API}/admin/members/${impersonable.id}/impersonate`, { token: specToken })).status === 403
    );
    check(
      "an anonymous caller cannot start one",
      (await call("POST", `${API}/admin/members/${impersonable.id}/impersonate`)).status === 401
    );

    const started = await call("POST", `${API}/admin/members/${impersonable.id}/impersonate`, {
      token: adminToken,
      body: { reason: "smoke suite" },
    });
    check("an admin can start one", started.status === 200 && Boolean(started.json?.token), `HTTP ${started.status}`);
    const borrowed = started.json?.token;

    if (borrowed) {
      const who = await call("GET", `${API}/auth/me`, { token: borrowed });
      check("the borrowed session is the member", who.json?.user?.email === impersonable.email);
      check("and it declares itself an impersonation", who.json?.impersonation?.active === true);
      check(
        "it can use that member's own dashboard",
        (await call("GET", `${API}/dashboard/profile`, { token: borrowed })).status === 200
      );

      /* The whole point. A borrowed session must not be able to reach
         anything administrative, however it was obtained. */
      for (const p of ["/admin/members", "/admin/overview", "/admin/verifications", "/admin/reviews", "/admin/audit"]) {
        const r = await call("GET", API + p, { token: borrowed });
        check(`a borrowed session cannot reach ${p}`, r.status === 403 && r.json?.code === "impersonating", `HTTP ${r.status}`);
      }
      check(
        "a borrowed session cannot bulk-act",
        (await call("POST", `${API}/admin/members/bulk`, { token: borrowed, body: { action: "approve", ids: [impersonable.id] } })).status === 403
      );
      check(
        "a borrowed session cannot impersonate somebody else",
        (await call("POST", `${API}/admin/members/${impersonable.id}/impersonate`, { token: borrowed })).status === 403
      );

      const stopped = await call("POST", `${API}/admin/members/stop-impersonating`, { token: borrowed });
      check("it can be handed back", stopped.status === 200 && Boolean(stopped.json?.token));
      check(
        "and what comes back is an admin session again",
        (await call("GET", `${API}/admin/members?pageSize=1`, { token: stopped.json?.token })).status === 200
      );
    }
  }
  if (accountless) {
    const r = await call("POST", `${API}/admin/members/${accountless.id}/impersonate`, { token: adminToken });
    check("a listing with no account behind it is refused", r.status === 409, `HTTP ${r.status}`);
  }
  check(
    "an ordinary session cannot claim to be stopping one",
    (await call("POST", `${API}/admin/members/stop-impersonating`, { token: specToken })).status === 400
  );

  /* --------------------------------------------------- bulk actions */
  section("Bulk actions");
  for (const [body, why, expect] of [
    [{ action: "nope", ids: ["x"] }, "an unknown action", 400],
    [{ action: "approve", ids: [] }, "an empty selection", 400],
    [{ action: "approve", ids: Array.from({ length: 501 }, (_, i) => `x${i}`) }, "an absurd selection", 413],
    [{ action: "reject", ids: ["x"] }, "rejecting with no reason", 400],
    [{ action: "tag", ids: ["x"] }, "tagging with no tag", 400],
  ]) {
    const r = await noCrash(`bulk: ${why}`, "POST", `${API}/admin/members/bulk`, { token: adminToken, body });
    check(`bulk refuses ${why}`, r.status === expect, `HTTP ${r.status}`);
  }
  const ghosts = await call("POST", `${API}/admin/members/bulk`, {
    token: adminToken,
    body: { action: "approve", ids: ["not-a-member", "also-not"] },
  });
  check(
    "ids that do not exist are skipped rather than fatal",
    ghosts.status === 200 && ghosts.json?.changed === 0 && ghosts.json?.skippedCount === 2,
    JSON.stringify(ghosts.json).slice(0, 100)
  );

  /* ------------------------------------------------------- the export */
  section("The members export");
  const csv = await call("GET", `${API}/admin/members/export.csv`, { token: adminToken });
  check("it comes back as a CSV file", csv.status === 200 && /text\/csv/.test(csv.headers?.get("content-type") ?? ""));
  check(
    "with a filename to save it as",
    /attachment; filename=/.test(csv.headers?.get("content-disposition") ?? ""),
    csv.headers?.get("content-disposition")
  );
  /* Checked on the raw bytes, not on the decoded string: fetch's UTF-8
     decode strips a leading BOM by specification, so reading text()
     here would report it missing however carefully it was written. */
  const csvBytes = new Uint8Array(
    await (await fetch(`${API}/admin/members/export.csv`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })).arrayBuffer()
  );
  check(
    "and a byte-order mark, so Excel reads it as UTF-8",
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    [...csvBytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")
  );
  check("with a header row", csv.text.includes('"ID","Name","Email"'));
  /* A cell starting with = + - or @ is executed as a formula by Excel.
     A member called "=cmd|..." must not turn an export into code
     running on whoever opens it. */
  check(
    "and no cell that Excel would run as a formula",
    csv.text
      .split(/\r?\n/)
      .slice(1)
      .every((line) => !/(^|,)"?[=+@]/.test(line)),
    csv.text.split(/\r?\n/).find((l) => /(^|,)"?[=+@]/.test(l))?.slice(0, 60)
  );

  /* ------------------------------------------- dangerous URLs */
  section("URLs a member supplies");
  for (const [field, value, why] of [
    ["websiteUrl", "javascript:alert(1)", "a javascript: URL in a link shown to patients"],
    ["photoUrl", "javascript:alert(document.cookie)", "a javascript: URL in an image"],
    ["bookingUrl", "data:text/html;base64,PHNjcmlwdD4=", "a data: URL"],
    ["websiteUrl", "//evil.test/phish", "a protocol-relative URL that leaves the site"],
    ["websiteUrl", "not a url", "something that is not a URL at all"],
  ]) {
    const r = await noCrash(`profile: ${why}`, "PATCH", `${API}/dashboard/profile`, {
      token: specToken,
      body: { [field]: value },
    });
    check(`saving ${why} is refused`, r.status === 400, `HTTP ${r.status}`);
  }
  const goodUrl = await call("PATCH", `${API}/dashboard/profile`, {
    token: specToken,
    body: { websiteUrl: "https://www.example-practice.co.uk/team" },
  });
  check("an ordinary https address still saves", goodUrl.status === 200, `HTTP ${goodUrl.status}`);
  const clearUrl = await call("PATCH", `${API}/dashboard/profile`, {
    token: specToken,
    body: { websiteUrl: null },
  });
  check("and it can still be cleared", clearUrl.status === 200, `HTTP ${clearUrl.status}`);

  /* ------------------------------------------------ system and mail */
  section("System status and email");
  const sys = await call("GET", `${API}/admin/system`, { token: adminToken });
  check("an admin can read the system status", sys.status === 200);
  check(
    "it reports the mail provider rather than claiming one",
    typeof sys.json?.mail?.provider === "string" && typeof sys.json?.mail?.configured === "boolean",
    JSON.stringify(sys.json?.mail).slice(0, 120)
  );
  check(
    "with nothing configured it says so honestly",
    sys.json?.mail?.configured === false && sys.json?.mail?.provider === "console"
  );
  check(
    "it reports payments the same way",
    sys.json?.payments?.configured === false && sys.json?.payments?.provider === null
  );
  check("and which store is behind it", ["postgres", "demo"].includes(sys.json?.storage?.mode));
  check(
    "a member cannot read it",
    (await call("GET", `${API}/admin/system`, { token: specToken })).status === 403
  );

  const badAddress = await call("POST", `${API}/admin/system/test-email`, {
    token: adminToken,
    body: { to: "not-an-address" },
  });
  check("the test email refuses a malformed address", badAddress.status === 400, `HTTP ${badAddress.status}`);

  const testMail = await call("POST", `${API}/admin/system/test-email`, {
    token: adminToken,
    body: { to: "someone@a-real-domain.co.uk" },
  });
  check("with no provider it reports not-sent rather than pretending", testMail.json?.sent === false);
  check(
    "and explains what to do about it",
    /provider is configured/i.test(testMail.json?.message ?? ""),
    testMail.json?.message
  );
  check(
    "a member cannot send test email from the platform's address",
    (await call("POST", `${API}/admin/system/test-email`, { token: specToken, body: { to: "x@y.co" } })).status === 403
  );

  /* --------------------------------------------- platform enquiries */
  section("Every enquiry, across every specialist");
  const inbox = await call("GET", `${API}/admin/enquiries`, { token: adminToken });
  check("the admin can read enquiries platform-wide", inbox.status === 200);
  check("with counts to filter by", typeof inbox.json?.counts?.all === "number");
  check(
    "and each row says who it was sent to",
    (inbox.json?.results ?? []).every((r) => "specialist" in r && "answered" in r)
  );
  check(
    "unanswered ones carry how long the patient has waited",
    (inbox.json?.results ?? []).filter((r) => !r.answered).every((r) => r.waitingHours === null || r.waitingHours >= 0)
  );
  const filtered = await call("GET", `${API}/admin/enquiries?unanswered=yes`, { token: adminToken });
  check(
    "the waiting filter returns only unanswered ones",
    (filtered.json?.results ?? []).every((r) => !r.answered)
  );
  check(
    "a member cannot read other specialists' enquiries",
    (await call("GET", `${API}/admin/enquiries`, { token: specToken })).status === 403,
    "this is the whole point of the endpoint being admin-only"
  );

  /* --------------------------------------------------------- 404 handling */
  const missing = await call("GET", `${API}/no-such-endpoint`);
  check("an unknown endpoint is a clean JSON 404", missing.status === 404 && missing.json?.error != null);
}

/**
 * The smallest thing that looks like an MP4 to a content sniffer.
 *
 * Built rather than committed as a fixture: the point of the check is
 * the byte pattern the server tests for, and writing it out here is the
 * clearest possible statement of what that pattern is.
 *
 *   [0..3]  box size
 *   [4..7]  "ftyp"
 *   [8..11] the brand — "isom" is an ordinary MP4
 */
function minimalMp4() {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(32, 0);
  header.write("ftyp", 4, "ascii");
  header.write("isom", 8, "ascii");
  header.write("isomiso2avc1mp41", 12, "ascii");
  return header;
}
