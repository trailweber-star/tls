/* ------------------------------------------------------------------ *
 * Reset — rebuild the schema from scratch, then re-seed
 *
 * The data model changed shape (places gained thirty-odd columns, a team
 * join table appeared, reviews gained moderation), and Drizzle's own
 * `generate` cannot produce that diff without asking a human whether a
 * renamed column is a rename or a drop-and-add. On a database that only
 * holds seed data the answer does not matter: it is faster and safer to
 * rebuild.
 *
 * It refuses to run if anybody has actually claimed a listing, because
 * "reset the demo database" and "delete every specialist who ever
 * registered" are one keystroke apart. Pass --force only when you are
 * certain.
 *
 *   npm run db:reset
 * ------------------------------------------------------------------ */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDB, disconnectDb, getDb, isDbConfigured } from "../config/db.js";

const FORCE = process.argv.includes("--force");

if (!isDbConfigured()) {
  console.error("[reset] DATABASE_URL is not set — nothing to reset. Check backend/.env.");
  process.exit(1);
}

await connectDB();
const db = getDb();

// The guard is best-effort by design: on a database that has no
// `specialists` table yet there is nothing to protect, and that is the
// normal first-run case rather than an error.
/**
 * Which claimed listings represent a real person who signed up.
 *
 * The seed creates one demo specialist account of its own
 * (j.whitfield@example.com) and marks its listing claimed, so a
 * pristine, freshly seeded database always contains exactly one claimed
 * profile. Counting that as a real sign-up made the guard cry wolf on
 * its own output: re-seeding a demo database was impossible without
 * --force, which trains you to reach for --force by reflex — the one
 * habit a guard like this exists to prevent.
 *
 * So the seeded demo accounts are excluded by email, and anything else
 * claimed is named in the refusal rather than merely counted, so the
 * decision to erase is made with the list in front of you.
 */
const SEEDED_DEMO_EMAILS = ["j.whitfield@example.com"];

async function realSignups(db) {
  const result = await db.execute(sql`
    select s.slug, s.full_name, u.email
    from specialists s
    left join users u on u.id = s.user_id
    where s.claimed = true
  `);
  const rows = result.rows ?? result;
  return rows.filter((r) => !SEEDED_DEMO_EMAILS.includes(String(r.email ?? "").toLowerCase()));
}

try {
  const signups = await realSignups(db);
  if (signups.length > 0 && !FORCE) {
    console.error(
      `[reset] refusing to run: ${signups.length} specialist(s) have claimed a listing in this database:\n` +
        signups.map((r) => `         · ${r.full_name} <${r.email ?? "no account"}> (${r.slug})`).join("\n") +
        `\n        Re-run with --force if you are certain you want to erase them.`
    );
    await disconnectDb();
    process.exit(1);
  }
} catch {
  console.log("[reset] no existing specialists table — treating this as a first run.");
}

console.log("[reset] dropping and recreating the schema...");
// Two schemas, not one. The tables and enum types live in `public`, but
// Drizzle keeps its migration ledger in a separate `drizzle` schema —
// so dropping only `public` would leave the ledger claiming the init
// migration had already run, and `migrate` would create nothing at all.
await db.execute(sql`drop schema if exists drizzle cascade`);
await db.execute(sql`drop schema if exists public cascade`);
await db.execute(sql`create schema public`);

console.log("[reset] applying migrations...");
await migrate(db, { migrationsFolder: "./drizzle" });

await disconnectDb();
console.log("[reset] schema rebuilt. Now run:  npm run seed");
