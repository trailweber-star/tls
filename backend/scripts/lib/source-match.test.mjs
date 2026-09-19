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
