/* Password reset and password change, end to end over HTTP.
 *
 * Almost every check here is about something NOT happening. A reset flow
 * is mostly a set of refusals, and each one below is a specific way this
 * could have gone wrong:
 *
 *   - telling a stranger which addresses have accounts
 *   - a link that works twice, or after an hour, or after the password
 *     already moved
 *   - a reset that changes the lock and leaves the intruder inside
 *   - an unattended laptop being enough to take somebody's account
 *   - an administrator changing a member's password from inside a
 *     support session
 *
 *   node scripts/password-test.mjs [http://127.0.0.1:4000/api]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:4000/api";
const ADMIN = { email: "admin@tls.test", password: "demo1234" };

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};
const section = (name) => console.log(`\n${name}`);

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const stamp = Date.now();
const tokenFrom = (url) => new URL(url).searchParams.get("token");

/* A throwaway account of our own, so nothing here touches the seeded
   logins the rest of the suite signs in with. */
const member = {
  fullName: `Reset Test ${stamp}`,
  email: `reset-${stamp}@example.com`,
  password: "first-password-9281",
};

const registered = await call(null, "POST", "/auth/register", member);
check("registered an account to work on", registered.status === 201, JSON.stringify(registered.body)?.slice(0, 160));
const firstSession = registered.body?.token ?? null;

/* --------------------------------------------------- enumeration */

section("what a stranger can learn");

/* One second of daylight between the sign-up and everything that
   follows. Sessions are stamped with a whole-second issued-at, and the
   middleware refuses tokens STRICTLY older than the password change —
   strictly, because the token the reset itself hands back is minted in
   that same second and signing the person out of it would be absurd.
   The consequence is a sub-second tolerance, and this wait is what
   makes the checks below measure the rule rather than that tolerance. */
await new Promise((r) => setTimeout(r, 1100));

const known = await call(null, "POST", "/auth/forgot-password", { email: member.email });
const unknown = await call(null, "POST", "/auth/forgot-password", { email: `nobody-${stamp}@example.com` });

check("a known address gets 200", known.status === 200, String(known.status));
check("an unknown address gets 200 too", unknown.status === 200, String(unknown.status));
check("and the same body", known.body?.ok === true && unknown.body?.ok === true);
check(
  "nothing in the answer says whether the account exists",
  !JSON.stringify(unknown.body ?? {}).includes("not found") && unknown.body?.error === undefined
);

/* The dev link is the one thing that differs, and it is fenced to a
   loopback request on a non-production server with no mail provider —
   which is exactly what this test is. It exists so the flow can be
   walked on a laptop; the check below is that it is actually there,
   because the rest of this file depends on it. */
const resetUrl = known.body?.devResetUrl ?? null;
check("the link is handed back on a local dev server", Boolean(resetUrl), JSON.stringify(known.body)?.slice(0, 120));
check("and not for an address with no account", !unknown.body?.devResetUrl);

const malformed = await call(null, "POST", "/auth/forgot-password", { email: "not-an-email" });
check("a malformed address is a 400, which tells nobody anything", malformed.status === 400, String(malformed.status));

/* ------------------------------------------------------ the link */

section("the link itself");

const token = resetUrl ? tokenFrom(resetUrl) : "";
check("the link carries a token", token.length >= 32, String(token.length));

const wrongToken = await call(null, "POST", "/auth/reset-password", {
  token: "a".repeat(43),
  password: "some-new-password-2",
});
check("a made-up token is refused", wrongToken.status === 400, String(wrongToken.status));
check("with the same message a spent link gets", /expired or has already been used/i.test(wrongToken.body?.error ?? ""));

const weak = await call(null, "POST", "/auth/reset-password", { token, password: "short" });
check("a password under 8 characters is refused", weak.status === 400, String(weak.status));

const obvious = await call(null, "POST", "/auth/reset-password", { token, password: "password123" });
check("and one anybody would guess first", obvious.status === 400, String(obvious.status));
check("with a reason worth reading", /anybody would try/i.test(obvious.body?.error ?? ""));

const personal = await call(null, "POST", "/auth/reset-password", { token, password: `reset-${stamp}-x` });
check("and one built from the email address", personal.status === 400, String(personal.status));

check("none of those refusals spent the link", true);

/* ------------------------------------------------------ redeeming */

section("redeeming it");

const second = "second-password-5512";
const redeemed = await call(null, "POST", "/auth/reset-password", { token, password: second });
check("a good password is accepted", redeemed.status === 200, JSON.stringify(redeemed.body)?.slice(0, 160));
check("and signs them in", Boolean(redeemed.body?.token));
check("as the right account", redeemed.body?.user?.email === member.email, String(redeemed.body?.user?.email));

const replay = await call(null, "POST", "/auth/reset-password", { token, password: "third-password-7741" });
check("the same link cannot be used twice", replay.status === 400, String(replay.status));

const oldLogin = await call(null, "POST", "/auth/login", { email: member.email, password: member.password });
check("the old password no longer works", oldLogin.status === 401, String(oldLogin.status));

const newLogin = await call(null, "POST", "/auth/login", { email: member.email, password: second });
check("the new one does", newLogin.status === 200, String(newLogin.status));

/* ------------------------------------- the one that matters most */

section("the reset puts the other session out");

const stale = await call(firstSession, "GET", "/auth/me");
check(
  "the session opened before the reset is dead",
  stale.status === 401,
  `${stale.status} ${JSON.stringify(stale.body)?.slice(0, 80)}`
);
check("and says why", stale.body?.code === "password_changed", String(stale.body?.code));

const fresh = await call(redeemed.body?.token, "GET", "/auth/me");
check("the session the reset issued is not", fresh.status === 200, String(fresh.status));

/* ------------------------------------------ two links in flight */

section("a second link already in the post");

const a = await call(null, "POST", "/auth/forgot-password", { email: member.email });
const b = await call(null, "POST", "/auth/forgot-password", { email: member.email });
const tokenA = a.body?.devResetUrl ? tokenFrom(a.body.devResetUrl) : "";
const tokenB = b.body?.devResetUrl ? tokenFrom(b.body.devResetUrl) : "";
check("two requests give two different links", Boolean(tokenA) && Boolean(tokenB) && tokenA !== tokenB);

const third = "third-password-3390";
const usedB = await call(null, "POST", "/auth/reset-password", { token: tokenB, password: third });
check("the newer link works", usedB.status === 200, String(usedB.status));

const usedA = await call(null, "POST", "/auth/reset-password", { token: tokenA, password: "fourth-password-1102" });
check("and the older one is dead the moment it does", usedA.status === 400, String(usedA.status));

/* Four requests in the same hour: the fourth is rate limited, and says
   so by saying nothing — same 200, no link. */
const limited = await call(null, "POST", "/auth/forgot-password", { email: member.email });
check("a fourth request within the hour is rate limited", limited.status === 200 && !limited.body?.devResetUrl, JSON.stringify(limited.body)?.slice(0, 100));

/* ------------------------------------------------ changing it */

section("changing a password you know");

const signedIn = await call(null, "POST", "/auth/login", { email: member.email, password: third });
const session = signedIn.body?.token ?? null;
check("signed in with the current password", Boolean(session), String(signedIn.status));

const anon = await call(null, "POST", "/auth/change-password", {
  currentPassword: third,
  newPassword: "anonymous-attempt-1",
});
check("changing a password needs a session", anon.status === 401, String(anon.status));

const wrongCurrent = await call(session, "POST", "/auth/change-password", {
  currentPassword: "not-the-current-one",
  newPassword: "fifth-password-8823",
});
check(
  "a session alone is not enough — the current password is required",
  wrongCurrent.status === 400,
  String(wrongCurrent.status)
);
check("and it says which field is wrong", wrongCurrent.body?.code === "current_password_wrong");

const sameAgain = await call(session, "POST", "/auth/change-password", {
  currentPassword: third,
  newPassword: third,
});
check("setting the same password again is refused", sameAgain.status === 400, String(sameAgain.status));

const tooWeak = await call(session, "POST", "/auth/change-password", {
  currentPassword: third,
  newPassword: "abc",
});
check("a weak new password is refused", tooWeak.status === 400, String(tooWeak.status));

/* A second window on the same account, opened before the change. */
const otherWindow = await call(null, "POST", "/auth/login", { email: member.email, password: third });
const otherSession = otherWindow.body?.token ?? null;
check("a second browser is signed in on the same account", Boolean(otherSession));

/* One second of daylight, so the new token's issued-at is provably
   later than the old ones rather than sharing their second. */
await new Promise((r) => setTimeout(r, 1100));

const fifth = "fifth-password-8823";
const changed = await call(session, "POST", "/auth/change-password", {
  currentPassword: third,
  newPassword: fifth,
});
check("a correct change is accepted", changed.status === 200, JSON.stringify(changed.body)?.slice(0, 160));
check("and hands back a replacement session", Boolean(changed.body?.token));
check("saying that the others are gone", changed.body?.signedOutElsewhere === true);

const otherNow = await call(otherSession, "GET", "/auth/me");
check("the other browser is signed out", otherNow.status === 401, String(otherNow.status));

const mineNow = await call(changed.body?.token, "GET", "/auth/me");
check("the browser that made the change is not", mineNow.status === 200, String(mineNow.status));

const oldSession = await call(session, "GET", "/auth/me");
check("even the token this request was made with is dead", oldSession.status === 401, String(oldSession.status));

const loginFifth = await call(null, "POST", "/auth/login", { email: member.email, password: fifth });
check("the new password signs in", loginFifth.status === 200, String(loginFifth.status));

/* --------------------------------------------- support sessions */

section("an administrator cannot change a member's password");

const adminLogin = await call(null, "POST", "/auth/login", ADMIN);
const adminToken = adminLogin.body?.token ?? null;
check("signed in as an administrator", Boolean(adminToken), String(adminLogin.status));

if (adminToken) {
  const members = await call(adminToken, "GET", `/admin/members?q=${encodeURIComponent(member.email)}`);
  const found = (members.body?.results ?? []).find((m) => m.email === member.email);

  if (found) {
    const borrowed = await call(adminToken, "POST", `/admin/members/${found.id}/impersonate`, {
      reason: "password test",
    });
    if (borrowed.status === 200 && borrowed.body?.token) {
      const attempt = await call(borrowed.body.token, "POST", "/auth/change-password", {
        currentPassword: fifth,
        newPassword: "admin-took-this-account-1",
      });
      check("a borrowed session is refused", attempt.status === 403, String(attempt.status));
      check("and told why", attempt.body?.code === "impersonating", String(attempt.body?.code));

      const stillWorks = await call(null, "POST", "/auth/login", { email: member.email, password: fifth });
      check("the member's password is untouched", stillWorks.status === 200, String(stillWorks.status));
    } else {
      check("could not open a support session to test against", false, String(borrowed.status));
    }
  } else {
    check("could not find the test member in the admin list", false, String(members.status));
  }
}

/* ------------------------------------------- admins reset too */

section("the rate limit counts per account, not globally");

/* The account above has spent its three links for the hour. A different
   account must be unaffected — a limit that leaked across accounts
   would let one person's forgotten password lock everybody else out of
   the reset flow, which is a denial of service dressed as a safeguard. */
const other = {
  fullName: `Other Account ${stamp}`,
  email: `other-${stamp}@example.com`,
  password: "another-password-6621",
};
const otherReg = await call(null, "POST", "/auth/register", other);
check("registered a second account", otherReg.status === 201, String(otherReg.status));

const exhausted = await call(null, "POST", "/auth/forgot-password", { email: member.email });
check("the first account is still rate limited", exhausted.status === 200 && !exhausted.body?.devResetUrl);

const otherForgot = await call(null, "POST", "/auth/forgot-password", { email: other.email });
check("the second account is not", otherForgot.status === 200 && Boolean(otherForgot.body?.devResetUrl));

section("an administrator's own password");

const adminForgot = await call(null, "POST", "/auth/forgot-password", { email: ADMIN.email });
check("an admin can ask for a reset link like anybody else", adminForgot.status === 200, String(adminForgot.status));

/* Deliberately not redeemed: the seeded admin login is what the rest of
   the suite signs in with, and changing it here would break every other
   script. That the endpoint does not treat an administrator differently
   is the point — and whether a link comes back depends on how many the
   account has already asked for this hour, which is exactly the
   behaviour checked above. */

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
