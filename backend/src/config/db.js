/* ------------------------------------------------------------------ *
 * Kept as the single import point the rest of the application uses to
 * ask "is there a real database?", so no controller has to know which
 * driver is underneath. The connection itself lives in src/db/client.js.
 * ------------------------------------------------------------------ */

export { isDbConfigured, getDb, connectDb as connectDB, disconnectDb } from "../db/client.js";
