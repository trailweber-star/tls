import { entitlementsFor } from "./plans.js";

/* ------------------------------------------------------------------ *
 * What the public is allowed to see
 *
 * The rule this file exists to enforce: a premium field is withheld at
 * the API, not merely hidden by the interface. If the gallery only
 * disappeared in React, anyone could open the network tab and read it —
 * and a competitor could scrape premium content from a free listing.
 *
 * Withheld is not deleted. The specialist's own gallery, video and
 * booking link stay in the database untouched while they are on Basic;
 * the moment a Premium subscription activates they reappear exactly as
 * they were. Downgrading must never destroy someone's work.
 *
 * The owner of a profile, and admins, see their own withheld content
 * (with a `locked` marker) so the dashboard can show what would go live
 * on an upgrade. Everyone else does not receive the field at all.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Never public, on any plan, to any viewer of a public endpoint
 *
 * These are not plan-gated — they are simply not the public's business,
 * and one of them (`application`) carries links to uploaded identity
 * documents. The public specialist endpoint assembled its response by
 * spreading the whole record, so all of this was going out to anonymous
 * callers: an email address and a phone number harvestable from every
 * listing on the site, and a verification history naming the admin who
 * approved it.
 *
 * It is stripped here rather than in each controller because "remember
 * to remove these six fields" is exactly the instruction that gets
 * forgotten the next time an endpoint is added. Everything that reaches
 * the public goes through these three functions.
 *
 * The owner and admins are no exception here: they read their own
 * records through the dashboard and admin endpoints, which serve these
 * fields deliberately. A public URL never needs to.
 * ------------------------------------------------------------------ */
const NEVER_PUBLIC = [
  "contactEmail",
  "contactPhone",
  "application",
  "verificationHistory",
  "userId",
  "passwordHash",
  "stripeCustomerId",
  "notes",
  "internalNotes",
  /* Where an imported listing came from. This is the admin's evidence
     when somebody claims a profile, and it holds the source row
     verbatim — including another platform's ratings, which this site
     deliberately does not publish. Putting it on a public endpoint
     would republish exactly the figures the import refused to. */
  "importSource",
  "sourceUrl",
  "sourceImportedAt",
];

function stripPrivate(record) {
  const out = { ...record };
  for (const field of NEVER_PUBLIC) delete out[field];
  return out;
}

/**
 * The plan block, in one shape.
 *
 * Cards used to carry `plan` straight off the database row — the raw
 * enum string "premium" — while profiles carried this object. Anything
 * reading `plan.features` on a card would have thrown, and the type
 * definitions promised the object in both places. One builder now, so
 * the two cannot drift again.
 */
function planBlock(ent, source) {
  return {
    id: ent.effectivePlan,
    name: ent.effectivePlanName,
    // The badge is a plan feature AND a verification outcome: paying for
    // Premium does not make anyone verified, and being verified without
    // Premium does not display the badge.
    verifiedBadge: Boolean(ent.features.verifiedBadge) && source?.verificationStatus === "verified",
    searchPriority: ent.features.searchPriority,
    features: publicFeatureFlags(ent.features),
  };
}

/** Fields the public profile only carries when the plan grants them. */
const GATED = [
  { field: "gallery", feature: "photoGallery", empty: [] },
  { field: "coverImageUrl", feature: "photoGallery", empty: null },
  { field: "videoUrl", feature: "videoBio", empty: null },
  { field: "videoThumbnailUrl", feature: "videoBio", empty: null },
  { field: "videoDurationSeconds", feature: "videoBio", empty: null },
  { field: "bookingUrl", feature: "bookingLink", empty: null },
  { field: "websiteUrl", feature: "websiteAndSocial", empty: null },
  { field: "socials", feature: "websiteAndSocial", empty: null },
  // The published contact address, distinct from the private inbox
  // enquiries are routed to — that one is never serialised at all.
  { field: "publicEmail", feature: "publicContactEmail", empty: null },
];

/**
 * Apply the plan to a serialised profile.
 *
 * @param profile   the fully serialised specialist
 * @param source    the record the plan fields live on
 * @param viewer    "public" | "owner" | "admin"
 */
export function gateProfile(profile, source, viewer = "public") {
  const ent = entitlementsFor(source);
  const privileged = viewer === "owner" || viewer === "admin";

  const out = stripPrivate(profile);
  const locked = [];

  for (const { field, feature, empty } of GATED) {
    if (ent.features[feature]) continue;
    const hadContent = hasContent(out[field]);
    if (hadContent) locked.push(field);
    // Privileged viewers keep their own content so the dashboard can
    // preview it; the public gets the empty shape, never the data.
    if (!privileged) out[field] = empty;
  }

  out.plan = planBlock(ent, source);

  if (privileged) {
    out.planAdmin = {
      selectedPlan: ent.selectedPlan,
      selectedPlanName: ent.selectedPlanName,
      planStatus: ent.planStatus,
      planInterval: ent.planInterval,
      awaitingActivation: ent.awaitingActivation,
      renewsAt: ent.renewsAt,
      // Which fields are populated but not being shown to patients —
      // this is what drives "3 items hidden on your plan" in the
      // dashboard rather than a vague upsell.
      lockedFields: locked,
    };
  }

  return out;
}

/**
 * Only the flags the front end needs to decide what to render. The rest
 * of the matrix is nobody's business on a public endpoint.
 */
function publicFeatureFlags(features) {
  return {
    photoGallery: Boolean(features.photoGallery),
    videoBio: Boolean(features.videoBio),
    bookingLink: Boolean(features.bookingLink),
    enquiryForm: Boolean(features.enquiryForm),
    publicContactEmail: Boolean(features.publicContactEmail),
    privateChat: Boolean(features.privateChat),
    websiteAndSocial: Boolean(features.websiteAndSocial),
    phoneReveal: Boolean(features.phoneReveal),
    reviewReplies: Boolean(features.reviewReplies),
  };
}

/**
 * The same rule for places. A separate list because the gated fields
 * differ: a hospital has no video bio, and its gallery and website are
 * what the paid tiers actually buy. Everything else — withheld not
 * deleted, owner sees their own locked content, the badge needs both a
 * plan and a verification — is deliberately identical, because a place
 * that pays the same three prices should get the same three deals.
 */
const GATED_FACILITY = [
  { field: "gallery", feature: "photoGallery", empty: [] },
  { field: "coverImageUrl", feature: "photoGallery", empty: null },
  { field: "bookingUrl", feature: "bookingLink", empty: null },
  { field: "websiteUrl", feature: "websiteAndSocial", empty: null },
  { field: "socials", feature: "websiteAndSocial", empty: null },
];

export function gateFacilityProfile(profile, source, viewer = "public") {
  const ent = entitlementsFor(source);
  const privileged = viewer === "owner" || viewer === "admin";

  const out = stripPrivate(profile);
  const locked = [];
  for (const { field, feature, empty } of GATED_FACILITY) {
    if (ent.features[feature]) continue;
    if (hasContent(out[field])) locked.push(field);
    if (!privileged) out[field] = empty;
  }

  out.plan = planBlock(ent, source);

  if (privileged) {
    out.planAdmin = {
      selectedPlan: ent.selectedPlan,
      selectedPlanName: ent.selectedPlanName,
      planStatus: ent.planStatus,
      planInterval: ent.planInterval,
      awaitingActivation: ent.awaitingActivation,
      renewsAt: ent.renewsAt,
      lockedFields: locked,
    };
  }
  return out;
}

function hasContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some((v) => v != null && v !== "");
  return value !== "";
}

/**
 * Trim a search result to what its plan allows.
 *
 * Cards are cheap to scrape in bulk, so the same rule applies: a Basic
 * listing's card carries no badge and no premium media.
 */
export function gateCard(card, source) {
  const ent = entitlementsFor(source);
  return {
    ...stripPrivate(card),
    verifiedBadge: Boolean(ent.features.verifiedBadge) && source?.verificationStatus === "verified",
    planTier: ent.effectivePlan,
    priority: ent.features.searchPriority === "top",
    bookingUrl: ent.features.bookingLink ? (card.bookingUrl ?? null) : null,
    // The same object a profile carries, rather than the bare enum
    // string the row happened to hold — see planBlock.
    plan: planBlock(ent, source),
  };
}
