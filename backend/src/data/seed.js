/* ------------------------------------------------------------------ *
 * Seed
 *
 * Loads the same starter data into Postgres that src/data/mock.js serves
 * in demo mode, so the two modes show the same directory. Run it with
 * `npm run seed` once DATABASE_URL is set.
 *
 * Safe to re-run: it truncates the tables it manages first. It will NOT
 * run against a database that already holds real sign-ups unless you
 * pass --force, because "seed" and "delete every specialist who ever
 * registered" are one keystroke apart.
 * ------------------------------------------------------------------ */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

import { connectDB, disconnectDb, getDb, isDbConfigured } from "../config/db.js";
import * as t from "../db/schema.js";
import { newId } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import {
  facilities as facilitySeed,
  facilityReviews as facilityReviewSeed,
  facilityTeamLinks as facilityTeamSeed,
  specialists as allMockSpecialists,
  curatedReviews as curatedReviewSeed,
  conditions as mockConditions,
  nextAvailableIso,
} from "./mock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specialtyTree = JSON.parse(fs.readFileSync(path.join(__dirname, "taxonomy/specialty-tree.json"), "utf8"));
const facilityTree = JSON.parse(fs.readFileSync(path.join(__dirname, "taxonomy/facility-tree.json"), "utf8"));

const FORCE = process.argv.includes("--force");

/**
 * Inserts a 3-level (top -> sub -> narrow) taxonomy tree one level at a
 * time, so each child's parent_id points at a row that already exists.
 * Returns a slug -> row map covering every level.
 */
// Depth-by-depth, so a child is never inserted before the parent row
// whose generated id it needs. Recurses to whatever depth a branch
// actually has -- a tree hard-coded to top/sub/leaf silently drops
// anything nested a level deeper than that (Expert Witness ->
// Medicolegal -> Personal Injury -> Orthopaedic & Musculoskeletal
// Injury is 4 levels), which is worse than an error because nothing
// here would tell you rows went missing.
async function insertTaxonomyTree(db, table, tree) {
  const bySlug = {};
  let frontier = tree.map((node) => ({ node, parentSlug: null }));

  while (frontier.length) {
    const inputs = frontier.map(({ node, parentSlug }) => ({
      id: newId(),
      parentId: parentSlug ? bySlug[parentSlug].id : null,
      slug: node.slug,
      name: node.name,
    }));
    const inserted = await db.insert(table).values(inputs).returning();
    inserted.forEach((r) => (bySlug[r.slug] = r));

    frontier = frontier.flatMap(({ node }) =>
      (node.children ?? []).map((child) => ({ node: child, parentSlug: node.slug }))
    );
  }

  return bySlug;
}

/**
 * Which claimed listings represent a real person who signed up.
 *
 * The seed creates one demo specialist account of its own
 * (j.whitfield@example.com) and marks its listing claimed, so a
 * pristine, freshly seeded database always contains exactly one claimed
 * profile. Counting that as a real sign-up made the guard cry wolf on
 * its own output: re-seeding a demo database was impossible without
 * --force, which trains you to reach for --force by reflex — the one
 * habit a guard like this exists to prevent.
 *
 * So the seeded demo accounts are excluded by email, and anything else
 * claimed is named in the refusal rather than merely counted, so the
 * decision to erase is made with the list in front of you.
 */
const SEEDED_DEMO_EMAILS = ["j.whitfield@example.com"];

async function realSignups(db) {
  const result = await db.execute(sql`
    select s.slug, s.full_name, u.email
    from specialists s
    left join users u on u.id = s.user_id
    where s.claimed = true
  `);
  const rows = result.rows ?? result;
  return rows.filter((r) => !SEEDED_DEMO_EMAILS.includes(String(r.email ?? "").toLowerCase()));
}

async function seed() {
  if (!isDbConfigured()) {
    console.error("[seed] DATABASE_URL is not set — nothing to seed. Copy .env.example to .env first.");
    process.exit(1);
  }
  await connectDB();
  const db = getDb();

  // Guard rail: refuse to wipe a database somebody has signed up to.
  const signups = await realSignups(db);
  if (signups.length > 0 && !FORCE) {
    console.error(
      `[seed] refusing to run: ${signups.length} specialist(s) have claimed a listing in this database:\n` +
        signups.map((r) => `         · ${r.full_name} <${r.email ?? "no account"}> (${r.slug})`).join("\n") +
        `\n       Re-run with --force if you are certain you want to erase them.`
    );
    process.exit(1);
  }

  console.log("[seed] clearing existing data...");
  // One statement, so foreign keys never block the order of deletes.
  await db.execute(sql`
    truncate table
      contact_messages, claims, push_subscriptions, notifications, orders,
      leads, reviews,
      specialist_specialties, specialist_conditions, specialist_treatments,
      specialist_clinic_locations, facility_category_links, facility_team,
      specialists, users, facilities, facility_categories,
      clinic_locations, clinics, treatments, conditions, specialties,
      regulators, cities, countries
    restart identity cascade
  `);

  const [gb] = await db
    .insert(t.countries)
    .values({ isoCode: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB", timezone: "Europe/London" })
    .returning();

  const cityRows = await db
    .insert(t.cities)
    .values(
      [
        ["Birmingham", "birmingham", "West Midlands", 52.4862, -1.8904],
        ["Solihull", "solihull", "West Midlands", 52.4128, -1.7783],
        ["Manchester", "manchester", "Greater Manchester", 53.4808, -2.2426],
        ["London", "london", "Greater London", 51.5072, -0.1276],
        ["Leeds", "leeds", "West Yorkshire", 53.8008, -1.5491],
        ["Liverpool", "liverpool", "Merseyside", 53.4084, -2.9916],
      ].map(([name, slug, region, lat, lng]) => ({ countryId: gb.id, name, slug, region, lat, lng }))
    )
    .returning();
  const cityBySlug = Object.fromEntries(cityRows.map((c) => [c.slug, c]));

  const regulatorRows = await db
    .insert(t.regulators)
    .values(
      [
        ["GMC", "General Medical Council"],
        ["GDC", "General Dental Council"],
        ["HCPC", "Health and Care Professions Council"],
        ["NMC", "Nursing and Midwifery Council"],
      ].map(([code, name]) => ({ countryId: gb.id, code, name }))
    )
    .returning();
  const regulatorByCode = Object.fromEntries(regulatorRows.map((r) => [r.code, r]));

  console.log("[seed] inserting specialty taxonomy...");
  const specialtyBySlug = await insertTaxonomyTree(db, t.specialties, specialtyTree);
  console.log(`[seed] inserted ${Object.keys(specialtyBySlug).length} specialty nodes.`);

  console.log("[seed] inserting facility-category taxonomy...");
  const facilityCategoryBySlug = await insertTaxonomyTree(db, t.facilityCategories, facilityTree);
  console.log(`[seed] inserted ${Object.keys(facilityCategoryBySlug).length} facility-category nodes.`);

  const conditionRows = await db
    .insert(t.conditions)
    .values(
      [
        ["orthopaedics", "knee-arthritis", "Knee Arthritis"],
        ["orthopaedics", "knee-pain", "Knee Pain"],
        ["orthopaedics", "shoulder-impingement", "Shoulder Impingement"],
        ["orthopaedics", "hip-osteoarthritis", "Hip Osteoarthritis"],
        ["physiotherapy", "lower-back-pain", "Lower Back Pain"],
        ["physiotherapy", "sports-injury", "Sports Injury"],
        ["aesthetics-specialists", "facial-ageing", "Facial Ageing"],
        ["dentistry", "missing-teeth", "Missing Teeth"],
        ["dentistry", "crooked-teeth", "Crooked Teeth"],
        ["ent", "chronic-sinusitis", "Chronic Sinusitis"],
        ["gynaecology", "endometriosis-condition", "Endometriosis"],
      ].map(([specSlug, slug, name]) => ({ specialtyId: specialtyBySlug[specSlug].id, slug, name }))
    )
    .returning();
  const conditionBySlug = Object.fromEntries(conditionRows.map((c) => [c.slug, c]));

  const treatmentRows = await db
    .insert(t.treatments)
    .values(
      [
        ["orthopaedics", "knee-arthritis", "total-knee-replacement-treatment", "Total Knee Replacement"],
        ["orthopaedics", "knee-arthritis", "partial-knee-replacement-treatment", "Partial Knee Replacement"],
        ["orthopaedics", "knee-pain", "acl-reconstruction-treatment", "ACL Reconstruction"],
        ["orthopaedics", "hip-osteoarthritis", "total-hip-replacement-treatment", "Total Hip Replacement"],
        ["orthopaedics", "shoulder-impingement", "shoulder-arthroscopy-treatment", "Shoulder Arthroscopy"],
        ["physiotherapy", "sports-injury", "sports-massage-therapy", "Sports Massage Therapy"],
        ["physiotherapy", "lower-back-pain", "manual-therapy", "Manual Therapy"],
        ["aesthetics-specialists", "facial-ageing", "dermal-fillers-treatment", "Dermal Fillers"],
        ["aesthetics-specialists", "facial-ageing", "facelift-treatment", "Facelift"],
        ["dentistry", "missing-teeth", "dental-implants-treatment", "Dental Implants"],
        ["dentistry", "crooked-teeth", "invisalign", "Invisalign"],
        ["dentistry", "crooked-teeth", "teeth-whitening-treatment", "Teeth Whitening"],
        ["ent", "chronic-sinusitis", "septoplasty-treatment", "Septoplasty"],
        ["gynaecology", "endometriosis-condition", "laparoscopy-endometriosis", "Laparoscopy for Endometriosis"],
      ].map(([specSlug, condSlug, slug, name]) => ({
        specialtyId: specialtyBySlug[specSlug].id,
        conditionId: conditionBySlug[condSlug].id,
        slug,
        name,
      }))
    )
    .returning();
  const treatmentBySlug = Object.fromEntries(treatmentRows.map((r) => [r.slug, r]));

  const clinicRows = await db
    .insert(t.clinics)
    .values([
      { slug: "midlands-orthopaedic-centre", name: "Midlands Orthopaedic Centre", description: "A dedicated orthopaedic clinic serving Birmingham and the West Midlands." },
      { slug: "solihull-physio-sports-clinic", name: "Solihull Physio & Sports Clinic", description: "Sports and musculoskeletal physiotherapy in the heart of Solihull." },
      { slug: "finsbury-aesthetic-clinic", name: "Finsbury Aesthetic Clinic", description: "Facial and non-surgical aesthetic treatments in central London." },
      { slug: "riverside-dental-studio", name: "Riverside Dental Studio", description: "General and cosmetic dentistry in Manchester." },
      { slug: "city-ent-sinus-clinic", name: "City ENT & Sinus Clinic", description: "Ear, nose and throat care for adults and children across Leeds." },
      { slug: "wimbledon-womens-health-centre", name: "Wimbledon Women's Health Centre", description: "Gynaecology and women's health services in south-west London." },
    ])
    .returning();
  const clinicBySlug = Object.fromEntries(clinicRows.map((c) => [c.slug, c]));

  const locationSeed = [
    ["midlands-orthopaedic-centre", "birmingham", "14 Colmore Row", "B3 2QD", "0121 496 0100"],
    ["solihull-physio-sports-clinic", "solihull", "2 Homer Road", "B91 3QG", "0121 704 0200"],
    ["finsbury-aesthetic-clinic", "london", "88 City Road", "EC1Y 2BJ", "020 7946 0300"],
    ["riverside-dental-studio", "manchester", "5 Quay Street", "M3 3JE", "0161 234 0400"],
    ["city-ent-sinus-clinic", "leeds", "21 Park Row", "LS1 5JF", "0113 234 0500"],
    ["wimbledon-womens-health-centre", "london", "9 Worple Road", "SW19 4DD", "020 7946 0600"],
  ];
  const locationRows = await db
    .insert(t.clinicLocations)
    .values(
      locationSeed.map(([clinicSlug, citySlug, address, postcode, phone]) => ({
        clinicId: clinicBySlug[clinicSlug].id,
        cityId: cityBySlug[citySlug].id,
        address,
        postcode,
        phone,
        lat: cityBySlug[citySlug].lat,
        lng: cityBySlug[citySlug].lng,
      }))
    )
    .returning();
  const locationByClinicSlug = Object.fromEntries(locationSeed.map(([clinicSlug], i) => [clinicSlug, locationRows[i]]));

  const specialistSeed = [
    { slug: "dr-amara-chukwu", fullName: "Dr Amara Chukwu", title: "Consultant Orthopaedic Surgeon", bio: "Specialises in knee arthritis and joint replacement, with over 15 years' experience treating patients across the West Midlands.", specSlug: "total-knee-replacement", regCode: "GMC", regNo: "7012345", price: 15000, rating: 4.8, count: 42, clinicSlug: "midlands-orthopaedic-centre", conditionSlugs: ["knee-arthritis", "knee-pain"], treatmentSlugs: ["total-knee-replacement-treatment", "partial-knee-replacement-treatment"], availableInDays: 6, years: 15 },
    { slug: "mr-james-whitfield", fullName: "Mr James Whitfield", title: "Consultant Orthopaedic Surgeon", photoUrl: "/images/specialist-orthopaedic.jpg", bio: "Shoulder and upper-limb specialist, focused on arthroscopic and minimally invasive techniques.", specSlug: "rotator-cuff-repair", regCode: "GMC", regNo: "7023456", price: 16000, rating: 4.9, count: 27, clinicSlug: "midlands-orthopaedic-centre", conditionSlugs: ["shoulder-impingement"], treatmentSlugs: ["shoulder-arthroscopy-treatment"], availableInDays: 4, years: 12, videoUrl: "/videos/intro-placeholder.mp4" },
    { slug: "sarah-coleman", fullName: "Sam Coleman", title: "Sports Physiotherapist", photoUrl: "/images/specialist-physio.png", bio: "Works with amateur and professional athletes recovering from sports injury and chronic pain.", specSlug: "acl-rehabilitation", regCode: "HCPC", regNo: "PH098765", price: 6000, rating: 4.9, count: 61, clinicSlug: "solihull-physio-sports-clinic", conditionSlugs: ["sports-injury", "lower-back-pain"], treatmentSlugs: ["sports-massage-therapy", "manual-therapy"], availableInDays: 1, years: 9, videoUrl: "/videos/intro-placeholder.mp4" },
    { slug: "dr-priya-anand", fullName: "Dr Priya Anand", title: "Aesthetic Medicine Doctor", bio: "Focuses on natural-looking non-surgical facial aesthetics for patients across London.", specSlug: "dermal-fillers", regCode: "GMC", regNo: "7034567", price: 20000, rating: 4.7, count: 33, clinicSlug: "finsbury-aesthetic-clinic", conditionSlugs: ["facial-ageing"], treatmentSlugs: ["dermal-fillers-treatment"], availableInDays: 3, years: 11 },
    { slug: "dr-michael-osei", fullName: "Dr Michael Osei", title: "Dentist — Implant Specialist", photoUrl: "/images/specialist-dentist.jpg", bio: "General dentist with a special interest in dental implants and full-mouth restoration.", specSlug: "dental-implants", regCode: "GDC", regNo: "99012", price: 9000, rating: 4.9, count: 19, clinicSlug: "riverside-dental-studio", conditionSlugs: ["missing-teeth"], treatmentSlugs: ["dental-implants-treatment"], availableInDays: 9, years: 8, videoUrl: "/videos/intro-placeholder.mp4" },
    { slug: "mr-david-okonkwo", fullName: "Mr David Okonkwo", title: "Consultant ENT Surgeon", bio: "Specialises in nasal and sinus surgery, treating chronic sinusitis and breathing obstruction with minimally invasive techniques.", specSlug: "septoplasty", regCode: "GMC", regNo: "7045678", price: 18000, rating: 4.8, count: 24, clinicSlug: "city-ent-sinus-clinic", conditionSlugs: ["chronic-sinusitis"], treatmentSlugs: ["septoplasty-treatment"], availableInDays: 12, years: 17 },
    { slug: "dr-fatima-al-rashid", fullName: "Dr Fatima Al-Rashid", title: "Consultant Gynaecologist", bio: "Specialist in endometriosis and chronic pelvic pain, offering both medical management and minimally invasive laparoscopic surgery.", specSlug: "endometriosis", regCode: "GMC", regNo: "7056789", price: 22000, rating: 4.8, count: 38, clinicSlug: "wimbledon-womens-health-centre", conditionSlugs: ["endometriosis-condition"], treatmentSlugs: ["laparoscopy-endometriosis"], languages: ["English", "Arabic"], availableInDays: 20, years: 14 },
  ];

  const specialistRows = await db
    .insert(t.specialists)
    .values(
      specialistSeed.map((s) => ({
        id: newId("spc"),
        slug: s.slug,
        fullName: s.fullName,
        title: s.title,
        photoUrl: s.photoUrl ?? null,
        bio: s.bio,
        primarySpecialtyId: specialtyBySlug[s.specSlug].id,
        regulatorId: regulatorByCode[s.regCode].id,
        registrationNumber: s.regNo,
        verificationStatus: "verified",
        // Seeded listings are imported directory entries, not sign-ups.
        // Marking them claimed would make the claim flow unreachable for
        // exactly the profiles it exists to serve.
        claimed: false,
        consultationPriceMinor: s.price,
        currency: "GBP",
        languages: s.languages ?? ["English"],
        // Set to 0 here and derived from the review rows below, so the
        // number on a card is always the number of reviews that exist.
        // A seeded "4.8 from 42 reviews" with two reviews behind it is
        // exactly the kind of figure this build refuses to print.
        ratingAvg: 0,
        ratingCount: 0,
        // The seed expresses availability as a day offset so a re-seed is
        // never stale; the stored column is a real timestamp, which is
        // what the profile form and a booking integration write.
        nextAvailableAt: new Date(nextAvailableIso(s.availableInDays)),
        yearsExperience: s.years ?? null,
        videoUrl: s.videoUrl ?? null,
        videoThumbnailUrl: s.videoUrl ? "/images/placeholder-doctor-1.jpg" : null,
        videoDurationSeconds: s.videoUrl ? 8 : null,
        application: { submittedAt: new Date().toISOString(), notes: null, documents: [] },
        verificationHistory: [{ action: "approved", byName: "Seed", note: "Imported listing", at: new Date().toISOString() }],
      }))
    )
    .returning();
  const specialistBySlug = Object.fromEntries(specialistRows.map((s) => [s.slug, s]));

  // Join rows for the taxonomy links.
  await db.insert(t.specialistSpecialties).values(
    specialistSeed.map((s) => ({
      specialistId: specialistBySlug[s.slug].id,
      specialtyId: specialtyBySlug[s.specSlug].id,
    }))
  );
  await db.insert(t.specialistConditions).values(
    specialistSeed.flatMap((s) =>
      s.conditionSlugs.map((slug) => ({
        specialistId: specialistBySlug[s.slug].id,
        conditionId: conditionBySlug[slug].id,
        source: t.LINK_SOURCES.seed,
      }))
    )
  );
  await db.insert(t.specialistTreatments).values(
    specialistSeed.flatMap((s) =>
      s.treatmentSlugs.map((slug) => ({
        specialistId: specialistBySlug[s.slug].id,
        treatmentId: treatmentBySlug[slug].id,
        source: t.LINK_SOURCES.seed,
      }))
    )
  );
  await db.insert(t.specialistClinicLocations).values(
    specialistSeed.map((s) => ({
      specialistId: specialistBySlug[s.slug].id,
      clinicLocationId: locationByClinicSlug[s.clinicSlug].id,
    }))
  );

  /* ------------------------------------------------------------ reviews
     Taken from the same hand-written set demo mode uses, so the two
     modes show the same words rather than two divergent copies. Seeded
     reviews are inserted already approved — they stand in for a
     directory that has been running a while — while anything written
     through the site lands pending and waits for an admin. */
  const conditionSlugById = Object.fromEntries(mockConditions.map((c) => [c.id, c.slug]));
  const specialistSlugById = Object.fromEntries(allMockSpecialists.map((sp) => [sp.id, sp.slug]));

  await db.insert(t.reviews).values(
    curatedReviewSeed
      .filter((r) => specialistBySlug[specialistSlugById[r.subjectId]])
      .map((r) => ({
        subjectType: "specialist",
        subjectId: specialistBySlug[specialistSlugById[r.subjectId]].id,
        rating: r.rating,
        comment: r.comment,
        patientName: r.patientName,
        conditionId: conditionBySlug[conditionSlugById[r.conditionId]]?.id ?? null,
        verified: r.verified,
        scoreCommunication: r.scores?.communication ?? null,
        scoreExpertise: r.scores?.expertise ?? null,
        scoreCare: r.scores?.care ?? null,
        scoreWaitTime: r.scores?.waitTime ?? null,
        moderationStatus: "approved",
        moderatedAt: new Date(),
        createdAt: new Date(r.createdAt),
      }))
  );

  // Ratings are derived, never typed: recompute each seeded specialist's
  // aggregate from the rows just inserted.
  await db.execute(sql`
    update specialists s set
      rating_count = coalesce(r.count, 0),
      rating_avg   = coalesce(round(r.avg::numeric, 1), 0)
    from (
      select subject_id, count(*)::int as count, avg(rating) as avg
      from reviews
      where subject_type = 'specialist' and moderation_status = 'approved'
      group by subject_id
    ) r
    where r.subject_id = s.id
  `);

  console.log("[seed] inserting facilities...");
  // The mock data addresses facilities and specialists by their own
  // authoring ids ("fac-…", "spc-…"); the database hands out fresh ones.
  // These two maps are the only bridge, so a link row can never point at
  // an id that exists in one world and not the other.
  const facilityIdToSlug = Object.fromEntries(facilitySeed.map((f) => [f.id, f.slug]));
  const specialistIdToSlug = Object.fromEntries(allMockSpecialists.map((s) => [s.id, s.slug]));
  const specialistById = Object.fromEntries(
    Object.entries(specialistIdToSlug)
      .map(([id, slug]) => [id, specialistBySlug[slug]])
      .filter(([, row]) => row)
  );
  const facilityRows = await db
    .insert(t.facilities)
    .values(
      facilitySeed.map((f) => ({
        id: newId("fac"),
        facilityType: f.facilityType,
        slug: f.slug,
        name: f.name,
        // Seeded places are imported listings, not accounts. Leaving
        // them unclaimed is what keeps the claim flow reachable for
        // exactly the listings it exists to serve.
        claimed: false,
        tagline: f.tagline ?? null,
        description: f.description,
        about: f.about ?? null,
        photoUrl: f.photoUrl,
        coverImageUrl: f.coverImageUrl ?? null,
        gallery: f.gallery ?? [],
        websiteUrl: f.websiteUrl ?? null,
        bookingUrl: f.bookingUrl ?? null,
        socials: f.socials ?? {},
        phone: f.phone,
        contactEmail: f.contactEmail ?? null,
        contactPhone: f.contactPhone ?? null,
        cityId: cityBySlug[f.cityId.replace("city-", "")].id,
        address: f.address,
        postcode: f.postcode,
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        regulator: f.regulator ?? null,
        regulatorRef: f.regulatorRef ?? null,
        regulatorRating: f.regulatorRating ?? null,
        regulatorRatedAt: f.regulatorRatedAt ? new Date(f.regulatorRatedAt) : null,
        regulatorUrl: f.regulatorUrl ?? null,
        yearEstablished: f.yearEstablished ?? null,
        bedCount: f.bedCount ?? null,
        staffCount: f.staffCount ?? null,
        openingHours: f.openingHours ?? {},
        open24h: Boolean(f.open24h),
        emergencyDepartment: Boolean(f.emergencyDepartment),
        languages: f.languages ?? ["English"],
        amenities: f.amenities ?? [],
        insurers: f.insurers ?? [],
        accreditations: f.accreditations ?? [],
        verificationStatus: f.verificationStatus,
        // Ratings below are placeholders overwritten by the recompute
        // that follows the facility reviews — see the update statement.
        ratingAvg: 0,
        ratingCount: 0,
      }))
    )
    .returning();
  const facilityBySlug = Object.fromEntries(facilityRows.map((f) => [f.slug, f]));

  await db.insert(t.facilityCategoryLinks).values(
    facilitySeed.flatMap((f) =>
      f.categorySlugs.map((slug) => ({
        facilityId: facilityBySlug[f.slug].id,
        categoryId: facilityCategoryBySlug[slug].id,
      }))
    )
  );

  // Who practises where. This is the join that lets a hospital profile
  // list its consultants and a consultant's profile name the hospital.
  const teamValues = facilityTeamSeed
    .filter((l) => specialistById[l.specialistId] && facilityBySlug[facilityIdToSlug[l.facilityId]])
    .map((l) => ({
      facilityId: facilityBySlug[facilityIdToSlug[l.facilityId]].id,
      specialistId: specialistById[l.specialistId].id,
      role: l.role,
    }));
  if (teamValues.length) await db.insert(t.facilityTeam).values(teamValues);

  if (facilityReviewSeed.length) {
    await db.insert(t.reviews).values(
      facilityReviewSeed
        .filter((r) => (r.moderationStatus ?? "approved") === "approved")
        .map((r) => ({
        subjectType: "facility",
        subjectId: facilityBySlug[facilityIdToSlug[r.subjectId]].id,
        rating: r.rating,
        comment: r.comment,
        patientName: r.patientName,
        conditionId: null,
        verified: r.verified,
        scoreCommunication: r.scores?.communication ?? null,
        scoreExpertise: r.scores?.expertise ?? null,
        scoreCare: r.scores?.care ?? null,
        scoreWaitTime: r.scores?.waitTime ?? null,
        moderationStatus: "approved",
        moderatedAt: new Date(),
        createdAt: new Date(r.createdAt),
      }))
    );
  }

  // Same rule as specialists: the aggregate is derived from the rows,
  // never typed in. A place with no reviews stays honestly at zero.
  await db.execute(sql`
    update facilities f set
      rating_count = coalesce(r.count, 0),
      rating_avg   = coalesce(round(r.avg::numeric, 1), 0)
    from (
      select subject_id, count(*)::int as count, avg(rating) as avg
      from reviews
      where subject_type = 'facility' and moderation_status = 'approved'
      group by subject_id
    ) r
    where r.subject_id = f.id
  `);

  /* ---------------------------------------------------------- accounts
     Demo mode carries its logins in data/accounts.js, in memory. A real
     database has none until they are created — so without this step a
     freshly seeded site has a working directory and nobody who can sign
     in to administer it. These are starter credentials: change the
     password on first login, or set SEED_ADMIN_* before seeding.
     ------------------------------------------------------------------ */
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@tls.test").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "demo1234";
  await db.insert(t.users).values({
    id: newId("usr"),
    email: adminEmail,
    passwordHash: hashPassword(adminPassword),
    fullName: process.env.SEED_ADMIN_NAME || "TLS Admin",
    role: "admin",
  });

  // One specialist account, linked to a seeded listing, so the specialist
  // dashboard can be walked without registering first.
  const demoSpecialist = specialistBySlug["mr-james-whitfield"];
  const [specialistUser] = await db
    .insert(t.users)
    .values({
      id: newId("usr"),
      email: "j.whitfield@example.com",
      passwordHash: hashPassword("demo1234"),
      fullName: demoSpecialist.fullName,
      role: "specialist",
    })
    .returning();
  await db
    .update(t.specialists)
    .set({ userId: specialistUser.id, contactEmail: "j.whitfield@example.com", claimed: true })
    .where(sql`id = ${demoSpecialist.id}`);

  console.log(`[seed] created admin account ${adminEmail}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log("[seed] WARNING: the admin password is the default 'demo1234'. Change it before going live.");
  }
  console.log("[seed] done.");
  await disconnectDb();
}

seed().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
