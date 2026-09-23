import "dotenv/config";
import { users as userRepo } from "../src/db/repos.js";
import { isDbConfigured } from "../src/config/db.js";
import { usablePassword } from "../src/lib/auth.js";

/* ------------------------------------------------------------------ *
 * Answer one question: why does a login or a forgot-password link
 * for this address go nowhere?
 *
 *   npm run user:check -- someone@example.com
 *
 * Login and forgot-password both refuse to say whether an address has
 * an account — forgot-password answers { ok: true } no matter what
 * (see controllers/password.controller.js), and a bad login just says
 * "incorrect". That's deliberate: it's an anti-enumeration measure, not
 * a bug. This script is the honest version of the same lookup, meant to
 * be run by whoever holds the database, not exposed over HTTP.
 * ------------------------------------------------------------------ */

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run user:check -- someone@example.com");
  process.exit(1);
}

if (!isDbConfigured()) {
  console.error("No DATABASE_URL set in this environment — nothing to check against.");
  process.exit(1);
}

const user = await userRepo.findByEmail(email);

if (!user) {
  console.log({ email, found: false });
  console.log(
    "No row for this email. Forgot-password and login both answer as if it might exist, on purpose — that's why neither told you this."
  );
  process.exit(0);
}

console.log({
  email: user.email,
  found: true,
  id: user.id,
  role: user.role ?? null,
  active: user.active !== false,
  hasUsablePassword: usablePassword(user.passwordHash),
  createdAt: user.createdAt ?? null,
});

if (user.active === false) {
  console.log("Account is deactivated — that's why forgot-password did nothing.");
} else if (!usablePassword(user.passwordHash)) {
  console.log(
    "No password has ever been set on this account (it's an imported/shell record) — that's why forgot-password did nothing. It needs to go through signup/claim, or have a password set directly."
  );
} else {
  console.log(
    "Account looks normal — exists, active, has a real password set. If forgot-password still sent nothing, check the Render Logs tab (not Shell) for [mail] lines from right when you submitted it: sendMail failures there are swallowed on purpose so the response never leaks account existence."
  );
}

process.exit(0);
