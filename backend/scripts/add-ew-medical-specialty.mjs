#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Adds a "Medical Specialty" branch under Expert Witness, alongside
 * the existing "Medicolegal" branch (Personal Injury, Clinical
 * Negligence, Criminal Injuries Compensation, ...).
 *
 * Medicolegal is organised by REPORT TYPE (what kind of case). This
 * new branch is organised by CLINICAL SPECIALTY (Breast Surgery,
 * Cardiology, Neurosurgery, ...) -- the taxonomy McCollum Consultants
 * and similar directories use, and the one their own
 * /area-of-expertise/<slug>/ category pages are keyed on. The two
 * branches are independent and a specialist gets tagged under both:
 * a breast surgeon doing personal-injury reports carries both
 * "Personal Injury" (Medicolegal) and "Breast Surgery" (Medical
 * Specialty).
 *
 * SHAPE, AND WHY IT'S FLAT. McCollum's own site groups these 88
 * categories under 5 headings (Surgical / Medical / Paediatrics &
 * Neonatology / Radiology / Nursing Expert Witnesses). The first
 * version of this script mirrored that with a 3-deep tree (Medical
 * Specialty -> 5 groups -> 88 leaves) -- but the live search page's
 * filter is two levels deep off "Expert Witness" (Sub-specialty =
 * children of Expert Witness; Type of report = children of whichever
 * Sub-specialty is checked, which is where Medicolegal's own 8 leaves
 * show up today). A 3-deep branch would put all 88 real specialties
 * one level below where that filter can reach -- checking "Medical
 * Specialty" as the sub-specialty would surface only the 5 group
 * names, and Breast Surgery et al would need a filter tier that
 * doesn't exist yet. So this branch is FLAT to match Medicolegal's own
 * shape exactly: Medical Specialty -> 88 leaves directly, no group
 * layer. McCollum's 5 headings aren't represented anywhere in this
 * taxonomy -- they only organised the source, and one flat "Type of
 * report"-equivalent list is what actually surfaces on the site.
 *
 * Structure added (89 new taxonomy rows: 1 branch + 88 leaves):
 *
 *   Expert Witness
 *     Medical Specialty                expert-witness-medical-specialty
 *       Anaesthesia                    ew-anaesthesia
 *       Breast Surgery                 ew-breast-surgery
 *       ... (88 leaves total, see full list in the script body)
 *
 * Every leaf slug is prefixed "ew-" deliberately. Medicolegal's own
 * leaves (personal-injury, family-law-reports, ...) aren't prefixed
 * because those are report-type words that don't collide with
 * anything else in a 700+ node clinical taxonomy. Clinical-specialty
 * words very much can -- "Cardiology", "Dermatology", "Urology" are
 * exactly the kind of leaf name that might already exist somewhere
 * under the general treatment tree. sync-taxonomy.mjs matches
 * purely by slug and RENAMES whatever it finds at a matching slug in
 * place, so an accidental collision wouldn't fail loudly -- it would
 * silently relabel an unrelated node. The "ew-" prefix rules that out
 * regardless of what's live in production right now, and this script
 * also refuses outright (see below) if it finds a collision anyway.
 *
 * Two names appear twice in McCollum's own grouping (Ophthalmology
 * under both their Surgical and Medical headings; Paediatric Radiology
 * under both their Paediatrics and Radiology headings) -- each gets
 * ONE leaf here, since a flat specialties table needs one slug per
 * leaf. A specialist found on either of McCollum's source pages tags
 * to the same single leaf.
 *
 * This script only edits the local JSON file -- no DATABASE_URL, no
 * network. It's the file sync-taxonomy.mjs already reads to bring a
 * live database up to date, so the flow is:
 *
 *   node scripts/add-ew-medical-specialty.mjs           # edit the file
 *   git diff backend/src/data/taxonomy/specialty-tree.json   # review it
 *   DATABASE_URL="<real prod url>" node scripts/sync-taxonomy.mjs --write
 *
 * Safe to re-run -- if the branch is already present (by slug) it
 * reports that and makes no changes.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.join(HERE, "..", "src", "data", "taxonomy", "specialty-tree.json"),
  path.join(process.cwd(), "backend", "src", "data", "taxonomy", "specialty-tree.json"),
  path.join(process.cwd(), "src", "data", "taxonomy", "specialty-tree.json"),
];
const TREE_PATH = CANDIDATES.find((p) => fs.existsSync(p));

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

if (!TREE_PATH) {
  console.error(`${c.bad}Couldn't find specialty-tree.json. Run this from backend/scripts/ in the tls-mern repo, or from the repo root.${c.off}`);
  process.exit(1);
}

const raw = fs.readFileSync(TREE_PATH, "utf8");
const tree = JSON.parse(raw);

// name, slug, [mccollum heading -- provenance only, not written to the tree]
const LEAVES = [
  ["Anaesthesia", "ew-anaesthesia", "Surgical"],
  ["Breast Surgery", "ew-breast-surgery", "Surgical"],
  ["Cardiothoracic Surgery", "ew-cardiothoracic-surgery", "Surgical"],
  ["Colorectal (Lower GI) Surgery", "ew-colorectal-surgery", "Surgical"],
  ["Endocrine Surgery", "ew-endocrine-surgery", "Surgical"],
  ["Dental Surgery", "ew-dental-surgery", "Surgical"],
  ["Ear, Nose & Throat (ENT) Surgery", "ew-ear-nose-and-throat-surgery", "Surgical"],
  ["Foot & Ankle Surgery", "ew-foot-and-ankle-surgery", "Surgical"],
  ["Endovascular Surgery", "ew-endovascular-surgery", "Surgical"],
  ["General Surgery", "ew-general-surgery", "Surgical"],
  ["Hepato-Pancreato-Biliary (HPB) Surgery", "ew-hepato-pancreato-biliary-surgery", "Surgical"],
  ["Neurosurgery", "ew-neurosurgery", "Surgical"],
  ["Oral & Maxillofacial Surgery", "ew-oral-and-maxillofacial-surgery", "Surgical"],
  ["Ophthalmology", "ew-ophthalmology", "Surgical"],
  ["Plastic Surgery", "ew-plastic-surgery", "Surgical"],
  ["Transplant Surgery", "ew-transplant-surgery", "Surgical"],
  ["Trauma & Orthopaedic Surgery", "ew-trauma-and-orthopaedic-surgery", "Surgical"],
  ["Upper GI Surgery", "ew-upper-gi-surgery", "Surgical"],
  ["Urology", "ew-urology", "Surgical"],
  ["Vascular Surgery", "ew-vascular-surgery", "Surgical"],

  ["Acute Medicine", "ew-acute-medicine", "Medical"],
  ["Allergy", "ew-allergy", "Medical"],
  ["Cardiology", "ew-cardiology", "Medical"],
  ["Dermatology", "ew-dermatology", "Medical"],
  ["Emergency Medicine", "ew-emergency-medicine", "Medical"],
  ["Endocrinology & Diabetes Medicine", "ew-endocrinology-and-diabetes-medicine", "Medical"],
  ["Gastroenterology", "ew-gastroenterology", "Medical"],
  ["Geriatric Medicine", "ew-geriatric-medicine", "Medical"],
  ["General Practice (GP)", "ew-general-practice", "Medical"],
  ["Haematology", "ew-haematology", "Medical"],
  ["Hepatology", "ew-hepatology", "Medical"],
  ["Intensive Care Medicine", "ew-intensive-care-medicine", "Medical"],
  ["Medical Statistics", "ew-medical-statistics", "Medical"],
  ["Nephrology", "ew-nephrology", "Medical"],
  ["Neurology", "ew-neurology", "Medical"],
  ["Neurorehabilitation", "ew-neurorehabilitation", "Medical"],
  ["Oncology", "ew-oncology", "Medical"],
  ["Palliative Care / End of Life Medicine", "ew-palliative-care-end-of-life-medicine", "Medical"],
  ["Rehabilitation", "ew-rehabilitation", "Medical"],
  ["Respiratory Medicine", "ew-respiratory-medicine", "Medical"],
  ["Rheumatology", "ew-rheumatology", "Medical"],
  ["Stroke Medicine", "ew-stroke-medicine", "Medical"],

  ["Neonatology", "ew-neonatology", "Paediatrics & Neonatology"],
  ["Paediatric Allergy", "ew-paediatric-allergy", "Paediatrics & Neonatology"],
  ["Paediatric Anaesthesia", "ew-paediatric-anaesthesia", "Paediatrics & Neonatology"],
  ["Paediatric Burns", "ew-paediatric-burns", "Paediatrics & Neonatology"],
  ["Paediatric Cardiology", "ew-paediatric-cardiology", "Paediatrics & Neonatology"],
  ["Paediatric Critical Care", "ew-paediatric-critical-care", "Paediatrics & Neonatology"],
  ["Paediatric Emergency Medicine", "ew-paediatric-emergency-medicine", "Paediatrics & Neonatology"],
  ["Paediatric ENT", "ew-paediatric-ent", "Paediatrics & Neonatology"],
  ["Paediatric General Surgery", "ew-paediatric-general-surgery", "Paediatrics & Neonatology"],
  ["Paediatric Ophthalmology", "ew-paediatric-ophthalmology", "Paediatrics & Neonatology"],
  ["Paediatric Orthopaedics", "ew-paediatric-orthopaedics", "Paediatrics & Neonatology"],
  ["Paediatric Radiology", "ew-paediatric-radiology", "Paediatrics & Neonatology"],
  ["Paediatric Respiratory Medicine", "ew-paediatric-respiratory-medicine", "Paediatrics & Neonatology"],
  ["Paediatric Spinal Surgery", "ew-paediatric-spinal-surgery", "Paediatrics & Neonatology"],
  ["Paediatric Thoracic Surgery", "ew-paediatric-thoracic-surgery", "Paediatrics & Neonatology"],
  ["Paediatric", "ew-paediatric", "Paediatrics & Neonatology"],

  ["Breast Radiology", "ew-breast-radiology", "Radiology"],
  ["Gastrointestinal (GI) & Abdominal Radiology", "ew-gastrointestinal-and-abdominal-radiology", "Radiology"],
  ["Cardiothoracic Radiology", "ew-cardiothoracic-radiology", "Radiology"],
  ["General & Interventional Radiology", "ew-general-and-interventional-radiology", "Radiology"],
  ["Head & Neck Radiology", "ew-head-and-neck-radiology", "Radiology"],
  ["Interventional Radiology", "ew-interventional-radiology", "Radiology"],
  ["Musculoskeletal Radiology (MSK)", "ew-musculoskeletal-radiology", "Radiology"],
  ["Neuroradiology", "ew-neuroradiology", "Radiology"],
  ["Thoracic Radiology", "ew-thoracic-radiology", "Radiology"],
  ["Ultrasound", "ew-ultrasound", "Radiology"],
  ["Vascular Interventional Radiology", "ew-vascular-interventional-radiology", "Radiology"],

  ["Aesthetic Nursing", "ew-aesthetic-nursing", "Nursing"],
  ["Advanced Nurse Practitioners", "ew-advanced-nurse-practitioners", "Nursing"],
  ["Clinical Governance & Patient Safety", "ew-clinical-governance-and-patient-safety", "Nursing"],
  ["Community & Primary Care Nursing", "ew-community-and-primary-care-nursing", "Nursing"],
  ["Critical Care / Intensive Care Nursing", "ew-critical-care-intensive-care-nursing", "Nursing"],
  ["Emergency & Urgent Care Nursing", "ew-emergency-and-urgent-care-nursing", "Nursing"],
  ["Gastroenterology & IBD Nursing", "ew-gastroenterology-and-ibd-nursing", "Nursing"],
  ["General / Adult Nursing", "ew-general-adult-nursing", "Nursing"],
  ["Infection Prevention & Control", "ew-infection-prevention-and-control", "Nursing"],
  ["Learning Disability Nursing", "ew-learning-disability-nursing", "Nursing"],
  ["Mental Health Nursing", "ew-mental-health-nursing", "Nursing"],
  ["Paediatric Critical Care Nursing", "ew-paediatric-critical-care-nursing", "Nursing"],
  ["Paediatric Emergency Nursing", "ew-paediatric-emergency-nursing", "Nursing"],
  ["Paediatric Nursing", "ew-paediatric-nursing", "Nursing"],
  ["Palliative Care / End of Life Nursing", "ew-palliative-care-end-of-life-nursing", "Nursing"],
  ["Respiratory Nursing", "ew-respiratory-nursing", "Nursing"],
  ["Pre-Hospital & Trauma Care", "ew-pre-hospital-and-trauma-care", "Nursing"],
  ["Stoma Care Nursing", "ew-stoma-care-nursing", "Nursing"],
  ["Wound Care & Tissue Viability", "ew-wound-care-and-tissue-viability", "Nursing"],
];

const NEW_BRANCH = {
  "name": "Medical Specialty",
  "slug": "expert-witness-medical-specialty",
  "children": LEAVES.map(([name, slug]) => ({ name, slug })),
};

function collectSlugs(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectSlugs(n, out)); return out; }
  if (node && typeof node === "object") {
    if (node.slug) out.push(node.slug);
    if (node.children) collectSlugs(node.children, out);
  }
  return out;
}

function findByName(node, name) {
  if (Array.isArray(node)) {
    for (const n of node) { const r = findByName(n, name); if (r) return r; }
    return null;
  }
  if (node && typeof node === "object") {
    if (node.name === name) return node;
    if (node.children) return findByName(node.children, name);
  }
  return null;
}

const existingSlugs = new Set(collectSlugs(tree, []));

if (existingSlugs.has(NEW_BRANCH.slug)) {
  console.log(`${c.warn}"Medical Specialty" (slug ${NEW_BRANCH.slug}) is already in the tree -- nothing to do.${c.off}`);
  process.exit(0);
}

const newSlugs = collectSlugs(NEW_BRANCH, []);
const collisions = newSlugs.filter((s) => existingSlugs.has(s));
if (collisions.length) {
  console.error(`${c.bad}Refusing to write: ${collisions.length} slug(s) already exist elsewhere in the tree and this script would silently duplicate/rename them via sync-taxonomy.mjs:${c.off}`);
  collisions.forEach((s) => console.error(`  ${s}`));
  console.error(`${c.dim}Rename the colliding leaf(s) in this script and re-run.${c.off}`);
  process.exit(1);
}

const dupNames = new Set();
{
  const seen = new Set();
  for (const [name] of LEAVES) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) dupNames.add(name);
    seen.add(key);
  }
}
if (dupNames.size) {
  console.error(`${c.bad}Refusing to write: duplicate leaf name(s) within the new branch itself:${c.off} ${[...dupNames].join(", ")}`);
  process.exit(1);
}

const expertWitness = findByName(tree, "Expert Witness");
if (!expertWitness || !Array.isArray(expertWitness.children)) {
  console.error(`${c.bad}Couldn't find an "Expert Witness" node with a children array in ${TREE_PATH}. Not touching the file.${c.off}`);
  process.exit(1);
}

expertWitness.children.push(NEW_BRANCH);

fs.writeFileSync(TREE_PATH, JSON.stringify(tree, null, 2) + "\n");

console.log(`${c.bold}${c.good}Added "Medical Specialty" to Expert Witness${c.off}`);
console.log(`  ${TREE_PATH}`);
console.log(`  1 branch + ${NEW_BRANCH.children.length} leaves = ${1 + NEW_BRANCH.children.length} new taxonomy rows (flat, same shape as Medicolegal).`);
console.log(`${c.dim}Review with: git diff -- '**/specialty-tree.json'${c.off}`);
console.log(`${c.dim}Then push to the live DB with: DATABASE_URL="<prod url>" node scripts/sync-taxonomy.mjs --write${c.off}`);
