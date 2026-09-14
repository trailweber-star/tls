/* ------------------------------------------------------------------ *
 * Password reset, and ending the sessions a reset is meant to end
 *
 * Until now the only password handling on this site was at registration
 * and login. Whatever password an account was created with was the
 * password it had for ever, and a member who forgot theirs had to email
 * the developer so somebody could edit the database by hand. That is
 * the first support request any directory gets.
 *
 * TWO COLUMNS, AND ONE OF THEM IS THE SECURITY ONE.
 *
 * The table stores a HASH of the reset token, never the token itself.
 * The token exists in exactly two places — the email we send, and the
 * link in the user's browser — and nowhere else, ever. A leaked backup
 * or a careless log of this table gives an attacker nothing: they would
 * have to invert SHA-256 to produce a usable link. Storing the raw
 * token would make this table equivalent to a list of live passwords.
 *
 * users.password_changed_at is the other half, and it is the one that
 * makes a reset mean something. Sessions here are signed tokens with no
 * server-side store, so a password change cannot revoke them by
 * deleting a row. Without this column, somebody who resets their
 * password BECAUSE they were compromised leaves the attacker signed in
 * for the rest of the token's life — the reset would change the lock
 * while leaving the intruder inside. The auth middleware compares each
 * token's issued-at against this column and refuses anything older, so
 * changing a password ends every session that predates it, everywhere,
 * immediately.
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" text PRIMARY KEY NOT NULL,

  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  /* SHA-256 of the token we emailed. Unique so a lookup is a single
     indexed read and two tokens can never collide silently. */
  "token_hash" text NOT NULL UNIQUE,

  /* One hour. Long enough to walk away from the computer and come back,
     short enough that a link sitting in a mailbox somebody else later
     reads is almost always already dead. */
  "expires_at" timestamp with time zone NOT NULL,

  /* Single use. Set the moment it is redeemed, and checked before
     anything else — a link forwarded, cached by a mail scanner, or
     pasted into a chat must not work twice. */
  "used_at" timestamp with time zone,

  /* Where the request came from. Not used to decide anything: it is
     there so that "somebody keeps requesting resets for my account" is
     a question an administrator can actually answer. */
  "requested_ip" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

/* The redeem path's only query. */
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_idx"
  ON "password_reset_tokens" ("token_hash");

/* For burning every outstanding token for one account — which happens
   on every successful reset and on every password change, so a second
   link that was already in flight cannot be used afterwards. */
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx"
  ON "password_reset_tokens" ("user_id", "created_at");

/* ------------------------------------------------------------------ *
 * The session clock
 *
 * Nullable, and null means "never changed" — which is every account
 * that exists today, and correctly lets their current sessions stand.
 * ------------------------------------------------------------------ */
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp with time zone;
