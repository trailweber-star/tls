/* ------------------------------------------------------------------ *
 * Three things the account screen promised and could not yet do:
 * see where you are signed in, move your email address, and put a
 * second lock on the door.
 *
 * ------------------------------------------------------------------ *
 * SESSIONS — and the change in kind that comes with them
 *
 * Until now a session was a signed token and nothing else. Nothing on
 * the server recorded that it existed, which is why "sign out my other
 * devices" could only ever be answered with a blunt instrument
 * (password_changed_at, which ends ALL of them and cannot name one),
 * and why "which devices are signed in?" could not be answered at all.
 *
 * So every token now carries a session id and every session id has a
 * row. The row is the authority: the auth middleware looks it up on
 * every request, and a revoked or missing row is an ended session,
 * immediately, without waiting for a token to expire.
 *
 * That is deliberately a move from stateless to stateful auth, and it
 * costs one indexed read per request. It buys the only honest version
 * of the two features above — a list that reflects reality, and a
 * revoke button that revokes rather than merely expires.
 *
 * password_changed_at stays. A token minted before this migration has
 * no session id and no row; those are accepted as they are, so nobody
 * is thrown out by a deploy, and the password path can still end them.
 *
 * ------------------------------------------------------------------ *
 * EMAIL CHANGES — why two confirmations and not one
 *
 * The usual design confirms only the new address, and it has a well
 * known failure: somebody who gets thirty seconds at an unlocked laptop
 * points the account at their own address, and the owner finds out when
 * they can no longer sign in. Confirming the new address proves the
 * attacker owns the attacker's mailbox, which was never in doubt.
 *
 * Here both ends must agree. The new address confirms it is real and
 * reachable; the old address approves the move, and the same message
 * carries a cancel link that kills the request outright. Neither on its
 * own does anything. The current password is required to start it, so
 * the laptop alone is not enough either.
 *
 * ------------------------------------------------------------------ *
 * TWO-FACTOR — what is stored and what is not
 *
 * The TOTP secret is stored encrypted, not in the clear: it is a
 * password equivalent, and a table full of them is a table that turns
 * one leaked backup into every account at once. Recovery codes are
 * stored as hashes for exactly the same reason, and are single use.
 *
 * totp_last_step is the replay guard. A TOTP code is valid for a whole
 * thirty-second window, which is long enough for a code read over
 * somebody's shoulder — or out of a phishing page — to be used a second
 * time. Recording the last step consumed means it cannot.
 * ------------------------------------------------------------------ */

/* ============================================================ sessions */

CREATE TABLE IF NOT EXISTS "sessions" (
  /* This id is the `sid` claim inside the token. */
  "id" text PRIMARY KEY NOT NULL,

  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  /* Set when an administrator opened this session while wearing the
     member's account, so a support session is recognisable in the list
     rather than looking like a stranger signing in from London. */
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,

  /* What the browser said it was. Never trusted for anything — it is
     shown to a person so they can recognise their own devices, which is
     the only job it has. */
  "user_agent" text,
  "ip" text,
  "country" text,

  /* Written at most once a minute, not on every request: the list needs
     to say "active a few minutes ago", not to count requests. */
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,

  /* Set instead of deleting the row, so the audit question "when was
     that device signed out, and did somebody do it or did it lapse?"
     still has an answer afterwards. */
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,

  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

/* The list, newest first, and the revoke-the-others sweep. */
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id", "last_seen_at" DESC);

/* ================================================== email changes */

CREATE TABLE IF NOT EXISTS "email_change_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  /* Held here, not on the account, until both ends agree. The account's
     own email column does not move until the moment it is applied. */
  "new_email" text NOT NULL,
  "old_email" text NOT NULL,

  /* Hashes, never the tokens — same reasoning as password resets. */
  "new_token_hash" text NOT NULL UNIQUE,
  "old_token_hash" text NOT NULL UNIQUE,
  "cancel_token_hash" text NOT NULL UNIQUE,

  "new_confirmed_at" timestamp with time zone,
  "old_confirmed_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" text,

  /* A day. Long enough to reach an address somebody only checks in the
     evening, short enough that a half-finished change does not sit open
     for a fortnight. */
  "expires_at" timestamp with time zone NOT NULL,
  "requested_ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_change_user_idx" ON "email_change_requests" ("user_id", "created_at" DESC);

/* One open request per account at a time. Partial, so the history of
   applied and cancelled requests is kept — it is the only record of
   what an address used to be. */
CREATE UNIQUE INDEX IF NOT EXISTS "email_change_one_open_idx"
  ON "email_change_requests" ("user_id")
  WHERE "applied_at" IS NULL AND "cancelled_at" IS NULL;

/* ===================================================== two-factor */

/* AES-256-GCM, keyed from AUTH_SECRET — see lib/totp.js. Null means
   two-factor was never set up on this account. */
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;

/* Set only once a code from the app has been checked. An enrolment
   somebody abandoned halfway must not lock them out, so the secret can
   exist while this is null and sign-in is unaffected. */
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;

/* The last thirty-second step consumed. A code is refused if its step
   is not strictly newer, so the same six digits cannot be used twice. */
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_step" bigint;

CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  /* Hashed. They are passwords that bypass the second factor. */
  "code_hash" text NOT NULL UNIQUE,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mfa_recovery_user_idx" ON "mfa_recovery_codes" ("user_id");
