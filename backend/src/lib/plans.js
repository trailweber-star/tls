/* ------------------------------------------------------------------ *
 * The plan catalogue — one source of truth
 *
 * Every price on the pricing page, every tick in the comparison table,
 * every gated field in the signup form, every section the public profile
 * decides to render, and every check the API makes before serialising a
 * premium field all read from THIS file. There is deliberately no second
 * copy of the feature list in the frontend: the pricing page fetches it
 * from /api/plans, so the marketing page and the enforcement can never
 * drift apart and promise something the API won't serve.
 *
 * Money is in minor units (pence). Never store or compare pounds.
 * ------------------------------------------------------------------ */

export const CURRENCY = "GBP";

/**
 * Monthly billing costs more than paying for a year up front — that is
 * what makes "save 17%" a true statement rather than decoration:
 *   Premium  £29.90 x 12 = £358.80   vs £299 yearly  → 16.7% saved
 *   ClinWell £34.90 x 12 = £418.80   vs £349 yearly  → 16.7% saved
 */
export const PLANS = [
  {
    id: "basic",
    name: "Basic Plan",
    eyebrow: "Basic Directory",
    tagline: "Essential public directory presence for medical specialists and local clinics.",
    priceMinor: { monthly: 0, yearly: 0 },
    freeForever: true,
    cta: "Get Started Free",
    // Bullets shown on the pricing card, in order.
    highlights: [
      { label: "Practitioner Account Dashboard", included: true },
      { label: "Profile Photo & Headshot Upload", included: true },
      { label: "Office Phone Contact Display", included: true },
      { label: "Specialty & Sub-specialty Tags", included: true },
      { label: "Google Maps Location Pin", included: true },
      { label: "ClinWell EMR Suite (Not Included)", included: false },
    ],
    features: {
      dashboard: true,
      publicListing: true,
      profilePhoto: true,
      mapPin: true,
      phoneReveal: true,
      websiteAndSocial: true,
      reviews: true,
      searchPriority: "standard",
      verifiedBadge: false,
      subSpecialtyLimit: 1,
      // A free listing still takes enquiries, but a capped number per
      // month. A directory whose free half cannot be contacted is worth
      // less to patients, and patient traffic is what makes the paid
      // tiers worth buying.
      enquiryForm: true,
      enquiryMonthlyCap: 5,
      instantEnquiryAlerts: false,
      publicContactEmail: false,
      privateChat: false,
      reviewReplies: false,
      photoGallery: false,
      galleryImageLimit: 0,
      videoBio: false,
      bookingLink: false,
      contentPublishing: false,
      subAccounts: false,
      clinwell: false,
    },
  },
  {
    id: "premium",
    name: "Premium Listing",
    eyebrow: "Premium Directory",
    badge: "RECOMMENDED",
    tagline: "Top search visibility, verified practitioner badge, priority ranking & direct patient bookings.",
    priceMinor: { monthly: 2990, yearly: 29900 },
    cta: "Get Premium Directory",
    inheritsFrom: "basic",
    highlightsHeading: "All Basic features, PLUS:",
    highlights: [
      { label: "Verified Specialist Badge in search", included: true },
      { label: "#1 Top Priority Ranking in Search Results", included: true },
      { label: "Direct Calendar & Booking Link Integration", included: true },
      { label: "Custom Clinical Gallery & Video Bios", included: true },
      { label: "Direct On-Profile Patient Email Contact Form", included: true },
      { label: "ClinWell EMR Suite (Not Included)", included: false },
    ],
    features: {
      dashboard: true,
      publicListing: true,
      profilePhoto: true,
      mapPin: true,
      phoneReveal: true,
      websiteAndSocial: true,
      reviews: true,
      searchPriority: "top",
      verifiedBadge: true,
      subSpecialtyLimit: null, // null = unlimited
      enquiryForm: true,
      enquiryMonthlyCap: null,
      instantEnquiryAlerts: true,
      publicContactEmail: true,
      privateChat: true,
      reviewReplies: true,
      photoGallery: true,
      galleryImageLimit: 24,
      videoBio: true,
      bookingLink: true,
      contentPublishing: true,
      subAccounts: true,
      clinwell: false,
    },
  },
  {
    id: "clinwell",
    name: "Full Practice Suite",
    eyebrow: "Premium + ClinWell",
    badge: "ULTIMATE SUITE",
    tagline: "Full Premium directory ranking PLUS complete ClinWell.ai EMR, AI Notes & Telehealth suite.",
    priceMinor: { monthly: 3490, yearly: 34900 },
    cta: "Get Premium + ClinWell",
    inheritsFrom: "premium",
    highlightsHeading: "All Premium features, PLUS:",
    highlights: [
      { label: "Full ClinWell.ai EMR Suite (Patient History)", included: true },
      { label: "AI Assistant (Instant Clinical SOAP Notes)", included: true },
      { label: "NHS RTT Breach Tracker & Wait Times", included: true },
      { label: "Secure e-Prescriptions & NHS Patient Portal", included: true },
      { label: "Telehealth Video Consultations & Room", included: true },
    ],
    features: {
      dashboard: true,
      publicListing: true,
      profilePhoto: true,
      mapPin: true,
      phoneReveal: true,
      websiteAndSocial: true,
      reviews: true,
      searchPriority: "top",
      verifiedBadge: true,
      subSpecialtyLimit: null,
      enquiryForm: true,
      enquiryMonthlyCap: null,
      instantEnquiryAlerts: true,
      publicContactEmail: true,
      privateChat: true,
      reviewReplies: true,
      photoGallery: true,
      galleryImageLimit: 60,
      videoBio: true,
      bookingLink: true,
      contentPublishing: true,
      subAccounts: true,
      // Note what this flag does NOT mean: no clinical record is stored
      // by this application. It only says the practice is entitled to a
      // ClinWell workspace, which lives behind lib/clinwell.js.
      clinwell: true,
    },
  },
];

export const PLAN_IDS = PLANS.map((p) => p.id);
export const DEFAULT_PLAN = "basic";

export function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) ?? PLANS.find((p) => p.id === DEFAULT_PLAN);
}

export function isPaidPlan(planId) {
  const plan = getPlan(planId);
  return plan.priceMinor.yearly > 0;
}

export function priceFor(planId, interval = "yearly") {
  const plan = getPlan(planId);
  return plan.priceMinor[interval === "monthly" ? "monthly" : "yearly"] ?? 0;
}

/** What a year on each billing interval actually costs, and the saving. */
export function annualComparison(planId) {
  const plan = getPlan(planId);
  const monthlyOverAYear = plan.priceMinor.monthly * 12;
  const yearly = plan.priceMinor.yearly;
  const savingMinor = Math.max(0, monthlyOverAYear - yearly);
  return {
    monthlyOverAYear,
    yearly,
    savingMinor,
    savingPct: monthlyOverAYear ? Math.round((savingMinor / monthlyOverAYear) * 100) : 0,
    // What a yearly subscription works out at per month — the "less than
    // £25/mo" line on the card.
    yearlyPerMonthMinor: Math.round(yearly / 12),
  };
}

/* ------------------------------------------------------------------ *
 * The comparison table
 *
 * Rendered by the pricing page exactly as ordered here. A row's value
 * per plan is derived from the feature matrix above rather than typed
 * out again, so a feature can never be advertised on a plan that does
 * not actually grant it.
 * ------------------------------------------------------------------ */
const TABLE_ROWS = [
  { group: "Directory Search Visibility & Priority" },
  { label: "Public Directory Listing Profile", key: "publicListing" },
  {
    label: "Search Results Priority Ranking",
    key: "searchPriority",
    render: (v) => (v === "top" ? "#1 Top Priority" : "Standard"),
  },
  { label: "Verified Practitioner Badge & Search Highlight", key: "verifiedBadge" },
  {
    label: "Sub-Level Categories Selection",
    key: "subSpecialtyLimit",
    render: (v) => (v === null ? "Unlimited (ALL)" : `Limited (${v})`),
  },

  { group: "Profile Features & Patient Engagement" },
  {
    label: "Direct On-Profile Patient Email Contact Form",
    key: "publicContactEmail",
  },
  {
    label: "Patient Enquiry Form",
    key: "enquiryMonthlyCap",
    render: (v, features) => (!features.enquiryForm ? "—" : v === null ? "Unlimited" : `${v} / month`),
  },
  { label: "Instant Enquiry Alerts", key: "instantEnquiryAlerts" },
  { label: "Direct Website & Social Media Links", key: "websiteAndSocial" },
  { label: "Click-to-Call Phone Reveal Button", key: "phoneReveal" },
  { label: "Private Chat Messages (Send & Receive)", key: "privateChat" },

  { group: "Patient Reviews & Reputation Management" },
  { label: "Patient Reviews & Star Ratings System", key: "reviews" },
  { label: "Doctor Review Replies & Moderation Control", key: "reviewReplies" },

  { group: "Member Dashboard & Content Publishing" },
  { label: "Sub-Accounts & Multi-Practice Profiles", key: "subAccounts" },
  {
    label: "Content Publishing (Blogs, Events, Jobs, Videos, Articles)",
    key: "contentPublishing",
    render: (v) => (v ? "Unlimited" : "—"),
  },
  {
    label: "Custom Clinical Photo Gallery & Cover Banner",
    key: "galleryImageLimit",
    render: (v, features) => (!features.photoGallery ? "—" : `Up to ${v} images`),
  },
  { label: "Video Bio on Profile", key: "videoBio" },
  { label: "Direct Calendar & Booking Link Integration", key: "bookingLink" },

  { group: "ClinWell EMR & AI Practice Suite (£1,200/yr Value)" },
  { label: "ClinWell.ai EMR Suite Access", key: "clinwell" },
  { label: "AI Clinical Assistant (Instant SOAP Notes)", key: "clinwell" },
  { label: "NHS RTT Breach Tracker & Waiting Times", key: "clinwell" },
  { label: "Secure e-Prescriptions & NHS Patient Portal", key: "clinwell" },
  { label: "Telehealth Video Consultations", key: "clinwell" },
];

/** The comparison table, resolved against every plan. */
export function comparisonTable() {
  return TABLE_ROWS.map((row) => {
    if (row.group) return { group: row.group };
    return {
      label: row.label,
      values: PLANS.map((plan) => {
        const value = plan.features[row.key];
        if (row.render) {
          const rendered = row.render(value, plan.features);
          return { planId: plan.id, kind: "text", value: rendered === "—" ? null : rendered };
        }
        return { planId: plan.id, kind: "boolean", value: Boolean(value) };
      }),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Entitlements
 *
 * The question every other module asks is "may THIS specialist do this
 * right now", and the answer depends on more than which plan they chose:
 * a paid plan that has not been paid for yet grants nothing beyond the
 * free tier. entitlementsFor() is the only correct way to ask.
 * ------------------------------------------------------------------ */

export const SUBSCRIPTION_STATUSES = [
  "active", // paid and current (or the free plan)
  "pending_verification", // plan chosen; waiting for an admin to approve the application
  "pending_payment", // approved; waiting for the first payment
  "past_due", // a renewal failed — grace period, features still on
  "canceled", // ended; falls back to Basic
];

/** Statuses under which the chosen plan's features actually apply. */
const ENTITLING_STATUSES = new Set(["active", "past_due"]);

/**
 * Resolve what this specialist may do.
 *
 * `effectivePlan` is what they actually get; `selectedPlan` is what they
 * signed up for. They differ while payment is outstanding, which is what
 * lets the dashboard say "Premium activates once you pay" instead of
 * silently downgrading someone with no explanation.
 */
export function entitlementsFor(specialist) {
  const selectedPlanId = specialist?.plan ?? DEFAULT_PLAN;
  const status = specialist?.planStatus ?? "active";
  const entitled = ENTITLING_STATUSES.has(status);
  const effectivePlanId = entitled ? selectedPlanId : DEFAULT_PLAN;

  const effective = getPlan(effectivePlanId);
  const selected = getPlan(selectedPlanId);

  return {
    selectedPlan: selected.id,
    selectedPlanName: selected.name,
    effectivePlan: effective.id,
    effectivePlanName: effective.name,
    planStatus: status,
    planInterval: specialist?.planInterval ?? "yearly",
    renewsAt: specialist?.planRenewsAt ?? null,
    // True when they have chosen (and perhaps started paying for) more
    // than they are currently getting.
    awaitingActivation: selected.id !== effective.id,
    features: effective.features,
    can: (feature) => Boolean(effective.features[feature]),
    limit: (feature) => effective.features[feature],
  };
}

/**
 * Sort weight for search results. Premium tiers rank above Basic, and
 * within a tier the existing relevance ordering is untouched — so
 * "priority ranking" is a real, testable effect rather than a promise.
 */
export function searchPriorityWeight(specialist) {
  return entitlementsFor(specialist).features.searchPriority === "top" ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Pricing page FAQ
 *
 * Kept beside the plan rules on purpose: the two entries that explain
 * when we charge and what a free listing can receive describe behaviour
 * this file actually enforces, so if the rule changes the answer is
 * edited in the same place rather than left stale on a marketing page.
 * ------------------------------------------------------------------ */
export const PRICING_FAQ = [
  {
    q: "When am I charged, and what happens if I'm not approved?",
    a: "Never before we've approved you. Choosing a paid plan puts your application in our verification queue at no cost — no card is asked for at signup. Once a member of our team has checked your registration and approved you, your dashboard prompts you to pay, and that is the point your Premium features switch on. If we can't approve your application, you have paid nothing and there is nothing to refund.",
  },
  {
    q: "Can patients contact me on the free Basic plan?",
    a: "Yes. Basic listings show a click-to-call phone button and include a patient enquiry form, capped at 5 enquiries a month — enough that patients can always reach you. Premium removes the cap, adds instant alerts when an enquiry lands, publishes a direct contact email on your profile, and opens private chat. Enquiries beyond your monthly cap are held and released when the cap resets, so nobody is turned away at your door.",
  },
  {
    q: "What is the ClinWell.ai EMR Suite, and is it included free?",
    a: "ClinWell.ai is the clinical side of your practice — patient history, AI-drafted SOAP notes, e-prescriptions, NHS RTT tracking and telehealth consultations. It is included only on the Full Practice Suite tier. It runs as a separate secure clinical system: your directory listing and your patient records are deliberately kept apart, and Top Local Specialists never stores clinical data.",
  },
  {
    q: "Which healthcare professionals get the Verified Specialist Badge?",
    a: "Any Premium or Full Practice Suite member whose registration we have checked against their regulator — GMC, GDC, NMC or HCPC. The badge is applied by a person, not automatically on payment, and we remove it if a registration lapses.",
  },
  {
    q: "What documents do I need for credential verification?",
    a: "Your regulator registration number is the essential one. A certificate or a screenshot of your entry on the public register speeds things up considerably. Most applications are reviewed within two working days.",
  },
  {
    q: "Does the Basic Plan require credit card details?",
    a: "No. Basic is free forever and takes no payment details at any point. You can upgrade later from your dashboard, and everything you have already filled in carries across.",
  },
  {
    q: "What happens to my gallery and videos if I downgrade?",
    a: "Nothing is deleted. Premium-only content is hidden from your public profile while you are on Basic and comes back exactly as it was if you subscribe again.",
  },
  {
    q: "Can I switch between monthly and yearly billing?",
    a: "Yes, from Plan & Billing in your dashboard. Paying yearly saves around 17% against the same plan billed monthly, and the saving is shown in pounds before you confirm.",
  },
];
