/* ------------------------------------------------------------------ *
 * Sessions
 *
 * One place where a session token is created, so that every one of them
 * has a row behind it. That matters more than it sounds: the device
 * list is only honest if it is complete, and a token minted somewhere
 * that forgot to call this would be a session the owner cannot see and
 * cannot revoke — invisible exactly when it matters.
 *
 * The six places that mint one are all here as callers: signing up,
 * signing in, finishing a reset, changing a password, an administrator
 * borrowing a session, and handing it back.
 *
 * Demo mode has no database, so rows live in a Map for the life of the
 * process. Same shape, same behaviour, so nothing above this file has
 * to know which it is talking to.
 * ------------------------------------------------------------------ */

import { isDbConfigured } from "../config/db.js";
import { sessions as sessionRepo } from "../db/repos.js";
import { createToken } from "./auth.js";
import { requestOrigin } from "./requestIp.js";

/* Matches the token's own life. The row expiring and the token
   expiring on different days would produce a list that shows sessions
   that do not work, or hides ones that do. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/* A session that has not been used for this long is written off even if
   its token has not expired — see `touch`. Not a security boundary, a
   tidiness one. */
const TOUCH_EVERY_MS = 60_000;

/* ------------------------------------------------------------- demo */

const demoRows = new Map();
let demoSeq = 0;

const demoStore = {
  async create({ userId, actorUserId, userAgent, ip, country, expiresAt }) {
    const row = {
      id: `ses-${++demoSeq}`,
      userId,
      actorUserId: actorUserId ?? null,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      country: country ?? null,
      lastSeenAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      expiresAt,
      createdAt: new Date(),
    };
    demoRows.set(row.id, row);
    return row;
  },
  async find(id) {
    return demoRows.get(id) ?? null;
  },
  async touch(id, { ip, country } = {}) {
    const row = demoRows.get(id);
    if (!row) return;
    row.lastSeenAt = new Date();
    if (ip) row.ip = ip;
    if (country) row.country = country;
  },
  async liveFor(userId) {
    return [...demoRows.values()]
      .filter((r) => r.userId === userId && !r.revokedAt && new Date(r.expiresAt) > new Date())
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
  },
  async revoke(id, reason = "signed out") {
    const row = demoRows.get(id);
    if (!row || row.revokedAt) return null;
    row.revokedAt = new Date();
    row.revokedReason = reason;
    return row;
  },
  async revokeAllFor(userId, { exceptId = null, reason = "signed out elsewhere" } = {}) {
    let n = 0;
    for (const row of demoRows.values()) {
      if (row.userId !== userId || row.revokedAt || row.id === exceptId) continue;
      row.revokedAt = new Date();
      row.revokedReason = reason;
      n += 1;
    }
    return n;
  },
  async purgeExpired(before = new Date()) {
    let n = 0;
    for (const [id, row] of demoRows) {
      if (new Date(row.expiresAt) < before) {
        demoRows.delete(id);
        n += 1;
      }
    }
    return n;
  },
};

const store = () => (isDbConfigured() ? sessionRepo : demoStore);

/* ------------------------------------------------------- minting */

/**
 * Open a session and return the token for it.
 *
 * `actorId` is the administrator behind a support session. It goes into
 * the token as `act` (which is what the middleware enforces) and onto
 * the row as well, so the member's own device list can say "support
 * session — Jane Okafor" rather than showing an unexplained login.
 */
export async function issueSession(req, user, { actorId = null, ttlSeconds = SESSION_TTL_SECONDS } = {}) {
  const origin = requestOrigin(req);
  const row = await store().create({
    userId: String(user.id),
    actorUserId: actorId ? String(actorId) : null,
    userAgent: String(req?.headers?.["user-agent"] ?? "").slice(0, 400) || null,
    ip: origin.ip,
    country: origin.country,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });

  const claims = { sub: String(user.id), role: user.role, sid: row.id };
  if (actorId) claims.act = String(actorId);
  return { token: createToken(claims, ttlSeconds), session: row };
}

/* ------------------------------------------------------- reading */

/**
 * Is this session still good? Returns the row, or null.
 *
 * A token whose row is gone is refused: rows are only deleted once they
 * are long expired, so a missing row for a live token means the account
 * was deleted underneath it.
 */
export async function loadSession(sid) {
  if (!sid) return null;
  const row = await store().find(sid);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

/**
 * Record that a session was just used — at most once a minute.
 *
 * A write per request would turn every authenticated call into a
 * database write, on a list that only ever says "a few minutes ago".
 * The in-process cache means several server instances each write once a
 * minute, which is still nothing and is correct enough for the only
 * question it answers.
 */
const lastTouched = new Map();
export async function touchSession(req, sid) {
  const now = Date.now();
  const previous = lastTouched.get(sid) ?? 0;
  if (now - previous < TOUCH_EVERY_MS) return;
  lastTouched.set(sid, now);
  const origin = requestOrigin(req);
  await store()
    .touch(sid, { ip: origin.ip, country: origin.country })
    .catch(() => null);
}

export const listSessions = (userId) => store().liveFor(userId);
export const revokeSession = (id, reason) => store().revoke(id, reason);
export const revokeOtherSessions = (userId, exceptId, reason) =>
  store().revokeAllFor(userId, { exceptId, reason });
export const revokeAllSessions = (userId, reason) => store().revokeAllFor(userId, { reason });
export const purgeExpiredSessions = (before) => store().purgeExpired(before);

/* ------------------------------------------- describing a device */

/**
 * Turn a user-agent string into something a person recognises.
 *
 * Deliberately crude. This is not analytics — it exists so somebody
 * scanning a list can tell "that's my iPhone" from "that is not any
 * device I own", and for that job "Safari on iPhone" is worth more than
 * an exact version number. Anything unrecognised is reported honestly
 * as unknown rather than guessed at.
 */
export function describeDevice(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return { browser: null, platform: null, label: "Unknown device" };

  const platform =
    /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /CrOS/i.test(ua) ? "Chromebook"
    : /Linux/i.test(ua) ? "Linux"
    : null;

  /* Order matters: Edge and Opera both claim to be Chrome, and Chrome
     claims to be Safari. Checking the most specific first is the whole
     trick. */
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : /curl|node|python|Go-http/i.test(ua) ? "A script"
    : null;

  const label =
    browser && platform ? `${browser} on ${platform}`
    : browser ? browser
    : platform ? platform
    : "Unknown device";

  return { browser, platform, label };
}
