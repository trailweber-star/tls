/* ------------------------------------------------------------------ *
 * The search tabs, checked against the taxonomy
 *
 *   node scripts/tabs-test.mjs [baseUrl]
 *
 * The panel used to scope only its last column to the tab, so standing
 * on Doctor you were offered dentists, physiotherapy treatments and —
 * through the strip — care homes. Every assertion here exists because
 * that class of leak is invisible by eye: the rows look plausible, and
 * only a check against the branch each row belongs to catches one that
 * came from the wrong directory.
 *
 * Run against a server in either mode. Demo data is enough: the
 * scoping is computed from the taxonomy, not from the row count.
 * ------------------------------------------------------------------ */

import { SEARCH_TABS, branchSlugsFor, rootSlugsFor, tabFor } from "../src/lib/searchTabs.js";
import { specialties as mockSpecialties } from "../src/data/mock.js";

const BASE = process.argv[2] ?? "http://127.0.0.1:4000/api";

let checks = 0;
const problems = [];
function ok(label, condition, detail = "") {
  checks += 1;
  if (!condition) problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

/* The taxonomy the server is serving, so the checks are not asserted
   against a second copy of the tree that could drift from it. */
const specialties = await get("/taxonomy/specialties").catch(() => null);
const tree = Array.isArray(specialties) ? specialties : mockSpecialties;
const nameBySlug = new Map(tree.map((s) => [s.slug, s.name]));
const slugByName = new Map(tree.map((s) => [s.name.toLowerCase(), s.slug]));

console.log(`\nsearch tabs → ${BASE}\n`);

for (const tab of SEARCH_TABS) {
  console.log(`— ${tab.label} (${tab.key})`);

  const panel = await get(`/search/panel?type=${tab.key}`);
  ok(`${tab.key}: the server agrees which tab this is`, panel.type === tab.key, panel.type);
  ok(`${tab.key}: placeholder is the tab's own`, panel.placeholder === tab.placeholder, panel.placeholder);

  if (tab.kind === "facility") {
    /* A places tab is places and nothing else. The clinical columns are
       not "empty" here, they are absent — a hospital search offering
       "Knee Arthroscopy" leads away from what was asked for. */
    ok(`${tab.key}: no specialties column`, panel.columns.specialties === null);
    ok(`${tab.key}: no procedures column`, panel.columns.procedures === null);
    ok(`${tab.key}: advertises its facility type`, panel.facilityType === tab.facilityType, String(panel.facilityType));

    const rows = [...panel.columns.people.primary, ...panel.columns.people.more];
    ok(`${tab.key}: every row is a place`, rows.every((r) => r.kind === "facility"), rows.map((r) => r.kind).join(","));
    const wrongType = rows.filter((r) => r.facilityType !== tab.facilityType);
    ok(
      `${tab.key}: no place of another type`,
      wrongType.length === 0,
      wrongType.map((r) => `${r.label} is ${r.facilityType}`).join(" | ")
    );
    const offSite = rows.filter((r) => !r.href.startsWith("/facilities/"));
    ok(`${tab.key}: every row opens a place`, offSite.length === 0, offSite.map((r) => r.href).join(" | "));

    // The strip is derived from listings of THIS type, so it cannot
    // offer "Care Homes" to somebody standing on Pharmacies.
    ok(`${tab.key}: category strip is non-empty`, (panel.topCategories ?? []).length > 0);
    const strayStrip = (panel.topCategories ?? []).filter((c) => !c.href.includes(`type=${tab.facilityType}`));
    ok(`${tab.key}: strip stays in this type`, strayStrip.length === 0, strayStrip.map((c) => c.label).join(", "));
    continue;
  }

  /* ------------------------------------------------ a people tab */
  const branch = branchSlugsFor(tab.key, tree);
  const roots = rootSlugsFor(tab.key, tree);
  ok(
    `${tab.key}: covers ${[...roots].map((r) => nameBySlug.get(r) ?? r).join(", ") || "nothing"}`,
    roots.size > 0
  );
  ok(`${tab.key}: advertises its group`, panel.group === tab.key, String(panel.group));
  ok(`${tab.key}: has a specialties column`, Boolean(panel.columns.specialties));
  ok(`${tab.key}: has a procedures column`, Boolean(panel.columns.procedures));

  /* Column 1: every specialty offered must sit inside this tab's
     branches. Checked by the slug in the row's own href, which is what
     the click actually searches — not by the label, which could match
     by coincidence. */
  const specRows = [
    ...panel.columns.specialties.primary,
    ...panel.columns.specialties.more,
  ];
  const straySpecialty = specRows.filter((r) => {
    const slug = new URL(r.href, "http://x").searchParams.get("specialty") ??
      new URL(r.href, "http://x").searchParams.get("subspecialty");
    return slug ? !branch.has(slug) : true;
  });
  ok(
    `${tab.key}: no specialty from another directory`,
    straySpecialty.length === 0,
    straySpecialty.slice(0, 4).map((r) => `${r.label} (${r.href})`).join(" | ")
  );
  ok(`${tab.key}: the specialties column is not empty`, specRows.length > 0);

  /* Column 2: a procedure or condition is offered only when somebody on
     THIS tab performs or treats it. The row carries its parent
     specialty as the sublabel, which is what is checked. */
  const procRows = [...panel.columns.procedures.primary, ...panel.columns.procedures.more];
  const strayProc = procRows.filter((r) => {
    if (!r.sublabel) return false;
    const slug = slugByName.get(r.sublabel.toLowerCase());
    return slug ? !branch.has(slug) : false;
  });
  ok(
    `${tab.key}: no procedure from another directory`,
    strayProc.length === 0,
    strayProc.slice(0, 4).map((r) => `${r.label} under ${r.sublabel}`).join(" | ")
  );

  /* Column 3: the people. Their listed field must be one of this tab's
     roots — this is the check that fails loudest if the pool is ever
     un-scoped again. */
  const people = [...panel.columns.people.primary, ...panel.columns.people.more];
  ok(`${tab.key}: every row is a person`, people.every((p) => p.kind === "specialist"));
  ok(`${tab.key}: every row opens a profile`, people.every((p) => p.href.startsWith("/specialists/")));
  const strayPerson = people.filter((p) => {
    if (!p.sublabel) return false;
    const slug = slugByName.get(p.sublabel.toLowerCase());
    return slug ? !roots.has(slug) : false;
  });
  ok(
    `${tab.key}: nobody from another directory`,
    strayPerson.length === 0,
    strayPerson.slice(0, 4).map((p) => `${p.label} is ${p.sublabel}`).join(" | ")
  );

  /* And the results page behind the tab agrees with the panel. This is
     the pair that used to disagree: the panel scoped its people, the
     search did not, so pressing Enter widened the search silently. */
  const search = await get(`/specialists/search?group=${tab.key}&pageSize=50`);
  const wrongField = (search.results ?? []).filter((s) => {
    const slugs = (s.specialties ?? []).map((x) => x.slug);
    return slugs.length > 0 && !slugs.some((slug) => branch.has(slug));
  });
  ok(
    `${tab.key}: /specialists/search?group= returns only this directory`,
    wrongField.length === 0,
    wrongField.slice(0, 4).map((s) => s.fullName).join(", ")
  );
  ok(`${tab.key}: and returns somebody`, (search.total ?? 0) > 0, `total ${search.total}`);
}

/* ------------------------------------------------------- the seams */
console.log("\n— compatibility and edges");

for (const [alias, expected] of [
  ["doctor", "specialist-doctors"],
  ["dentist", "dentists"],
  ["practice", "clinics"],
  ["care-home", "care-homes"],
  ["pharmacy", "pharmacies"],
  ["hospital", "hospitals"],
]) {
  const panel = await get(`/search/panel?type=${alias}`);
  ok(`the old "${alias}" key still lands on ${expected}`, panel.type === expected, panel.type);
  ok(`"${alias}" resolves the same way in code`, tabFor(alias).key === expected);
}

const junk = await get("/search/panel?type=not-a-tab");
ok("an unknown tab falls back rather than failing", junk.type === "specialist-doctors", junk.type);

const stale = await get("/specialists/search?group=not-a-tab&pageSize=5");
ok("an unknown group widens the search rather than emptying it", (stale.total ?? 0) > 0, `total ${stale.total}`);

/* A typed query stays inside the tab. "Implant" is a dental treatment;
   asking for it on the doctors tab must not produce the dentist who
   does it. */
const dentalOnDoctors = await get("/search/panel?type=specialist-doctors&q=implant");
const dentalRows = [
  ...dentalOnDoctors.columns.specialties.primary,
  ...dentalOnDoctors.columns.specialties.more,
  ...dentalOnDoctors.columns.procedures.primary,
  ...dentalOnDoctors.columns.procedures.more,
].filter((r) => /dent/i.test(r.sublabel ?? ""));
ok(
  'typing "implant" on Specialist Doctors offers nothing dental',
  dentalRows.length === 0,
  dentalRows.map((r) => `${r.label} under ${r.sublabel}`).join(" | ")
);

const physioOnDentists = await get("/search/panel?type=dentists&q=knee");
const kneeRows = [
  ...physioOnDentists.columns.specialties.primary,
  ...physioOnDentists.columns.specialties.more,
  ...physioOnDentists.columns.procedures.primary,
  ...physioOnDentists.columns.procedures.more,
];
ok('typing "knee" on Dentists offers nothing at all', kneeRows.length === 0, kneeRows.map((r) => r.label).join(" | "));

console.log(`\n${checks - problems.length}/${checks} checks passed`);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
