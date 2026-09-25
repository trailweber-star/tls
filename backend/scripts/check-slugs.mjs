import "dotenv/config";
import { getDb, disconnectDb } from "../src/db/client.js";
import * as t from "../src/db/schema.js";
import { inArray } from "drizzle-orm";

const db = getDb();
const rows = await db
  .select({ slug: t.specialties.slug, id: t.specialties.id })
  .from(t.specialties)
  .where(inArray(t.specialties.slug, ["criminal-injuries-compensation", "fitness-to-practise-regulatory"]));
console.log(rows);
await disconnectDb();
