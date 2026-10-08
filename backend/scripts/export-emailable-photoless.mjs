import "dotenv/config";
import pg from "pg";

/* Lists listings with no photo that have a usable contact email, as CSV
 * on screen. Read only.
 *   node scripts/export-emailable-photoless.mjs > emailable.csv
 * Skips throwaway-looking domains and anyone who has already claimed. */
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(`
  select full_name, slug, contact_email
  from specialists
  where verification_status in ('verified','unverified')
    and coalesce(photo_url,'') = ''
    and coalesce(contact_email,'') like '%@%'
    and contact_email !~* '(example\\.|noreply|no-reply|test@)'
  order by full_name`);
console.log("name,email,profile");
for (const r of rows) {
  console.log(`"${r.full_name.replace(/"/g, "'")}",${r.contact_email},https://toplocalspecialists.com/specialists/${r.slug}`);
}
await client.end();
