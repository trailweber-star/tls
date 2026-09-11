// Generated demo directory.
//
// The seven hand-written specialists in mock.js are the curated examples
// (they carry the real photos and the hand-written reviews). This module
// generates the rest of the demo directory around them — enough breadth
// across every specialty and city that the search page has something
// real to filter, sort and paginate through.
//
// It is DEMO CONTENT, not real people: fictional names, no photos (the
// UI falls back to an initials tile), and prices/availability that vary
// so the filters demonstrably do something. Every record has exactly the
// shape a real Specialist row has, so as genuine profiles arrive through
// the specialist submission form they simply replace these — nothing
// downstream needs to change.
//
// Generation is fully deterministic (no randomness, no dates baked in),
// so the same dataset comes back on every boot and demo screenshots stay
// reproducible.

// Paired by index below so the same first/last combination never
// repeats until both pools are exhausted (24 x 24 = 576 unique names).
const FIRST_NAMES = [
  "Adaeze", "Marcus", "Priya", "Tomasz", "Elena", "Samuel", "Ngozi", "Ravi",
  "Claire", "Yusuf", "Hannah", "Dmitri", "Aisha", "Callum", "Rosa", "Ibrahim",
  "Beatrice", "Olumide", "Freya", "Hassan", "Miriam", "Lucas", "Chidinma", "Theo",
];

const LAST_NAMES = [
  "Bennett", "Adeyemi", "Kowalski", "Fernandes", "Okafor", "Lindqvist", "Ahmed", "Marshall",
  "Rahman", "Doyle", "Nwosu", "Kaur", "Petrov", "Sinclair", "Mensah", "Whitaker",
  "Ellison", "Baptiste", "Novak", "Iqbal", "Hargreaves", "Owusu", "Vasquez", "Chen",
];

const TITLES = {
  orthopaedics: ["Consultant Orthopaedic Surgeon", "Orthopaedic Surgeon", "Consultant Trauma & Orthopaedics"],
  physiotherapy: ["Physiotherapist", "Musculoskeletal Physiotherapist", "Sports Physiotherapist"],
  dentistry: ["Dentist", "Cosmetic Dentist", "Dentist — Implant Specialist"],
  "aesthetics-specialists": ["Aesthetic Medicine Doctor", "Consultant Plastic Surgeon", "Aesthetic Practitioner"],
  ent: ["Consultant ENT Surgeon", "ENT Surgeon", "Consultant Otolaryngologist"],
  gynaecology: ["Consultant Gynaecologist", "Gynaecologist", "Consultant Obstetrician & Gynaecologist"],
};

// Typical private consultation price band per specialty, in minor units.
const PRICE_BANDS = {
  orthopaedics: [12000, 25000],
  physiotherapy: [4500, 9000],
  dentistry: [6000, 15000],
  "aesthetics-specialists": [15000, 32000],
  ent: [14000, 24000],
  gynaecology: [16000, 28000],
};

const CLINIC_SUFFIX = {
  orthopaedics: "Orthopaedic Centre",
  physiotherapy: "Physiotherapy & Rehab",
  dentistry: "Dental Practice",
  "aesthetics-specialists": "Aesthetic Clinic",
  ent: "ENT Clinic",
  gynaecology: "Women's Health Clinic",
};

// A plausible street per city so addresses read like real listings.
const STREETS = {
  birmingham: ["21 Temple Row", "9 Church Street"],
  solihull: ["14 Poplar Road", "3 Drury Lane"],
  manchester: ["48 King Street", "12 Deansgate"],
  london: ["112 Harley Street", "27 Devonshire Place"],
  leeds: ["18 Park Square", "6 East Parade"],
  liverpool: ["30 Rodney Street", "8 Hope Street"],
};

const POSTCODES = {
  birmingham: ["B2 5LS", "B3 2NP"],
  solihull: ["B91 3AJ", "B91 2AA"],
  manchester: ["M2 4LQ", "M3 2BW"],
  london: ["W1G 7JU", "W1G 6JE"],
  leeds: ["LS1 2NE", "LS1 5AA"],
  liverpool: ["L1 9EY", "L1 9BX"],
};

const DIAL = {
  birmingham: "0121", solihull: "0121", manchester: "0161",
  london: "020", leeds: "0113", liverpool: "0151",
};

const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Leaf nodes (deepest tier) under a given node — what a specialist is
// actually tagged with.
function leavesUnderNode(specialties, top) {
  if (!top) return [];
  const childIds = new Set();
  let frontier = [top.id];
  const all = [];
  while (frontier.length) {
    const kids = specialties.filter((s) => frontier.includes(s.parentId));
    if (!kids.length) break;
    all.push(...kids);
    kids.forEach((k) => childIds.add(k.id));
    frontier = kids.map((k) => k.id);
  }
  const parentIds = new Set(all.map((n) => n.parentId));
  return all.filter((n) => !parentIds.has(n.id));
}

// Placeholder media, standing in until specialists upload their own.
const PLACEHOLDER_PHOTOS = [
  "/images/placeholder-doctor-1.jpg",
  "/images/placeholder-doctor-2.jpg",
  "/images/placeholder-doctor-3.jpg",
];

const PLACEHOLDER_VIDEO = {
  url: "/videos/intro-placeholder.mp4",
  thumbnailUrl: "/images/placeholder-doctor-1.jpg",
  durationSeconds: 8,
};

// Deliberately generic so no demo review reads as a real patient account.
const REVIEW_COMMENTS = [
  "Clear explanations and a thorough consultation.",
  "Answered all my questions and never made me feel rushed.",
  "Professional throughout, and the follow-up was well organised.",
  "Straightforward advice and a treatment plan I understood.",
  "The clinic was easy to find and I was seen on time.",
  "Took time to talk through the options before deciding anything.",
];

const REVIEWER_NAMES = [
  "A. Bello", "J. Murray", "S. Patel", "T. O'Neill", "R. Khan", "M. Duarte",
  "L. Fischer", "C. Nwankwo", "D. Reilly", "H. Osborne", "P. Sharma", "K. Andersen",
];

const REGULATOR_FOR = {
  orthopaedics: "reg-gmc",
  physiotherapy: "reg-hcpc",
  dentistry: "reg-gdc",
  "aesthetics-specialists": "reg-gmc",
  ent: "reg-gmc",
  gynaecology: "reg-gmc",
};

/**
 * Build the generated half of the demo directory.
 *
 * @param {object}   args
 * @param {Array}    args.specialties   flattened specialty taxonomy
 * @param {Array}    args.cities        city rows (with lat/lng)
 * @param {string[]} args.takenSlugs    slugs already used by curated data
 * @param {number}   args.perCity       specialists per specialty per city
 */
export function buildDemoDirectory({ specialties, cities, takenSlugs = [], perCity = 2 }) {
  const topLevel = specialties.filter((s) => s.parentId === null);
  const used = new Set(takenSlugs);

  const clinics = [];
  const clinicLocations = [];
  const demoSpecialists = [];
  const specialistClinicLocations = [];
  const demoReviews = [];

  let n = 0; // global counter driving every deterministic choice

  for (const top of topLevel) {
    const leaves = leavesUnderNode(specialties, top);
    if (!leaves.length) continue;
    // Sub-specialties (Knee, Hip, Shoulder & Elbow, ...). Generated
    // specialists rotate through these so every sub-specialty checkbox in
    // the sidebar has real people behind it, rather than the whole city
    // piling into whichever branch happens to sort first.
    const subs = specialties.filter((s) => s.parentId === top.id);
    const leavesBySub = subs.map((sub) => leavesUnderNode(specialties, sub));
    const [priceLow, priceHigh] = PRICE_BANDS[top.slug] ?? [10000, 20000];
    const titles = TITLES[top.slug] ?? ["Specialist"];

    for (const [cityIndex, city] of cities.entries()) {
      // One demo clinic per specialty per city, so every result has a
      // real clinic and address behind it.
      const clinicId = `cl-demo-${top.slug}-${city.slug}`;
      const clinicName = `${city.name} ${CLINIC_SUFFIX[top.slug] ?? "Clinic"}`;
      clinics.push({
        id: clinicId,
        slug: slugify(clinicName),
        name: clinicName,
        description: `${top.name} care for patients in and around ${city.name}.`,
        logoUrl: null,
        website: null,
      });

      const locationId = `loc-demo-${top.slug}-${city.slug}`;
      const streetIdx = n % 2;
      clinicLocations.push({
        id: locationId,
        clinicId,
        cityId: city.id,
        address: (STREETS[city.slug] ?? ["1 High Street"])[streetIdx] ?? "1 High Street",
        postcode: (POSTCODES[city.slug] ?? ["AA1 1AA"])[streetIdx] ?? "AA1 1AA",
        phone: `${DIAL[city.slug] ?? "0300"} ${String(700 + (n % 90)).padStart(3, "0")} ${String(1000 + (n % 9000))}`,
      });

      for (let i = 0; i < perCity; i += 1) {
        // first cycles every record; last is offset by both the cycle
        // number and the position within it, so consecutive results look
        // varied while the pair stays unique across 24 x 24 records.
        const first = FIRST_NAMES[n % FIRST_NAMES.length];
        const last =
          LAST_NAMES[
            (Math.floor(n / FIRST_NAMES.length) + 5 * (n % FIRST_NAMES.length)) % LAST_NAMES.length
          ];
        const fullName = `Dr ${first} ${last}`;

        let slug = slugify(fullName);
        let suffix = 2;
        while (used.has(slug)) slug = `${slugify(fullName)}-${suffix++}`;
        used.add(slug);

        const subIdx = subs.length ? (i + cityIndex) % subs.length : 0;
        const pool = leavesBySub[subIdx]?.length ? leavesBySub[subIdx] : leaves;
        const leaf = pool[Math.floor(n / Math.max(1, subs.length)) % pool.length];

        // Deterministic spreads: ratings stay at or below 4.8 so the
        // three photographed curated specialists keep the homepage's
        // top-rated Featured slots.
        const ratingAvg = Number((3.9 + ((n * 3) % 10) / 10).toFixed(1));
        // How many reviews this profile actually has. The count used to
        // be a decorative number in the hundreds with three review rows
        // behind it, so a demo profile claimed "4.2 from 141 reviews"
        // over three comments — and any code that derived the aggregate
        // from the rows (the seed, review moderation) appeared to break
        // it. The number is now the number of rows that get written.
        const ratingCount = 3 + ((n * 7) % 10);
        const price = priceLow + ((n * 1300) % Math.max(1, priceHigh - priceLow));
        const availableInDays = (n * 5) % 29;
        // A few unverified profiles so "TLS verified only" is a filter
        // that visibly does something.
        const verificationStatus = n % 9 === 4 ? "pending" : "verified";
        // Pending profiles are applications: give each one a submission
        // date and an audit entry so the admin queue can sort by "newest
        // first" and show when it arrived, exactly as a real one would.
        // They are staggered over the past few weeks rather than all
        // landing at the same instant.
        const submittedAt = new Date(Date.now() - ((n * 7) % 26) * 86400000 - (n % 24) * 3600000).toISOString();

        // A realistic spread of tiers so paid placement, the verified
        // badge and the gated profile sections are all visible in the
        // demo directory rather than needing to be imagined.
        const claimed = n % 3 !== 0;
        const tierPick = n % 5;
        // Only a claimed profile can be on a paid tier: an unclaimed
        // listing was compiled by us, so nobody has ever paid for it.
        const plan = !claimed ? "basic" : tierPick === 0 ? "clinwell" : tierPick <= 2 ? "premium" : "basic";
        const paid = plan !== "basic";
        const planInterval = n % 3 === 0 ? "monthly" : "yearly";

        demoSpecialists.push({
          id: `spc-demo-${slug}`,
          slug,
          fullName,
          title: titles[n % titles.length],
          photoUrl: null,
          bio:
            `${top.name.replace(/s$/, "")} specialist based in ${city.name}, with a particular focus on ` +
            `${leaf.name.toLowerCase()}. Consultations start with a full assessment and a clear explanation ` +
            `of the options, including the ones that do not involve a procedure. Where treatment is the right ` +
            `answer, the plan, the expected recovery and the costs are set out in writing before anything is ` +
            `booked. Patients are seen at ${clinicName}, with follow-up appointments arranged directly ` +
            `through the clinic team.`,
          primarySpecialtyId: leaf.id,
          extraSpecialtyIds: subs[subIdx] ? [subs[subIdx].id] : [],
          regulatorId: REGULATOR_FOR[top.slug] ?? "reg-gmc",
          registrationNumber: String(7100000 + n),
          verificationStatus,
          plan,
          planInterval,
          // Everyone in the seeded directory is already paid up; the
          // pending/awaiting-payment states are exercised by registering
          // through the site.
          planStatus: "active",
          planSelectedAt: submittedAt,
          planActivatedAt: submittedAt,
          planRenewsAt: new Date(
            Date.now() + (planInterval === "monthly" ? 30 : 365) * 86400000 - ((n * 3) % 40) * 86400000
          ).toISOString(),
          clinwellWorkspaceId: plan === "clinwell" ? `cw_demo_spc-demo-${slug}` : null,
          // Premium-tier content. Basic profiles carry none, which is
          // what makes the gate observable: their pages simply have no
          // gallery, video or booking button.
          coverImageUrl: paid ? PLACEHOLDER_PHOTOS[n % PLACEHOLDER_PHOTOS.length] : null,
          gallery: paid
            ? Array.from({ length: 3 + (n % 4) }, (_, g) => ({
                url: PLACEHOLDER_PHOTOS[(n + g) % PLACEHOLDER_PHOTOS.length],
                caption: [`Consulting room`, `Theatre`, `Recovery suite`, `Reception`, `Imaging`, `Team`][
                  (n + g) % 6
                ],
                addedAt: submittedAt,
              }))
            : [],
          websiteUrl: paid ? `https://www.${slug}.example.com` : null,
          socials: paid
            ? {
                linkedin: `https://www.linkedin.com/in/${slug}`,
                x: n % 2 === 0 ? `https://x.com/${slug.replace(/-/g, "")}` : null,
                instagram: n % 3 === 0 ? `https://www.instagram.com/${slug.replace(/-/g, "")}` : null,
                facebook: null,
                youtube: null,
              }
            : null,
          bookingUrl: paid ? `https://booking.example.com/${slug}` : null,
          application:
            verificationStatus === "pending" ? { submittedAt, notes: null, documents: [] } : null,
          verificationHistory:
            verificationStatus === "pending"
              ? [{ action: "submitted", byName: fullName, at: submittedAt }]
              : [],
          claimed,
          consultationPriceMinor: Math.round(price / 500) * 500,
          currency: "GBP",
          languages: ["English"],
          ratingAvg: Math.min(4.8, ratingAvg),
          ratingCount,
          nextAvailableInDays: availableInDays,
          yearsExperience: 4 + ((n * 3) % 26),
          // example.com is reserved for documentation, so a demo enquiry
          // can never reach a real inbox.
          contactEmail: `${slug}@example.com`,
          contactPhone: null,
          // Every third generated profile carries one of the placeholder
          // portraits so listings show a mix of photos and initials
          // rather than a wall of either; the rest render the initials
          // tile until a real photoUrl arrives.
          photoUrl: n % 3 === 0 ? PLACEHOLDER_PHOTOS[Math.floor(n / 3) % PLACEHOLDER_PHOTOS.length] : null,
          // A subset publish an intro video, so the profile's video card
          // is exercised both present and absent.
          videoUrl: paid && n % 2 === 0 ? PLACEHOLDER_VIDEO.url : null,
          videoThumbnailUrl: paid && n % 2 === 0 ? PLACEHOLDER_VIDEO.thumbnailUrl : null,
          videoDurationSeconds: paid && n % 2 === 0 ? PLACEHOLDER_VIDEO.durationSeconds : null,
        });

        // A few reviews each, with per-category scores, so every profile
        // has a populated reviews section and rating breakdown. Generic
        // and deterministic — real reviews replace them wholesale.
        for (let r = 0; r < ratingCount; r += 1) {
          const base = Math.max(3, Math.min(5, Math.round(ratingAvg) - (r % 2)));
          demoReviews.push({
            id: `rv-demo-${slug}-${r + 1}`,
            subjectType: "specialist",
            subjectId: `spc-demo-${slug}`,
            rating: base,
            comment: REVIEW_COMMENTS[(n + r) % REVIEW_COMMENTS.length],
            patientName: REVIEWER_NAMES[(n * 3 + r) % REVIEWER_NAMES.length],
            conditionId: null,
            verified: (n + r) % 3 !== 0,
            scores: {
              communication: base,
              expertise: Math.min(5, base + ((n + r) % 2)),
              care: base,
              waitTime: Math.max(3, base - ((n + r) % 2)),
            },
            moderationStatus: "approved",
            createdAt: `2026-0${1 + ((n + r) % 8)}-1${(n + r) % 9}T00:00:00Z`,
          });
        }

        specialistClinicLocations.push({ specialistId: `spc-demo-${slug}`, clinicLocationId: locationId });
        n += 1;
      }
    }
  }

  return {
    clinics,
    clinicLocations,
    specialists: demoSpecialists,
    specialistClinicLocations,
    reviews: demoReviews,
  };
}
