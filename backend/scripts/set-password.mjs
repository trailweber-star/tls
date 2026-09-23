import "dotenv/config";
import { users as userRepo } from "../src/db/repos.js";
import { isDbConfigured } from "../src/config/db.js";
import { hashPassword } from "../src/lib/auth.js";

/* ------------------------------------------------------------------ *
 * Set a password directly, bypassing forgot-password and its email.
 *
 *   npm run user:set-password -- someone@example.com "a new password"
 *
 * For when you hold the database and the mail round-trip is in the
 * way — most often forgot-password's own rate limit (3 requests per
 * account per rolling hour, see controllers/password.controller.js),
 * which answers { ok: true } and sends nothing once tripped, with no
 * line in the logs to tell you that's what happened.
 *
 * Does exactly what resetPassword does to the row — new hash,
 * passwordChangedAt bumped so any session issued before this moment
 * stops working — without a token, a link, or a message. Not exposed
 * over HTTP; meant to be run from where DATABASE_URL lives.
 * ------------------------------------------------------------------ */

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: npm run user:set-password -- someone@example.com "a new password"');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Use at least 8 characters — the sign-in form will reject anything shorter anyway.");
  process.exit(1);
}

if (!isDbConfigured()) {
  console.error("No DATABASE_URL set in this environment — nothing to update.");
  process.exit(1);
}

const user = await userRepo.findByEmail(email);

if (!user) {
  console.log({ email, found: false });
  console.log("No row for this email — nothing to set a password on. Create the account first.");
  process.exit(1);
}

const changedAt = new Date();
await userRepo.update(user.id, {
  passwordHash: hashPassword(password),
  passwordChangedAt: changedAt,
});

console.log({
  email: user.email,
  id: user.id,
  role: user.role ?? null,
  passwordSet: true,
  passwordChangedAt: changedAt.toISOString(),
});
console.log("Done. Any session issued before this moment is now invalid — sign in fresh with the new password.");

process.exit(0);
