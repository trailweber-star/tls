/* Devices, email changes and two-factor, end to end over HTTP.
 *
 * Each of the three replaces a promise the account screen used to make
 * in a "not here yet" list, and each has one property that is the whole
 * reason it exists. Those three are the checks to read first:
 *
 *   - revoking a session ENDS it, on the next request, rather than
 *     letting its token run out in a week
 *   - an email change cannot apply on one confirmation, because the
 *     one-sided version of this is how accounts get taken
 *   - a TOTP code cannot be used twice, and a recovery code cannot be
 *     used twice either
 *
 *   node scripts/account-test.mjs [http://127.0.0.1:4000/api]
 */
import { currentCode, stepAt, codeForStep } from "../src/lib/totp.js";

const BASE = process.argv[2] ?? "http://127.0.0.1:4000/api";
const ADMIN = { email: "admin@tls.test", password: "demo1234" };

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};
const section = (name) => console.log(`\n${name}`);

async function call(token, method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const stamp = Date.now();
const PASSWORD = "account-test-4471";

const account = {
  fullName: `Account Test ${stamp}`,
  email: `account-${stamp}@example.com`,
  password: PASSWORD,
};

const registered = await call(null, "POST", "/auth/register", account);
check("registered an account", registered.status === 201, JSON.stringify(registered.body)?.slice(0, 140));
const first = registered.body?.token ?? null;

/* ================================================= signed-in devices */

section("the device list");

const listed = await call(first, "GET", "/auth/sessions");
check("the list needs a session", (await call(null, "GET", "/auth/sessions")).status === 401);
check("signing up put one session in it", listed.body?.results?.length === 1, String(listed.body?.results?.length));
check("and it is marked as this device", listed.body?.results?.[0]?.current === true);
check("with something a person could recognise", typeof listed.body?.results?.[0]?.label === "string");

/* A second and third "device", distinguishable by what they claim to be. */
const phone = await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD }, {
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const laptop = await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD }, {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
});
check("a second sign-in opens a second session", Boolean(phone.body?.token), String(phone.status));
check("and a third a third", Boolean(laptop.body?.token), String(laptop.status));

const three = await call(first, "GET", "/auth/sessions");
check("all three are listed", three.body?.results?.length === 3, String(three.body?.results?.length));

const labels = (three.body?.results ?? []).map((r) => r.label);
check("the phone is named as one", labels.includes("Safari on iPhone"), labels.join(" | "));
check("and the laptop as another", labels.includes("Chrome on Windows"), labels.join(" | "));
check("only one of them is this device", (three.body?.results ?? []).filter((r) => r.current).length === 1);

section("revoking actually revokes");

const phoneRow = (three.body?.results ?? []).find((r) => r.label === "Safari on iPhone");
const stillWorks = await call(phone.body.token, "GET", "/auth/me");
check("the phone's session works before", stillWorks.status === 200, String(stillWorks.status));

const revoked = await call(first, "DELETE", `/auth/sessions/${phoneRow.id}`);
check("it can be ended from another device", revoked.status === 200, String(revoked.status));
check("and that was not this device", revoked.body?.endedCurrent === false);

const afterRevoke = await call(phone.body.token, "GET", "/auth/me");
check("the phone's token stops working immediately", afterRevoke.status === 401, String(afterRevoke.status));
check("and is told the session ended, not that the password changed", afterRevoke.body?.code === "session_revoked");

const twoLeft = await call(first, "GET", "/auth/sessions");
check("the list is down to two", twoLeft.body?.results?.length === 2, String(twoLeft.body?.results?.length));

const alreadyGone = await call(first, "DELETE", `/auth/sessions/${phoneRow.id}`);
check("ending it twice is a 404, not a second success", alreadyGone.status === 404, String(alreadyGone.status));

const strangers = await call(first, "DELETE", "/auth/sessions/ses_not_mine_at_all");
check("a session id that isn't yours cannot be ended", strangers.status === 404, String(strangers.status));

section("signing out the others");

const others = await call(first, "POST", "/auth/sessions/revoke-others");
check("the rest go in one call", others.status === 200 && others.body?.ended === 1, JSON.stringify(others.body));

const laptopNow = await call(laptop.body.token, "GET", "/auth/me");
check("the laptop is out", laptopNow.status === 401, String(laptopNow.status));
const meNow = await call(first, "GET", "/auth/me");
check("this device is still in", meNow.status === 200, String(meNow.status));
const one = await call(first, "GET", "/auth/sessions");
check("one session left", one.body?.results?.length === 1, String(one.body?.results?.length));

section("signing out");

const bye = await call(laptop.body.token, "POST", "/auth/logout");
check("logging out with a dead session is refused", bye.status === 401, String(bye.status));

const fresh = await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD });
const goodbye = await call(fresh.body.token, "POST", "/auth/logout");
check("logging out works", goodbye.status === 200, String(goodbye.status));
const afterBye = await call(fresh.body.token, "GET", "/auth/me");
check("and the token is dead rather than merely forgotten", afterBye.status === 401, String(afterBye.status));

/* ==================================================== email changes */

section("starting an email change");

const session = (await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD })).body.token;
const newEmail = `moved-${stamp}@example.com`;

const noPassword = await call(session, "POST", "/auth/email-change", { newEmail });
check("it needs the current password", noPassword.status === 400, String(noPassword.status));

const wrongPassword = await call(session, "POST", "/auth/email-change", {
  newEmail,
  currentPassword: "not-the-password",
});
check("the right one", wrongPassword.status === 400 && wrongPassword.body?.code === "current_password_wrong");

const sameAddress = await call(session, "POST", "/auth/email-change", {
  newEmail: account.email,
  currentPassword: PASSWORD,
});
check("moving to the address you already have is refused", sameAddress.status === 400, String(sameAddress.status));

const taken = await call(session, "POST", "/auth/email-change", {
  newEmail: ADMIN.email,
  currentPassword: PASSWORD,
});
check("so is an address on another account", taken.status === 409, String(taken.status));

const started = await call(session, "POST", "/auth/email-change", { newEmail, currentPassword: PASSWORD });
check("a good request is accepted", started.status === 201, JSON.stringify(started.body)?.slice(0, 140));
check("nothing is confirmed yet", started.body?.request?.newConfirmed === false && started.body?.request?.oldConfirmed === false);

const links = started.body?.devLinks ?? null;
check("three links were issued", Boolean(links?.confirm && links?.approve && links?.cancel), JSON.stringify(links)?.slice(0, 80));
check("and all three are different", new Set(Object.values(links ?? {})).size === 3);

const pending = await call(session, "GET", "/auth/email-change");
check("the account screen can see it waiting", pending.body?.request?.newEmail === newEmail);

section("one confirmation is not enough");

const tokenFrom = (url) => new URL(url).searchParams.get("token");

const half = await call(null, "POST", "/auth/email-change/confirm", { token: tokenFrom(links.confirm) });
check("the new address confirms", half.status === 200 && half.body?.outcome === "waiting", JSON.stringify(half.body));
check("and is told what it is waiting for", half.body?.waitingOn === "the old address", String(half.body?.waitingOn));

const stillOld = await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD });
check("the account still signs in with the old address", stillOld.status === 200, String(stillOld.status));
const notYet = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
check("and not yet with the new one", notYet.status === 401, String(notYet.status));

section("both, and it moves");

const done = await call(null, "POST", "/auth/email-change/confirm", { token: tokenFrom(links.approve) });
check("the old address approves", done.status === 200 && done.body?.outcome === "applied", JSON.stringify(done.body));

const oldGone = await call(null, "POST", "/auth/login", { email: account.email, password: PASSWORD });
check("the old address no longer signs in", oldGone.status === 401, String(oldGone.status));
const newWorks = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
check("the new one does", newWorks.status === 200, String(newWorks.status));

const replay = await call(null, "POST", "/auth/email-change/confirm", { token: tokenFrom(links.confirm) });
check("the links are spent", replay.status === 400, String(replay.status));

section("the cancel link, which is the one that matters");

const live = (await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD })).body.token;
const second = await call(live, "POST", "/auth/email-change", {
  newEmail: `attacker-${stamp}@example.com`,
  currentPassword: PASSWORD,
});
check("a second change can be started", second.status === 201, String(second.status));

const cancelled = await call(null, "POST", "/auth/email-change/confirm", {
  token: tokenFrom(second.body.devLinks.cancel),
});
check("the old address can kill it outright", cancelled.body?.outcome === "cancelled", JSON.stringify(cancelled.body));

const afterCancel = await call(null, "POST", "/auth/email-change/confirm", {
  token: tokenFrom(second.body.devLinks.confirm),
});
check("and the other links die with it", afterCancel.status === 400, String(afterCancel.status));

const none = await call(live, "GET", "/auth/email-change");
check("nothing is left waiting", none.body?.request === null);

section("only one change in flight at a time");

const a = await call(live, "POST", "/auth/email-change", { newEmail: `first-${stamp}@example.com`, currentPassword: PASSWORD });
const b = await call(live, "POST", "/auth/email-change", { newEmail: `second-${stamp}@example.com`, currentPassword: PASSWORD });
check("starting a second supersedes the first", b.status === 201, String(b.status));
const supersededLink = await call(null, "POST", "/auth/email-change/confirm", { token: tokenFrom(a.body.devLinks.confirm) });
check("and the first one's links stop working", supersededLink.status === 400, String(supersededLink.status));
await call(live, "DELETE", "/auth/email-change");

/* ======================================================= two-factor */

section("setting up two-factor");

const status0 = await call(live, "GET", "/auth/2fa");
check("it starts switched off", status0.body?.enabled === false);

const noPass = await call(live, "POST", "/auth/2fa/setup", {});
check("setup needs the current password", noPass.status === 400, String(noPass.status));

const setup = await call(live, "POST", "/auth/2fa/setup", { currentPassword: PASSWORD });
check("setup returns a secret", setup.status === 200 && typeof setup.body?.secret === "string", String(setup.status));
check("in base32 an app can read", /^[A-Z2-7]{32}$/.test(setup.body?.secret ?? ""), String(setup.body?.secret));
check("and an otpauth URI", (setup.body?.otpauthUri ?? "").startsWith("otpauth://totp/"));
check("carrying the same secret", (setup.body?.otpauthUri ?? "").includes(setup.body?.secret));
check("and a QR code to scan", (setup.body?.qr ?? "").startsWith("data:image/svg+xml;base64,"));

const notOnYet = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
check("sign-in is unchanged until it is switched on", Boolean(notOnYet.body?.token), JSON.stringify(notOnYet.body)?.slice(0, 80));

const secret = setup.body.secret;

const wrongCode = await call(live, "POST", "/auth/2fa/enable", { code: "000000" });
check("a wrong code does not switch it on", wrongCode.status === 400, String(wrongCode.status));

const enabled = await call(live, "POST", "/auth/2fa/enable", { code: currentCode(secret) });
check("a real code does", enabled.status === 200, JSON.stringify(enabled.body)?.slice(0, 140));
check("and ten recovery codes come back", enabled.body?.recoveryCodes?.length === 10);
check("each of them unique", new Set(enabled.body?.recoveryCodes ?? []).size === 10);
check("with no characters that get misread on paper", (enabled.body?.recoveryCodes ?? []).every((c) => !/[01OIL]/.test(c)));

const recoveryCodes = enabled.body.recoveryCodes;

const status1 = await call(live, "GET", "/auth/2fa");
check("the account says it is on", status1.body?.enabled === true);
check("and how many recovery codes are left", status1.body?.recoveryCodesRemaining === 10);
check("the codes themselves are never returned again", JSON.stringify(status1.body).includes(recoveryCodes[0]) === false);

section("signing in with it on");

const half2 = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
check("the password alone gets no session", !half2.body?.token, JSON.stringify(half2.body)?.slice(0, 80));
check("it gets a challenge instead", half2.body?.mfaRequired === true && typeof half2.body?.challenge === "string");

/* The one that would undo the whole feature: a challenge must not be
   usable as a session token. It carries no `sub`, so nothing that
   requires a session will accept it — including endpoints written
   later by somebody who never read this file. */
const asSession = await call(half2.body.challenge, "GET", "/auth/me");
check("the challenge cannot be used as a session", asSession.status === 401, String(asSession.status));

const badSecond = await call(null, "POST", "/auth/login/2fa", {
  challenge: half2.body.challenge,
  code: "000000",
});
check("a wrong code is refused", badSecond.status === 400, String(badSecond.status));

/* The NEXT code, not the current one. Switching two-factor on a moment
   ago consumed the code that did it, and the replay guard refuses the
   same step a second time — correctly, since it is the same six digits.
   In an app that is simply the number rolling over; here it is one step
   forward, which the one-step window accepts. */
const code = codeForStep(secret, stepAt() + 1);
const signedIn = await call(null, "POST", "/auth/login/2fa", { challenge: half2.body.challenge, code });
check("the right one signs in", signedIn.status === 200 && Boolean(signedIn.body?.token), JSON.stringify(signedIn.body)?.slice(0, 120));
check("as the right account", signedIn.body?.user?.email === newEmail);

section("a code cannot be used twice");

const again = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
const replayed = await call(null, "POST", "/auth/login/2fa", { challenge: again.body.challenge, code });
check("the same six digits are refused the second time", replayed.status === 400, String(replayed.status));
check("and named as already used, not as wrong", replayed.body?.code === "code_replayed", String(replayed.body?.code));

/* A code from the previous window is in the accepted range by time, and
   must still be refused because a newer step has been consumed. */
const older = codeForStep(secret, stepAt());
const staleAttempt = await call(null, "POST", "/auth/login/2fa", { challenge: again.body.challenge, code: older });
check("so is the one before it", staleAttempt.status === 400, String(staleAttempt.status));

section("recovery codes");

const lost = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
const rescued = await call(null, "POST", "/auth/login/2fa", {
  challenge: lost.body.challenge,
  code: recoveryCodes[0],
});
check("a recovery code signs in", rescued.status === 200 && Boolean(rescued.body?.token), JSON.stringify(rescued.body)?.slice(0, 120));
check("and says so, rather than quietly", rescued.body?.usedRecoveryCode === true);
check("with a count of what is left", rescued.body?.recoveryCodesRemaining === 9, String(rescued.body?.recoveryCodesRemaining));

const lostAgain = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
const spent = await call(null, "POST", "/auth/login/2fa", {
  challenge: lostAgain.body.challenge,
  code: recoveryCodes[0],
});
check("the same recovery code does not work twice", spent.status === 400, String(spent.status));

const lowerCase = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
const sloppy = await call(null, "POST", "/auth/login/2fa", {
  challenge: lowerCase.body.challenge,
  code: recoveryCodes[1].toLowerCase().replace("-", " "),
});
check("case and spacing do not matter when typing one back", sloppy.status === 200, String(sloppy.status));

const active = rescued.body.token;
const reissued = await call(active, "POST", "/auth/2fa/recovery-codes", { currentPassword: PASSWORD });
check("a new set can be issued", reissued.status === 200 && reissued.body?.recoveryCodes?.length === 10);

const oldSet = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
const deadCode = await call(null, "POST", "/auth/login/2fa", {
  challenge: oldSet.body.challenge,
  code: recoveryCodes[2],
});
check("which kills the old set", deadCode.status === 400, String(deadCode.status));

section("switching it off");

const stillOn = await call(active, "POST", "/auth/2fa/disable", { currentPassword: PASSWORD });
check("turning it off needs a code as well as the password", stillOn.status === 400, String(stillOn.status));

const wrongPw = await call(active, "POST", "/auth/2fa/disable", {
  currentPassword: "nope",
  code: currentCode(secret),
});
check("and the right password", wrongPw.status === 400 && wrongPw.body?.code === "current_password_wrong");

/* Wait out a step and then take the one after this: the last code
   consumed was already a step ahead (see the sign-in above), and the
   guard wants something strictly newer than that. This is the replay
   protection making the test awkward, which is the point of it. */
await new Promise((r) => setTimeout(r, 31_000));

const off = await call(active, "POST", "/auth/2fa/disable", {
  currentPassword: PASSWORD,
  code: codeForStep(secret, stepAt() + 1),
});
check("with both, it comes off", off.status === 200, JSON.stringify(off.body)?.slice(0, 140));

const plain = await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD });
check("sign-in is one step again", Boolean(plain.body?.token), JSON.stringify(plain.body)?.slice(0, 80));

const status2 = await call(plain.body.token, "GET", "/auth/2fa");
check("and the account says it is off", status2.body?.enabled === false);
check("with no recovery codes left behind", status2.body?.recoveryCodesRemaining === 0);

section("what a borrowed session may not do");

const adminToken = (await call(null, "POST", "/auth/login", ADMIN)).body?.token ?? null;
check("signed in as an administrator", Boolean(adminToken));

if (adminToken) {
  const found = (await call(adminToken, "GET", `/admin/members?q=${encodeURIComponent(newEmail)}`)).body?.results?.find(
    (m) => m.email === newEmail
  );
  if (found) {
    const borrowed = await call(adminToken, "POST", `/admin/members/${found.id}/impersonate`, {
      reason: "account test",
    });
    const worn = borrowed.body?.token;
    check("a support session opened", Boolean(worn), String(borrowed.status));

    if (worn) {
      const tryEmail = await call(worn, "POST", "/auth/email-change", {
        newEmail: `stolen-${stamp}@example.com`,
        currentPassword: PASSWORD,
      });
      check("it cannot move the member's email address", tryEmail.status === 403, String(tryEmail.status));

      const try2fa = await call(worn, "POST", "/auth/2fa/setup", { currentPassword: PASSWORD });
      check("nor set up two-factor on their account", try2fa.status === 403, String(try2fa.status));

      /* But it can be seen. The member's own device list showing the
         support session is the point of recording the actor on it. */
      const memberSees = await call(worn, "GET", "/auth/sessions");
      const support = (memberSees.body?.results ?? []).filter((r) => r.support);
      check("and the member's device list shows it for what it is", support.length === 1, JSON.stringify(memberSees.body?.results?.map((r) => r.support)));

      await call(worn, "POST", "/admin/members/stop-impersonating");
      const afterStop = await call(worn, "GET", "/auth/me");
      check("handing the session back ends it rather than leaving it live", afterStop.status === 401, String(afterStop.status));
    }
  } else {
    check("could not find the test member in the admin list", false);
  }
}

section("a password change still ends everything");

const one1 = (await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD })).body.token;
const two2 = (await call(null, "POST", "/auth/login", { email: newEmail, password: PASSWORD })).body.token;
check("two sessions open", Boolean(one1) && Boolean(two2));

await new Promise((r) => setTimeout(r, 1100));
/* Nothing from the account's own name or address in it — the password
   rules refuse those, which is checked in scripts/password-test.mjs. */
const NEW_PASSWORD = "further-uphill-quietly-7731";
const changed = await call(one1, "POST", "/auth/change-password", {
  currentPassword: PASSWORD,
  newPassword: NEW_PASSWORD,
});
check("the password changes", changed.status === 200, JSON.stringify(changed.body)?.slice(0, 120));

check("the other session is out", (await call(two2, "GET", "/auth/me")).status === 401);
check("and the new token is in", (await call(changed.body.token, "GET", "/auth/me")).status === 200);

const listAfter = await call(changed.body.token, "GET", "/auth/sessions");
check("the device list is down to the one that made the change", listAfter.body?.results?.length === 1, String(listAfter.body?.results?.length));

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
