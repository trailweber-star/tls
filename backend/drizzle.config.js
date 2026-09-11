import "dotenv/config";

/** Migrations are plain .sql files under ./drizzle — readable, reviewable,
 *  and applied by `npm run db:migrate`. */
export default {
  schema: "./src/db/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  casing: "snake_case",
};
