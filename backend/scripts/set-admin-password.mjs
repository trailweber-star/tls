#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Set (or create) an administrator's password
 *
 *   node scripts/set-admin-password.mjs admin@tls.test
 *
 * WHY THIS EXISTS. The only account this project ever creates is the one
 * seed.js makes, and seed.js runs only against a completely empty
 * specialists table -- prepare.mjs logs "listings already present — not
 * seeding" and skips it. So on any database that has been imported into,
 * there is no supported way to get an administrator in, and no way at
 * all to fix one whose password is unknown. That is how you end up
 * guessing at demo1234 against a live directory.
 *
 * THE PASSWORD IS READ FROM THE TERMINAL, NOT FROM ARGV. Passing it as
 * an argument writes it into shell history and into the process list
 * where any other user on the machine can read it -- which is precisely
 * how the credentials in this project leaked into a chat log in the
 * first place. It is typed at a silent prompt, confirmed, hashed with
 * the application's own hashPassword, and never printed.
 * ------------------------------------------------------------------ */

import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(here, "..");
dotenv.config({ path: path.join(BACKEND, ".env") });

const email = String(process.argv[2] ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/set-admin-password.mjs <email>");
  console.error("The password is asked for at a prompt — do not pass it here.");
  process.exit(1);
}

/* Render's internal hostname resolves only from inside Render, and the
   driver reports it as an unrelated DNS failure. Same guard as the
   importers. */
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

/** A prompt that does not echo, and does not leave the password on screen. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let shown = false;
    rl._writeToOutput = (s) => {
      if (!shown) { process.stdout.write(question); shown = true; }
      else if (s.includes("\n")) process.stdout.write("\n");
    };
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

const { getDb, disconnectDb } = await import("../src/db/client.js");
const t = await import("../src/db/schema.js");
const { hashPassword } = await import("../src/lib/auth.js");
const { eq } = await import("drizzle-orm");
const { newId } = t; // newId lives in db/schema.js alongside the tables

const db = getDb();
const existing = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1);
const user = existing[0] ?? null;

console.log();
console.log(user ? `${email} exists — role "${user.role}".` : `${email} does not exist — it will be created as an admin.`);
if (user && user.role !== "admin") {
  console.log(`It will also be promoted from "${user.role}" to "admin".`);
}
console.log();

const first = await askHidden("New password (not shown): ");
const again = await askHidden("Confirm it: ");
console.log();

if (first !== again) {
  console.error("Those do not match. Nothing was changed.");
  await disconnectDb();
  process.exit(1);
}
if (first.length < 12) {
  console.error("Use at least 12 characters. Nothing was changed.");
  await disconnectDb();
  process.exit(1);
}

const passwordHash = hashPassword(first);

if (user) {
  await db.update(t.users).set({ passwordHash, role: "admin" }).where(eq(t.users.id, user.id));
  console.log(`✓ password set for ${email} (role: admin)`);
} else {
  await db.insert(t.users).values({
    id: newId("usr"),
    email,
    passwordHash,
    fullName: process.argv[3] ?? "TLS Admin",
    role: "admin",
  });
  console.log(`✓ created ${email} as an admin`);
}

console.log("  The password was not written to this terminal, to shell history, or to any file.");
await disconnectDb();
