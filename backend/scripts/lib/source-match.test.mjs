/* ------------------------------------------------------------------ *
 * node --test scripts/lib/source-match.test.mjs
 *
 * The cases here are the real ones from this dataset, not invented
 * ones. Each test names the listing it came from, so that when somebody
 * later loosens a check to make a stubborn listing pass, the thing that
 * breaks tells them exactly which mistake they have just re-enabled.
 * ------------------------------------------------------------------ */

import test from "node:test";
import assert from "node:assert/strict";
import { verdict, isOrganisation } from "./source-match.mjs";

const failed = (v) => v.checks.filter((c) => !c.pass).map((c) => c.name);

/* Enough prose to clear the `readable` check, in the voice these pages
   are actually written in. */
const filler =
  "We are a private practice offering appointments within a few days. " +
  "Our team is committed to a clear explanation of the options at every stage, " +
  "and we will always discuss non-surgical management before recommending an operation. " +
  "Appointments can be booked online or by telephone, and we accept all major insurers. " +
  "Parking is available on site and the clinic is fully accessible. " +
  "Please bring any imaging or referral letters with you to your first appointment. " +
  "We aim to reply to every enquiry on the same working day it is received. ";

test("a solo consultant's own site passes", () => {
  const v = verdict({
    listing: {
      fullName: "Mr Rob Pollock",
      town: "London",
      postcode: "W1U 5NY",
      leafNames: ["Knee Replacement", "Bone Tumour"],
      branch: "orthopaedics",
    },
    source: {
      claimedByOtherListings: 0,
      text:
        "Mr Rob Pollock is a consultant orthopaedic surgeon in London specialising in knee replacement " +
        "and the management of bone tumours. " + filler,
    },
  });
  assert.equal(v.pass, true, v.why);
});

test("two listings giving the same department page — midlandhealth.co.uk/ent — both fail", () => {
  const page =
    "Midland Health ENT. Our ENT service in Birmingham treats hearing loss, tinnitus and chronic sinusitis. " +
    "Mr Amit Parmar and Mr Jonathan Fussey lead the service. Mr Sandeep Kaur also consults here. " +
    "Dr Grisham Smotra covers gynaecology. " + filler;
  for (const name of ["Mr Amit Parmar ENT", "Mr Jonathan Fussey ENT"]) {
    const v = verdict({
      listing: { fullName: name, town: "Birmingham", postcode: "B15 1LZ", leafNames: ["Chronic Sinusitis"], branch: "ent" },
      source: { claimedByOtherListings: 1, text: page },
      kind: "person",
    });
    assert.equal(v.pass, false, `${name} should not pass: ${v.why}`);
    assert.ok(failed(v).includes("exclusive"), `${name} should fail 'exclusive', failed ${failed(v)}`);
  }
});

test("a practice team page is refused for an individual even when the url is theirs alone", () => {
  const v = verdict({
    listing: { fullName: "Mr Andrew Clarke", town: "London", postcode: "W1G 6AA", leafNames: ["Carpal Tunnel Syndrome"], branch: "orthopaedics" },
    source: {
      claimedByOtherListings: 0,
      text:
        "Our consultants. Mr Andrew Clarke, hand and wrist. Mr Peter Vaughan, shoulder. " +
        "Ms Helen Cole, foot and ankle. Dr Simon Reed, pain management. " +
        "Between them the team treats carpal tunnel syndrome, tennis elbow and frozen shoulder in London. " + filler,
    },
    kind: "person",
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(failed(v).includes("attributable"), `should fail 'attributable', failed ${failed(v)}`);
});

test("the wrong Andrew Clarke — right name, wrong discipline and wrong place — fails", () => {
  const v = verdict({
    listing: { fullName: "Mr Andrew Clarke", town: "London", postcode: "W1G 6AA", leafNames: ["Carpal Tunnel Syndrome", "Tennis Elbow"], branch: "orthopaedics" },
    source: {
      claimedByOtherListings: 0,
      text:
        "Mr Andrew Clarke is a consultant general surgeon practising in Taunton, Somerset. " +
        "His interests are hernia repair, gallbladder surgery and endoscopy. " + filler,
    },
    kind: "person",
  });
  assert.equal(v.pass, false, v.why);
  assert.deepEqual(failed(v).sort(), ["discipline", "placed"]);
});

test("a name alone is never enough", () => {
  const v = verdict({
    listing: { fullName: "Mr Rob Pollock", town: "London", postcode: "W1U 5NY", leafNames: ["Knee Replacement"], branch: "orthopaedics" },
    source: { claimedByOtherListings: 0, text: "Mr Rob Pollock. " + filler },
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(v.checks.find((c) => c.name === "named").pass, "the name did match");
});

test("a parked or empty page fails on readable, whatever else it says", () => {
  const v = verdict({
    listing: { fullName: "Westfield Aesthetics", town: "Birmingham", postcode: "B15 3ED", leafNames: ["Dermal Fillers"], branch: "aesthetics-specialists" },
    source: { claimedByOtherListings: 0, text: "Westfield Aesthetics Birmingham dermal fillers. This domain is for sale." },
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(failed(v).includes("readable"), `failed ${failed(v)}`);
});

test("an organisation is allowed to name its whole team", () => {
  const v = verdict({
    listing: { fullName: "Westfield Aesthetics", town: "Birmingham", postcode: "B15 3ED", leafNames: ["Dermal Fillers"], branch: "aesthetics-specialists" },
    source: {
      claimedByOtherListings: 0,
      text:
        "Westfield Aesthetics in Birmingham. Our practitioners: Dr Anna Reid, Ms Claire Booth, Mr Paul Hart, Dr Nia Owens. " +
        "We offer dermal fillers, anti-wrinkle injections and skin peels. " + filler,
    },
  });
  assert.equal(v.pass, true, v.why);
});

test("matching on the word 'clinic' is not matching", () => {
  const v = verdict({
    listing: { fullName: "Broad Oaks Health Clinic", town: "Solihull", postcode: "B91 2PP", leafNames: ["General Psychology & Counselling"], branch: "psychology" },
    source: {
      claimedByOtherListings: 0,
      text: "Dove House Psychology Services. A counselling clinic in Solihull offering general psychology & counselling. " + filler,
    },
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(failed(v).includes("named"), `failed ${failed(v)}`);
});

test("initials are accepted where the page uses them", () => {
  const v = verdict({
    listing: { fullName: "Mr Philip M Stott", town: "Hove", postcode: "BN3 1RD", leafNames: ["Hip Replacement"], branch: "orthopaedics" },
    source: {
      claimedByOtherListings: 0,
      text: "Mr P. Stott, consultant hip surgeon, Hove. Hip replacement and revision surgery. " + filler,
    },
    kind: "person",
  });
  assert.equal(v.pass, true, v.why);
});

test("isOrganisation separates the two kinds", () => {
  assert.equal(isOrganisation("Mr Rob Pollock"), false);
  assert.equal(isOrganisation("Westfield Aesthetics"), true);
  assert.equal(isOrganisation("Coventry Central Chiropractic Clinic"), true);
  assert.equal(isOrganisation("Dr Fatima Al-Rashid"), false);
});

/* ------------------------------------------------------------------ *
 * Found by running the gate over the first 25 fetched sites. All three
 * were passing the `named` check on nothing at all.
 * ------------------------------------------------------------------ */

test("ENT is not a surname, and must not match the word 'treatment'", () => {
  const v = verdict({
    listing: { fullName: "Mr Amit Parmar ENT", town: "Birmingham", postcode: "B15 1LZ", leafNames: ["Sinusitis"], branch: "ent" },
    source: {
      claimedByOtherListings: 0,
      text:
        "Our consultants offer assessment and treatment for every patient referred to the department. " +
        "Different options are discussed at the first appointment. Sinusitis is among the conditions seen in Birmingham. " + filler,
    },
  });
  assert.equal(
    v.checks.find((c) => c.name === "named").pass,
    false,
    "a page that never says Parmar must not pass 'named'"
  );
  assert.equal(v.pass, false, v.why);
});

test("a category appended to a person's name is not their surname", () => {
  const page =
    "Dr Grisham Smotra is a consultant gynaecologist in Birmingham. " +
    "The gynaecology service treats heavy periods and pelvic pain. " + filler;
  const yes = verdict({
    listing: { fullName: "Dr Grisham Smotra Gynaecology", town: "Birmingham", postcode: "B15 1LZ", leafNames: ["Pelvic Pain"], branch: "gynaecology" },
    source: { claimedByOtherListings: 0, text: page },
  });
  assert.equal(yes.pass, true, yes.why);

  /* The same page, for the other consultant whose listing carries the
     same department word. It says "gynaecology" all over it and that
     must not be enough. */
  const no = verdict({
    listing: { fullName: "Dr Kausik Das Gynaecology", town: "Birmingham", postcode: "B15 1LZ", leafNames: ["Pelvic Pain"], branch: "gynaecology" },
    source: { claimedByOtherListings: 0, text: page },
  });
  assert.equal(no.pass, false, no.why);
  assert.ok(failed(no).includes("named"), `failed ${failed(no)}`);
});

test("a business named after its discipline is an organisation, not a person called Psychology", () => {
  assert.equal(isOrganisation("New Meanings Psychology"), true);
  assert.equal(isOrganisation("the247dentist - Coventry"), true);
  assert.equal(isOrganisation("Dr Grisham Smotra Gynaecology"), false, "an honorific still means a person");

  const v = verdict({
    listing: { fullName: "New Meanings Psychology", town: "Birmingham", postcode: "B15 1LZ", leafNames: ["Talking Therapy"], branch: "psychology" },
    source: {
      claimedByOtherListings: 0,
      text: "A psychology practice in Birmingham offering assessment and talking therapy to adults. " + filler,
    },
  });
  assert.equal(v.checks.find((c) => c.name === "named").pass, false, "'psychology' alone is not the name");
});

/* ------------------------------------------------------------------ *
 * Found by running the gate over all 673 fetched sites. Three ways a
 * page that plainly belonged to a listing was being refused.
 * ------------------------------------------------------------------ */

test("a name glued to digits still matches when the page spaces it out", () => {
  const v = verdict({
    listing: { fullName: "76dental", town: "Birmingham", postcode: "B46 1RD", leafNames: ["Dental Implants"], branch: "dentistry" },
    source: {
      claimedByOtherListings: 0,
      url: "http://www.76dental.com/",
      text: "76 Dental, 112 Coleshill Road, Water Orton, Birmingham B46 1RD. General dentistry and dental implants. " + filler,
    },
  });
  assert.equal(v.checks.find((c) => c.name === "named").pass, true, v.why);
  assert.equal(v.pass, true, v.why);
});

test("a name made only of generic words is identified by the domain instead", () => {
  const v = verdict({
    listing: { fullName: "Dental Health Care", town: "Solihull", postcode: "B93 0LL", leafNames: ["Dental Hygiene"], branch: "dentistry" },
    source: {
      claimedByOtherListings: 0,
      url: "https://www.dental-health-care.co.uk/",
      text: "Solihull based dental practice offering dental hygiene and routine care. " + filler,
    },
  });
  assert.equal(v.checks.find((c) => c.name === "named").pass, true, v.why);

  /* And the domain must not rescue a page that is simply somebody
     else's: Garry Savin's listing points at a charity's website. */
  const no = verdict({
    listing: { fullName: "Garry Savin", town: "Birmingham", postcode: "B15 1TH", leafNames: ["Talking Therapy"], branch: "psychology" },
    source: {
      claimedByOtherListings: 0,
      url: "https://www.doctors-in-distress.org.uk/",
      text: "Doctors in Distress. Support for healthcare workers, including talking therapy, across Birmingham. " + filler,
    },
  });
  assert.equal(no.pass, false, no.why);
  assert.ok(failed(no).includes("named"), `failed ${failed(no)}`);
});

test("a two-word business is not a person whose surname is UK", () => {
  const v = verdict({
    listing: { fullName: "Dermaesthetix UK", town: "Birmingham", postcode: "B15 1TH", leafNames: ["Dermal Fillers"], branch: "aesthetics-specialists" },
    source: {
      claimedByOtherListings: 0,
      url: "https://www.dermaesthetix.uk/",
      text: "Dermaesthetix. Facial treatments, skin boosters and dermal fillers in Birmingham. " + filler,
    },
  });
  assert.equal(v.checks.find((c) => c.name === "named").pass, true, v.why);
  assert.equal(v.isOrg, true, "two words, no honorific, surname would be 'uk'");
});

/* ---------------------------------------------------------------- *
 * The same host, which is not the same thing as the same url.
 * ---------------------------------------------------------------- */

test("a department page one rung down the same site — Sarah Barker on midlandhealth.co.uk/mental-health/ — fails", () => {
  /* Her listing gives .../mental-health/ and Midland Health's gives the
     homepage, so the url check saw no sharer at all. Twelve services
     off a page belonging to the practice she is one clinician at. */
  const page =
    "Midland Health mental health service in Birmingham. We offer talking therapy, counselling and " +
    "speech and language therapy for adults and children. Our therapists are all HCPC registered. " + filler;
  const v = verdict({
    listing: {
      fullName: "Sarah Barker Speech and Language Therapist",
      town: "Birmingham", postcode: "B15 1LZ",
      leafNames: ["Stress Management", "Low Mood"], branch: "psychology",
    },
    source: {
      url: "https://midlandhealth.co.uk/mental-health/",
      claimedByOtherListings: 0,
      sameHostListings: ["Midland Health", "Mr Amit Parmar ENT", "Dr Kausik Das Gynaecology"],
      text: page,
    },
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(failed(v).includes("exclusive"), `should fail 'exclusive', failed ${failed(v)}`);
});

test("one practice listed once per branch — Mr Roger Sloan, Solihull and Coventry — still passes", () => {
  const v = verdict({
    listing: {
      fullName: "Warwickshire Orthopaedic Clinic Solihull - Mr Roger Sloan",
      town: "Solihull", postcode: "B91 2AW",
      leafNames: ["Hip Replacement", "Knee Replacement"], branch: "orthopaedics",
    },
    source: {
      url: "https://www.rogersloan.co.uk/",
      claimedByOtherListings: 0,
      sameHostListings: ["Warwickshire Orthopaedic Clinic Coventy - Mr Roger Sloan"],
      text: "Mr Roger Sloan is a consultant orthopaedic surgeon in Solihull offering hip replacement and knee replacement. " + filler,
    },
  });
  assert.equal(v.pass, true, v.why);
});

test("a group's site shared by its practices — rodericksdentalpartners.co.uk — fails for each", () => {
  const v = verdict({
    listing: {
      fullName: "Cottams Dental - Harborne Dentist",
      town: "Birmingham", postcode: "B17 9NS",
      leafNames: ["Dental Implants", "Teeth Whitening"], branch: "dentistry",
    },
    source: {
      url: "https://www.rodericksdentalpartners.co.uk/practices/cottams",
      claimedByOtherListings: 0,
      sameHostListings: ["Castle Care - Castle Bromwich Dental Care", "Coventry Road Dental", "Handsworth Wood Dental Practice"],
      text: "Rodericks Dental Partners. Our practices offer dental implants and teeth whitening across the Midlands, Harborne included. " + filler,
    },
  });
  assert.equal(v.pass, false, v.why);
  assert.ok(failed(v).includes("exclusive"), `should fail 'exclusive', failed ${failed(v)}`);
});

test("guests on a practice's own domain do not cost the practice its own site", () => {
  const v = verdict({
    listing: {
      fullName: "Broad Oaks Health Clinic",
      town: "Solihull", postcode: "B91 1DL",
      leafNames: ["Sports Injury Assessment"], branch: "physiotherapy",
    },
    source: {
      url: "https://www.broadoakshealthclinic.com/",
      claimedByOtherListings: 0,
      sameHostListings: ["Dove House Psychology Services"],
      text: "Broad Oaks Health Clinic in Solihull offers sports injury assessment and rehabilitation. " + filler,
    },
  });
  assert.equal(v.pass, true, v.why);
});
