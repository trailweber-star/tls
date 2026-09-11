/* ------------------------------------------------------------------ *
 * Database connection
 *
 * One pool, one Drizzle instance, created lazily so the server still
 * boots with no DATABASE_URL set. That matters: demo mode is not a
 * fallback for a broken connection, it is a deliberate mode the whole
 * application supports (see data/mock.js), and every controller branches
 * on isDbConfigured() exactly as it used to branch on Mongo.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

let pool = null;
let database = null;

/** True when a real Postgres is configured. */
export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * The Drizzle instance. Throws if called without DATABASE_URL — every
 * caller is behind an isDbConfigured() check, so reaching here without
 * one is a bug worth surfacing loudly rather than silently degrading.
 */
export function getDb() {
  if (!isDbConfigured()) {
    throw new Error("getDb() called with no DATABASE_URL — check isDbConfigured() first");
  }
  if (!database) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres (Neon, Supabase, RDS) terminates TLS with its
      // own certificate chain. Verification is on by default; set
      // DATABASE_SSL=no-verify only if your provider needs it.
      ssl: sslOption(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err) => {
      // An idle client erroring is not fatal — the pool replaces it.
      console.error("[db] idle client error:", err.message);
    });
    database = drizzle(pool, { schema });
  }
  return database;
}

function sslOption() {
  const url = process.env.DATABASE_URL ?? "";
  const mode = process.env.DATABASE_SSL;
  if (mode === "off" || url.includes("sslmode=disable")) return false;
  if (mode === "no-verify" || url.includes("sslmode=no-verify")) return { rejectUnauthorized: false };
  // Local development against a socket or 127.0.0.1 does not use TLS.
  if (/@(localhost|127\.0\.0\.1)/.test(url)) return false;
  return undefined; // let pg read sslmode from the connection string
}

/** Verify the connection at boot so a bad URL fails fast and loudly. */
export async function connectDb() {
  if (!isDbConfigured()) return false;
  const db = getDb();
  await db.execute("select 1");
  await assertSchemaIsCurrent(db);
  return true;
}

/* ------------------------------------------------------------------ *
 * Is the database as new as the code?
 *
 * When it is not, nothing announces it. The server starts perfectly,
 * reports "connected to Postgres", and then every query that touches a
 * column added since the last migration fails — so the site answers 500
 * to everything and the browser says "Can't reach the server", which is
 * the one thing that is definitely not wrong.
 *
 * That happened, and it cost an evening. Migrations are counted at boot
 * now: if the folder holds more than the database has applied, the
 * server says so in a sentence naming the command that fixes it, and
 * refuses to start rather than serving a site that cannot answer.
 *
 * Deliberately a hard stop rather than a warning. A server that starts
 * and 500s is worse than one that does not start: the second tells you
 * what is wrong.
 * ------------------------------------------------------------------ */
async function assertSchemaIsCurrent(db) {
  const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
  let expected = 0;
  try {
    expected = JSON.parse(fs.readFileSync(journalPath, "utf8")).entries?.length ?? 0;
  } catch {
    return; // No journal to compare against — nothing to assert.
  }
  if (expected === 0) return;

  let applied = 0;
  try {
    const res = await db.execute(
      "select count(*)::int as n from drizzle.__drizzle_migrations"
    );
    applied = Number(res.rows?.[0]?.n ?? 0);
  } catch {
    applied = 0; // The ledger does not exist yet: nothing has been applied.
  }

  if (applied >= expected) return;

  const behind = expected - applied;
  const error = new Error(
    `This database is ${behind} migration${behind === 1 ? "" : "s"} behind the code ` +
      `(${applied} applied, ${expected} in ./drizzle).\n\n` +
      `  Run:  npm run db:migrate\n\n` +
      `Starting anyway would leave every page answering 500, because the ` +
      `queries reference columns this database does not have yet.`
  );
  // Marks it as a failure we anticipated, so server.js prints the
  // sentence rather than a stack trace over the top of it.
  error.expected = true;
  throw error;
}

export async function disconnectDb() {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

export { schema };
