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
