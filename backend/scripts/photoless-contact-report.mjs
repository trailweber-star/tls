import "dotenv/config";
import pg from "pg";

/* Read only. How reachable are the listings that still have no photo?
 *   node scripts/photoless-contact-report.mjs                */
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
  select count(*)::int as photoless,
         count(*) filter (where coalesce(contact_email,'') like '%@%')::int as with_email,
         count(*) filter (where coalesce(website_url,'') <> '')::int as with_website,
         count(*) filter (where coalesce(contact_phone,'') <> '')::int as with_phone,
         count(*) filter (where claimed)::int as claimed
  from specialists
  where verification_status in ('verified','unverified')
    and coalesce(photo_url,'') = ''`);
console.log(rows[0]);
await client.end();
