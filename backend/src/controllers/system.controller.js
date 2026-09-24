import { isDbConfigured } from "../config/db.js";
import { leads as leadRepo, specialists as specialistRepo } from "../db/repos.js";
import { demoLeads } from "../data/leads-store.js";
import { mockSpecialistsWithRelations } from "../data/mock.js";
import {
  buildTestEmail,
  mailProviderName,
  mailerStatus,
  recentMail,
  sendMail,
} from "../lib/mailer.js";
import { hasPaymentProvider, paymentProviderName, orderStore } from "../lib/payments.js";
import { storageProviderName } from "../lib/storage.js";
import { mapProvider } from "../lib/maps.js";
import { clientIp } from "../lib/requestIp.js";
import { adminAudit } from "../db/repos.js";
import { siteUrl } from "../lib/urls.js";

/* ------------------------------------------------------------------ *
 * System and platform-wide enquiries
 *
 * Two administrator questions that had no screen behind them:
 *
 *   "Is email actually going out?" — answered by reading the running
 *   process rather than by asserting a green tick, with a button that
 *   proves it end to end by sending one message to a named address.
 *
 *   "Are patients getting through, and is anybody answering them?" —
 *   answered by the one query nobody could run before: every enquiry
 *   across every specialist, with how long it has been waiting.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------- system */

// GET /api/admin/system
export async function getSystemStatus(req, res) {
  res.json({
    mail: mailerStatus(),
    recentMail: recentMail(20),
    payments: {
      configured: hasPaymentProvider(),
      provider: paymentProviderName(),
      // Live keys and test keys are the same code path; only this tells
      // an administrator which one is loaded.
      mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test",
    },
    storage: { mode: isDbConfigured() ? "postgres" : "demo" },
    media: { provider: storageProviderName() },
    maps: { provider: mapProvider() },
    site: siteUrl(),
  });
}

/**
 * POST /api/admin/system/test-email  { to }
 *
 * The only honest way to answer "is email working". It goes through the
 * same sendMail() every other message uses, so a success here means the
 * provider, the from-address, the template and the credentials are all
 * correct — not just that a key is present in the environment.
 */
export async function sendTestEmail(req, res) {
  const to = String(req.body?.to ?? req.user?.email ?? "").trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.status(400).json({ error: "Give a valid email address to send the test to." });
  }

  const result = await sendMail(buildTestEmail({ to, byName: req.user?.fullName }));

  if (isDbConfigured()) {
    await adminAudit.record({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.fullName ?? "Unknown",
      actorEmail: req.user?.email ?? null,
      ip: clientIp(req),
      action: "system.test-email",
      subjectType: "system",
      subjectId: null,
      subjectLabel: to,
      detail: { provider: mailProviderName(), sent: result.sent, reason: result.reason ?? null },
    });
  }

  res.json({
    ...result,
    to,
    provider: mailProviderName(),
    /* The reason matters more than the boolean. "No provider configured"
       is a settings problem, "send-failed" is a credentials or domain
       problem, and "skipped" means a staging guard caught it — three
       different next steps that a bare `false` would collapse into one. */
    message: result.sent
      ? `Sent to ${to} via ${mailProviderName()}. If it does not arrive within a minute or two, check spam and then the sending domain's SPF and DKIM records.`
      : result.reason === "no-mailer-configured"
        ? "No email provider is configured, so the message was written to the server log instead. Set one of the mail keys in .env and restart."
        : result.reason === "skipped"
          ? `Skipped: ${result.detail}. That is a staging guard (MAIL_ALLOWLIST / reserved test address), not a failure.`
          : `The provider refused it: ${result.detail ?? "unknown error"}`,
  });
}

/* ---------------------------------------------------------- enquiries */

const STATUSES = ["new", "in_progress", "responded", "closed"];

/** Hours since a timestamp, or null. Used for "waiting" on an open enquiry. */
function hoursSince(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 36e5));
}

/**
 * GET /api/admin/enquiries
 *
 * Every enquiry on the platform, newest first, filtered by status, by
 * specialist, by whether it is still waiting, or by free text.
 */
export async function listAllEnquiries(req, res) {
  const [rawLeads, specialists] = isDbConfigured()
    ? await Promise.all([leadRepo.all(), specialistRepo.all()])
    : [demoLeads.all(), mockSpecialistsWithRelations];

  const byId = new Map(specialists.map((s) => [String(s.id ?? s._id), s]));

  const shaped = rawLeads.map((l) => {
    const specialist = byId.get(String(l.specialistId));
    const answered = Boolean(l.response);
    return {
      id: l.id ?? String(l._id),
      patientName: l.patientName ?? "Someone",
      email: l.email ?? null,
      phone: l.phone ?? null,
      message: l.message ?? null,
      status: l.status ?? "new",
      held: Boolean(l.held),
      response: l.response ?? null,
      respondedAt: l.respondedAt ? new Date(l.respondedAt).toISOString() : null,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
      source: l.source ?? "website_enquiry",
      specialist: specialist
        ? {
            id: String(specialist.id ?? specialist._id),
            slug: specialist.slug,
            fullName: specialist.fullName,
            contactEmail: specialist.contactEmail ?? null,
            verificationStatus: specialist.verificationStatus,
          }
        : null,
      answered,
      /* How long this has been sitting unanswered. The single most useful
         number on the page: an enquiry nobody replied to is a patient who
         went elsewhere, and it reflects on the directory, not only on the
         member. */
      waitingHours: answered ? null : hoursSince(l.createdAt),
    };
  });

  const q = String(req.query.q ?? "").trim().toLowerCase();
  const status = String(req.query.status ?? "all");
  const specialistId = String(req.query.specialist ?? "");
  const unanswered = req.query.unanswered === "yes";
  const held = req.query.held === "yes";

  const matched = shaped
    .filter((l) => (status === "all" ? true : l.status === status))
    .filter((l) => (specialistId ? l.specialist?.id === specialistId : true))
    .filter((l) => (unanswered ? !l.answered : true))
    .filter((l) => (held ? l.held : true))
    .filter((l) =>
      q
        ? [l.patientName, l.email, l.phone, l.message, l.specialist?.fullName]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q))
        : true
    )
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
  const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), totalPages);

  /* Counted over everything, not the filtered set — these are the tabs,
     and a tab whose number moved every time you filtered would be no use
     for deciding where to look next. */
  const counts = { all: shaped.length, unanswered: 0, held: 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const l of shaped) {
    if (counts[l.status] !== undefined) counts[l.status] += 1;
    if (!l.answered) counts.unanswered += 1;
    if (l.held) counts.held += 1;
  }

  const waits = shaped.filter((l) => !l.answered && l.waitingHours != null).map((l) => l.waitingHours);
  const answeredOnes = shaped.filter((l) => l.answered && l.createdAt && l.respondedAt);

  res.json({
    results: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize,
    totalPages,
    counts,
    stats: {
      longestWaitHours: waits.length ? Math.max(...waits) : null,
      medianReplyHours: answeredOnes.length
        ? median(
            answeredOnes.map((l) =>
              Math.max(0, Math.round((new Date(l.respondedAt) - new Date(l.createdAt)) / 36e5))
            )
          )
        : null,
      answeredPct: shaped.length
        ? Math.round((shaped.filter((l) => l.answered).length / shaped.length) * 100)
        : null,
    },
    /* Who is receiving enquiries at all — the filter list is built from
       the data so it can never offer a specialist with none. */
    specialists: [...new Map(shaped.filter((l) => l.specialist).map((l) => [l.specialist.id, l.specialist])).values()]
      .map((s) => ({ id: s.id, fullName: s.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  });
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ------------------------------------------------------------ orders */

// GET /api/admin/orders — what has been billed, and what is stuck.
export async function listOrders(req, res) {
  const all = await orderStore.all?.();
  if (!all) return res.json({ results: [], note: "Order history needs a database." });
  res.json({ results: all.slice(0, 100) });
}
