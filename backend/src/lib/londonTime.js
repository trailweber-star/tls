/* ------------------------------------------------------------------ *
 * Europe/London local time <-> UTC
 *
 * specialistAvailability.startMinute/endMinute are captured from a
 * plain <input type="time"> in the dashboard (see
 * pages/dashboard/Appointments.tsx's timeToMinutes) -- a UK clinician
 * typing "09:00" with no timezone attached at all, and schema.js's own
 * comment on the column calls them "minutes since local midnight".
 *
 * booking.controller.js used to treat that same number as minutes
 * since UTC midnight, which is only correct while the UK is on GMT
 * (roughly late October to late March). For the other ~7 months of
 * the year, on British Summer Time (UTC+1), every slot generated and
 * every booking validated was an hour off from what the specialist
 * actually configured -- a 9am rule offered and accepted 8am UTC as
 * "9am", which is 9am GMT but 8am BST.
 *
 * Node ships the full IANA timezone database via Intl on every
 * platform, so this needs no dependency -- just two conversions built
 * on Intl.DateTimeFormat, kept in one place so nothing else has to
 * reason about DST directly.
 * ------------------------------------------------------------------ */

const ZONE = "Europe/London";
const WEEKDAY_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The Europe/London UTC offset, in minutes (positive = ahead of UTC),
 * AT the given UTC instant -- the actual moment, not a date, so this
 * reads correctly even for the hour either side of a DST transition,
 * when a whole-day offset would guess wrong for half the day.
 */
function offsetMinutesAt(utcInstant) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcInstant);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  // What UTC instant would have these same digits, read as if they
  // were already UTC. The gap between that and the real UTC instant we
  // asked about is exactly the offset.
  const localReadAsUtc = new Date(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.000Z`);
  return Math.round((localReadAsUtc.getTime() - utcInstant.getTime()) / 60000);
}

/**
 * The UTC offset Europe/London is on at local noon of the given
 * YYYY-MM-DD date -- a one-number answer for display ("this day is on
 * BST"). Not used below: londonMinutesToUtc corrects against the
 * instant itself instead, so it stays exact through a transition day,
 * which a single whole-day number cannot be for every minute of it.
 */
export function londonOffsetMinutes(dateStr) {
  return offsetMinutesAt(new Date(`${dateStr}T12:00:00.000Z`));
}

/**
 * A YYYY-MM-DD local calendar date plus minutes since that day's local
 * midnight -- exactly what an availability rule stores, and what the
 * booking widget's day picker sends -- turned into the real UTC
 * instant it refers to.
 *
 * Guesses the instant as if the offset were zero, then corrects using
 * the real offset at that guess. The guess is always within an hour of
 * the truth, and the offset only ever changes once, at 1am or 2am local
 * on the two nights of the year it changes at all, so one correction is
 * exact everywhere -- including minute 0 (midnight) on a transition day
 * itself, which a whole-day offset gets wrong for exactly that reason.
 */
export function londonMinutesToUtc(dateStr, minutesSinceLocalMidnight) {
  const naive = new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + minutesSinceLocalMidnight * 60000);
  return new Date(naive.getTime() - offsetMinutesAt(naive) * 60000);
}

/**
 * The reverse: a real UTC instant (an appointment's startsAt, say)
 * broken into the Europe/London local calendar date, weekday (0 =
 * Sunday, matching Date#getDay() the way availability rules already
 * do) and minutes since that local day's midnight it falls on.
 */
export function utcToLondonParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    weekday: WEEKDAY_INDEX.indexOf(map.weekday),
    minuteOfDay: Number(map.hour) * 60 + Number(map.minute),
  };
}

/** The next calendar date string -- pure date-component arithmetic, not
 *  an instant, so it is never off by an hour around a DST transition
 *  the way "+24h" on a Date would be. */
export function nextDateStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
