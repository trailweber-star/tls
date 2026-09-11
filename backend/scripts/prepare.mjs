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

if (!isDbConfigured()) {
  console.log("[prepare] DATABASE_URL is not set — starting in demo mode, nothing to migrate.");
  process.exit(0);
}

const db = getDb();

console.log("[prepare] applying migrations…");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[prepare] schema is up to date");

if (process.env.SEED_ON_BOOT === "1") {
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
