import "dotenv/config";
import { spawnSync } from "node:child_process";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { getDb, disconnectDb, isDbConfigured } from "../src/db/client.js";

/* ------------------------------------------------------------------ *
 * What has to happen before the server accepts its first request
 *
 * Run by `npm run start:prod`, which is what a host's start command
 * points at. Three steps, each safe to repeat, because a host will run
 * this again on every deploy, every restart and every crash recovery:
 *
 *   1. Apply any migrations the deployed code expects.
 *   2. On a genuinely empty database, optionally seed the demo
 *      directory — so a preview link shows a working site rather than
 *      an empty one.
 *   3. Hand over to the server.
 *
 * Step 2 only ever runs against an empty table. A seed that could
 * overwrite real listings on a restart is not a convenience, it is a
 * loaded gun, so the emptiness check is the whole safety of it.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Waiting for the database to be there
 *
 * Step 1 used to be a bare `await migrate(...)`, and on 23 Sep 2026 it
 * died like this:
 *
 *   DrizzleQueryError: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
 *   cause: Error: connect ECONNREFUSED 10.232.106.37:5432
 *
 * Nothing was wrong. The managed database was being resized, which takes
 * it down for about 45 seconds, and this process happened to boot inside
 * that window. One refused connection and the whole service failed to
 * start.
 *
 * That was survivable then only because the previous instance was still
 * serving. On a live domain it is downtime, and it is not a rare shape:
 * the host reboots instances for its own reasons, every future plan
 * change is another 45-second outage, and a failover moves the database
 * to a new address that DNS takes a moment to catch up with.
 *
 * So connection failures wait and try again. Ninety seconds by default —
 * twice the outage actually measured, which is the number this is sized
 * against rather than a round guess.
 *
 * What is deliberately NOT retried is everything else. A migration with
 * a syntax error, a schema conflict, a permissions problem: those fail
 * on the first attempt and stay failed, and retrying them buys nothing
 * but ninety seconds of silence in front of the real message. The
 * distinction is the whole point of the code below — "the database is
 * not there yet" is worth waiting for, "the database said no" is not.
 * ------------------------------------------------------------------ */

const RETRYABLE = new Set([
  "ECONNREFUSED", // nothing listening yet — restarting, or not up
  "ENOTFOUND", // DNS has not caught up with a moved instance
  "EAI_AGAIN", // transient resolver failure
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EPIPE",
  "57P03", // Postgres: "the database system is starting up"
  "53300", // Postgres: too many connections, common mid-restart
]);

/* Drizzle wraps the driver's error, and the driver may wrap the socket's,
   so the code that says what actually happened can be a couple of levels
   down. Walk the chain rather than trusting the top. */
function retryableCause(err) {
  for (let e = err, depth = 0; e && depth < 10; e = e.cause, depth += 1) {
    if (e.code && RETRYABLE.has(e.code)) return e.code;
  }
  return null;
}

const ATTEMPTS = Number(process.env.DB_BOOT_ATTEMPTS ?? 18);
const RETRY_MS = Number(process.env.DB_BOOT_RETRY_MS ?? 5000);

/* ENOTFOUND has to stay retryable: a managed database that fails over
   comes back at a new address, and DNS takes a moment to agree. But the
   driver reaches DNS by treating whatever it was handed as a hostname,
   so a connection string that is simply wrong — a stray quote, a half
   pasted value, an unsubstituted placeholder — also arrives here as
   ENOTFOUND, and then spends the full ninety seconds looking like a
   database that is merely slow to appear.

   That was measured, not guessed: DATABASE_URL="totally not a url"
   retried 17 times and took 86 seconds to say anything useful.

   So the shape is checked once, up front. A string that could never
   address a Postgres server is a typo, not an outage, and it should say
   so in the first second. */
function assertUsableUrl() {
  const raw = process.env.DATABASE_URL ?? "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(
      new Error(
        `DATABASE_URL is not a URL.\n\n` +
          `  Got: ${raw.length > 60 ? `${raw.slice(0, 60)}…` : raw}\n\n` +
          `Expected something like postgresql://user:password@host:5432/dbname`
      ),
      { expected: true }
    );
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) {
    throw Object.assign(
      new Error(
        `DATABASE_URL does not address a Postgres server.\n\n` +
          `  protocol: ${url.protocol || "(none)"}\n` +
          `  host:     ${url.hostname || "(none)"}\n\n` +
          `Expected something like postgresql://user:password@host:5432/dbname`
      ),
      { expected: true }
    );
  }
}

async function connectAndMigrate() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      /* Fetched inside the loop on purpose. A pool that failed to
         connect is torn down below, and getDb() builds a fresh one — a
         handle captured before the failure would keep using the dead
         pool. */
      const db = getDb();
      await migrate(db, { migrationsFolder: "./drizzle" });
      return;
    } catch (err) {
      const code = retryableCause(err);
      if (!code || attempt >= ATTEMPTS) throw err;

      await disconnectDb();
      const waited = (attempt * RETRY_MS) / 1000;
      console.warn(
        `[prepare] database not reachable (${code}) — attempt ${attempt}/${ATTEMPTS}, ` +
          `${waited}s so far, retrying in ${RETRY_MS / 1000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

if (!isDbConfigured()) {
  console.log("[prepare] DATABASE_URL is not set — starting in demo mode, nothing to migrate.");
  process.exit(0);
}

/* `expected` marks a failure we anticipated and wrote a sentence for.
   db/client.js uses the same flag for the same reason, so that a
   problem a person can fix reads as one line in the deploy log rather
   than a stack trace with the useful part in the middle. */
try {
  assertUsableUrl();
} catch (err) {
  if (!err.expected) throw err;
  console.error(`\n[prepare] ${err.message}\n`);
  process.exit(1);
}

console.log("[prepare] applying migrations…");
await connectAndMigrate();
console.log("[prepare] schema is up to date");

if (process.env.SEED_ON_BOOT === "1") {
  /* A fresh handle: connectAndMigrate() may have rebuilt the pool. */
  const db = getDb();
  const [row] = await db.execute(sql`select count(*)::int as count from specialists`).then((r) => r.rows ?? r);
  const count = Number(row?.count ?? 0);

  if (count > 0) {
    console.log(`[prepare] ${count} listings already present — not seeding`);
  } else {
    console.log("[prepare] empty database and SEED_ON_BOOT=1 — seeding the demo directory");
    await disconnectDb();
    const seed = spawnSync(process.execPath, ["src/data/seed.js"], { stdio: "inherit" });
    process.exit(seed.status ?? 0);
  }
}

await disconnectDb();
console.log("[prepare] ready");
