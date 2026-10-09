import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, disconnectDb } from "./client.js";

const db = getDb();

const rows = await db.execute(sql`
  SELECT s.full_name, s.title, s.source_url
  FROM specialists s
  JOIN specialist_specialties ss ON ss.specialist_id = s.id
  JOIN specialties sp ON sp.id = ss.specialty_id
  WHERE sp.slug = 'personal-injury'
  ORDER BY random()
  LIMIT 20
`);
console.table(rows.rows ?? rows);

await disconnectDb();
