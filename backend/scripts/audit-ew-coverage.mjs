#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function subtreeCount(rootSlug) {
  const { rows } = await client.query(
    `with recursive subtree as (
       select id, slug, name from specialties where slug = $1
       union all
       select s.id, s.slug, s.name from specialties s
       join subtree st on s.parent_id = st.id
     )
     select count(distinct ss.specialist_id)::int as specialists,
            count(distinct subtree.id)::int as nodes
     from subtree
     left join specialist_specialties ss on ss.specialty_id = subtree.id`,
    [rootSlug]
  );
  return rows[0];
}

for (const slug of ["expert-witness", "expert-witness-medicolegal", "expert-witness-medical-specialty"]) {
  const { specialists, nodes } = await subtreeCount(slug);
  console.log(`${slug}: ${nodes} taxonomy node(s), ${specialists} distinct specialist(s) tagged anywhere in the subtree`);
}

const { rows: orphans } = await client.query(`
  select full_name, slug
  from specialists
  where medico_legal_experience is not null
  and not exists (
    select 1 from specialist_specialties ss
    join specialties sp on sp.id = ss.specialty_id
    where ss.specialist_id = specialists.id
    and sp.slug like 'ew-%'
  )
  limit 10
`);
console.log(`\nExpert Witness profiles with CV data but NO Medical Specialty leaf tag (sample of up to 10):`);
console.log(orphans.length ? orphans : "  none");

await client.end();
