import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

/* Read only. Writes data/photo-hunt/worklist-now.csv with every public
 * listing that still has no photo, so a search pass works from the
 * current database and not an old export.
 *   node scripts/export-photoless-worklist.mjs               */
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
  select s.slug, s.full_name, coalesce(c.name,'') as town,
         coalesce(sp.name,'') as category, coalesce(s.website_url,'') as website
  from specialists s
  left join specialties sp on sp.id = s.primary_specialty_id
  left join clinic_locations l on l.owned_by_specialist_id = s.id
  left join cities c on c.id = l.city_id
  where s.verification_status in ('verified','unverified')
    and coalesce(s.photo_url,'') = ''
  group by s.slug, s.full_name, c.name, sp.name, s.website_url
  order by s.full_name`);
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const out = ["slug,name,town,category,website", ...rows.map((r) => [r.slug, r.full_name, r.town, r.category, r.website].map(esc).join(","))];
fs.mkdirSync("data/photo-hunt", { recursive: true });
fs.writeFileSync("data/photo-hunt/worklist-now.csv", out.join("\n") + "\n");
console.log(`Wrote ${rows.length} rows to data/photo-hunt/worklist-now.csv`);
await client.end();
