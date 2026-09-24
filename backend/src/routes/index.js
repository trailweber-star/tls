import { Router } from "express";
import {
  getAllSpecialties,
  getTopLevelSpecialties,
  getSubspecialties,
  getCities,
  getAllFacilityCategories,
  getTopLevelFacilityCategories,
  getFacilityCategoryChildren,
} from "../controllers/taxonomy.controller.js";
import {
  getFeaturedSpecialists,
  getSpecialistBySlug,
  searchSpecialists,
} from "../controllers/specialists.controller.js";
import {
  createSpecialistReview,
  listSpecialistReviews,
  listFeaturedReviews,
  listReviewsForModeration,
  moderateReview,
} from "../controllers/reviews.controller.js";
import { getClinicBySlug } from "../controllers/clinics.controller.js";
import { searchPanel } from "../controllers/search.controller.js";
import { getMapView, resolveAddress, reverseGeocode, suggestAddress } from "../controllers/geo.controller.js";
import {
  getFeaturedFacilities,
  getFacilityBySlug,
  searchFacilities,
  listFacilityReviews,
  createFacilityReview,
} from "../controllers/facilities.controller.js";
import express from "express";
import { deleteImage, uploadConfig, uploadImage, uploadVideo } from "../controllers/uploads.controller.js";
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES } from "../lib/storage.js";
import { createLead } from "../controllers/leads.controller.js";
import {
  applyAsOrganisation,
  createOrganisationPaymentLink,
  getOrganisationApplication,
  listOrganisationApplications,
  quoteOrganisation,
  setOrganisationStatus,
} from "../controllers/organisations.controller.js";
import { demoCredentials, login, me, register } from "../controllers/auth.controller.js";
import {
  changePassword,
  forgotPassword,
  resetPassword,
} from "../controllers/password.controller.js";
import {
  cancelEmailChange,
  confirmEmailChange,
  endOtherSessions,
  endSession,
  getEmailChange,
  getSessions,
  logout,
  startEmailChange,
} from "../controllers/account.controller.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  finishLogin,
  getTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactor,
} from "../controllers/mfa.controller.js";
import {
  getOverview,
  getProfile,
  updateProfile,
  listEnquiries,
  respondToEnquiry,
  listOwnReviews,
  respondToOwnReview,
  getAnalytics,
  listMessageThreads,
  getMessageThread,
  sendMessage,
  getAvailability,
  setAvailability,
  listAppointments,
  updateAppointmentStatus,
} from "../controllers/dashboard.controller.js";
import { getAvailableSlots, createAppointment } from "../controllers/booking.controller.js";
import { getReplyThread, postReply } from "../controllers/reply.controller.js";
import {
  decideVerification,
  getAdminOverview,
  getVerification,
  listAdminSpecialists,
  listVerifications,
} from "../controllers/admin.controller.js";
import {
  bulkMembers,
  exportMembers,
  getMember,
  listAudit,
  listMembers,
  startImpersonation,
  stopImpersonation,
  updateMemberAdminFields,
  updateMemberClinwell,
  bulkEditOptions,
} from "../controllers/members.controller.js";
import {
  getSystemStatus,
  listAllEnquiries,
  sendTestEmail,
} from "../controllers/system.controller.js";
import {
  changePlan,
  getClinWell,
  getPlans,
  getSubscription,
  paymentWebhook,
  simulatePayment,
  startCheckout,
} from "../controllers/billing.controller.js";
import { handleInboundMail } from "../controllers/mail.controller.js";
import { receivePracticeStatus } from "../controllers/clinwellStatus.controller.js";
import { getClinwellOutbox, requeueClinwellEvent } from "../controllers/clinwellAdmin.controller.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCount,
  subscribeToPush,
  unsubscribeFromPush,
} from "../controllers/notifications.controller.js";
import {
  claimEligibility,
  decideClaim,
  getClaim,
  listClaims,
  submitClaim,
} from "../controllers/claims.controller.js";
import { listContactMessages, submitContactMessage } from "../controllers/contact.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  assignArticle,
  createMyArticle,
  getMyArticle,
  listMyArticles,
  reviewArticle,
  updateMyArticle,
} from "../controllers/memberArticles.controller.js";
import {
  deleteArticle,
  getAdminArticle,
  getArticle,
  importArticle,
  previewArticle,
  listAllArticles,
  listArticles,
  updateArticle,
} from "../controllers/articles.controller.js";

const router = Router();

router.get("/specialties", getAllSpecialties);
router.get("/specialties/top-level", getTopLevelSpecialties);
router.get("/specialties/:slug/subspecialties", getSubspecialties);
router.get("/cities", getCities);

router.get("/facility-categories", getAllFacilityCategories);
router.get("/facility-categories/top-level", getTopLevelFacilityCategories);
router.get("/facility-categories/:slug/children", getFacilityCategoryChildren);

router.get("/specialists/featured", getFeaturedSpecialists);
router.get("/specialists/search", searchSpecialists);
// The homepage strip — approved reviews only, drawn from real rows.
router.get("/reviews/featured", listFeaturedReviews);
router.get("/specialists/:slug/reviews", listSpecialistReviews);
router.post("/specialists/:slug/reviews", createSpecialistReview);
router.get("/specialists/:slug", getSpecialistBySlug);

// Public booking widget on a specialist's own profile -- no account,
// same reasoning as an enquiry.
router.get("/specialists/:slug/availability", getAvailableSlots);
router.post("/specialists/:slug/appointments", createAppointment);

router.get("/search/panel", searchPanel);

/* The blog. Public read; everything that writes is admin-only, including
   the importer — it is the one door articles come through, so it is the
   one door that has to be locked. */
router.get("/articles", listArticles);
router.get("/articles/:slug", getArticle);
router.get("/admin/articles", requireAuth, requireRole("admin"), listAllArticles);
router.post("/admin/articles/import", requireAuth, requireRole("admin"), importArticle);
router.post("/admin/articles/preview", requireAuth, requireRole("admin"), previewArticle);
router.get("/admin/articles/:id", requireAuth, requireRole("admin"), getAdminArticle);
router.post("/admin/articles/:id/assign", requireAuth, requireRole("admin"), assignArticle);
router.post("/admin/articles/:id/review", requireAuth, requireRole("admin"), reviewArticle);
router.patch("/admin/articles/:id", requireAuth, requireRole("admin"), updateArticle);

/* A member writing for the guides. Gated on the plan's
   contentPublishing feature inside the controller, because the plan
   catalogue is the only place that says which tier includes it. */
router.get("/dashboard/articles", requireAuth, listMyArticles);
router.post("/dashboard/articles", requireAuth, createMyArticle);
router.get("/dashboard/articles/:id", requireAuth, getMyArticle);
router.patch("/dashboard/articles/:id", requireAuth, updateMyArticle);
router.delete("/admin/articles/:id", requireAuth, requireRole("admin"), deleteArticle);
router.get("/geo/reverse", reverseGeocode);
// What the address field types against, and the one lookup that runs
// when a suggestion is picked.
router.get("/geo/suggest", suggestAddress);
router.post("/geo/resolve", resolveAddress);
// What to draw for one address. The provider — OpenStreetMap today,
// Google the moment a key exists — is decided here, not in the browser.
router.get("/geo/map", getMapView);

/* ------------------------------------------------------------- uploads
   Signed in only. An open upload endpoint is a free file host, and a
   free file host on your own domain is somebody else's malware
   distribution. express.raw enforces the size cap before the bytes get
   as far as the controller. */
router.get("/uploads/config", uploadConfig);
router.post(
  "/uploads/image",
  requireAuth,
  express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_UPLOAD_BYTES }),
  uploadImage
);
/* Video, with its own much larger cap. Same contract as the image
   endpoint — raw body, content sniffed on arrival, generated filename —
   and the same delete route removes either, since both are just files
   in the uploads folder. */
router.post(
  "/uploads/video",
  requireAuth,
  express.raw({ type: ["video/*", "application/octet-stream"], limit: MAX_VIDEO_BYTES }),
  uploadVideo
);
router.delete("/uploads/image", requireAuth, deleteImage);

router.get("/clinics/:slug", getClinicBySlug);

router.get("/facilities/featured", getFeaturedFacilities);
router.get("/facilities/search", searchFacilities);
router.get("/facilities/:slug", getFacilityBySlug);
router.get("/facilities/:slug/reviews", listFacilityReviews);
router.post("/facilities/:slug/reviews", createFacilityReview);

router.post("/leads", createLead);

// A patient's own side of a message thread -- the reply_token in the
// URL is their whole access control, no account needed. See
// reply.controller.js.
router.get("/reply/:token", getReplyThread);
router.post("/reply/:token", postReply);

/* ------------------------------------------------------- organisations
   Hospitals, clinics, pharmacies and care homes are priced on how many
   clinicians they want covered, so there is no figure to publish and no
   self-serve checkout. They apply, we quote, they pay a link. */
router.post("/organisations/apply", applyAsOrganisation);

/* ------------------------------------------------------------ contact
   Public. Stored, raised in the admin bell and emailed to support with
   reply-to set to the sender. */
router.post("/contact", submitContactMessage);
router.get("/admin/contact-messages", requireAuth, requireRole("admin"), listContactMessages);

/* -------------------------------------------------------- claiming
   Public: anyone can see whether a listing is claimable and submit a
   claim. Approving one is admin-only, below. */
router.get("/claims/eligibility/:slug", claimEligibility);
router.post("/claims", submitClaim);

/* --------------------------------------------------- notifications
   Every route reads the account from the session, so a bell can only
   ever be its owner's. */
router.get("/notifications", requireAuth, listNotifications);
router.get("/notifications/count", requireAuth, notificationCount);
router.post("/notifications/read-all", requireAuth, markAllNotificationsRead);
router.post("/notifications/:id/read", requireAuth, markNotificationRead);
router.post("/notifications/subscribe", requireAuth, subscribeToPush);
router.post("/notifications/unsubscribe", requireAuth, unsubscribeFromPush);

/* ------------------------------------------------------------- plans
   Public: the pricing page reads the same catalogue the API enforces. */
router.get("/plans", getPlans);

/* ----------------------------------------------------------- billing */
router.get("/billing/subscription", requireAuth, requireRole("specialist"), getSubscription);
router.post("/billing/change-plan", requireAuth, requireRole("specialist"), changePlan);
router.post("/billing/checkout", requireAuth, requireRole("specialist"), startCheckout);
router.get("/billing/clinwell", requireAuth, requireRole("specialist"), getClinWell);
// Demo only — runs the same activation path the webhook runs so the
// flow is walkable before a payment provider exists.
router.post("/billing/simulate-payment", requireAuth, requireRole("specialist"), simulatePayment);
// The provider's callback. Unauthenticated by necessity; the payload is
// verified by the provider adapter, never trusted on its face.
router.post("/billing/webhook", paymentWebhook);

/* ------------------------------------------------------------- mail
   Resend's inbound webhook -- an email arriving, a bounce, a complaint.
   Unauthenticated by necessity, same as the billing webhook above; the
   payload is verified by its own signature check, never trusted on its
   face. See controllers/mail.controller.js. */
router.post("/mail/inbound", handleInboundMail);

/* --------------------------------------------------------- partners */
/* The inbound half of the ClinWell integration (contract v1.0.1,
   Appendix B): one nightly push telling us which practices are live on
   ClinWell. Unauthenticated by this router's standards — it carries no
   TLS session, because the caller is a server, not a person — and
   authenticated inside the handler by bearer key plus an HMAC over the
   raw body. It may write the ClinWell badge and nothing else; see the
   handler's header for why that boundary is worth designing around. */
router.post("/partners/clinwell/practices/status", receivePracticeStatus);

/* ---------------------------------------------------------------- auth */
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", requireAuth, me);
router.get("/auth/demo-credentials", demoCredentials);

/* Passwords. The first two are unauthenticated by necessity — somebody
   who cannot sign in is exactly who needs them — and both are written to
   give nothing away to a caller guessing addresses or links. The third
   needs a session AND the current password; a session alone is only
   evidence that a browser was left open. */
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/reset-password", resetPassword);
router.post("/auth/change-password", requireAuth, changePassword);

/* The second half of signing in, when two-factor is on. Unauthenticated
   by necessity: the caller holds a challenge, not a session, and the
   challenge is built so it cannot be used as one. */
router.post("/auth/login/2fa", finishLogin);

/* ----------------------------------------------------- the account
   Where you are signed in, what address you sign in with, and whether
   a code is needed as well as a password. All of it behind a session,
   and the ones that matter behind the current password as well — a
   session only proves a browser was left open. */
router.post("/auth/logout", requireAuth, logout);

router.get("/auth/sessions", requireAuth, getSessions);
router.delete("/auth/sessions/:id", requireAuth, endSession);
router.post("/auth/sessions/revoke-others", requireAuth, endOtherSessions);

router.get("/auth/email-change", requireAuth, getEmailChange);
router.post("/auth/email-change", requireAuth, startEmailChange);
router.delete("/auth/email-change", requireAuth, cancelEmailChange);
/* Open, because it is reached from a link in an email — including the
   cancel link, which is the one somebody clicks precisely when they
   cannot sign in. */
router.post("/auth/email-change/confirm", confirmEmailChange);

router.get("/auth/2fa", requireAuth, getTwoFactor);
router.post("/auth/2fa/setup", requireAuth, startTwoFactor);
router.post("/auth/2fa/enable", requireAuth, enableTwoFactor);
router.post("/auth/2fa/disable", requireAuth, disableTwoFactor);
router.post("/auth/2fa/recovery-codes", requireAuth, regenerateRecoveryCodes);

/* ------------------------------------------------- specialist dashboard
   Every route reads the profile id from the session, never from the URL,
   so an account can only ever touch its own data. */
router.get("/dashboard/overview", requireAuth, requireRole("specialist"), getOverview);
router.get("/dashboard/profile", requireAuth, requireRole("specialist"), getProfile);
router.patch("/dashboard/profile", requireAuth, requireRole("specialist"), updateProfile);
router.get("/dashboard/enquiries", requireAuth, requireRole("specialist"), listEnquiries);
router.post("/dashboard/enquiries/:id/respond", requireAuth, requireRole("specialist"), respondToEnquiry);
router.get("/dashboard/reviews", requireAuth, requireRole("specialist"), listOwnReviews);
// A provider replying to a published review of their own listing. Not
// moderated — see the note on respondToOwnReview.
router.post("/dashboard/reviews/:id/respond", requireAuth, requireRole("specialist"), respondToOwnReview);

// Analytics -- persistent view/referrer/search-term tracking, replacing
// the in-memory counters lib/analytics.js used to reset on every deploy.
router.get("/dashboard/analytics", requireAuth, requireRole("specialist"), getAnalytics);

// Messages -- the rest of a conversation past a lead's first reply.
router.get("/dashboard/messages", requireAuth, requireRole("specialist"), listMessageThreads);
router.get("/dashboard/messages/:leadId", requireAuth, requireRole("specialist"), getMessageThread);
router.post("/dashboard/messages/:leadId", requireAuth, requireRole("specialist"), sendMessage);

// Appointments -- weekly availability rules the specialist sets, and the
// bookings patients make against them.
router.get("/dashboard/availability", requireAuth, requireRole("specialist"), getAvailability);
router.put("/dashboard/availability", requireAuth, requireRole("specialist"), setAvailability);
router.get("/dashboard/appointments", requireAuth, requireRole("specialist"), listAppointments);
router.post("/dashboard/appointments/:id/status", requireAuth, requireRole("specialist"), updateAppointmentStatus);

/* --------------------------------------------------------------- admin */
router.get("/admin/overview", requireAuth, requireRole("admin"), getAdminOverview);
router.get("/admin/verifications", requireAuth, requireRole("admin"), listVerifications);
router.get("/admin/verifications/:id", requireAuth, requireRole("admin"), getVerification);
router.post("/admin/verifications/:id/decide", requireAuth, requireRole("admin"), decideVerification);
router.get("/admin/specialists", requireAuth, requireRole("admin"), listAdminSpecialists);

/* --------------------------------------------------- members workspace
   One filtered list of everybody on the site, and the actions that can
   be taken on a selection from it. Every route here is admin-only, and
   requireRole additionally refuses a session that is itself an
   impersonation — see middleware/auth.js. */
router.get("/admin/members", requireAuth, requireRole("admin"), listMembers);
// Before /:id, or "export.csv" is read as a member id.
router.get("/admin/members/export.csv", requireAuth, requireRole("admin"), exportMembers);
router.get("/admin/audit", requireAuth, requireRole("admin"), listAudit);

/* ------------------------------------------------- system and enquiries
   "Is email going out" and "is anybody answering patients" — both were
   questions with no screen behind them. */
router.get("/admin/system", requireAuth, requireRole("admin"), getSystemStatus);
router.post("/admin/system/test-email", requireAuth, requireRole("admin"), sendTestEmail);
router.get("/admin/enquiries", requireAuth, requireRole("admin"), listAllEnquiries);
/* Stopping needs only the borrowed session, which is by definition NOT
   an admin one — so it is guarded by requireAuth alone and proves its
   own right to exist from the actor id inside the signed token. */
router.post("/admin/members/stop-impersonating", requireAuth, stopImpersonation);
router.get("/admin/members/:id", requireAuth, requireRole("admin"), getMember);
router.patch("/admin/members/:id", requireAuth, requireRole("admin"), updateMemberAdminFields);
/* The ClinWell practice slug, on its own route because it writes to the
   listing rather than the account and is part of a contract with a
   third party — see the handler. */
router.patch("/admin/members/:id/clinwell", requireAuth, requireRole("admin"), updateMemberClinwell);
router.post("/admin/members/:id/impersonate", requireAuth, requireRole("admin"), startImpersonation);
/* What the bulk editor offers to pick from — the specialty tree and
   every clinic location, so a category or a place can be set across a
   selection without opening each listing. */
router.get("/admin/taxonomy-options", requireAuth, requireRole("admin"), bulkEditOptions);
router.post("/admin/members/bulk", requireAuth, requireRole("admin"), bulkMembers);
// Review moderation. Admin-only, both of them: nobody else can see the
// queue, and nobody else can publish or reject.
router.get("/admin/reviews", requireAuth, requireRole("admin"), listReviewsForModeration);
router.post("/admin/reviews/:id/moderate", requireAuth, requireRole("admin"), moderateReview);
/* The ClinWell outbox. A dead event means a practice's clinical access
   is out of step with what they are paying for, and nothing on this
   side of the integration looks wrong — so it needs a screen. */
router.get("/admin/organisations", requireAuth, requireRole("admin"), listOrganisationApplications);
router.get("/admin/organisations/:id", requireAuth, requireRole("admin"), getOrganisationApplication);
router.post("/admin/organisations/:id/quote", requireAuth, requireRole("admin"), quoteOrganisation);
router.post("/admin/organisations/:id/status", requireAuth, requireRole("admin"), setOrganisationStatus);
router.post(
  "/admin/organisations/:id/payment-link",
  requireAuth,
  requireRole("admin"),
  createOrganisationPaymentLink
);

router.get("/admin/clinwell", requireAuth, requireRole("admin"), getClinwellOutbox);
router.post("/admin/clinwell/events/:id/requeue", requireAuth, requireRole("admin"), requeueClinwellEvent);

router.get("/admin/claims", requireAuth, requireRole("admin"), listClaims);
router.get("/admin/claims/:id", requireAuth, requireRole("admin"), getClaim);
router.post("/admin/claims/:id/decide", requireAuth, requireRole("admin"), decideClaim);

export default router;
