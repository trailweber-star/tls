import { isDbConfigured } from "../config/db.js";
import {
  adminAudit,
  clinwellBadges,
  specialists as specialistRepo,
  users as userRepo,
} from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { mockSpecialistsWithRelations, specialists as mockSpecialists } from "../data/mock.js";
import { entitlementsFor } from "../lib/plans.js";
import { issueSession, revokeSession } from "../lib/sessions.js";
import { clientIp } from "../lib/requestIp.js";

/* ------------------------------------------------------------------ *
 * The admin members workspace
 *
 * One screen that answers every question an administrator has about who
 * is on the site, and lets them act on the answer without leaving it.
 *
 * The shape of this file follows from one observation: at fifty members
 * you open records one at a time; at three thousand you filter, select,
 * and act on the selection. Everything here is built for the second —
 * a single list with every filter stacked above it, bulk operations
 * over whatever that filter returned, and enough on each row to decide
 * without opening it.
 *
 * Two capabilities in here are more dangerous than the rest and are
 * treated accordingly:
 *
 *  - Signing in as a member. Enormously useful for support, and the one
 *    thing that could be used to do something indefensible while
 *    looking exactly like the member did it. Every start and stop is
 *    written to the audit log with the administrator's name on it, the
 *    token is short-lived, and it cannot reach an admin route.
 *
 *  - Bulk actions. Approving four hundred listings with one click is
 *    the point, and is also how four hundred mistakes happen at once.
 *    Every one is audited individually, and the destructive ones refuse
 *    to touch an account that is not a plain member.
 * ------------------------------------------------------------------ */

/* --------------------------------------------------------- shaping */

const lower = (v) => String(v ?? "").trim().toLowerCase();
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Every status a listing can be in, in the order an admin works
 * through them. The labels are the vocabulary of the whole screen —
 * filter chips, row badges and the counts along the top all read from
 * here, so they cannot drift apart.
 */
export const MEMBER_STATUSES = [
  { key: "pending", label: "Awaiting review", tone: "amber" },
  { key: "info_requested", label: "Info requested", tone: "amber" },
  { key: "verified", label: "Approved", tone: "teal" },
  { key: "unverified", label: "Unclaimed", tone: "slate" },
  { key: "rejected", label: "Rejected", tone: "danger" },
  { key: "suspended", label: "Suspended", tone: "danger" },
];
const STATUS_KEYS = new Set(MEMBER_STATUSES.map((s) => s.key));

/**
 * One row of the members table.
 *
 * Deliberately fat: every field here is something an administrator
 * reads to decide whether to act, and a second request per row to fill
 * in the plan or the sign-up country would make the page unusable at
 * any real size.
 */
function shapeMember(specialist, account) {
  const ent = entitlementsFor(specialist);
  const location = (specialist.clinicLocations ?? [])[0] ?? null;
  return {
    id: specialist.id,
    slug: specialist.slug,
    fullName: specialist.fullName,
    title: specialist.title ?? null,
    qualifications: specialist.qualifications ?? null,
    photoUrl: specialist.photoUrl ?? null,
    specialty: specialist.primarySpecialty?.name ?? null,
    specialtySlug: specialist.primarySpecialty?.slug ?? null,

    /* ------------------------------------------------- state */
    verificationStatus: specialist.verificationStatus,
    claimed: Boolean(specialist.claimed),
    // An account that has been switched off. Distinct from a rejected
    // listing: the listing is a public thing, the account is a login.
    accountActive: account ? account.active !== false : null,

    /* ------------------------------------------------- membership */
    plan: ent.effectivePlan,
    planName: ent.effectivePlanName,
    planStatus: ent.planStatus,
    selectedPlan: ent.selectedPlan,
    awaitingActivation: ent.awaitingActivation,

    /* ------------------------------------------------- contact */
    email: account?.email ?? specialist.contactEmail ?? null,
    contactPhone: specialist.contactPhone ?? null,
    city: location?.city?.name ?? null,
    address: location?.address ?? null,

    /* ------------------------------------------------- provenance */
    // Where the account signed up from, and where it last signed in
    // from. The single most useful pair of fields for spotting an
    // account that is not what it says it is.
    signupIp: account?.signupIp ?? null,
    signupCountry: account?.signupCountry ?? null,
    lastLoginIp: account?.lastLoginIp ?? null,
    lastLoginCountry: account?.lastLoginCountry ?? null,
    lastLoginAt: account?.lastLoginAt ?? null,
    joinedAt: account?.createdAt ?? specialist.createdAt ?? null,
    // Where an imported listing came from. Never public; see
    // NEVER_PUBLIC in lib/profileGate.js.
    sourceName: specialist.sourceName ?? null,
    sourceUrl: specialist.sourceUrl ?? null,

    /* ------------------------------------------------- signals */
    ratingAvg: specialist.ratingAvg ?? 0,
    ratingCount: specialist.ratingCount ?? 0,
    hasPhoto: Boolean(specialist.photoUrl),
    tags: account?.tags ?? [],
    adminNotes: account?.adminNotes ?? null,
    userId: account?.id ?? null,
    // Whether this row can be signed in as at all. A listing with no
    // account behind it — every imported one — has no session to borrow.
    canImpersonate: Boolean(account?.id) && account?.role !== "admin" && account?.active !== false,
  };
}

/* ------------------------------------------------------------ loading */

/**
 * Every listing, paired with the account that owns it.
 *
 * Loaded whole and filtered in memory. That is the right trade at this
 * size and is honest about its limit: past roughly ten thousand members
 * this becomes a query, and the filter definitions below are already
 * written so they can be pushed into SQL one at a time without the
 * interface changing.
 */
async function loadMembers() {
  if (!isDbConfigured()) {
    const accountsById = new Map();
    for (const a of demoAccounts.all()) {
      if (a.specialistId) accountsById.set(String(a.specialistId), a);
    }
    return mockSpecialistsWithRelations.map((s) => shapeMember(s, accountsById.get(String(s.id)) ?? null));
  }

  const [specialists, accounts] = await Promise.all([specialistRepo.all(), userRepo.all()]);
  const accountsBySpecialist = new Map();
  for (const a of accounts) {
    if (a.specialistId) accountsBySpecialist.set(String(a.specialistId), a);
  }
  return specialists.map((s) => shapeMember(s, accountsBySpecialist.get(String(s.id)) ?? null));
}

/* ------------------------------------------------------------ filters
 *
 * One predicate per filter, each reading a single query parameter and
 * each ignoring itself when that parameter is absent. Written this way
 * so a new filter is one entry rather than another branch in a growing
 * if-tree — which is how the old list ended up supporting two.
 * ------------------------------------------------------------------ */

const FILTERS = {
  /** Name, email, slug, id, phone or town — whatever was typed. */
  q: (m, value) => {
    const needle = lower(value);
    if (!needle) return true;
    return [m.fullName, m.email, m.slug, m.id, m.contactPhone, m.city, m.title, m.specialty]
      .filter(Boolean)
      .some((field) => lower(field).includes(needle));
  },
  email: (m, value) => (lower(value) ? lower(m.email).includes(lower(value)) : true),
  status: (m, value) =>
    !value || value === "all" ? true : String(value).split(",").includes(m.verificationStatus),
  plan: (m, value) => (!value || value === "all" ? true : String(value).split(",").includes(m.plan)),
  planStatus: (m, value) => (!value || value === "all" ? true : m.planStatus === value),
  claimed: (m, value) =>
    value === "yes" ? m.claimed : value === "no" ? !m.claimed : true,
  accountActive: (m, value) =>
    value === "yes" ? m.accountActive === true : value === "no" ? m.accountActive === false : true,
  specialty: (m, value) => (!value || value === "all" ? true : m.specialtySlug === value),
  city: (m, value) => (lower(value) ? lower(m.city).includes(lower(value)) : true),
  country: (m, value) =>
    !value || value === "all"
      ? true
      : [m.signupCountry, m.lastLoginCountry].filter(Boolean).includes(String(value).toUpperCase()),
  ip: (m, value) =>
    lower(value)
      ? [m.signupIp, m.lastLoginIp].filter(Boolean).some((v) => v.includes(String(value).trim()))
      : true,
  hasPhoto: (m, value) => (value === "yes" ? m.hasPhoto : value === "no" ? !m.hasPhoto : true),
  source: (m, value) =>
    !value || value === "all"
      ? true
      : value === "imported"
        ? Boolean(m.sourceName)
        : value === "signup"
          ? !m.sourceName
          : lower(m.sourceName) === lower(value),
  tag: (m, value) => (!value ? true : (m.tags ?? []).includes(String(value))),
  joinedFrom: (m, value) => {
    const from = asDate(value);
    return !from || (m.joinedAt && new Date(m.joinedAt) >= from);
  },
  joinedTo: (m, value) => {
    const to = asDate(value);
    if (!to) return true;
    // Inclusive of the day named, which is what a person picking a date
    // on a calendar means by it.
    to.setHours(23, 59, 59, 999);
    return m.joinedAt && new Date(m.joinedAt) <= to;
  },
  loginFrom: (m, value) => {
    const from = asDate(value);
    return !from || (m.lastLoginAt && new Date(m.lastLoginAt) >= from);
  },
  loginTo: (m, value) => {
    const to = asDate(value);
    if (!to) return true;
    to.setHours(23, 59, 59, 999);
    return m.lastLoginAt && new Date(m.lastLoginAt) <= to;
  },
  /** Signed up and then never came back. */
  neverLoggedIn: (m, value) => (value === "yes" ? !m.lastLoginAt : true),
};

const SORTS = {
  newest: (a, b) => new Date(b.joinedAt ?? 0) - new Date(a.joinedAt ?? 0),
  oldest: (a, b) => new Date(a.joinedAt ?? 0) - new Date(b.joinedAt ?? 0),
  name: (a, b) => a.fullName.localeCompare(b.fullName),
  "name-desc": (a, b) => b.fullName.localeCompare(a.fullName),
  "last-login": (a, b) => new Date(b.lastLoginAt ?? 0) - new Date(a.lastLoginAt ?? 0),
  rating: (a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount,
  status: (a, b) => a.verificationStatus.localeCompare(b.verificationStatus) || a.fullName.localeCompare(b.fullName),
};

function applyFilters(rows, query) {
  return rows.filter((m) =>
    Object.entries(FILTERS).every(([key, predicate]) => {
      const value = query[key];
      return value === undefined || value === "" ? true : predicate(m, value);
    })
  );
}

/* ------------------------------------------------------------ the list */

// GET /api/admin/members
export async function listMembers(req, res) {
  const all = await loadMembers();
  const matched = applyFilters(all, req.query);

  const sortKey = SORTS[req.query.sort] ? req.query.sort : "newest";
  matched.sort(SORTS[sortKey]);

  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));
  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(Number(req.query.page)) || 1), totalPages);
  const start = (page - 1) * pageSize;

  /* The counts are over EVERY member, not the filtered set — they are
     the tabs along the top, and a tab whose number changed every time
     you filtered would be useless for deciding what to look at next. */
  const counts = Object.fromEntries(MEMBER_STATUSES.map((s) => [s.key, 0]));
  let unclaimedCount = 0;
  let importedCount = 0;
  let suspendedAccounts = 0;
  for (const m of all) {
    if (counts[m.verificationStatus] !== undefined) counts[m.verificationStatus] += 1;
    if (!m.claimed) unclaimedCount += 1;
    if (m.sourceName) importedCount += 1;
    if (m.accountActive === false) suspendedAccounts += 1;
  }

  /* The filter dropdowns are built from what the data actually holds,
     so a filter can never offer an option that returns nothing. */
  const specialties = new Map();
  const cities = new Set();
  const countries = new Set();
  const tags = new Set();
  const sources = new Set();
  for (const m of all) {
    if (m.specialtySlug) specialties.set(m.specialtySlug, m.specialty);
    if (m.city) cities.add(m.city);
    if (m.signupCountry) countries.add(m.signupCountry);
    if (m.lastLoginCountry) countries.add(m.lastLoginCountry);
    for (const tag of m.tags ?? []) tags.add(tag);
    if (m.sourceName) sources.add(m.sourceName);
  }

  res.json({
    results: matched.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    sort: sortKey,
    counts: {
      all: all.length,
      ...counts,
      unclaimed: unclaimedCount,
      imported: importedCount,
      suspendedAccounts,
    },
    facets: {
      statuses: MEMBER_STATUSES,
      specialties: [...specialties.entries()]
        .map(([slug, name]) => ({ slug, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      cities: [...cities].sort(),
      countries: [...countries].sort(),
      tags: [...tags].sort(),
      sources: [...sources].sort(),
    },
  });
}

// GET /api/admin/members/:id — one member, with their audit trail.
export async function getMember(req, res) {
  const all = await loadMembers();
  const member = all.find((m) => m.id === req.params.id || m.slug === req.params.id);
  if (!member) return res.status(404).json({ error: "No such member" });

  const history = isDbConfigured() ? await adminAudit.recent({ subjectId: member.id, limit: 50 }) : [];
  res.json({ member, history, clinwell: await clinwellStateFor(member) });
}

/* ------------------------------------------------------- ClinWell */

/**
 * The integration's state for one member, for the admin record.
 *
 * Read-only except the slug, and the slug is the only one an admin can
 * meaningfully set: the workspace id is issued by ClinWell, the badge
 * is pushed nightly, and the status is theirs to report. Showing them
 * together is the point — "no workspace id, badge off, slug unset" is
 * a diagnosis, whereas each of those facts alone is a puzzle.
 */
async function clinwellStateFor(member) {
  const entitled = Boolean(entitlementsFor(member)?.features?.clinwell);

  /* Two slugs, kept apart on purpose, because conflating them is the
     mistake this screen exists to prevent somebody making:

       tlsSlug     ours. What we send in every event and what ClinWell
                   sends back in the nightly push. Read-only here.
       clinicSlug  ClinWell's, e.g. "dkc". Used only in the embed URL,
                   and the one value an admin sets by hand.

     ClinWell joins the two on their side by the workspace row. They
     are not expected to match and neither is a default for the other. */
  if (!isDbConfigured()) {
    return { entitled, tlsSlug: member.slug ?? null, clinicSlug: null, demo: true };
  }

  const row = member.slug ? await clinwellBadges.forSlug(member.slug).catch(() => null) : null;
  const clinicSlug = row?.clinwellClinicSlug ?? member.clinwellClinicSlug ?? null;

  return {
    entitled,
    /* What Synthiq needs from us in order to register the practice. */
    tlsSlug: member.slug ?? null,
    /* What they told us their clinic is called. Null until an admin
       enters it, which means no booking embed — never our slug as a
       stand-in, because that URL 404s on their host. */
    clinicSlug,
    workspaceId: row?.clinwellWorkspaceId ?? null,
    live: Boolean(row?.clinwellLive),
    status: row?.clinwellStatus ?? null,
    statusAt: row?.clinwellStatusAt ?? null,
    badgeExpiresAt: row?.clinwellBadgeExpiresAt ?? null,
    /* What the public site is allowed to render. Needs BOTH: the badge
       live, and a clinic slug to point at. */
    embedUrl:
      row?.clinwellLive && clinicSlug
        ? `https://app.clinwell.ai/book/${encodeURIComponent(clinicSlug)}/enquiry`
        : null,
  };
}

/**
 * PATCH /api/admin/members/:id/clinwell
 *
 * Sets ClinWell's OWN slug for this clinic — "dkc" for Dr Moholkar's —
 * which is used in exactly one place: the §7 booking embed URL.
 *
 * It is not a replacement for our slug. What we send ClinWell is always
 * the listing's own slug, and Synthiq stores that against their clinic
 * record; this field is the other half of that pairing, and nothing
 * here renames anything on this site.
 *
 * Validates rather than tidies. A slug this endpoint "helpfully"
 * lower-cased or hyphenated would be one ClinWell does not recognise,
 * and the failure would be a 404 inside an iframe that nobody is
 * watching — seen only by a patient trying to book.
 *
 * Deliberately its own endpoint rather than a field on the annotate
 * route: that one writes to the user account, this writes to the
 * listing, and one of them is part of a contract with a third party.
 */
export async function updateMemberClinwell(req, res) {
  const all = await loadMembers();
  const member = all.find((m) => m.id === req.params.id || m.slug === req.params.id);
  if (!member) return res.status(404).json({ error: "No such member" });
  if (!isDbConfigured()) return res.status(503).json({ error: "Setting a ClinWell slug needs a database." });

  /* The old field name is still accepted so a half-updated client does
     not silently post nothing. */
  const supplied = req.body?.clinicSlug ?? req.body?.clinwellClinicSlug ?? req.body?.clinwellSlug;
  if (supplied === undefined) return res.status(400).json({ error: "Nothing to change." });

  const raw = String(supplied ?? "").trim();

  /* Empty clears it, which means "no booking embed" — our own enquiry
     form is then used, which is the right answer for every practice
     that has one. */
  let slug = null;
  if (raw) {
    if (raw.length > 100) return res.status(400).json({ error: "A ClinWell clinic slug is at most 100 characters." });
    if (!/^[a-z0-9-]+$/.test(raw)) {
      return res.status(400).json({
        error:
          "A ClinWell clinic slug is lower-case letters, digits and hyphens only. Enter it exactly as Synthiq gave it — it is not normalised on either side.",
      });
    }
    slug = raw;
  }

  const updated = await specialistRepo.setClinwellClinicSlug(member.id, slug).catch((err) => {
    /* The unique index. Two listings pointing at one ClinWell clinic
       would put two practices' patients through one booking widget. */
    if (String(err?.message ?? "").includes("clinwell_clinic_slug")) return { conflict: true };
    throw err;
  });
  if (updated?.conflict) {
    return res.status(409).json({ error: "Another listing already uses that ClinWell clinic slug." });
  }

  await audit(req, {
    action: "member.clinwell-clinic-slug",
    subjectType: "member",
    subjectId: member.id,
    subjectLabel: member.fullName,
    detail: { from: member.clinwellClinicSlug ?? null, to: slug },
  });

  res.json({ ok: true, clinwell: await clinwellStateFor({ ...member, clinwellClinicSlug: slug }) });
}

/* ------------------------------------------------------------- audit */

async function audit(req, entry) {
  if (!isDbConfigured()) return null;
  return adminAudit.record({
    actorUserId: req.user?.id ?? null,
    actorName: req.user?.fullName ?? "Unknown",
    actorEmail: req.user?.email ?? null,
    ip: clientIp(req),
    ...entry,
  });
}

// GET /api/admin/audit — the log itself.
export async function listAudit(req, res) {
  if (!isDbConfigured()) return res.json({ results: [], note: "The audit log needs a database." });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json({ results: await adminAudit.recent({ limit }) });
}

/* ----------------------------------------------------- impersonation */

/**
 * How long a borrowed session lasts.
 *
 * Short on purpose. Support work is minutes; a token that outlived the
 * afternoon would sit in a browser being forgotten about, and the whole
 * safety of this feature rests on it being a deliberate, brief,
 * recorded act rather than a second way to be logged in.
 */
const IMPERSONATION_TTL_SECONDS = 60 * 30;

// POST /api/admin/members/:id/impersonate
export async function startImpersonation(req, res) {
  const all = await loadMembers();
  const member = all.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "No such member" });
  if (!member.userId) {
    return res.status(409).json({
      error: "That listing has no account behind it yet — there is no session to borrow.",
      code: "no_account",
    });
  }

  const account = isDbConfigured()
    ? await userRepo.findById(member.userId)
    : demoAccounts.findById(member.userId);
  if (!account) return res.status(404).json({ error: "That account no longer exists" });

  /* Two refusals that matter more than they look:

     An admin account. Borrowing another administrator's session is a
     way to take an action that the log attributes to them, which is
     precisely the thing this feature must not enable.

     A deactivated account. If it cannot sign in, neither can anyone
     wearing it — otherwise suspension would be a door that only locks
     for the person outside it. */
  if (account.role === "admin") {
    return res.status(403).json({ error: "Administrator accounts cannot be signed in to." });
  }
  if (account.active === false) {
    return res.status(409).json({
      error: "That account is suspended. Reactivate it first if you need to sign in as them.",
      code: "account_suspended",
    });
  }

  const reason = String(req.body?.reason ?? "").trim().slice(0, 300) || null;

  await audit(req, {
    action: "impersonate.start",
    subjectType: "member",
    subjectId: member.id,
    subjectLabel: `${member.fullName} <${member.email ?? "no email"}>`,
    detail: { reason, accountId: account.id, expiresInSeconds: IMPERSONATION_TTL_SECONDS },
  });

  /* The token says who is really driving. `act` is the actor — the
     administrator — and every request made with this token carries it,
     so the session can be refused at admin routes and labelled in the
     interface without the browser being trusted to admit anything. */
  /* The session row carries the actor too, so the MEMBER's own device
     list shows this for what it is — "support session, opened by Jane
     Okafor" — rather than as an unexplained sign-in they cannot place.
     Somebody whose account was entered deserves to be able to see it. */
  const { token } = await issueSession(req, account, {
    actorId: req.user.id,
    ttlSeconds: IMPERSONATION_TTL_SECONDS,
  });

  res.json({
    ok: true,
    token,
    expiresInSeconds: IMPERSONATION_TTL_SECONDS,
    member: { id: member.id, slug: member.slug, fullName: member.fullName, email: member.email },
  });
}

// POST /api/admin/members/stop-impersonating
export async function stopImpersonation(req, res) {
  /* Called with the BORROWED token, not the admin's — the browser has
     put the admin's aside and is holding this one. The actor id in the
     token is what says which administrator to hand it back to, which is
     why it is signed rather than sent in the body. */
  const actorId = req.impersonatorId;
  if (!actorId) return res.status(400).json({ error: "This session is not an impersonation." });

  const actor = isDbConfigured() ? await userRepo.findById(actorId) : demoAccounts.findById(actorId);
  if (!actor || actor.role !== "admin" || actor.active === false) {
    return res.status(403).json({ error: "That administrator account can no longer sign in." });
  }

  if (isDbConfigured()) {
    await adminAudit.record({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorEmail: actor.email,
      ip: clientIp(req),
      action: "impersonate.stop",
      subjectType: "member",
      subjectId: req.user?.specialistId ?? null,
      subjectLabel: `${req.user?.fullName ?? "member"} <${req.user?.email ?? ""}>`,
      detail: {},
    });
  }

  /* The borrowed session ends here rather than being left to lapse:
     handing it back and leaving it live would put a working token for
     somebody else's account in the browser's history for half an hour. */
  if (req.session?.id) await revokeSession(req.session.id, "support session ended");

  const returned = await issueSession(req, actor);
  res.json({
    ok: true,
    token: returned.token,
    account: { id: actor.id, fullName: actor.fullName, email: actor.email, role: actor.role },
  });
}

/* -------------------------------------------------------- bulk actions */

/**
 * What a bulk action may do, and what each one means.
 *
 * `verification` changes the listing — a public thing. `account`
 * changes the login — a private thing. They are deliberately separate:
 * rejecting a listing is not the same as locking someone out, and an
 * interface that conflated them would eventually do the second while
 * meaning the first.
 */
const BULK_ACTIONS = {
  approve: { kind: "verification", to: "verified", label: "Approved" },
  hold: { kind: "verification", to: "pending", label: "Put on hold" },
  "request-info": { kind: "verification", to: "info_requested", label: "Information requested" },
  reject: { kind: "verification", to: "rejected", label: "Rejected", needsNote: true },
  suspend: { kind: "verification", to: "suspended", label: "Suspended", needsNote: true },
  "deactivate-account": { kind: "account", set: { active: false }, label: "Account deactivated" },
  "reactivate-account": { kind: "account", set: { active: true }, label: "Account reactivated" },
  tag: { kind: "tag", label: "Tagged" },
  untag: { kind: "untag", label: "Tag removed" },
};

// POST /api/admin/members/bulk  { action, ids: [], note?, tag? }
export async function bulkMembers(req, res) {
  const action = String(req.body?.action ?? "");
  const spec = BULK_ACTIONS[action];
  if (!spec) {
    return res.status(400).json({
      error: `Unknown action "${action}".`,
      allowed: Object.keys(BULK_ACTIONS),
    });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: "Select at least one member." });
  /* A ceiling, because the whole point of this endpoint is to do a lot
     at once and an unbounded loop over a growing table is how one
     mis-click becomes a timeout halfway through a partial write. */
  if (ids.length > 500) {
    return res.status(413).json({ error: "That is more than 500 members. Narrow the filter and do it in batches." });
  }

  const note = String(req.body?.note ?? "").trim().slice(0, 500) || null;
  if (spec.needsNote && !note) {
    return res.status(400).json({
      error: `A reason is required to ${action} a listing — it is sent to the member.`,
      code: "note_required",
    });
  }
  const tag = String(req.body?.tag ?? "").trim().slice(0, 40);
  if ((spec.kind === "tag" || spec.kind === "untag") && !tag) {
    return res.status(400).json({ error: "Name the tag." });
  }

  const all = await loadMembers();
  const byId = new Map(all.map((m) => [m.id, m]));

  const done = [];
  const skipped = [];

  for (const id of ids) {
    const member = byId.get(id);
    if (!member) {
      skipped.push({ id, reason: "no such member" });
      continue;
    }

    try {
      if (spec.kind === "verification") {
        await setVerification(member, spec.to, note, req.user);
      } else if (spec.kind === "account") {
        if (!member.userId) {
          skipped.push({ id, name: member.fullName, reason: "no account behind this listing" });
          continue;
        }
        const account = isDbConfigured()
          ? await userRepo.findById(member.userId)
          : demoAccounts.findById(member.userId);
        // Never through this door. An administrator locking out another
        // administrator is a thing to do deliberately, one at a time.
        if (account?.role === "admin") {
          skipped.push({ id, name: member.fullName, reason: "administrator account" });
          continue;
        }
        if (isDbConfigured()) await userRepo.update(member.userId, spec.set);
        else demoAccounts.update(member.userId, spec.set);
      } else if (spec.kind === "tag" || spec.kind === "untag") {
        if (!member.userId) {
          skipped.push({ id, name: member.fullName, reason: "no account behind this listing" });
          continue;
        }
        const current = new Set(member.tags ?? []);
        if (spec.kind === "tag") current.add(tag);
        else current.delete(tag);
        const tags = [...current];
        if (isDbConfigured()) await userRepo.update(member.userId, { tags });
        else demoAccounts.update(member.userId, { tags });
      }

      done.push({ id, name: member.fullName });
      await audit(req, {
        action: `member.${action}`,
        subjectType: "member",
        subjectId: member.id,
        subjectLabel: `${member.fullName} <${member.email ?? "no email"}>`,
        detail: { note, tag: tag || undefined, from: member.verificationStatus, to: spec.to },
      });
    } catch (err) {
      skipped.push({ id, name: member.fullName, reason: err.message ?? "failed" });
    }
  }

  res.json({
    ok: true,
    action,
    label: spec.label,
    changed: done.length,
    skippedCount: skipped.length,
    done,
    skipped,
  });
}

/** Move one listing to a verification state, in either storage mode. */
async function setVerification(member, to, note, actor) {
  const entry = {
    action: to,
    byUserId: actor?.id ?? null,
    byName: actor?.fullName ?? "Administrator",
    note: note ?? null,
    at: new Date().toISOString(),
  };

  if (!isDbConfigured()) {
    const row = mockSpecialists.find((s) => s.id === member.id);
    if (!row) throw new Error("no such listing");
    row.verificationStatus = to;
    row.verificationHistory = [...(row.verificationHistory ?? []), entry];
    return;
  }

  const current = await specialistRepo.findById(member.id);
  if (!current) throw new Error("no such listing");
  await specialistRepo.update(member.id, {
    verificationStatus: to,
    verificationHistory: [...(current.verificationHistory ?? []), entry],
  });
}

/* ------------------------------------------------------------- export */

const CSV_COLUMNS = [
  ["id", "ID"],
  ["fullName", "Name"],
  ["email", "Email"],
  ["title", "Title"],
  ["qualifications", "Qualifications"],
  ["specialty", "Specialty"],
  ["city", "City"],
  ["contactPhone", "Phone"],
  ["verificationStatus", "Status"],
  ["claimed", "Claimed"],
  ["plan", "Plan"],
  ["planStatus", "Plan status"],
  ["ratingAvg", "Rating"],
  ["ratingCount", "Reviews"],
  ["joinedAt", "Joined"],
  ["lastLoginAt", "Last login"],
  ["signupIp", "Signup IP"],
  ["signupCountry", "Signup country"],
  ["sourceName", "Source"],
  ["sourceUrl", "Source URL"],
  ["tags", "Tags"],
];

/**
 * Quote a value for CSV.
 *
 * The leading apostrophe on anything starting with = + - @ is not
 * decoration: those characters make Excel treat the cell as a formula,
 * and a name field containing one is how a spreadsheet export becomes
 * remote code execution on whoever opens it.
 */
function csvCell(value) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// GET /api/admin/members/export.csv — the current filter, as a file.
export async function exportMembers(req, res) {
  const all = await loadMembers();
  const matched = applyFilters(all, req.query);
  const sortKey = SORTS[req.query.sort] ? req.query.sort : "newest";
  matched.sort(SORTS[sortKey]);

  const lines = [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",")];
  for (const m of matched) lines.push(CSV_COLUMNS.map(([key]) => csvCell(m[key])).join(","));

  await audit(req, {
    action: "member.export",
    subjectType: "members",
    subjectId: null,
    subjectLabel: `${matched.length} members`,
    detail: { filters: req.query },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="tls-members-${stamp}.csv"`);
  // A BOM, so Excel opens it as UTF-8 rather than mangling every accent.
  res.send("﻿" + lines.join("\r\n"));
}

/* --------------------------------------------------------- one member */

// PATCH /api/admin/members/:id  { adminNotes?, tags? }
export async function updateMemberAdminFields(req, res) {
  const all = await loadMembers();
  const member = all.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "No such member" });
  if (!member.userId) return res.status(409).json({ error: "That listing has no account to annotate." });

  const patch = {};
  if (req.body?.adminNotes !== undefined) {
    patch.adminNotes = String(req.body.adminNotes ?? "").slice(0, 4000) || null;
  }
  if (Array.isArray(req.body?.tags)) {
    patch.tags = [...new Set(req.body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 25);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to change." });

  if (isDbConfigured()) await userRepo.update(member.userId, patch);
  else demoAccounts.update(member.userId, patch);

  await audit(req, {
    action: "member.annotate",
    subjectType: "member",
    subjectId: member.id,
    subjectLabel: member.fullName,
    detail: { fields: Object.keys(patch) },
  });

  res.json({ ok: true });
}
