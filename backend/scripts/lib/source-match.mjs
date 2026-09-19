/* ------------------------------------------------------------------ *
 * Does this source actually describe this listing?
 *
 * Every pass that copies clinical claims onto a profile from somewhere
 * else -- the practice's own website, PHIN, anything found by a search
 * -- has to answer that question first, and has to answer it on more
 * than the name. A name is the weakest identifier in this dataset:
 *
 *   - searching PHIN for our Andrew Clarke, a hand surgeon, returns
 *     Mr Andrew Clarke (General surgery, South West), Dr Andrew Clark
 *     (Paediatrics), Mr Hugh Clarke, Mr Callum Clark and Ms Anna Marie
 *     Clarke. None of them is him;
 *   - the GMC number on our own records cannot break the tie, because
 *     the old site fabricated them -- 869 sequential numbers shared
 *     four listings to a number;
 *   - two of our listings, Mr Amit Parmar and Mr Jonathan Fussey, give
 *     the SAME url as their website: midlandhealth.co.uk/ent. It is
 *     their department's page. Reading it and filing everything on it
 *     under either man attributes a department's service list to one
 *     individual.
 *
 * So the verdict below is a set of named checks, each of which prints
 * its own reason, and the caller sees every one. A listing that fails
 * is not a bug to be worked around; it is the honest answer, and the
 * profile keeps whatever it already had.
 *
 * WHAT WOULD MAKE THIS SAFE TO AUTOMATE AT SCALE. A real registration
 * number on both sides. Until the GMC numbers are genuine, this file
 * is the substitute, and it is deliberately strict.
 * ------------------------------------------------------------------ */

const TITLE = /\b(mr|mrs|ms|miss|mx|dr|doctor|prof|professor|sir|dame)\b\.?/gi;

/* A page that returned 200 and is still not the website. */
const PARKED =
  /(domain (is |name )?for sale|buy this domain|this domain may be for sale|page not found|404 error|under construction|coming soon|account suspended|site is temporarily unavailable|website is currently unavailable|enable javascript to)/i;

const ORG_WORD =
  /\b(clinic|clinics|centre|center|hospital|practice|surgery|ltd|limited|llp|group|associates|partners|physio|physiotherapy|chiropractic|dental|dentist|aesthetics|aesthetic|health|healthcare|medical|care|therapy|therapies|counselling|counseling|psychotherapy|studio|spa|institute|academy|laser|skin|smile|orthodontic|wellness|rehab|rehabilitation|sports|injury|pharmacy|osteopath|osteopathy|acupuncture|wellbeing|consultancy|solutions|company|specialists)\b/i;

/* Words that identify nobody. A page "naming" a listing only because
   both contain the word "clinic" has not named it. */
const EMPTY = new Set([
  "the", "and", "of", "at", "in", "for", "uk", "ltd", "limited", "llp", "co", "company",
  "clinic", "clinics", "centre", "center", "practice", "surgery", "group", "services",
  "service", "health", "healthcare", "medical", "care", "dental", "dentist", "therapy",
  "aesthetics", "aesthetic", "specialist", "specialists", "consultant", "london",
]);

export const isOrganisation = (name) =>
  ORG_WORD.test(String(name ?? "")) || String(name ?? "").replace(TITLE, "").trim().split(/\s+/).length > 4;

const words = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const nameWords = (s) => words(String(s ?? "").replace(TITLE, " ")).filter((w) => w.length > 1);

const digits = (s) => String(s ?? "").replace(/[^0-9]/g, "").replace(/^44/, "0");

/* Other people the page presents as clinicians. A solo consultant's own
   site names one; a practice page names the team, and everything on a
   team page belongs to the team. */
function otherClinicians(text, ownName) {
  const mine = new Set(nameWords(ownName));
  const found = new Set();
  for (const m of String(text ?? "").matchAll(/\b(?:Mr|Mrs|Ms|Miss|Dr|Professor)\.?\s+([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})?)/g)) {
    const who = m[1].trim();
    const parts = nameWords(who);
    if (!parts.length) continue;
    if (parts.every((p) => mine.has(p))) continue; // that is this listing
    found.add(who.toLowerCase());
  }
  return [...found];
}

/* ------------------------------------------------------------------ *
 * verdict
 *
 *   listing  { fullName, town, postcode, telephone, branch, leafNames }
 *   source   { url, text, claimedByOtherListings }
 *
 * Returns { pass, checks, why }. `checks` is always the full list, in a
 * fixed order, whether or not the verdict passed -- a report that only
 * shows the failing check teaches nobody why the others held.
 * ------------------------------------------------------------------ */
export function verdict({ listing, source, kind }) {
  const text = String(source?.text ?? "");
  const hay = text.toLowerCase();
  const isOrg = kind === "organisation" || (kind !== "person" && isOrganisation(listing.fullName));
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  /* 1. Exclusive. Two listings pointing at one page means the page is
        about neither of them in particular. */
  const sharers = source?.claimedByOtherListings ?? 0;
  add(
    "exclusive",
    sharers === 0,
    sharers === 0 ? "no other listing gives this url" : `${sharers} other listing(s) give the same url`
  );

  /* 2. Readable. A parked domain, a cookie wall or a 404 body can all
        return 200 and contain none of the site. The word floor is
        deliberately low -- a real single-room clinic can have a very
        thin homepage, and throwing those away to be tidy would lose
        listings that are perfectly fine -- so the phrase test does most
        of the work here. */
  const wordCount = hay.split(/\s+/).filter(Boolean).length;
  const parked = PARKED.exec(hay);
  add(
    "readable",
    wordCount >= 60 && !parked,
    parked ? `the page says "${parked[0]}"` : `${wordCount} words of text`
  );

  /* 3. Named. For a person the surname is required and a given name or
        its initial must agree; for an organisation, its distinctive
        words must appear, not merely the word "clinic". */
  let named = false;
  let namedDetail = "";
  const parts = nameWords(listing.fullName);
  if (isOrg) {
    const distinctive = parts.filter((w) => !EMPTY.has(w));
    const hits = distinctive.filter((w) => hay.includes(w));
    named = distinctive.length > 0 && hits.length >= Math.max(1, Math.ceil(distinctive.length / 2));
    namedDetail = distinctive.length
      ? `${hits.length}/${distinctive.length} distinctive word(s): ${hits.join(", ") || "none"}`
      : "the name has no distinctive words";
  } else {
    const surname = parts[parts.length - 1] ?? "";
    const given = parts.slice(0, -1);
    const surnameOk = surname.length > 2 && hay.includes(surname);
    const givenOk =
      given.length === 0 ||
      given.some((g) => hay.includes(g)) ||
      given.some((g) => new RegExp(`\\b${g[0]}\\.?\\s+${surname}\\b`, "i").test(hay));
    named = surnameOk && givenOk;
    namedDetail = `surname "${surname}" ${surnameOk ? "found" : "absent"}; given name ${givenOk ? "agrees" : "does not appear"}`;
  }
  add("named", named, namedDetail);

  /* 4. Placed. The town, the outward postcode, or the listing's own
        phone number somewhere on the page. */
  const town = String(listing.town ?? "").toLowerCase().trim();
  const outward = String(listing.postcode ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const phone = digits(listing.telephone);
  const pageDigits = digits(text);
  const placedBy = [];
  if (town && town.length > 3 && hay.includes(town)) placedBy.push(`town "${listing.town}"`);
  if (outward && outward.length >= 2 && hay.includes(outward)) placedBy.push(`postcode ${outward.toUpperCase()}`);
  if (phone.length >= 9 && pageDigits.includes(phone)) placedBy.push("telephone");
  add("placed", placedBy.length > 0, placedBy.join(", ") || "no town, postcode or phone number from the listing");

  /* 5. Discipline. At least one name from the listing's own branch of
        the tree. A page that agrees on the person but talks about a
        different discipline is a different practice of theirs, or a
        different person with the same name. */
  const leaves = (listing.leafNames ?? []).filter(Boolean);
  const leafHits = leaves.filter((n) => hay.includes(String(n).toLowerCase()));
  add(
    "discipline",
    leafHits.length > 0,
    leaves.length
      ? `${leafHits.length} name(s) from ${listing.branch ?? "its branch"}${leafHits.length ? `: ${leafHits.slice(0, 3).join(", ")}` : ""}`
      : "no branch supplied"
  );

  /* 6. Not a team page -- people only. Everything on a page that
        introduces several clinicians belongs to the practice, not to
        whichever of them we happen to be filing. */
  const others = isOrg ? [] : otherClinicians(text, listing.fullName);
  add(
    "attributable",
    isOrg || others.length < 3,
    isOrg
      ? "organisation listing — a team page is its own page"
      : others.length
        ? `page also names ${others.length} other clinician(s): ${others.slice(0, 3).join(", ")}`
        : "no other clinicians named"
  );

  const by = Object.fromEntries(checks.map((c) => [c.name, c.pass]));

  /* Required: it is this listing's page, there is something to read,
     and it names them. Then one corroborating fact -- being in the
     right place, or talking about the right discipline. Name alone is
     never enough; that is the whole point of the file. */
  const pass =
    by.exclusive && by.readable && by.named && by.attributable && (by.placed || by.discipline);

  const why = pass
    ? `passed on ${checks.filter((c) => c.pass).map((c) => c.name).join(" + ")}`
    : `failed: ${checks.filter((c) => !c.pass).map((c) => c.name).join(", ")}`;

  return { pass, checks, why, isOrg };
}

export default verdict;
