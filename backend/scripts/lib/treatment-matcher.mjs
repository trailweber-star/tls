/* ------------------------------------------------------------------ *
 * Finding the treatments and conditions a piece of prose actually names
 *
 * This was the middle of derive-treatments.mjs, which read each
 * listing's own description. It is a module now because a second pass
 * reads the practices' own websites, and two copies of these rules
 * would drift the first time somebody fixed one of them. Every guard
 * below was put there by a wrong answer that reached a profile, and the
 * comments say which -- they are the only record of why the obvious
 * version does not work.
 *
 * Callers supply the text and the branch of the tree the listing sits
 * in. Nothing here touches a database.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ----------------------------------------------------------- the tree */

const tree = JSON.parse(fs.readFileSync(path.join(BACKEND, "src/data/taxonomy/specialty-tree.json"), "utf8"));
export const leaves = [];
(function walk(nodes, rootSlug) {
  for (const n of nodes) {
    const root = rootSlug ?? n.slug;
    const kids = n.children ?? [];
    if (kids.length) walk(kids, root);
    else leaves.push({ name: n.name, slug: n.slug, root });
  }
})(Array.isArray(tree) ? tree : tree.children ?? [], null);

/* Is a leaf something you HAVE, or something somebody DOES to you?
 *
 * The tree does not say, because it did not need to: it exists to file
 * people, and "Knee Replacement" files a surgeon whichever it is. The
 * profile page has two homes for them, so they have to be told apart.
 *
 * The rule below is a first pass and it is wrong in places -- "Painful
 * Knee Replacement" is a complication, not an operation, and the word
 * "replacement" does not know that. So the answers are written to
 * data/taxonomy-kinds.csv, which is in git, and anything corrected
 * there wins. Correct it once and it stays corrected. */
const PROCEDURE = /(replacement|reconstruction|arthroscopy|repair|surgery|surgical|fusion|release|injection|removal|graft|implant|filler|whitening|transplant|augmentation|reduction|decompression|fixation|osteotomy|excision|biopsy|screening|assessment|therapy|therapies|counselling|rehabilitation|revision|plasty\b|ectomy|otomy|oscopy|scopy\b|\blift\b|bracing|orthotics|veneers|crowns|bonding|dentures|braces|aligners|scan\b|ultrasound|vaccination|fitting|treatment|enhancement|contouring|needling|peel\b|sculpt|lipo|extraction|splint|prosthes)/i;
/* A complication of an operation is a condition, whatever words it
   borrows from the operation. These qualifiers say so. */
const COMPLICATION = /^(painful|infected|loose|loosening|stiff|failed|problem)/i;

export const kindOf = (name) => {
  if (COMPLICATION.test(name)) return "condition";
  return PROCEDURE.test(name) ? "treatment" : "condition";
};

/* Eighteen leaves carry a slash, and the two sides are not two names.
 * "PCL Injury / Reconstruction" is PCL Injury and PCL RECONSTRUCTION --
 * the right-hand word inherits the qualifier from the left. Splitting
 * naively gives "Reconstruction" as a name of its own, which then
 * matches every bio containing the word, and it did: it came top of the
 * first run with 355 hits, ahead of Knee Replacement. Same for "Repair"
 * out of "Root Meniscus Tear / Repair" and "Arthritis" out of "AC Joint
 * Injury / Arthritis".
 *
 * So a bare word after the slash is grafted onto the qualifier, and a
 * bare word BEFORE it is a standalone synonym -- "Bunion / Hallux
 * Valgus", "Unicompartmental / Partial Knee Replacement" -- which is
 * kept only when the word is distinctive enough to stand alone.
 * Grafting those the same way produces "Hallux Bunion". */
const GENERIC = new Set([
  "balance", "repair", "reconstruction", "arthritis", "injury", "injuries", "surgery",
  "therapy", "treatment", "assessment", "recovery", "mobility", "strength", "posture",
  "wellbeing", "screening", "restoration", "dislocation", "instability", "syndrome",
]);

export function aliasesFor(name) {
  const parts = name.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [name];
  const longest = parts.reduce((a, b) => (b.split(/\s+/).length > a.split(/\s+/).length ? b : a));
  const out = [];
  parts.forEach((p, i) => {
    const words = p.split(/\s+/);
    if (words.length >= 2) { out.push(p); return; }
    if (i === 0) {
      // A standalone synonym, kept only if it can carry a sentence alone.
      if (p.length >= 6 && !GENERIC.has(p.toLowerCase())) out.push(p);
      return;
    }
    const grafted = [...longest.split(/\s+/).slice(0, -1), p].join(" ");
    if (grafted.split(/\s+/).length >= 2) out.push(grafted);
  });
  const seen = new Set();
  return out.filter((a) => a.length >= 6 && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
}

export function readCsvText(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/* Corrections win over the rule. */
const kindsFile = path.join(BACKEND, "data", "taxonomy-kinds.csv");
const override = new Map();
if (fs.existsSync(kindsFile)) {
  const text = fs.readFileSync(kindsFile, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const r of readCsvText(text)) {
    const k = String(r.kind ?? "").trim().toLowerCase();
    if (r.slug && (k === "treatment" || k === "condition" || k === "skip")) override.set(r.slug.trim(), k);
  }
}
for (const l of leaves) l.kind = override.get(l.slug) ?? kindOf(l.name);

/* Short names match too much. "Knee" appears in every knee bio and says
   nothing a patient can act on; the leaf that matters is "Knee
   Replacement". Six characters is where the noise stops. */
export const matchers = leaves
  .filter((l) => l.kind !== "skip" && l.name.length >= 6)
  .map((l) => ({ ...l, aliases: aliasesFor(l.name) }))
  .filter((l) => l.aliases.length)
  .map((l) => {
    const rx = l.aliases.map((a) => a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    return { ...l, rx: new RegExp(`\\b(?:${rx.join("|")})\\b`, "i") };
  });

/* A CONDITION NAMED IN A SENTENCE ABOUT SOMEBODY'S CV.
 *
 * "She also gained an MD for her research thesis on ovarian cancer"
 * names ovarian cancer and says nothing about whether she treats it.
 * Tania Adib's profile produced exactly that, and it is the most
 * plausible-looking wrong answer this can give: the word is really
 * there, in her own words, in her own branch. A research interest, a
 * paper, a lecture and a doctorate are all claims about expertise, not
 * about a service a patient can book.
 *
 * So an academic sentence cannot be the ONLY evidence. If another
 * sentence names the same thing plainly, it still counts -- most
 * surgeons who publish on knee replacement also perform it, and their
 * profiles say so somewhere else. */
export const ACADEMIC = /\b(thesis|doctorate|\bphd\b|research(ed|ing)?\s+(into|on|in)\b|research\s+(interest|fellow|thesis|prize)|published|publication|papers?\s+on\b|lectur\w+\s+(on|in)\b|dissertation|trials?\s+(on|of|into)\b|presented\b)/i;

/* A procedure named in order to say it is NOT on offer. */
export const NEGATED = /\b(do(es)? not|don'?t|no longer|never|cannot|can'?t|unable to|refer(red|s|ral)? (on|out|elsewhere)|does not (perform|offer|treat)|not (perform|offer|treat|available))\b/i;

export const sentencesOf = (text) => String(text ?? "").split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

/* ------------------------------------------------------------------ *
 * matchIn(text, root)
 *
 * Returns the leaves this text names, each with the sentence it came
 * from, plus counts of everything deliberately thrown away. The counts
 * matter: a pass that silently discards is a pass nobody can audit.
 * ------------------------------------------------------------------ */
export function matchIn(text, root) {
  const picks = new Map();
  const crossBranch = [];
  let negated = 0;
  let redundant = 0;
  let academicOnly = 0;

  for (const s of sentencesOf(text)) {
    const isNegated = NEGATED.test(s);
    for (const m of matchers) {
      if (!m.rx.test(s)) continue;
      if (isNegated) { negated += 1; continue; }
      if (m.root !== root) { crossBranch.push({ leaf: m.name, root: m.root }); continue; }
      const academic = ACADEMIC.test(s);
      if (!picks.has(m.slug)) picks.set(m.slug, { leaf: m, sentence: s.trim(), academic });
      else if (!academic) {
        // A plain sentence beats the CV sentence that got here first.
        const seen = picks.get(m.slug);
        if (seen.academic) { seen.academic = false; seen.sentence = s.trim(); }
      }
    }
  }

  for (const [slug, v] of [...picks]) {
    if (v.academic) { picks.delete(slug); academicOnly += 1; }
  }

  /* One sentence can satisfy two leaves where one contains the other.
     "chronic pelvic pain" matches Pelvic Pain AND Chronic Pelvic Pain,
     and listing both says the same thing twice while making the profile
     look padded. Keep the more specific one. */
  for (const [slugA, a] of [...picks]) {
    for (const [slugB, b] of [...picks]) {
      if (slugA === slugB || !picks.has(slugA)) continue;
      const shorter = a.leaf.aliases.some((x) => b.leaf.aliases.some((y) => y.length > x.length && y.toLowerCase().includes(x.toLowerCase())));
      if (shorter) { picks.delete(slugA); redundant += 1; }
    }
  }

  return { picks: [...picks.values()], crossBranch, negated, redundant, academicOnly };
}
