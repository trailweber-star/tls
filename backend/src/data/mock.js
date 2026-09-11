// Demo-mode dataset — mirrors src/data/seed.js so the API returns real
// content without a live MongoDB connection. Controllers read from here
// when isDbConfigured() is false (see src/config/db.js). Response
// shapes here are exactly what the real Mongoose-backed controllers
// produce, so the frontend never needs to know which mode it's talking to.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flattenTaxonomyTree, branchSlugs, childrenOf, topLevelOf } from "./taxonomy/build.js";
import { buildDemoDirectory } from "./demo-directory.js";
import { aggregateReviewScores } from "../lib/reviews.js";
import { deriveRating } from "../lib/ratings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specialtyTree = JSON.parse(fs.readFileSync(path.join(__dirname, "taxonomy/specialty-tree.json"), "utf8"));
const facilityTree = JSON.parse(fs.readFileSync(path.join(__dirname, "taxonomy/facility-tree.json"), "utf8"));

export const countries = [
  { id: "country-gb", isoCode: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB", timezone: "Europe/London" },
];

export const cities = [
  { id: "city-birmingham", countryId: "country-gb", name: "Birmingham", slug: "birmingham", region: "West Midlands", lat: 52.4862, lng: -1.8904 },
  { id: "city-solihull", countryId: "country-gb", name: "Solihull", slug: "solihull", region: "West Midlands", lat: 52.4128, lng: -1.7783 },
  { id: "city-manchester", countryId: "country-gb", name: "Manchester", slug: "manchester", region: "Greater Manchester", lat: 53.4808, lng: -2.2426 },
  { id: "city-london", countryId: "country-gb", name: "London", slug: "london", region: "Greater London", lat: 51.5072, lng: -0.1276 },
  { id: "city-leeds", countryId: "country-gb", name: "Leeds", slug: "leeds", region: "West Yorkshire", lat: 53.8008, lng: -1.5491 },
  { id: "city-liverpool", countryId: "country-gb", name: "Liverpool", slug: "liverpool", region: "Merseyside", lat: 53.4084, lng: -2.9916 },
];

export const regulators = [
  { id: "reg-gmc", countryId: "country-gb", code: "GMC", name: "General Medical Council" },
  { id: "reg-gdc", countryId: "country-gb", code: "GDC", name: "General Dental Council" },
  { id: "reg-hcpc", countryId: "country-gb", code: "HCPC", name: "Health and Care Professions Council" },
  { id: "reg-nmc", countryId: "country-gb", code: "NMC", name: "Nursing and Midwifery Council" },
];

// Full taxonomy, 3 levels deep (top category -> subcategory -> narrow
// sub-subcategory), flattened into the same self-referencing shape the
// old hand-written 2-level list used (id/parentId/slug/name) so every
// consumer below keeps working unchanged. Source trees live in
// ./taxonomy/*.json — see taxonomy/build.js for how they're flattened.
// specialties: Orthopaedics, Physiotherapy, Dentistry, Aesthetics
// Specialists, ENT, Gynaecology — tags on Specialist records.
export const specialties = flattenTaxonomyTree(specialtyTree, "sp");

// facilityCategories: Hospital Care, Care Homes, Pharmacy, Clinics,
// Hospitals — a separate taxonomy for Facility records (hospitals,
// care homes, pharmacies, clinics), which are places, not people.
export const facilityCategories = flattenTaxonomyTree(facilityTree, "fc");

export const conditions = [
  { id: "co-knee-arthritis", specialtyId: "sp-orthopaedics", slug: "knee-arthritis", name: "Knee Arthritis", description: null },
  { id: "co-knee-pain", specialtyId: "sp-orthopaedics", slug: "knee-pain", name: "Knee Pain", description: null },
  { id: "co-shoulder-impingement", specialtyId: "sp-orthopaedics", slug: "shoulder-impingement", name: "Shoulder Impingement", description: null },
  { id: "co-hip-osteoarthritis", specialtyId: "sp-orthopaedics", slug: "hip-osteoarthritis", name: "Hip Osteoarthritis", description: null },
  { id: "co-lower-back-pain", specialtyId: "sp-physiotherapy", slug: "lower-back-pain", name: "Lower Back Pain", description: null },
  { id: "co-sports-injury", specialtyId: "sp-physiotherapy", slug: "sports-injury", name: "Sports Injury", description: null },
  { id: "co-facial-ageing", specialtyId: "sp-aesthetics-specialists", slug: "facial-ageing", name: "Facial Ageing", description: null },
  { id: "co-missing-teeth", specialtyId: "sp-dentistry", slug: "missing-teeth", name: "Missing Teeth", description: null },
  { id: "co-crooked-teeth", specialtyId: "sp-dentistry", slug: "crooked-teeth", name: "Crooked Teeth", description: null },
  { id: "co-chronic-sinusitis", specialtyId: "sp-ent", slug: "chronic-sinusitis", name: "Chronic Sinusitis", description: null },
  { id: "co-endometriosis-condition", specialtyId: "sp-gynaecology", slug: "endometriosis-condition", name: "Endometriosis", description: null },
];

export const treatments = [
  { id: "tr-total-knee-replacement", specialtyId: "sp-orthopaedics", conditionId: "co-knee-arthritis", slug: "total-knee-replacement", name: "Total Knee Replacement", description: null },
  { id: "tr-partial-knee-replacement", specialtyId: "sp-orthopaedics", conditionId: "co-knee-arthritis", slug: "partial-knee-replacement", name: "Partial Knee Replacement", description: null },
  { id: "tr-acl-reconstruction", specialtyId: "sp-orthopaedics", conditionId: "co-knee-pain", slug: "acl-reconstruction", name: "ACL Reconstruction", description: null },
  { id: "tr-total-hip-replacement", specialtyId: "sp-orthopaedics", conditionId: "co-hip-osteoarthritis", slug: "total-hip-replacement", name: "Total Hip Replacement", description: null },
  { id: "tr-shoulder-arthroscopy", specialtyId: "sp-orthopaedics", conditionId: "co-shoulder-impingement", slug: "shoulder-arthroscopy", name: "Shoulder Arthroscopy", description: null },
  { id: "tr-sports-massage-therapy", specialtyId: "sp-physiotherapy", conditionId: "co-sports-injury", slug: "sports-massage-therapy", name: "Sports Massage Therapy", description: null },
  { id: "tr-manual-therapy", specialtyId: "sp-physiotherapy", conditionId: "co-lower-back-pain", slug: "manual-therapy", name: "Manual Therapy", description: null },
  { id: "tr-dermal-fillers-treatment", specialtyId: "sp-aesthetics-specialists", conditionId: "co-facial-ageing", slug: "dermal-fillers-treatment", name: "Dermal Fillers", description: null },
  { id: "tr-facelift-treatment", specialtyId: "sp-aesthetics-specialists", conditionId: "co-facial-ageing", slug: "facelift-treatment", name: "Facelift", description: null },
  { id: "tr-dental-implants-treatment", specialtyId: "sp-dentistry", conditionId: "co-missing-teeth", slug: "dental-implants-treatment", name: "Dental Implants", description: null },
  { id: "tr-invisalign", specialtyId: "sp-dentistry", conditionId: "co-crooked-teeth", slug: "invisalign", name: "Invisalign", description: null },
  { id: "tr-teeth-whitening-treatment", specialtyId: "sp-dentistry", conditionId: "co-crooked-teeth", slug: "teeth-whitening-treatment", name: "Teeth Whitening", description: null },
  { id: "tr-septoplasty-treatment", specialtyId: "sp-ent", conditionId: "co-chronic-sinusitis", slug: "septoplasty-treatment", name: "Septoplasty", description: null },
  { id: "tr-laparoscopy-endometriosis", specialtyId: "sp-gynaecology", conditionId: "co-endometriosis-condition", slug: "laparoscopy-endometriosis", name: "Laparoscopy for Endometriosis", description: null },
];

const curatedClinics = [
  { id: "cl-midlands-orthopaedic-centre", slug: "midlands-orthopaedic-centre", name: "Midlands Orthopaedic Centre", description: "A dedicated orthopaedic clinic serving Birmingham and the West Midlands.", logoUrl: null, website: null },
  { id: "cl-solihull-physio-sports-clinic", slug: "solihull-physio-sports-clinic", name: "Solihull Physio & Sports Clinic", description: "Sports and musculoskeletal physiotherapy in the heart of Solihull.", logoUrl: null, website: null },
  { id: "cl-finsbury-aesthetic-clinic", slug: "finsbury-aesthetic-clinic", name: "Finsbury Aesthetic Clinic", description: "Facial and non-surgical aesthetic treatments in central London.", logoUrl: null, website: null },
  { id: "cl-riverside-dental-studio", slug: "riverside-dental-studio", name: "Riverside Dental Studio", description: "General and cosmetic dentistry in Manchester.", logoUrl: null, website: null },
  { id: "cl-city-ent-sinus-clinic", slug: "city-ent-sinus-clinic", name: "City ENT & Sinus Clinic", description: "Ear, nose and throat care for adults and children across Leeds.", logoUrl: null, website: null },
  { id: "cl-wimbledon-womens-health-centre", slug: "wimbledon-womens-health-centre", name: "Wimbledon Women's Health Centre", description: "Gynaecology and women's health services in south-west London.", logoUrl: null, website: null },
];

const curatedClinicLocations = [
  { id: "loc-midlands-orthopaedic-centre", clinicId: "cl-midlands-orthopaedic-centre", cityId: "city-birmingham", address: "14 Colmore Row", postcode: "B3 2QD", phone: "0121 496 0100" },
  { id: "loc-solihull-physio-sports-clinic", clinicId: "cl-solihull-physio-sports-clinic", cityId: "city-solihull", address: "2 Homer Road", postcode: "B91 3QG", phone: "0121 704 0200" },
  { id: "loc-finsbury-aesthetic-clinic", clinicId: "cl-finsbury-aesthetic-clinic", cityId: "city-london", address: "88 City Road", postcode: "EC1Y 2BJ", phone: "020 7946 0300" },
  { id: "loc-riverside-dental-studio", clinicId: "cl-riverside-dental-studio", cityId: "city-manchester", address: "5 Quay Street", postcode: "M3 3JE", phone: "0161 234 0400" },
  { id: "loc-city-ent-sinus-clinic", clinicId: "cl-city-ent-sinus-clinic", cityId: "city-leeds", address: "21 Park Row", postcode: "LS1 5JF", phone: "0113 234 0500" },
  { id: "loc-wimbledon-womens-health-centre", clinicId: "cl-wimbledon-womens-health-centre", cityId: "city-london", address: "9 Worple Road", postcode: "SW19 4DD", phone: "020 7946 0600" },
];

const curatedSpecialists = [
  {
    id: "spc-dr-amara-chukwu", slug: "dr-amara-chukwu", fullName: "Dr Amara Chukwu",
    title: "Consultant Orthopaedic Surgeon", photoUrl: null,
    bio: "Specialises in knee arthritis and joint replacement, with over 15 years\u2019 experience treating patients across the West Midlands. Her practice covers the full range of knee problems, from early arthritis managed with injections and physiotherapy through to partial and total knee replacement. She is known for taking time over the decision itself: replacement is a significant operation, and she talks patients through what it will and will not fix before anything is booked. She runs a dedicated follow-up clinic so recovery is monitored closely in the first year after surgery.",
    primarySpecialtyId: "sp-total-knee-replacement", regulatorId: "reg-gmc", registrationNumber: "7012345",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 15000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.8, ratingCount: 42, nextAvailableInDays: 6, yearsExperience: 15, contactEmail: "a.chukwu@example.com", contactPhone: null,
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: "/images/placeholder-doctor-2.jpg",
    gallery: [
      { url: "/images/placeholder-doctor-1.jpg", caption: "Consulting room" },
      { url: "/images/placeholder-doctor-2.jpg", caption: "Theatre" },
      { url: "/images/placeholder-doctor-3.jpg", caption: "Recovery suite" },
    ],
    websiteUrl: "https://www.example.com/spc-dr-amara-chukwu",
    socials: { linkedin: "https://www.linkedin.com/in/spc-dr-amara-chukwu", x: null, instagram: null, facebook: null, youtube: null },
    bookingUrl: "https://booking.example.com/spc-dr-amara-chukwu",
  },
  {
    id: "spc-mr-james-whitfield", slug: "mr-james-whitfield", fullName: "Mr James Whitfield",
    title: "Consultant Orthopaedic Surgeon", photoUrl: "/images/specialist-orthopaedic.jpg",
    bio: "Shoulder and upper-limb specialist, focused on arthroscopic and minimally invasive techniques. He treats rotator cuff tears, shoulder impingement and instability, and works with patients ranging from office workers with long-standing pain through to athletes returning to competitive sport. His practice emphasises getting an accurate diagnosis first — many shoulder problems settle with targeted rehabilitation rather than surgery — and he will always set out the non-operative options alongside the surgical ones. Where an operation is the right answer, he uses keyhole techniques wherever possible to shorten recovery, and works alongside a dedicated physiotherapy team so rehabilitation starts immediately after surgery.",
    primarySpecialtyId: "sp-rotator-cuff-repair", regulatorId: "reg-gmc", registrationNumber: "7023456",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 16000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.9, ratingCount: 27, nextAvailableInDays: 4, yearsExperience: 12, contactEmail: "j.whitfield@example.com", contactPhone: null, videoUrl: "/videos/intro-placeholder.mp4", videoThumbnailUrl: "/images/placeholder-doctor-1.jpg", videoDurationSeconds: 8,
    plan: "clinwell", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: "cw_demo_spc-mr-james-whitfield",
    coverImageUrl: "/images/placeholder-doctor-2.jpg",
    gallery: [
      { url: "/images/placeholder-doctor-1.jpg", caption: "Consulting room" },
      { url: "/images/placeholder-doctor-2.jpg", caption: "Theatre" },
      { url: "/images/placeholder-doctor-3.jpg", caption: "Recovery suite" },
    ],
    websiteUrl: "https://www.example.com/spc-mr-james-whitfield",
    socials: { linkedin: "https://www.linkedin.com/in/spc-mr-james-whitfield", x: null, instagram: null, facebook: null, youtube: null },
    bookingUrl: "https://booking.example.com/spc-mr-james-whitfield",
  },
  {
    id: "spc-sarah-coleman", slug: "sarah-coleman", fullName: "Sam Coleman",
    title: "Sports Physiotherapist", photoUrl: "/images/specialist-physio.png",
    bio: "Works with amateur and professional athletes recovering from sports injury and chronic pain. Sessions combine hands-on treatment with a structured loading programme, because the exercises done between appointments are usually what determine the outcome. Particular interests include ACL rehabilitation, hamstring and calf injuries, and persistent lower back pain that has not responded to rest. Every patient leaves the first session with a written plan and clear return-to-sport milestones.",
    primarySpecialtyId: "sp-acl-rehabilitation", regulatorId: "reg-hcpc", registrationNumber: "PH098765",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 6000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.9, ratingCount: 61, nextAvailableInDays: 1, yearsExperience: 9, contactEmail: "s.coleman@example.com", contactPhone: null, videoUrl: "/videos/intro-placeholder.mp4", videoThumbnailUrl: "/images/placeholder-doctor-1.jpg", videoDurationSeconds: 8,
    plan: "basic", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: null, gallery: [], websiteUrl: null, socials: null, bookingUrl: null,
  },
  {
    id: "spc-dr-priya-anand", slug: "dr-priya-anand", fullName: "Dr Priya Anand",
    title: "Aesthetic Medicine Doctor", photoUrl: null,
    bio: "Focuses on natural-looking non-surgical facial aesthetics for patients across London.",
    primarySpecialtyId: "sp-dermal-fillers", regulatorId: "reg-gmc", registrationNumber: "7034567",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 20000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.7, ratingCount: 33, nextAvailableInDays: 3, yearsExperience: 11, contactEmail: "p.anand@example.com", contactPhone: null,
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: "/images/placeholder-doctor-2.jpg",
    gallery: [
      { url: "/images/placeholder-doctor-1.jpg", caption: "Consulting room" },
      { url: "/images/placeholder-doctor-2.jpg", caption: "Theatre" },
      { url: "/images/placeholder-doctor-3.jpg", caption: "Recovery suite" },
    ],
    websiteUrl: "https://www.example.com/spc-dr-priya-anand",
    socials: { linkedin: "https://www.linkedin.com/in/spc-dr-priya-anand", x: null, instagram: null, facebook: null, youtube: null },
    bookingUrl: "https://booking.example.com/spc-dr-priya-anand",
  },
  {
    id: "spc-dr-michael-osei", slug: "dr-michael-osei", fullName: "Dr Michael Osei",
    title: "Dentist — Implant Specialist", photoUrl: "/images/specialist-dentist.jpg",
    bio: "General dentist with a special interest in dental implants and full-mouth restoration. He handles straightforward single-tooth implants as well as more complex cases involving bone grafting or multiple missing teeth, and takes on referrals from other practices. His approach is to plan the final result first and work backwards, using digital planning so patients can see the intended outcome before treatment begins. He also runs routine restorative and preventive care for families registered at the practice.",
    primarySpecialtyId: "sp-dental-implants", regulatorId: "reg-gdc", registrationNumber: "99012",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 9000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.9, ratingCount: 19, nextAvailableInDays: 9, yearsExperience: 8, contactEmail: "m.osei@example.com", contactPhone: null, videoUrl: "/videos/intro-placeholder.mp4", videoThumbnailUrl: "/images/placeholder-doctor-1.jpg", videoDurationSeconds: 8,
    plan: "basic", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: null, gallery: [], websiteUrl: null, socials: null, bookingUrl: null,
  },
  {
    id: "spc-mr-david-okonkwo", slug: "mr-david-okonkwo", fullName: "Mr David Okonkwo",
    title: "Consultant ENT Surgeon", photoUrl: null,
    bio: "Specialises in nasal and sinus surgery, treating chronic sinusitis and breathing obstruction with minimally invasive techniques.",
    primarySpecialtyId: "sp-septoplasty", regulatorId: "reg-gmc", registrationNumber: "7045678",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 18000, currency: "GBP",
    languages: ["English"], ratingAvg: 4.8, ratingCount: 24, nextAvailableInDays: 12, yearsExperience: 17, contactEmail: "d.okonkwo@example.com", contactPhone: null,
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: "/images/placeholder-doctor-2.jpg",
    gallery: [
      { url: "/images/placeholder-doctor-1.jpg", caption: "Consulting room" },
      { url: "/images/placeholder-doctor-2.jpg", caption: "Theatre" },
      { url: "/images/placeholder-doctor-3.jpg", caption: "Recovery suite" },
    ],
    websiteUrl: "https://www.example.com/spc-mr-david-okonkwo",
    socials: { linkedin: "https://www.linkedin.com/in/spc-mr-david-okonkwo", x: null, instagram: null, facebook: null, youtube: null },
    bookingUrl: "https://booking.example.com/spc-mr-david-okonkwo",
  },
  {
    id: "spc-dr-fatima-al-rashid", slug: "dr-fatima-al-rashid", fullName: "Dr Fatima Al-Rashid",
    title: "Consultant Gynaecologist", photoUrl: null,
    bio: "Specialist in endometriosis and chronic pelvic pain, offering both medical management and minimally invasive laparoscopic surgery.",
    primarySpecialtyId: "sp-endometriosis", regulatorId: "reg-gmc", registrationNumber: "7056789",
    verificationStatus: "verified", claimed: true, consultationPriceMinor: 22000, currency: "GBP",
    languages: ["English", "Arabic"], ratingAvg: 4.8, ratingCount: 38, nextAvailableInDays: 20, yearsExperience: 14, contactEmail: "f.alrashid@example.com", contactPhone: null,
    plan: "basic", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-15T00:00:00Z", planActivatedAt: "2026-01-15T00:00:00Z",
    planRenewsAt: "2027-01-15T00:00:00Z",
    clinwellWorkspaceId: null,
    coverImageUrl: null, gallery: [], websiteUrl: null, socials: null, bookingUrl: null,
  },
];

const curatedSpecialistClinicLocations = [
  { specialistId: "spc-dr-amara-chukwu", clinicLocationId: "loc-midlands-orthopaedic-centre" },
  { specialistId: "spc-mr-james-whitfield", clinicLocationId: "loc-midlands-orthopaedic-centre" },
  { specialistId: "spc-sarah-coleman", clinicLocationId: "loc-solihull-physio-sports-clinic" },
  { specialistId: "spc-dr-priya-anand", clinicLocationId: "loc-finsbury-aesthetic-clinic" },
  { specialistId: "spc-dr-michael-osei", clinicLocationId: "loc-riverside-dental-studio" },
  { specialistId: "spc-mr-david-okonkwo", clinicLocationId: "loc-city-ent-sinus-clinic" },
  { specialistId: "spc-dr-fatima-al-rashid", clinicLocationId: "loc-wimbledon-womens-health-centre" },
];

// The curated records above are the hand-written examples (real photos,
// hand-written reviews). buildDemoDirectory() generates the rest of the
// demo directory around them — clinics, addresses and specialists spread
// across every specialty and city — so search, filters, sorting and
// pagination have a realistic body of data to work against. Real
// profiles arriving through the specialist submission form replace these
// generated rows; nothing downstream distinguishes the two.
const demoDirectory = buildDemoDirectory({
  specialties,
  cities,
  takenSlugs: curatedSpecialists.map((s) => s.slug),
  perCity: 10,
});

export const clinics = [...curatedClinics, ...demoDirectory.clinics];
export const clinicLocations = [...curatedClinicLocations, ...demoDirectory.clinicLocations];
export const specialists = [...curatedSpecialists, ...demoDirectory.specialists];
export const specialistClinicLocations = [
  ...curatedSpecialistClinicLocations,
  ...demoDirectory.specialistClinicLocations,
];

export const specialistConditions = [
  { specialistId: "spc-dr-amara-chukwu", conditionId: "co-knee-arthritis" },
  { specialistId: "spc-dr-amara-chukwu", conditionId: "co-knee-pain" },
  { specialistId: "spc-mr-james-whitfield", conditionId: "co-shoulder-impingement" },
  { specialistId: "spc-sarah-coleman", conditionId: "co-sports-injury" },
  { specialistId: "spc-sarah-coleman", conditionId: "co-lower-back-pain" },
  { specialistId: "spc-dr-priya-anand", conditionId: "co-facial-ageing" },
  { specialistId: "spc-dr-michael-osei", conditionId: "co-missing-teeth" },
  { specialistId: "spc-mr-david-okonkwo", conditionId: "co-chronic-sinusitis" },
  { specialistId: "spc-dr-fatima-al-rashid", conditionId: "co-endometriosis-condition" },
];

export const specialistTreatments = [
  { specialistId: "spc-dr-amara-chukwu", treatmentId: "tr-total-knee-replacement" },
  { specialistId: "spc-dr-amara-chukwu", treatmentId: "tr-partial-knee-replacement" },
  { specialistId: "spc-mr-james-whitfield", treatmentId: "tr-shoulder-arthroscopy" },
  { specialistId: "spc-sarah-coleman", treatmentId: "tr-sports-massage-therapy" },
  { specialistId: "spc-sarah-coleman", treatmentId: "tr-manual-therapy" },
  { specialistId: "spc-dr-priya-anand", treatmentId: "tr-dermal-fillers-treatment" },
  { specialistId: "spc-dr-michael-osei", treatmentId: "tr-dental-implants-treatment" },
  { specialistId: "spc-mr-david-okonkwo", treatmentId: "tr-septoplasty-treatment" },
  { specialistId: "spc-dr-fatima-al-rashid", treatmentId: "tr-laparoscopy-endometriosis" },
];

export const curatedReviews = [
  { id: "rv-1", subjectType: "specialist", subjectId: "spc-dr-amara-chukwu", rating: 5, comment: "Mr Chukwu explained everything clearly before my knee replacement and the recovery has been better than I expected.", patientName: "Janet H.", conditionId: "co-knee-arthritis", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-01T00:00:00Z" },
  { id: "rv-2", subjectType: "specialist", subjectId: "spc-dr-amara-chukwu", rating: 5, comment: "Professional from the first consultation to the final check-up. Highly recommend.", patientName: "Robert P.", conditionId: "co-knee-pain", verified: false, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-05T00:00:00Z" },
  { id: "rv-3", subjectType: "specialist", subjectId: "spc-mr-james-whitfield", rating: 4, comment: "Very knowledgeable about shoulder issues, the arthroscopy went smoothly.", patientName: "Sandra K.", conditionId: "co-shoulder-impingement", verified: true, scores: { communication: 4, expertise: 4, care: 4, waitTime: 4 }, createdAt: "2026-02-10T00:00:00Z" },
  { id: "rv-4", subjectType: "specialist", subjectId: "spc-sarah-coleman", rating: 5, comment: "Helped me get back to running after a hamstring injury. Would not go anywhere else.", patientName: "Tom B.", conditionId: "co-sports-injury", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-15T00:00:00Z" },
  { id: "rv-5", subjectType: "specialist", subjectId: "spc-dr-priya-anand", rating: 5, comment: "Natural results and a very reassuring manner throughout.", patientName: "Amina R.", conditionId: "co-facial-ageing", verified: false, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-20T00:00:00Z" },
  { id: "rv-6", subjectType: "specialist", subjectId: "spc-dr-michael-osei", rating: 5, comment: "My implant looks and feels completely natural. Excellent care.", patientName: "David L.", conditionId: "co-missing-teeth", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-25T00:00:00Z" },
  { id: "rv-7", subjectType: "specialist", subjectId: "spc-mr-david-okonkwo", rating: 5, comment: "Finally breathing properly after years of blocked sinuses. Excellent surgeon.", patientName: "Priya M.", conditionId: "co-chronic-sinusitis", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-01T00:00:00Z" },
  { id: "rv-8", subjectType: "specialist", subjectId: "spc-dr-fatima-al-rashid", rating: 5, comment: "The first doctor who took my pain seriously. Life-changing care.", patientName: "Chloe W.", conditionId: "co-endometriosis-condition", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-03-05T00:00:00Z" },
{ id: "rv-9", subjectType: "specialist", subjectId: "spc-dr-amara-chukwu", rating: 5, comment: "She spent forty minutes going through the scan with me and was honest that a replacement would not fix the ache at the front of my knee. I appreciated being told that.", patientName: "Alan M.", conditionId: "co-knee-arthritis", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-12T00:00:00Z" },
  { id: "rv-10", subjectType: "specialist", subjectId: "spc-dr-amara-chukwu", rating: 4, comment: "Very good surgeon. The follow-up clinic is the part that made the difference — someone checked on me at six weeks and again at six months.", patientName: "Beverley O.", conditionId: "co-knee-arthritis", verified: true, scores: { communication: 4, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-24T00:00:00Z" },
  { id: "rv-11", subjectType: "specialist", subjectId: "spc-mr-james-whitfield", rating: 5, comment: "Six months of physio first, exactly as he said, and I never needed the operation. Refreshing to meet a surgeon who is not in a hurry to operate.", patientName: "Nathan C.", conditionId: "co-shoulder-impingement", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-01-22T00:00:00Z" },
  { id: "rv-12", subjectType: "specialist", subjectId: "spc-mr-james-whitfield", rating: 5, comment: "Keyhole repair on the rotator cuff. Back at my desk in a fortnight and back in the pool by twelve weeks.", patientName: "Grace A.", conditionId: "co-rotator-cuff-tear", verified: false, scores: { communication: 5, expertise: 5, care: 4, waitTime: 4 }, createdAt: "2026-02-18T00:00:00Z" },
  { id: "rv-13", subjectType: "specialist", subjectId: "spc-sarah-coleman", rating: 5, comment: "Rebuilt my running after a stubborn calf tear. The programme was specific and she adjusted it every fortnight rather than handing me a sheet.", patientName: "Isaac T.", conditionId: "co-sports-injury", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-01-30T00:00:00Z" },
  { id: "rv-14", subjectType: "specialist", subjectId: "spc-sarah-coleman", rating: 4, comment: "Genuinely knowledgeable and easy to talk to. Sessions run to time, which not everywhere manages.", patientName: "Lydia F.", conditionId: "co-sports-injury", verified: false, scores: { communication: 4, expertise: 5, care: 4, waitTime: 5 }, createdAt: "2026-02-27T00:00:00Z" },
  { id: "rv-15", subjectType: "specialist", subjectId: "spc-dr-priya-anand", rating: 5, comment: "Talked me out of half of what I asked for and I am glad she did. Nobody has noticed I have had anything done, which was the point.", patientName: "Sofia N.", conditionId: "co-facial-ageing", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-14T00:00:00Z" },
  { id: "rv-16", subjectType: "specialist", subjectId: "spc-dr-michael-osei", rating: 5, comment: "Two implants over eight months. Every appointment ran to time and the final result matches my other teeth exactly.", patientName: "Femi B.", conditionId: "co-missing-teeth", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-03T00:00:00Z" },
  { id: "rv-17", subjectType: "specialist", subjectId: "spc-dr-michael-osei", rating: 4, comment: "Expensive, but explained clearly why and gave me a written quote before anything started. No surprises at the end.", patientName: "Rachel S.", conditionId: "co-missing-teeth", verified: false, scores: { communication: 5, expertise: 4, care: 4, waitTime: 4 }, createdAt: "2026-03-06T00:00:00Z" },
  { id: "rv-18", subjectType: "specialist", subjectId: "spc-mr-david-okonkwo", rating: 5, comment: "Years of antibiotics from my GP and one operation sorted it. I wish I had been referred sooner.", patientName: "Kieran H.", conditionId: "co-chronic-sinusitis", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-06T00:00:00Z" },
  { id: "rv-19", subjectType: "specialist", subjectId: "spc-dr-fatima-al-rashid", rating: 5, comment: "Eleven years of being told it was normal period pain. She listened, scanned, and had a diagnosis inside a month.", patientName: "Hannah V.", conditionId: "co-endometriosis-condition", verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-16T00:00:00Z" },
  { id: "rv-20", subjectType: "specialist", subjectId: "spc-dr-fatima-al-rashid", rating: 5, comment: "Kind, thorough, and did not rush me when I got upset in the appointment.", patientName: "Ola J.", conditionId: "co-endometriosis-condition", verified: false, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-08T00:00:00Z" },
];

export const reviews = [...curatedReviews, ...demoDirectory.reviews];

/**
 * Two reviews that have been written but not yet published, so the admin
 * moderation queue has something in it the first time anyone opens it in
 * demo mode. They contribute nothing to any rating until approved —
 * which is the whole point of the state.
 */
export const pendingDemoReviews = [
  {
    id: "rv-pending-1",
    subjectType: "specialist",
    subjectId: "spc-dr-amara-chukwu",
    rating: 5,
    comment:
      "Second knee done in March and the difference is night and day. She talked me out of operating on the first one for a year, which I did not want to hear at the time and was completely right about.",
    patientName: "Margaret D.",
    conditionId: "co-knee-arthritis",
    verified: false,
    scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 },
    moderationStatus: "pending",
    createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
  },
  {
    id: "rv-pending-2",
    subjectType: "facility",
    subjectId: "fac-northgate-general-hospital",
    rating: 2,
    comment:
      "Waited nine hours with my father and nobody could tell us what was happening. The nurse who eventually saw him was excellent but the wait was not acceptable.",
    patientName: "Anonymous",
    conditionId: null,
    verified: false,
    scores: { communication: 2, expertise: 4, care: 3, waitTime: 1 },
    moderationStatus: "pending",
    // Deliberately older than 24 hours, so the overdue sweep has a real
    // case to find rather than only firing in production.
    createdAt: new Date(Date.now() - 31 * 3600_000).toISOString(),
  },
];

/**
 * Everything seeded is treated as already published — it stands in for
 * a directory that has been running a while. Anything written during a
 * demo session lands pending, exactly as it would with a database.
 */
reviews.forEach((r) => {
  r.moderationStatus = r.moderationStatus ?? "approved";
});
reviews.push(pendingDemoReviews[0]);

/** Only approved rows count towards a rating or reach a profile. */
export function approvedReviews(rows) {
  return rows.filter((r) => r.moderationStatus === "approved");
}

/**
 * Approved reviews of one specialist, newest first.
 *
 * The order is the point. The database path already sorts by createdAt
 * descending; demo mode did not, so a review sat wherever it happened to
 * be pushed onto the array — at the end. The profile shows one review at
 * a time starting at index 0, so a review an admin had just approved
 * appeared to have gone nowhere: the count went up, the quote on screen
 * did not change, and you had to click through four older ones to find
 * it. One helper, so the two modes cannot disagree about the order again.
 */
export function specialistReviews(specialistId) {
  return approvedReviews(
    reviews.filter((r) => r.subjectType === "specialist" && r.subjectId === specialistId)
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Ratings are derived, never typed.
 *
 * data/seed.js recomputes every aggregate from the review rows it just
 * inserted; this is the same rule for the mode without a database. It
 * matters beyond tidiness: with a typed count, approving or rejecting a
 * review recomputes the average and the displayed figure lurches — the
 * moderation queue looked broken when it was the seeded number that was
 * wrong all along.
 */
specialists.forEach((sp) => {
  const own = specialistReviews(sp.id);
  Object.assign(sp, deriveRating(own));
});

// ── Composition helpers — build the same response shape the real
// Mongoose-backed controllers produce (see src/controllers/*.js) ──────────

function cityForLocation(locationId) {
  const loc = clinicLocations.find((l) => l.id === locationId);
  const city = cities.find((c) => c.id === loc?.cityId);
  if (!loc || !city) throw new Error(`mock data: missing city for location ${locationId}`);
  return { ...loc, city };
}

// Demo data stores availability as a day offset (nextAvailableInDays)
// rather than a fixed date, so the dataset never goes stale. The API
// shape is a real ISO timestamp — `nextAvailableAt` — which is exactly
// what a live booking integration (or the specialist submission form)
// would write to the Specialist record.
export function nextAvailableIso(days) {
  if (days == null) return null;
  const d = new Date();
  d.setUTCHours(9, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function buildSpecialistWithRelations(specialist) {
  const primarySpecialty = specialties.find((s) => s.id === specialist.primarySpecialtyId) ?? null;
  const regulator = regulators.find((r) => r.id === specialist.regulatorId) ?? null;

  const clinicLocationsForSpecialist = specialistClinicLocations
    .filter((l) => l.specialistId === specialist.id)
    .map((link) => {
      const location = cityForLocation(link.clinicLocationId);
      if (!location) return null;
      /* Explicitly null, never undefined.
       *
       * `.find()` returns undefined for an address that belongs to no
       * clinic — a specialist's own practice — and undefined vanishes
       * through JSON.stringify, so the field simply was not there. Any
       * page reading `location.clinic.name` then threw on a shape it
       * had been told was impossible. Null survives serialisation and
       * says what is true: this address has no clinic. */
      const clinic = clinics.find((c) => c.id === location.clinicId) ?? null;
      return { ...location, clinic };
    })
    // A link whose address has since been removed is dropped rather
    // than carried through as a hole for a page to fall into.
    .filter(Boolean);

  const specialtyIds = new Set(
    [specialist.primarySpecialtyId, ...(specialist.extraSpecialtyIds ?? [])].filter(Boolean)
  );
  const conditionIds = specialistConditions.filter((c) => c.specialistId === specialist.id).map((c) => c.conditionId);
  const treatmentIds = specialistTreatments.filter((t) => t.specialistId === specialist.id).map((t) => t.treatmentId);

  return {
    ...specialist,
    gallery: specialist.gallery ?? [],
    socials: specialist.socials ?? null,
    // The address a Premium profile publishes for patients to write to.
    // It is the same inbox enquiries route to, but publishing it is a
    // plan feature — lib/profileGate.js strips it on Basic.
    publicEmail: specialist.contactEmail ?? null,
    application: specialist.application ?? null,
    verificationHistory: specialist.verificationHistory ?? [],
    nextAvailableAt: nextAvailableIso(specialist.nextAvailableInDays),
    reviewScores: aggregateReviewScores(
      specialistReviews(specialist.id)
    ),
    primarySpecialty,
    regulator,
    clinicLocations: clinicLocationsForSpecialist,
    specialties: specialties.filter((s) => specialtyIds.has(s.id)),
    conditions: conditions.filter((c) => conditionIds.includes(c.id)),
    treatments: treatments.filter((t) => treatmentIds.includes(t.id)),
    // Approved only: an unmoderated review reaches no profile, no card,
    // no average and no structured-data rating.
    reviews: specialistReviews(specialist.id),
  };
}

export function buildClinicWithRelations(clinic) {
  const locations = clinicLocations
    .filter((l) => l.clinicId === clinic.id)
    .map((l) => cityForLocation(l.id));
  const locationIds = new Set(locations.map((l) => l.id));
  const specialistIds = new Set(
    specialistClinicLocations.filter((link) => locationIds.has(link.clinicLocationId)).map((link) => link.specialistId)
  );
  return {
    ...clinic,
    locations,
    specialists: specialists.filter((s) => specialistIds.has(s.id)),
  };
}

export const mockSpecialistsWithRelations = specialists.map(buildSpecialistWithRelations);
export const mockClinicsWithRelations = clinics.map(buildClinicWithRelations);
export const topLevelSpecialties = topLevelOf(specialties);

// Direct children of a top-level specialty (e.g. "orthopaedics" ->
// Knee, Hip, Shoulder & Elbow, ...) — the mid-tier used for the
// chained search-bar dropdown. The much narrower third tier (e.g.
// "Total Knee Replacement") is what specialists are actually tagged
// with; it's used for matching, not as its own dropdown.
export function subspecialtiesOf(specialtySlug) {
  return childrenOf(specialties, specialtySlug);
}

// A specialist is tagged only with their narrowest (sub-sub)specialty,
// never its ancestors — so a search scoped to a top-level or mid-level
// slug needs to match anyone tagged anywhere underneath it, not just an
// exact slug match. Returns that slug plus every descendant slug.
export function specialtyBranchSlugs(specialtySlug) {
  return branchSlugs(specialties, specialtySlug);
}

export const topLevelFacilityCategories = topLevelOf(facilityCategories);

export function facilityCategoryChildrenOf(categorySlug) {
  return childrenOf(facilityCategories, categorySlug);
}

export function facilityCategoryBranchSlugs(categorySlug) {
  return branchSlugs(facilityCategories, categorySlug);
}

// ── Facilities — places (hospitals, care homes, pharmacies, clinics),
// not people. A separate directory from Specialist, tagged from the
// facilityCategories taxonomy above instead of the clinical specialties
// tree. Two per branch, spanning most of the demo cities. ─────────────

function facilityCategorySlugToId(slug) {
  const node = facilityCategories.find((c) => c.slug === slug);
  if (!node) throw new Error(`mock data: unknown facility category slug "${slug}"`);
  return node.id;
}

/**
 * Opening-hours helper. A day is `{ open, close }` or null for closed;
 * the whole object absent means "not published", which the profile
 * distinguishes from "closed" rather than guessing.
 */
function hours(spec) {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const out = {};
  days.forEach((d) => {
    out[d] = spec[d] ?? null;
  });
  if (spec.notes) out.notes = spec.notes;
  return out;
}
const WEEKDAYS = (open, close) => ({ mon: { open, close }, tue: { open, close }, wed: { open, close }, thu: { open, close }, fri: { open, close } });

export const facilities = [
  {
    id: "fac-queens-cross-private-hospital", slug: "queens-cross-private-hospital", name: "Queen's Cross Private Hospital",
    facilityType: "hospital",
    tagline: "Private acute care and day surgery on Harley Street",
    description: "A private acute hospital in central London offering orthopaedic surgery, day case procedures and full diagnostic imaging.",
    about:
      "Queen's Cross has operated from the same Harley Street building since 1974, and now runs four theatres, a twelve-bed inpatient ward and an on-site imaging suite. Most of what we do is planned orthopaedic and general surgery — hips, knees, shoulders, hernias — where a patient has already seen a consultant and wants the operation done without a long wait.\n\nWe are consultant-led throughout: the surgeon who assesses you is the surgeon who operates and the one who sees you at your follow-up. There is no rotating team and no handover to a trainee. Around three quarters of our work is self-pay, with the rest covered by the major insurers; we publish a fixed-price package for the twenty most common procedures so you know the total before you commit.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/queens-cross", bookingUrl: null,
    phone: "020 7946 0700", contactEmail: "enquiries@queenscross.example", contactPhone: "020 7946 0701",
    categorySlugs: ["private-general-hospital", "orthopaedic-hospital", "day-surgery"],
    cityId: "city-london", address: "24 Harley Street", postcode: "W1G 9QD",
    lat: 51.5187, lng: -0.1479,
    regulator: "cqc", regulatorRef: "1-101234567", regulatorRating: "outstanding",
    regulatorRatedAt: "2025-11-18T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-101234567",
    yearEstablished: 1974, bedCount: 12, staffCount: 140,
    openingHours: hours({ ...WEEKDAYS("07:00", "20:00"), sat: { open: "08:00", close: "16:00" }, notes: "Inpatient ward staffed around the clock; outpatient reception closes at 20:00." }),
    open24h: false, emergencyDepartment: false,
    languages: ["English", "French", "Arabic"],
    amenities: ["on-site-parking", "wheelchair-access", "accessible-wc", "public-transport", "hearing-loop", "on-site-imaging", "on-site-pharmacy", "on-site-pathology", "overnight-stay", "private-rooms"],
    insurers: ["Bupa", "AXA Health", "Aviva", "Vitality", "Self-pay"],
    accreditations: ["CQC registered", "JAG accredited endoscopy unit", "ISO 9001:2015"],
    teamRoles: {
      "spc-dr-amara-chukwu": "Consultant Orthopaedic Surgeon",
      "spc-mr-james-whitfield": "Consultant Shoulder & Elbow Surgeon",
    },
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-01-10T00:00:00Z", planActivatedAt: "2026-01-10T00:00:00Z", planRenewsAt: "2027-01-10T00:00:00Z",
    verificationStatus: "verified", ratingAvg: 4.8, ratingCount: 56,
  },
  {
    id: "fac-northgate-general-hospital", slug: "northgate-general-hospital", name: "Northgate General Hospital",
    facilityType: "hospital",
    tagline: "NHS acute teaching hospital with a 24-hour emergency department",
    description: "An NHS acute teaching hospital serving Greater Manchester, with a 24-hour emergency department and intensive care unit.",
    about:
      "Northgate is the main acute hospital for central and south Manchester, taking around 110,000 emergency attendances a year alongside planned surgery, maternity and a regional vascular service. It is a teaching hospital: undergraduate students and doctors in training work here under consultant supervision, which is why you may meet more than one clinician during an admission.\n\nThe emergency department is open every hour of every day and does not require an appointment or a referral. Outpatient clinics run on a referral basis through your GP or another hospital. Car parking is chargeable and fills early — the Oxford Road tram stop is a four-minute walk from the main entrance.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/northgate", bookingUrl: null,
    phone: "0161 234 0800", contactEmail: "pals@northgate.example", contactPhone: "0161 234 0801",
    categorySlugs: ["nhs-acute-hospital", "nhs-teaching-hospital", "emergency-department", "intensive-care"],
    cityId: "city-manchester", address: "1 Oxford Road", postcode: "M13 9WL",
    lat: 53.4629, lng: -2.2296,
    regulator: "cqc", regulatorRef: "1-102345678", regulatorRating: "good",
    regulatorRatedAt: "2025-06-04T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-102345678",
    yearEstablished: 1908, bedCount: 740, staffCount: 6200,
    openingHours: null,
    open24h: true, emergencyDepartment: true,
    languages: ["English", "Urdu", "Polish", "Bengali", "British Sign Language"],
    amenities: ["on-site-parking", "wheelchair-access", "accessible-wc", "public-transport", "hearing-loop", "interpreter", "on-site-imaging", "on-site-pharmacy", "on-site-pathology", "overnight-stay", "critical-care", "childrens-ward"],
    insurers: [],
    accreditations: ["CQC registered", "University teaching hospital", "Major trauma unit"],
    teamRoles: { "spc-mr-david-okonkwo": "Consultant ENT Surgeon" },
    plan: "basic", planInterval: "yearly", planStatus: "active",
    verificationStatus: "verified", ratingAvg: 4.3, ratingCount: 210,
  },
  {
    id: "fac-solihull-manor-care-home", slug: "solihull-manor-care-home", name: "Solihull Manor Care Home",
    facilityType: "care_home",
    tagline: "Residential, nursing and dementia care in landscaped grounds",
    description: "Residential and nursing care with a dedicated dementia unit, set in landscaped gardens on the edge of Solihull.",
    about:
      "Solihull Manor is a 64-bed home offering residential care, nursing care and a separate 18-bed dementia household with its own secure garden. Every bedroom is en-suite; twelve of them are on the ground floor with direct access to the grounds.\n\nOur staffing is deliberately steady rather than large — the same carers work with the same residents, and a registered nurse is on site day and night. Families are welcome at any hour without booking, and we keep no formal visiting times. Fees are all-inclusive apart from hairdressing and chiropody, and we will always tell you the weekly figure in writing before a trial stay.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/solihull-manor", bookingUrl: null,
    phone: "0121 704 0900", contactEmail: "admissions@solihullmanor.example", contactPhone: "0121 704 0901",
    categorySlugs: ["nursing-home-care", "residential-dementia-care", "long-term-residential-care"],
    cityId: "city-solihull", address: "12 Warwick Road", postcode: "B91 3DA",
    lat: 52.4118, lng: -1.7752,
    regulator: "cqc", regulatorRef: "1-103456789", regulatorRating: "good",
    regulatorRatedAt: "2025-09-22T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-103456789",
    yearEstablished: 1998, bedCount: 64, staffCount: 88,
    openingHours: null,
    open24h: true, emergencyDepartment: false,
    languages: ["English", "Punjabi"],
    amenities: ["on-site-parking", "wheelchair-access", "accessible-wc", "hearing-loop", "private-rooms", "ensuite-rooms", "garden", "pets-welcome", "visiting-anytime", "on-site-nurse", "activities-programme"],
    insurers: [],
    accreditations: ["CQC registered", "Dementia Care Matters accredited"],
    teamRoles: {},
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2025-12-02T00:00:00Z", planActivatedAt: "2025-12-02T00:00:00Z", planRenewsAt: "2026-12-02T00:00:00Z",
    verificationStatus: "verified", ratingAvg: 4.6, ratingCount: 38,
  },
  {
    id: "fac-willowbrook-house", slug: "willowbrook-house", name: "Willowbrook House",
    facilityType: "care_home",
    tagline: "Long-term and palliative care, with respite stays for carers",
    description: "Long-term residential and palliative care in Leeds, with respite stays available for carer breaks.",
    about:
      "Willowbrook is a 32-bed home in Roundhay taking long-term residents and short respite stays, usually one to four weeks, so that a family carer can take a break or recover from their own illness.\n\nWe have a standing relationship with the local hospice team, and a third of our residents are with us for end-of-life care. That shapes how the home runs: quiet, unhurried, no fixed mealtimes, and relatives able to stay overnight in the room. The house is Victorian and, honestly, has more stairs than a modern build — there is a passenger lift, but if step-free matters to you it is worth visiting before you decide.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: null, bookingUrl: null,
    phone: "0113 234 0950", contactEmail: "hello@willowbrookhouse.example", contactPhone: "0113 234 0951",
    categorySlugs: ["long-term-residential-care", "palliative-care", "respite-and-short-stay-respite-care"],
    cityId: "city-leeds", address: "45 Roundhay Road", postcode: "LS8 4HS",
    lat: 53.8168, lng: -1.5233,
    regulator: "cqc", regulatorRef: "1-104567890", regulatorRating: "requires_improvement",
    regulatorRatedAt: "2026-02-11T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-104567890",
    yearEstablished: 2004, bedCount: 32, staffCount: 41,
    openingHours: null,
    open24h: true, emergencyDepartment: false,
    languages: ["English"],
    amenities: ["on-site-parking", "accessible-wc", "garden", "visiting-anytime", "on-site-nurse", "activities-programme"],
    insurers: [],
    accreditations: ["CQC registered"],
    teamRoles: {},
    plan: "basic", planInterval: "yearly", planStatus: "active",
    verificationStatus: "verified", ratingAvg: 4.5, ratingCount: 22,
  },
  {
    id: "fac-colmore-row-pharmacy", slug: "colmore-row-pharmacy", name: "Colmore Row Pharmacy",
    facilityType: "pharmacy",
    tagline: "Independent community pharmacy in the business district",
    description: "Independent community pharmacy in central Birmingham offering prescriptions, vaccinations and travel health advice.",
    about:
      "A single-site independent pharmacy on Colmore Row, run by the same pharmacist since 2011. Alongside NHS and private dispensing we run a walk-in travel clinic — yellow fever, rabies, typhoid, malaria advice — and seasonal flu and COVID vaccination without an appointment.\n\nThere is a private consultation room off the shop floor for anything you would rather not discuss at the counter. Prescriptions ordered before 11am are usually ready the same afternoon, and we deliver free within the B1–B4 postcodes.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/colmore-row-pharmacy", bookingUrl: null,
    phone: "0121 496 0999", contactEmail: "team@colmorerx.example", contactPhone: null,
    categorySlugs: ["prescription-dispensing", "flu-vaccination", "travel-health-consultation"],
    cityId: "city-birmingham", address: "36 Colmore Row", postcode: "B3 2BH",
    lat: 52.4809, lng: -1.9012,
    regulator: "gphc", regulatorRef: "9010234", regulatorRating: null,
    regulatorRatedAt: null,
    regulatorUrl: "https://www.pharmacyregulation.org/registers",
    yearEstablished: 2011, bedCount: null, staffCount: 7,
    openingHours: hours({ ...WEEKDAYS("08:30", "18:30"), sat: { open: "09:00", close: "17:00" }, notes: "Closed Sundays and bank holidays." }),
    open24h: false, emergencyDepartment: false,
    languages: ["English", "Gujarati", "Urdu"],
    amenities: ["wheelchair-access", "public-transport", "walk-in", "prescription-delivery", "consultation-room"],
    insurers: [],
    accreditations: ["GPhC registered premises", "Healthy Living Pharmacy Level 2"],
    teamRoles: {},
    plan: "basic", planInterval: "yearly", planStatus: "active",
    verificationStatus: "verified", ratingAvg: 4.7, ratingCount: 64,
  },
  {
    id: "fac-cityside-pharmacy", slug: "cityside-pharmacy", name: "Cityside Pharmacy",
    facilityType: "pharmacy",
    tagline: "Repeat prescriptions and health checks near Moorgate",
    description: "A busy City of London pharmacy offering repeat prescriptions, health checks and sexual health services.",
    about:
      "Cityside sits directly opposite Moorgate station and is built around people collecting on the way to or from work. Repeat prescriptions can be nominated to us electronically and picked up from a collection point that stays open until 19:00.\n\nWe run blood pressure and cholesterol checks without an appointment, and provide emergency contraception and chlamydia testing free under the local NHS scheme. The pharmacy is small and gets very busy between 08:00 and 09:15 — later in the morning is quieter if you need to speak to the pharmacist properly.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: null, bookingUrl: null,
    phone: "020 7946 0999", contactEmail: "moorgate@cityside.example", contactPhone: null,
    categorySlugs: ["repeat-prescriptions", "blood-pressure-check", "emergency-contraception"],
    cityId: "city-london", address: "102 Moorgate", postcode: "EC2M 6SQ",
    lat: 51.5186, lng: -0.0884,
    regulator: "gphc", regulatorRef: "9010891", regulatorRating: null,
    regulatorRatedAt: null,
    regulatorUrl: "https://www.pharmacyregulation.org/registers",
    yearEstablished: 2016, bedCount: null, staffCount: 5,
    openingHours: hours({ ...WEEKDAYS("07:30", "19:00"), notes: "Weekends closed — nearest Sunday pharmacy is at Liverpool Street." }),
    open24h: false, emergencyDepartment: false,
    languages: ["English", "Romanian"],
    amenities: ["wheelchair-access", "public-transport", "walk-in", "consultation-room"],
    insurers: [],
    accreditations: ["GPhC registered premises"],
    teamRoles: {},
    plan: "basic", planInterval: "yearly", planStatus: "active",
    verificationStatus: "verified", ratingAvg: 4.4, ratingCount: 29,
  },
  {
    id: "fac-one-stop-orthopaedic-clinic-birmingham", slug: "one-stop-orthopaedic-clinic-birmingham", name: "One-Stop Orthopaedic Clinic Birmingham",
    facilityType: "clinic",
    tagline: "Assessment, imaging and a treatment plan in a single visit",
    description: "Same-day assessment, imaging and treatment planning for knee, hip and shoulder problems, alongside physiotherapy.",
    about:
      "The clinic exists to collapse what is normally three appointments into one. You see a consultant, have whatever imaging that consultation calls for in the same building, and leave with the scan reported and a plan agreed — usually within two and a half hours.\n\nWe cover knees, hips, shoulders and sports injuries. Physiotherapy runs from the same floor, so if the answer is rehabilitation rather than surgery you can start that week. We are not an emergency service: a suspected fracture or an acutely hot, swollen joint should go to A&E rather than wait for a clinic slot.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/one-stop-ortho", bookingUrl: "https://example.org/one-stop-ortho/book",
    phone: "0121 496 1000", contactEmail: "bookings@onestoportho.example", contactPhone: "0121 496 1001",
    categorySlugs: ["one-stop-orthopaedic-clinic", "physiotherapy-clinic"],
    cityId: "city-birmingham", address: "50 Colmore Row", postcode: "B3 2AP",
    lat: 52.4813, lng: -1.9028,
    regulator: "cqc", regulatorRef: "1-105678901", regulatorRating: "outstanding",
    regulatorRatedAt: "2025-10-30T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-105678901",
    yearEstablished: 2018, bedCount: null, staffCount: 26,
    openingHours: hours({ ...WEEKDAYS("08:00", "19:00"), sat: { open: "09:00", close: "14:00" } }),
    open24h: false, emergencyDepartment: false,
    languages: ["English", "Punjabi", "Polish"],
    amenities: ["on-site-parking", "wheelchair-access", "accessible-wc", "public-transport", "on-site-imaging", "walk-in", "same-day-appointments", "evening-clinics", "weekend-clinics"],
    insurers: ["Bupa", "AXA Health", "WPA", "Self-pay"],
    accreditations: ["CQC registered", "CSP registered physiotherapy team"],
    teamRoles: {
      "spc-dr-amara-chukwu": "Consultant Knee Surgeon",
      "spc-sarah-coleman": "Lead Physiotherapist",
    },
    plan: "clinwell", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2026-02-01T00:00:00Z", planActivatedAt: "2026-02-01T00:00:00Z", planRenewsAt: "2027-02-01T00:00:00Z",
    verificationStatus: "verified", ratingAvg: 4.9, ratingCount: 71,
  },
  {
    id: "fac-finsbury-diagnostic-imaging-centre", slug: "finsbury-diagnostic-imaging-centre", name: "Finsbury Diagnostic & Imaging Centre",
    facilityType: "clinic",
    tagline: "Walk-in MRI, X-ray and ultrasound with same-day reporting",
    description: "Walk-in MRI, X-ray and ultrasound imaging in central London, with same-day reporting for referring specialists.",
    about:
      "Finsbury is an imaging-only centre: we do not run clinics and we do not treat. You come with a referral — from a consultant, a GP, a physiotherapist or an osteopath — have the scan, and the report goes back to whoever referred you, usually the same working day and always within 24 hours.\n\nWe run a 3T MRI, a wide-bore 1.5T for patients who find scanners difficult, digital X-ray and consultant-delivered ultrasound. The wide-bore scanner is genuinely more open than a standard one and takes patients up to 200kg; if claustrophobia is the reason you have put a scan off, say so when you book and we will allocate that machine.",
    photoUrl: null, coverImageUrl: null,
    websiteUrl: "https://example.org/finsbury-imaging", bookingUrl: "https://example.org/finsbury-imaging/book",
    phone: "020 7946 1100", contactEmail: "bookings@finsburyimaging.example", contactPhone: "020 7946 1101",
    categorySlugs: ["imaging-centre", "mri-clinic", "ultrasound-clinic"],
    cityId: "city-london", address: "90 City Road", postcode: "EC1Y 2BN",
    lat: 51.5253, lng: -0.0876,
    regulator: "cqc", regulatorRef: "1-106789012", regulatorRating: "good",
    regulatorRatedAt: "2025-08-14T00:00:00Z",
    regulatorUrl: "https://www.cqc.org.uk/location/1-106789012",
    yearEstablished: 2013, bedCount: null, staffCount: 19,
    openingHours: hours({ ...WEEKDAYS("07:00", "21:00"), sat: { open: "08:00", close: "18:00" }, sun: { open: "10:00", close: "16:00" } }),
    open24h: false, emergencyDepartment: false,
    languages: ["English", "Spanish"],
    amenities: ["wheelchair-access", "accessible-wc", "public-transport", "hearing-loop", "on-site-imaging", "walk-in", "same-day-appointments", "evening-clinics", "weekend-clinics"],
    insurers: ["Bupa", "AXA Health", "Aviva", "Vitality", "WPA", "Self-pay"],
    accreditations: ["CQC registered", "ISAS accredited imaging service"],
    teamRoles: { "spc-mr-david-okonkwo": "Reporting Radiologist (ENT)" },
    plan: "premium", planInterval: "yearly", planStatus: "active",
    planSelectedAt: "2025-11-20T00:00:00Z", planActivatedAt: "2025-11-20T00:00:00Z", planRenewsAt: "2026-11-20T00:00:00Z",
    verificationStatus: "verified", ratingAvg: 4.7, ratingCount: 45,
  },
];

/**
 * Reviews of places, in the same table and the same shape as reviews of
 * people — `subjectType: "facility"`. Keeping one review model means the
 * rating maths, the category breakdown and the moderation rules cannot
 * drift apart between the two halves of the directory.
 */
export const facilityReviews = [
  { id: "frv-1", subjectType: "facility", subjectId: "fac-queens-cross-private-hospital", rating: 5, comment: "Admitted at seven, knee replaced by eleven, home the next afternoon. The surgeon saw me himself both mornings.", patientName: "Geoffrey T.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-01-14T00:00:00Z" },
  { id: "frv-2", subjectType: "facility", subjectId: "fac-queens-cross-private-hospital", rating: 4, comment: "Excellent clinically. Parking is the weak point — I would use the NCP round the corner next time.", patientName: "Yasmin A.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 4, waitTime: 4 }, createdAt: "2026-02-02T00:00:00Z" },
  { id: "frv-3", subjectType: "facility", subjectId: "fac-northgate-general-hospital", rating: 4, comment: "Four hours in A&E on a Friday night, which is what you expect, but the staff were calm and kept us informed.", patientName: "Marcus D.", conditionId: null, verified: false, scores: { communication: 4, expertise: 5, care: 4, waitTime: 3 }, createdAt: "2026-01-28T00:00:00Z" },
  { id: "frv-4", subjectType: "facility", subjectId: "fac-solihull-manor-care-home", rating: 5, comment: "Mum has been in the dementia household eighteen months. Same faces every week, and they ring me before I have to ring them.", patientName: "Helen R.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-08T00:00:00Z" },
  { id: "frv-5", subjectType: "facility", subjectId: "fac-solihull-manor-care-home", rating: 4, comment: "Good home, genuinely warm staff. The building shows its age in places but the care does not.", patientName: "Nadia K.", conditionId: null, verified: false, scores: { communication: 4, expertise: 4, care: 5, waitTime: 4 }, createdAt: "2026-02-19T00:00:00Z" },
  { id: "frv-6", subjectType: "facility", subjectId: "fac-willowbrook-house", rating: 5, comment: "They let us stay in Dad's room for the last three nights. I will never forget how they handled it.", patientName: "Christopher B.", conditionId: null, verified: true, scores: { communication: 5, expertise: 4, care: 5, waitTime: 4 }, createdAt: "2026-01-09T00:00:00Z" },
  { id: "frv-7", subjectType: "facility", subjectId: "fac-colmore-row-pharmacy", rating: 5, comment: "Sorted my travel jabs in one visit and rang the surgery themselves when a prescription went missing.", patientName: "Priti S.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-21T00:00:00Z" },
  { id: "frv-8", subjectType: "facility", subjectId: "fac-cityside-pharmacy", rating: 4, comment: "Fast and open early, which is all I need. Very cramped at rush hour.", patientName: "Owen M.", conditionId: null, verified: false, scores: { communication: 4, expertise: 4, care: 4, waitTime: 5 }, createdAt: "2026-02-26T00:00:00Z" },
  { id: "frv-9", subjectType: "facility", subjectId: "fac-one-stop-orthopaedic-clinic-birmingham", rating: 5, comment: "Consultant, MRI and the plan in one morning, after nine months of being passed around.", patientName: "Leanne F.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-02T00:00:00Z" },
  { id: "frv-10", subjectType: "facility", subjectId: "fac-finsbury-diagnostic-imaging-centre", rating: 5, comment: "The wide-bore scanner made it possible at all — I had cancelled two previous MRIs elsewhere.", patientName: "Dominic W.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-04T00:00:00Z" },
{ id: "frv-11", subjectType: "facility", subjectId: "fac-queens-cross-private-hospital", rating: 5, comment: "Hernia repair as a day case. Arrived at seven, home by two, and the discharge nurse rang the next morning to check on me.", patientName: "Ian F.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-17T00:00:00Z" },
  { id: "frv-12", subjectType: "facility", subjectId: "fac-northgate-general-hospital", rating: 5, comment: "My son was admitted to the children's ward overnight. The staff were brilliant with him and let me stay in the room.", patientName: "Aisha R.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 4 }, createdAt: "2026-02-09T00:00:00Z" },
  { id: "frv-13", subjectType: "facility", subjectId: "fac-northgate-general-hospital", rating: 3, comment: "Clinical care was fine. Parking took twenty-five minutes and cost more than the prescription.", patientName: "Gordon L.", conditionId: null, verified: false, scores: { communication: 3, expertise: 4, care: 4, waitTime: 3 }, createdAt: "2026-02-23T00:00:00Z" },
  { id: "frv-14", subjectType: "facility", subjectId: "fac-willowbrook-house", rating: 4, comment: "Warm, unhurried, and honest with us about what they could and could not manage. The stairs are a genuine consideration.", patientName: "Susan E.", conditionId: null, verified: true, scores: { communication: 5, expertise: 4, care: 5, waitTime: 4 }, createdAt: "2026-02-11T00:00:00Z" },
  { id: "frv-15", subjectType: "facility", subjectId: "fac-solihull-manor-care-home", rating: 5, comment: "The garden is what sold it to Mum. She is out in it most afternoons and the activities staff go out with her.", patientName: "Paul W.", conditionId: null, verified: false, scores: { communication: 4, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-03-01T00:00:00Z" },
  { id: "frv-16", subjectType: "facility", subjectId: "fac-colmore-row-pharmacy", rating: 5, comment: "The pharmacist noticed an interaction between two things my GP had prescribed and rang the surgery about it.", patientName: "Elaine M.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-28T00:00:00Z" },
  { id: "frv-17", subjectType: "facility", subjectId: "fac-cityside-pharmacy", rating: 5, comment: "Blood pressure check with no appointment on my lunch break, and they wrote the numbers down for me to take to my GP.", patientName: "Tunde A.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 4, waitTime: 5 }, createdAt: "2026-03-05T00:00:00Z" },
  { id: "frv-18", subjectType: "facility", subjectId: "fac-one-stop-orthopaedic-clinic-birmingham", rating: 5, comment: "Hip assessed, scanned and explained in one morning. The physio started the same week.", patientName: "Bernadette Q.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-20T00:00:00Z" },
  { id: "frv-19", subjectType: "facility", subjectId: "fac-one-stop-orthopaedic-clinic-birmingham", rating: 4, comment: "Excellent service, though the fixed price does not cover the scan if you need two of them. Worth asking up front.", patientName: "Callum Y.", conditionId: null, verified: false, scores: { communication: 4, expertise: 5, care: 4, waitTime: 5 }, createdAt: "2026-03-07T00:00:00Z" },
  { id: "frv-20", subjectType: "facility", subjectId: "fac-finsbury-diagnostic-imaging-centre", rating: 5, comment: "Scanned at seven in the morning and my consultant had the report before her afternoon clinic.", patientName: "Marta K.", conditionId: null, verified: true, scores: { communication: 5, expertise: 5, care: 5, waitTime: 5 }, createdAt: "2026-02-25T00:00:00Z" },
];

facilityReviews.forEach((r) => {
  r.moderationStatus = r.moderationStatus ?? "approved";
});
facilityReviews.push(pendingDemoReviews[1]);

/** Flat (facilityId, specialistId, role) rows — the facilityTeam table. */
export const facilityTeamLinks = facilities.flatMap((f) =>
  Object.entries(f.teamRoles ?? {}).map(([specialistId, role]) => ({
    facilityId: f.id,
    specialistId,
    role,
  }))
);

export function buildFacilityWithRelations(facility) {
  const city = cities.find((c) => c.id === facility.cityId);
  const categoryIds = new Set(facility.categorySlugs.map(facilityCategorySlugToId));
  // `teamRoles` is authoring shorthand, not part of the API contract —
  // it is expanded into `team` here and never serialised as itself.
  const { teamRoles, ...rest } = facility;
  const team = Object.entries(teamRoles ?? {})
    .map(([specialistId, role]) => {
      const sp = specialists.find((s) => s.id === specialistId);
      if (!sp) return null;
      return {
        id: sp.id,
        slug: sp.slug,
        fullName: sp.fullName,
        title: sp.title,
        photoUrl: sp.photoUrl ?? null,
        verificationStatus: sp.verificationStatus,
        ratingAvg: sp.ratingAvg,
        ratingCount: sp.ratingCount,
        role,
        primarySpecialty: specialties.find((x) => x.id === sp.primarySpecialtyId) ?? null,
      };
    })
    .filter(Boolean);
  const own = approvedReviews(facilityReviews.filter((r) => r.subjectId === facility.id)).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  return {
    ...rest,
    city,
    categories: facilityCategories.filter((c) => categoryIds.has(c.id)),
    team,
    reviews: own,
    reviewScores: aggregateReviewScores(own),
  };
}

// Same rule as specialists: the figure a card shows is the figure the
// rows support. See the note on the specialist derivation above.
facilities.forEach((f) => {
  Object.assign(f, deriveRating(approvedReviews(facilityReviews.filter((r) => r.subjectId === f.id))));
});

export const mockFacilitiesWithRelations = facilities.map(buildFacilityWithRelations);

/**
 * Demo-mode write path for reviews of places — the mirror of
 * addSpecialistReview, so the two halves of the directory round and
 * aggregate identically without a database.
 */
export function addFacilityReview(facilityId, review) {
  const record = {
    id: `frv-${facilityId}-${Date.now()}`,
    subjectType: "facility",
    subjectId: facilityId,
    conditionId: null,
    createdAt: new Date().toISOString(),
    ...review,
    moderationStatus: "pending",
  };
  facilityReviews.push(record);

  const source = facilities.find((f) => f.id === facilityId);
  return {
    review: record,
    ratingAvg: source?.ratingAvg ?? 0,
    ratingCount: source?.ratingCount ?? 0,
  };
}


/**
 * Demo-mode write path for reviews.
 *
 * Mirrors what the MongoDB path does (see controllers/reviews.controller.js):
 * store the review, then recompute the specialist's cached ratingAvg /
 * ratingCount and category breakdown from the full set of review rows —
 * never by nudging a stored number. Both the raw record and the built
 * relation object are updated so a profile re-read reflects it
 * immediately.
 *
 * The seeded ratingAvg/ratingCount that ship with this demo dataset are
 * placeholders standing in for real review history; the moment a review
 * is written through this function, the aggregate becomes fully derived.
 */
export function addSpecialistReview(specialistId, review) {
  const record = {
    id: `rv-${specialistId}-${Date.now()}`,
    subjectType: "specialist",
    subjectId: specialistId,
    conditionId: null,
    createdAt: new Date().toISOString(),
    // Spread last so a supplied conditionId ("seen for") survives.
    ...review,
    // Born pending, and a caller cannot talk its way past that. Nothing
    // below recomputes a rating, because nothing patients can see has
    // changed yet.
    moderationStatus: "pending",
  };
  reviews.push(record);

  const source = specialists.find((s) => s.id === specialistId);
  return {
    review: record,
    ratingAvg: source?.ratingAvg ?? 0,
    ratingCount: source?.ratingCount ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Demo-mode write helpers
 *
 * Demo mode has no database, so these mutate the in-memory arrays and
 * keep the pre-built relation objects in step. Each one mirrors exactly
 * what the MongoDB path does in the matching controller, so behaviour
 * cannot drift between the two modes.
 * ------------------------------------------------------------------ */

function slugifyName(name) {
  return String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Register a new specialist. Always lands in "pending": registration
 * creates an application for an admin to review, never a live listing.
 */
/**
 * Work out which regulator a registration number belongs to from the
 * prefix the applicant typed ("GMC 1234567"). It is only a first guess to
 * save the reviewer a step — the admin verifies the number against the
 * register either way, and an unrecognised prefix simply leaves it unset.
 */
export function regulatorIdFromNumber(registrationNumber) {
  const prefix = String(registrationNumber ?? "").trim().slice(0, 4).toUpperCase();
  const match = regulators.find((r) => prefix.startsWith(r.code));
  return match?.id ?? null;
}

export function addDemoSpecialist({
  fullName,
  title = null,
  contactEmail = null,
  contactPhone = null,
  registrationNumber = null,
  primarySpecialtySlug = null,
  plan = "basic",
  planInterval = "yearly",
  planStatus = "active",
  websiteUrl = null,
  socials = null,
  bookingUrl = null,
}) {
  const base = slugifyName(fullName);
  let slug = base;
  for (let i = 2; specialists.some((s) => s.slug === slug); i += 1) slug = `${base}-${i}`;

  const primary = primarySpecialtySlug
    ? specialties.find((s) => s.slug === primarySpecialtySlug) ?? null
    : null;

  const record = {
    id: `spc-new-${slug}`,
    slug,
    fullName,
    title,
    photoUrl: null,
    bio: null,
    primarySpecialtyId: primary?.id ?? null,
    extraSpecialtyIds: [],
    regulatorId: regulatorIdFromNumber(registrationNumber),
    registrationNumber,
    verificationStatus: "pending",
    claimed: true,
    consultationPriceMinor: null,
    currency: "GBP",
    languages: ["English"],
    ratingAvg: 0,
    ratingCount: 0,
    nextAvailableInDays: null,
    yearsExperience: null,
    contactEmail,
    contactPhone,
    videoUrl: null,
    videoThumbnailUrl: null,
    videoDurationSeconds: null,
    plan,
    planInterval,
    planStatus,
    planSelectedAt: new Date().toISOString(),
    planActivatedAt: null,
    planRenewsAt: null,
    clinwellWorkspaceId: null,
    coverImageUrl: null,
    gallery: [],
    websiteUrl,
    socials,
    bookingUrl,
    application: { submittedAt: new Date().toISOString(), notes: null, documents: [] },
    verificationHistory: [{ action: "submitted", byName: fullName, at: new Date().toISOString() }],
  };

  specialists.push(record);
  mockSpecialistsWithRelations.push(buildSpecialistWithRelations(record));
  return record;
}

/** Patch a specialist and refresh its built relation object. */
export function updateDemoSpecialist(id, patch) {
  const record = specialists.find((s) => s.id === id);
  if (!record) return null;
  Object.assign(record, patch);
  const idx = mockSpecialistsWithRelations.findIndex((s) => s.id === id);
  const rebuilt = buildSpecialistWithRelations(record);
  if (idx >= 0) mockSpecialistsWithRelations[idx] = rebuilt;
  return rebuilt;
}

/**
 * Record a verification decision: set the status and append to the
 * append-only history, which is what makes an approval accountable.
 */
export function recordDemoVerification(id, { status, action, byName, byUserId = null, note = null }) {
  const record = specialists.find((s) => s.id === id);
  if (!record) return null;
  record.verificationHistory = [
    ...(record.verificationHistory ?? []),
    { action, byName, byUserId, note, at: new Date().toISOString() },
  ];
  return updateDemoSpecialist(id, { verificationStatus: status, verificationHistory: record.verificationHistory });
}

/* ------------------------------------------------------------------ *
 * Treatments and clinic locations
 *
 * Both are separate collections joined to the specialist, so the
 * dashboard cannot just patch a field. These two helpers replace the
 * whole set for one specialist — the same semantics the Mongo branch
 * uses — creating any treatment the platform doesn't have yet under the
 * specialist's own specialty.
 * ------------------------------------------------------------------ */

/** Replace a specialist's treatments, given plain names. */
export function setDemoSpecialistTreatments(specialistId, names) {
  const record = specialists.find((s) => s.id === specialistId);
  if (!record) return null;

  const ids = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    const slug = slugifyName(name);
    let treatment = treatments.find((t) => t.slug === slug);
    if (!treatment) {
      treatment = {
        id: `tr-${slug}`,
        specialtyId: record.primarySpecialtyId ?? null,
        conditionId: null,
        slug,
        name,
        description: null,
      };
      treatments.push(treatment);
    }
    if (!ids.includes(treatment.id)) ids.push(treatment.id);
  }

  // Rewrite the join table in place: this array is exported by
  // reference, so it must be mutated rather than reassigned.
  for (let i = specialistTreatments.length - 1; i >= 0; i -= 1) {
    if (specialistTreatments[i].specialistId === specialistId) specialistTreatments.splice(i, 1);
  }
  ids.forEach((treatmentId) => specialistTreatments.push({ specialistId, treatmentId }));

  return updateDemoSpecialist(specialistId, {});
}

/** Replace a specialist's practice locations. */
export function setDemoSpecialistLocations(specialistId, entries) {
  const record = specialists.find((s) => s.id === specialistId);
  if (!record) return null;

  // Drop the locations this specialist owns outright (ones created from
  // the dashboard), but leave shared clinic addresses alone — other
  // specialists may still be linked to them.
  const ownedPrefix = `loc-own-${specialistId}-`;
  for (let i = clinicLocations.length - 1; i >= 0; i -= 1) {
    if (String(clinicLocations[i].id).startsWith(ownedPrefix)) clinicLocations.splice(i, 1);
  }
  /* Only the links to addresses this specialist owns are dropped.
   *
   * This used to drop every link, which meant a specialist attached to a
   * clinic lost that attachment the first time they pressed Save on
   * anything at all — a bio edit detached them from their hospital. The
   * profile page then rendered a location whose clinic was null, on a
   * page written when that could not happen, and went blank. The blank
   * page was the visible half; the silent half was that the directory
   * quietly forgot where they worked.
   *
   * The database path has always kept shared addresses (see
   * dashboard.controller's `shared`), so this is the two paths agreeing
   * again rather than a new rule. */
  for (let i = specialistClinicLocations.length - 1; i >= 0; i -= 1) {
    const link = specialistClinicLocations[i];
    if (link.specialistId !== specialistId) continue;
    if (String(link.clinicLocationId).startsWith(ownedPrefix)) {
      specialistClinicLocations.splice(i, 1);
    }
  }

  entries.forEach((entry, index) => {
    const city = cities.find((c) => c.id === entry.cityId || c.slug === entry.cityId);
    if (!city || !entry.address) return;
    const id = `${ownedPrefix}${index + 1}`;
    clinicLocations.push({
      id,
      clinicId: entry.clinicId ?? null,
      cityId: city.id,
      address: String(entry.address),
      postcode: entry.postcode ? String(entry.postcode) : null,
      phone: entry.phone ? String(entry.phone) : null,
      // The address's own coordinates when it was picked from the
      // geocoded suggestions; the city centre when it was typed.
      lat: entry.lat ?? city.lat,
      lng: entry.lng ?? city.lng,
    });
    specialistClinicLocations.push({ specialistId, clinicLocationId: id });
  });

  return updateDemoSpecialist(specialistId, {});
}

/* ------------------------------------------------------------------ *
 * Demo-mode moderation
 *
 * The database path lives in db/repos.js; this is the same contract
 * without one, so the admin queue, the approve/reject buttons and the
 * 24-hour chase all work in a demo exactly as they do in production.
 * ------------------------------------------------------------------ */

/** Every review of either kind, in one list, newest first. */
function allReviewRows() {
  return [...reviews, ...facilityReviews];
}

export function reviewsByModeration(status = "pending") {
  return allReviewRows()
    .filter((r) => (r.moderationStatus ?? "approved") === status)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function reviewCountsByModeration() {
  const out = {};
  allReviewRows().forEach((r) => {
    const key = r.moderationStatus ?? "approved";
    out[key] = (out[key] ?? 0) + 1;
  });
  return out;
}

export function findReviewById(id) {
  return allReviewRows().find((r) => r.id === id) ?? null;
}

/**
 * Publish or reject one review, then recompute whatever it belongs to.
 * Recomputing here rather than trusting an increment is what keeps a
 * rejected review from leaving its stars behind in the average.
 */
export function moderateReview(id, { status, byUserId = null, note = null }) {
  const row = findReviewById(id);
  if (!row) return null;
  row.moderationStatus = status;
  row.moderatedByUserId = byUserId;
  row.moderatedAt = new Date().toISOString();
  row.moderationNote = note;

  if (row.subjectType === "facility") {
    const own = approvedReviews(facilityReviews.filter((r) => r.subjectId === row.subjectId)).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const { ratingAvg, ratingCount } = deriveRating(own);
    const source = facilities.find((f) => f.id === row.subjectId);
    if (source) Object.assign(source, { ratingAvg, ratingCount });
    const built = mockFacilitiesWithRelations.find((f) => f.id === row.subjectId);
    if (built) {
      Object.assign(built, { ratingAvg, ratingCount, reviews: own, reviewScores: aggregateReviewScores(own) });
    }
  } else {
    const own = specialistReviews(row.subjectId);
    const { ratingAvg, ratingCount } = deriveRating(own);
    const source = specialists.find((sp) => sp.id === row.subjectId);
    if (source) Object.assign(source, { ratingAvg, ratingCount });
    const built = mockSpecialistsWithRelations.find((sp) => sp.id === row.subjectId);
    if (built) {
      Object.assign(built, { ratingAvg, ratingCount, reviews: own, reviewScores: aggregateReviewScores(own) });
    }
  }
  return row;
}

/** The provider's reply. Published immediately — no approval needed. */
export function respondToReview(id, response) {
  const row = findReviewById(id);
  if (!row) return null;
  row.response = response;
  row.responseAt = new Date().toISOString();
  return row;
}

/** Pending reviews older than the cut-off that have not been chased. */
export function overduePendingReviews(cutoffMs) {
  return reviewsByModeration("pending").filter(
    (r) => !r.reminderSentAt && new Date(r.createdAt).getTime() < cutoffMs
  );
}

export function markReviewReminded(id) {
  const row = findReviewById(id);
  if (row) row.reminderSentAt = new Date().toISOString();
}

/**
 * What the homepage shows: approved reviews with something to read,
 * newest first, each carrying the name of who or what it is about so a
 * card can link straight to that profile. Never fabricated — an empty
 * directory produces an empty list and the section hides itself.
 */
export function featuredApprovedReviews(limit = 12) {
  const specialistRows = approvedReviews(reviews.filter((r) => r.subjectType === "specialist"))
    .filter((r) => r.comment)
    .map((r) => {
      const sp = mockSpecialistsWithRelations.find((x) => x.id === r.subjectId);
      if (!sp) return null;
      return {
        review: r,
        subject: {
          kind: "specialist",
          slug: sp.slug,
          name: sp.fullName,
          subtitle: sp.title ?? sp.primarySpecialty?.name ?? null,
          photoUrl: sp.photoUrl ?? null,
          href: `/specialists/${sp.slug}`,
        },
        seenFor: conditions.find((c) => c.id === r.conditionId)?.name ?? null,
      };
    })
    .filter(Boolean);

  const facilityRows = approvedReviews(facilityReviews)
    .filter((r) => r.comment)
    .map((r) => {
      const f = mockFacilitiesWithRelations.find((x) => x.id === r.subjectId);
      if (!f) return null;
      return {
        review: r,
        subject: {
          kind: "facility",
          slug: f.slug,
          name: f.name,
          subtitle: f.categories[0]?.name ?? null,
          photoUrl: f.photoUrl ?? null,
          facilityType: f.facilityType,
          href: `/facilities/${f.slug}`,
        },
        seenFor: null,
      };
    })
    .filter(Boolean);

  // Verified visits first — the section's claim is that these are real,
  // and a review tied to a booking record is the strongest form of that.
  // Then reviews that name what the patient was seen for, because
  // "Seen for: cataract surgery" is what makes a quote useful rather
  // than decorative. Newest breaks the tie.
  return [...specialistRows, ...facilityRows]
    .sort(
      (a, b) =>
        Number(b.review.verified) - Number(a.review.verified) ||
        Number(Boolean(b.seenFor)) - Number(Boolean(a.seenFor)) ||
        new Date(b.review.createdAt) - new Date(a.review.createdAt)
    )
    .slice(0, limit);
}
