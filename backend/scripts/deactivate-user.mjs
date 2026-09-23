#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Deactivate an account (lock it out of sign-in) without deleting it.
 *
 *   node scripts/deactivate-user.mjs admin@tls.test
 *
 * WHY DEACTIVATE, NOT DELETE. Nothing in this codebase hard-deletes a
 * user row — audit log entries, sessions, reviews and articles can all
 * carry a user id as their author, and deleting the row would either
 * fail on the foreign key or silently orphan that history. Setting
 * active=false is the supported way to shut an account out: the same
 * flag the admin Members screen's "Deactivate account" button sets,
 * and reversible with user:reactivate if it's ever needed back.
 *
 * WHY THIS SCRIPT, NOT THE ADMIN UI. members.controller.js refuses to
 * deactivate any account with role "admin" through the Members screen
 * on purpose ("An administrator locking out another administrator is a
 * thing to do deliberately, one at a time.") — this script is that
 * deliberate, one-at-a-time door.
 *
 * SAFETY CHECK. Refuses if this is the last active admin — that would
 * lock everyone out with no way back in short of another DB script.
 * ------------------------------------------------------------------ */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(here, "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const email = String(process.argv[2] ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/deactivate-user.mjs <email>");
  process.exit(1);
}

// Same Render internal-hostname guard as set-admin-password.mjs.
{
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try { host = new URL(url).hostname; } catch { host = ""; }
  if (/^dpg-[a-z0-9]+-a$/i.test(host)) {
    console.error(
      `DATABASE_URL points at ${host}, which is Render's INTERNAL hostname and\n` +
      `resolves only from inside Render. Use the External Database URL instead\n` +
      `(it ends .frankfurt-postgres.render.com).`
    );
    process.exit(1);
  }
  if (!url) {
    console.error("DATABASE_URL is not set, so there is no database to write to.");
    process.exit(1);
  }
}

const { getDb, disconnectDb } = await import("../src/db/client.js");
const t = await import("../src/db/schema.js");
const { eq, and } = await import("drizzle-orm");

const db = getDb();
const existing = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1);
const user = existing[0] ?? null;

if (!user) {
  console.log(`${email}: no such account. Nothing to do.`);
  await disconnectDb();
  process.exit(0);
}

if (user.active === false) {
  console.log(`${email}: already deactivated (role "${user.role}"). Nothing to do.`);
  await disconnectDb();
  process.exit(0);
}

if (user.role === "admin") {
  const activeAdmins = await db
    .select()
    .from(t.users)
    .where(and(eq(t.users.role, "admin"), eq(t.users.active, true)));
  if (activeAdmins.length <= 1) {
    console.error(
      `${email} is the only active admin. Deactivating it would lock everyone out.\n` +
      `Set a real password on another admin first, confirm you can sign in as them, then re-run this.`
    );
    await disconnectDb();
    process.exit(1);
  }
}

await db.update(t.users).set({ active: false }).where(eq(t.users.id, user.id));
console.log(`✓ ${email} deactivated (role "${user.role}") — it can no longer sign in.`);
await disconnectDb();
