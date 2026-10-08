import "dotenv/config";
import pg from "pg";

/* Read only. Where do the stored photos live, and how many listings
 * have none?   node scripts/photo-host-report.mjs               */
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const total = await client.query(`select count(*)::int n,
  count(*) filter (where coalesce(photo_url,'')='')::int none from specialists`);
console.log("specialists:", total.rows[0]);
const hosts = await client.query(`
  select coalesce(substring(photo_url from '^https?://([^/]+)'),'(none)') as host, count(*)::int n
  from specialists group by 1 order by n desc limit 15`);
console.table(hosts.rows);
const sample = await client.query(`
  select slug, photo_url from specialists
  where slug in ('mr-luke-abnett','mrs-marsha-evans','mr-michael-kotrba','mr-gavin-brigstocke')`);
console.table(sample.rows);
await client.end();
