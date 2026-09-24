import { and, eq, gte, sql } from "drizzle-orm";
import { isDbConfigured } from "../config/db.js";
import { getDb } from "../db/client.js";
import { profileViewEvents } from "../db/schema.js";

// Profile view counting.
//
// The dashboard's "Profile views" figure and the analytics trend both
// come from here, so the number a specialist sees is an actual count of
// profile loads rather than a decorative stat.
//
// Views are held in memory keyed by specialist and day. That is the right
// shape for a demo and for a single-process deployment; at scale this
// becomes a `ProfileView` collection (or a counter in Redis flushed
// periodically) with exactly the same two functions in front of it, so
// nothing that reads views has to change.

const views = new Map(); // specialistId -> Map<YYYY-MM-DD, count>

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function recordProfileView(specialistId, when = new Date()) {
  if (!specialistId) return;
  if (!views.has(specialistId)) views.set(specialistId, new Map());
  const byDay = views.get(specialistId);
  const key = dayKey(when);
  byDay.set(key, (byDay.get(key) ?? 0) + 1);
}

/** Total views in the last `days` days, plus a per-day series for charting. */
export function viewStats(specialistId, days = 30) {
  const byDay = views.get(specialistId) ?? new Map();
  const series = [];
  let total = 0;
  let previousPeriod = 0;

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    const count = byDay.get(key) ?? 0;
    series.push({ date: key, count });
    total += count;
  }
  for (let i = days * 2 - 1; i >= days; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    previousPeriod += byDay.get(dayKey(d)) ?? 0;
  }

  const changePct = previousPeriod > 0 ? Math.round(((total - previousPeriod) / previousPeriod) * 100) : null;
  return { total, series, previousPeriod, changePct };
}


/* ------------------------------------------------------------------ *
 * Persistent views -- profile_view_events
 *
 * The functions above answer instantly from memory and stay exactly as
 * they were (demo mode has no database to write to). Once a database is
 * configured, getSpecialistBySlug also calls persistProfileView, and
 * everything below reads that table instead -- a history that survives
 * a restart, with the referrer and search term the in-memory counter
 * never had room for.
 * ------------------------------------------------------------------ */

/**
 * Where a view came from, in the two shapes the dashboard cares about.
 * A same-site referrer means the patient searched and clicked through,
 * so its query string is the search term; anything else is an external
 * site, named by its hostname.
 */
export function classifyReferrer(refererHeader, siteUrl) {
  if (!refererHeader) return { referrer: null, searchTerm: null };
  let url;
  try {
    url = new URL(refererHeader);
  } catch {
    return { referrer: null, searchTerm: null };
  }
  let site = null;
  try {
    site = siteUrl ? new URL(siteUrl) : null;
  } catch {
    site = null;
  }
  if (site && url.hostname === site.hostname) {
    const q = url.searchParams.get("q");
    return { referrer: "search", searchTerm: q ? q.slice(0, 200) : null };
  }
  return { referrer: url.hostname.replace(/^www\./, ""), searchTerm: null };
}

/** Fire-and-forget: a slow or failed write must never hold up the page
 *  it is describing. Errors are swallowed at the call site, not here,
 *  so a caller that does want to know still can. */
export async function persistProfileView({ specialistId, referrer = null, searchTerm = null, path = null }) {
  if (!specialistId || !isDbConfigured()) return;
  await getDb()
    .insert(profileViewEvents)
    .values({ specialistId, referrer, searchTerm, path });
}

/** The DB-backed equivalent of viewStats -- same shape, longer memory. */
export async function dbViewStats(specialistId, days = 30) {
  if (!isDbConfigured()) return viewStats(specialistId, days);
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days * 2);

  const rows = await db
    .select({
      day: sql`to_char(${profileViewEvents.occurredAt} at time zone 'utc', 'YYYY-MM-DD')`.as("day"),
      count: sql`count(*)`.as("count"),
    })
    .from(profileViewEvents)
    .where(and(eq(profileViewEvents.specialistId, specialistId), gte(profileViewEvents.occurredAt, since)))
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const series = [];
  let total = 0;
  let previousPeriod = 0;
  const dayKeyUtc = (d) => d.toISOString().slice(0, 10);

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKeyUtc(d);
    const count = byDay.get(key) ?? 0;
    series.push({ date: key, count });
    total += count;
  }
  for (let i = days * 2 - 1; i >= days; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    previousPeriod += byDay.get(dayKeyUtc(d)) ?? 0;
  }

  const changePct = previousPeriod > 0 ? Math.round(((total - previousPeriod) / previousPeriod) * 100) : null;
  return { total, series, previousPeriod, changePct };
}

/** Top external sites and on-site searches that led to a view, most
 *  recent `days` days. Kept separate from dbViewStats because a
 *  dashboard reasonably wants the trend without paying for both. */
export async function viewSources(specialistId, days = 30, limit = 8) {
  if (!isDbConfigured()) return { referrers: [], searchTerms: [] };
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const referrers = await db
    .select({ referrer: profileViewEvents.referrer, count: sql`count(*)`.as("count") })
    .from(profileViewEvents)
    .where(
      and(
        eq(profileViewEvents.specialistId, specialistId),
        gte(profileViewEvents.occurredAt, since),
        sql`${profileViewEvents.referrer} is not null and ${profileViewEvents.referrer} <> 'search'`
      )
    )
    .groupBy(profileViewEvents.referrer)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  const searchTerms = await db
    .select({ term: profileViewEvents.searchTerm, count: sql`count(*)`.as("count") })
    .from(profileViewEvents)
    .where(
      and(
        eq(profileViewEvents.specialistId, specialistId),
        gte(profileViewEvents.occurredAt, since),
        sql`${profileViewEvents.searchTerm} is not null`
      )
    )
    .groupBy(profileViewEvents.searchTerm)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return {
    referrers: referrers.map((r) => ({ referrer: r.referrer, count: Number(r.count) })),
    searchTerms: searchTerms.map((r) => ({ term: r.term, count: Number(r.count) })),
  };
}
