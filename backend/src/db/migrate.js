/* Applies every .sql file in ./drizzle, in order, exactly once. */
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, disconnectDb, isDbConfigured } from "./client.js";

if (!isDbConfigured()) {
  console.error("[migrate] DATABASE_URL is not set — nothing to migrate.");
  process.exit(1);
}

await migrate(getDb(), { migrationsFolder: "./drizzle" });
console.log("[migrate] schema is up to date");
await disconnectDb();
