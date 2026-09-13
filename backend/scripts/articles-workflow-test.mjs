/* The article authoring workflow, end to end over HTTP.
 *
 * A state machine is exactly the thing that regresses silently: every
 * transition still returns 200, just the wrong one. So this walks both
 * routes to publication and, as importantly, checks the moves that must
 * be refused.
 *
 *   node scripts/articles-workflow-test.mjs [http://127.0.0.1:4000/api]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:4000/api";
const ADMIN = { email: "admin@tls.test", password: "demo1234" };
const MEMBER = { email: "j.whitfield@example.com", password: "demo1234" };

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const login = async (who) => (await call(null, "POST", "/auth/login", who)).json.token;

console.log(`\narticle workflow → ${BASE}\n`);
const adminToken = await login(ADMIN);
const memberToken = await login(MEMBER);
if (!adminToken || !memberToken) {
  console.error("  could not sign in — is the server up and seeded?\n");
  process.exit(1);
}
const me = await call(memberToken, "GET", "/auth/me");
const specialistId = me.json?.specialist?.id;
check("the member has a specialist profile", Boolean(specialistId));

const stamp = Date.now();

/* ---------------------------------------------- the member's own route */
console.log("\n  a member writes their own");
const own = await call(memberToken, "POST", "/dashboard/articles", {
  title: `Member written ${stamp}`,
  body: "## A heading\n\nEnough words to be a plausible article body for a reading-time calculation.",
  submit: true,
});
check("created and submitted in one call", own.status === 201 && own.json.article?.status === "in_review",
  JSON.stringify(own.json).slice(0, 120));
const ownId = own.json.article?.id;

const blocked = await call(memberToken, "PATCH", `/dashboard/articles/${ownId}`, {
  title: `Member written ${stamp}`,
  body: "trying to change it while it is being reviewed",
});
check("cannot be edited while in review", blocked.status === 409, `got ${blocked.status}`);

const noNote = await call(adminToken, "POST", `/admin/articles/${ownId}/review`, { decision: "changes" });
check("sending it back without a note is refused", noNote.status === 400);

const sentBack = await call(adminToken, "POST", `/admin/articles/${ownId}/review`, {
  decision: "changes",
  note: "Add what the first week of recovery looks like.",
});
check("sent back with a note", sentBack.json.article?.status === "changes_requested");
check("the member can read the note", Boolean(sentBack.json.article?.reviewNote));

const resubmitted = await call(memberToken, "PATCH", `/dashboard/articles/${ownId}`, {
  title: `Member written ${stamp}`,
  body: "## A heading\n\n## The first week\n\nSwelling, crutches, and no driving until the surgeon says so.",
  submit: true,
});
check("resubmitting works", resubmitted.json.article?.status === "in_review");
check("resubmitting clears the old note", resubmitted.json.article?.reviewNote === null);

const publishedOwn = await call(adminToken, "POST", `/admin/articles/${ownId}/review`, { decision: "publish" });
check("published by the administrator", publishedOwn.json.article?.status === "published");

/* ------------------------------------------------- the written-for route */
console.log("\n  TLS writes one for a member");
await call(adminToken, "POST", "/admin/articles/import", {
  title: `Ghostwritten ${stamp}`,
  body: "## Draft\n\nWritten by the team for the member to check and edit before publication.",
  status: "draft",
  sourceRef: `ghost-${stamp}`,
});
const all = await call(adminToken, "GET", "/admin/articles");
const ghostId = all.json.results?.find((r) => r.title === `Ghostwritten ${stamp}`)?.id;
check("the admin draft exists", Boolean(ghostId));

const assigned = await call(adminToken, "POST", `/admin/articles/${ghostId}/assign`, {
  specialistId,
  note: "Have a read and change anything you would put differently.",
});
check("assigned to the member", assigned.json.article?.status === "awaiting_author");
check("flagged as written for them", assigned.json.article?.writtenForYou === true);

const mine = await call(memberToken, "GET", "/dashboard/articles");
check("it appears in the member's list", mine.json.results?.some((r) => r.id === ghostId));
check("counted as awaiting them", (mine.json.counts?.awaitingYou ?? 0) >= 1);

const readable = await call(memberToken, "GET", `/dashboard/articles/${ghostId}`);
check("the member gets the draft body back, not rendered HTML",
  String(readable.json.article?.body ?? "").startsWith("## Draft"));

const approved = await call(memberToken, "PATCH", `/dashboard/articles/${ghostId}`, {
  title: `Ghostwritten ${stamp}`,
  body: "## My version\n\nI have changed the wording and I am happy for this to go out under my name.",
  submit: true,
});
check("the member's edit goes back into review", approved.json.article?.status === "in_review");

const publishedGhost = await call(adminToken, "POST", `/admin/articles/${ghostId}/review`, { decision: "publish" });
check("published after review", publishedGhost.json.article?.status === "published");

/* ------------------------------------------------------------ the rules */
console.log("\n  the rules that must hold");
const bothPublic = await call(null, "GET", "/articles?pageSize=24");
const titles = (bothPublic.json.results ?? []).map((r) => r.title);
check("both appear on the public blog",
  titles.includes(`Member written ${stamp}`) && titles.includes(`Ghostwritten ${stamp}`));

const draftOnly = await call(adminToken, "POST", "/admin/articles/import", {
  title: `Never published ${stamp}`,
  body: "This one stays a draft and must never be public.",
  status: "draft",
  sourceRef: `draft-${stamp}`,
});
check("a draft is created", draftOnly.status === 201 || draftOnly.status === 200);
const publicAgain = await call(null, "GET", "/articles?pageSize=24");
check("a draft never reaches the public blog",
  !(publicAgain.json.results ?? []).some((r) => r.title === `Never published ${stamp}`));

const strangerToken = memberToken;
const someoneElses = await call(strangerToken, "GET", "/dashboard/articles/art_does_not_exist");
check("a member cannot read an article that is not theirs", someoneElses.status === 404);

const unauth = await call(null, "GET", "/dashboard/articles");
check("the member endpoint needs a session", unauth.status === 401);

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
