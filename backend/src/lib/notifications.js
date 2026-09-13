import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client.js";
import { notifications as notificationsTable } from "../db/schema.js";
import { sendMail } from "./mailer.js";
import { sendPush } from "./push.js";

/* ------------------------------------------------------------------ *
 * Notifications
 *
 * One event, up to three destinations: the in-app bell (durable, the
 * record of truth), an email, and a push to whatever devices the account
 * has registered. The in-app row is written first and always — email and
 * push are best-effort, and a failure in either must never lose the
 * admin's to-do item.
 *
 * Each notification carries a `key`. Writing the same key twice is a
 * no-op, which is what stops the 24-hour reminder sweep from stacking up
 * a new row every time it runs.
 * ------------------------------------------------------------------ */

const notifications = [];

export const NOTIFICATION_TYPES = {
  SIGNUP_PENDING: "signup_pending",
  CLAIM_PENDING: "claim_pending",
  APPROVAL_OVERDUE: "approval_overdue",
  PAYMENT_RECEIVED: "payment_received",
  ENQUIRY_RECEIVED: "enquiry_received",
  APPLICATION_DECIDED: "application_decided",
  REVIEW_PENDING: "review_pending",
  REVIEW_OVERDUE: "review_overdue",
  ARTICLE_PENDING: "article_pending",
};

/** Which notifications count as work an admin still has to do. */
const ACTIONABLE = new Set([
  NOTIFICATION_TYPES.SIGNUP_PENDING,
  NOTIFICATION_TYPES.CLAIM_PENDING,
  NOTIFICATION_TYPES.APPROVAL_OVERDUE,
  // A review sitting unmoderated is work, not news: it is invisible to
  // patients and unanswerable by the provider until someone decides.
  NOTIFICATION_TYPES.REVIEW_PENDING,
  NOTIFICATION_TYPES.REVIEW_OVERDUE,
  // An article submitted for review is work: it is invisible to patients
  // and the member who wrote it is waiting on a decision.
  NOTIFICATION_TYPES.ARTICLE_PENDING,
]);

function normalise(row) {
  if (!row) return null;
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
  return { ...row, readAt: iso(row.readAt), resolvedAt: iso(row.resolvedAt), createdAt: iso(row.createdAt) };
}

/**
 * The bell is the record of truth, so it has to survive a restart. With
 * a database configured these are rows; without one they stay in memory,
 * which is what demo mode is for. Every method is async in both modes so
 * callers never have to know which is underneath.
 */
export const notificationStore = {
  async add(row) {
    if (!isDbConfigured()) {
      notifications.push(row);
      return row;
    }
    const { createdAt, ...rest } = row;
    const [saved] = await getDb()
      .insert(notificationsTable)
      .values({ ...rest, readAt: null, resolvedAt: null })
      .returning();
    return normalise(saved);
  },

  async find(id) {
    if (!isDbConfigured()) return notifications.find((n) => n.id === id) ?? null;
    const [row] = await getDb()
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, id))
      .limit(1);
    return normalise(row);
  },

  async findByKey(key) {
    if (!isDbConfigured()) return notifications.find((n) => n.key === key) ?? null;
    const [row] = await getDb()
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.key, key))
      .limit(1);
    return normalise(row);
  },

  async forUser(userId, { unreadOnly = false, limit = 50 } = {}) {
    if (!isDbConfigured()) {
      return notifications
        .filter((n) => n.userId === userId && (!unreadOnly || !n.readAt))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }
    const where = unreadOnly
      ? and(eq(notificationsTable.userId, userId), isNull(notificationsTable.readAt))
      : eq(notificationsTable.userId, userId);
    const rows = await getDb()
      .select()
      .from(notificationsTable)
      .where(where)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    return rows.map(normalise);
  },

  async unreadCount(userId) {
    if (!isDbConfigured()) {
      return notifications.filter((n) => n.userId === userId && !n.readAt).length;
    }
    const [row] = await getDb()
      .select({ count: sql`count(*)::int` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), isNull(notificationsTable.readAt)));
    return row?.count ?? 0;
  },

  /** Unread items that represent outstanding work, not just news. */
  async actionableCount(userId) {
    if (!isDbConfigured()) {
      return notifications.filter((n) => n.userId === userId && !n.readAt && ACTIONABLE.has(n.type)).length;
    }
    const [row] = await getDb()
      .select({ count: sql`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          isNull(notificationsTable.readAt),
          inArray(notificationsTable.type, [...ACTIONABLE])
        )
      );
    return row?.count ?? 0;
  },

  async markRead(userId, id) {
    if (!isDbConfigured()) {
      const row = notifications.find((n) => n.id === id && n.userId === userId);
      if (!row) return null;
      row.readAt = row.readAt ?? new Date().toISOString();
      return row;
    }
    const [row] = await getDb()
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.userId, userId),
          isNull(notificationsTable.readAt)
        )
      )
      .returning();
    return row ? normalise(row) : notificationStore.find(id);
  },

  async markAllRead(userId) {
    if (!isDbConfigured()) {
      const now = new Date().toISOString();
      let count = 0;
      notifications.forEach((n) => {
        if (n.userId === userId && !n.readAt) {
          n.readAt = now;
          count += 1;
        }
      });
      return count;
    }
    const rows = await getDb()
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.userId, userId), isNull(notificationsTable.readAt)))
      .returning({ id: notificationsTable.id });
    return rows.length;
  },

  /**
   * Clear the outstanding items tied to one subject once it has been
   * dealt with — approving an application should empty the badge, not
   * leave the admin to tidy up after themselves.
   */
  async resolveSubject(subjectId) {
    if (!isDbConfigured()) {
      const now = new Date().toISOString();
      let count = 0;
      notifications.forEach((n) => {
        if (n.subjectId === subjectId && ACTIONABLE.has(n.type) && !n.readAt) {
          n.readAt = now;
          n.resolvedAt = now;
          count += 1;
        }
      });
      return count;
    }
    const now = new Date();
    const rows = await getDb()
      .update(notificationsTable)
      .set({ readAt: now, resolvedAt: now })
      .where(
        and(
          eq(notificationsTable.subjectId, subjectId),
          isNull(notificationsTable.readAt),
          inArray(notificationsTable.type, [...ACTIONABLE])
        )
      )
      .returning({ id: notificationsTable.id });
    return rows.length;
  },

  async all() {
    if (!isDbConfigured()) return [...notifications];
    const rows = await getDb().select().from(notificationsTable).orderBy(desc(notificationsTable.createdAt));
    return rows.map(normalise);
  },
};

/**
 * Create a notification and fan it out.
 *
 * @param userId    who it is for
 * @param type      one of NOTIFICATION_TYPES
 * @param title     one line, shown in the bell and used as the email subject
 * @param body      a sentence of detail
 * @param url       where clicking it should go, relative to the site
 * @param key       de-duplication key; a repeat is ignored
 * @param subjectId the thing it is about, so it can be resolved later
 * @param email     address to copy, or null to skip email
 * @param channels  which destinations to attempt
 */
export async function notify({
  userId,
  type,
  title,
  body,
  url = null,
  key = null,
  subjectId = null,
  email = null,
  channels = { inApp: true, email: true, push: true },
}) {
  const dedupeKey = key ?? `${type}:${subjectId ?? crypto.randomUUID()}`;

  if (await notificationStore.findByKey(dedupeKey)) {
    return { created: false, reason: "duplicate" };
  }

  const row = await notificationStore.add({
    id: `ntf_${crypto.randomBytes(8).toString("hex")}`,
    key: dedupeKey,
    userId,
    type,
    title,
    body,
    url,
    subjectId,
    readAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  });

  // Delivery is reported back to the caller but deliberately not stored:
  // whether an email left the building is a fact about that attempt, not
  // about the notification, and the durable row is the record of truth.
  const delivery = { email: null, push: null };

  // Email and push are attempted after the durable row exists, and
  // neither is allowed to throw into the caller's request.
  if (channels.email && email) {
    delivery.email = await sendMail({
      to: email,
      subject: title,
      text: `${body}\n\n${url ? `${process.env.SITE_URL || "http://localhost:5173"}${url}` : ""}`.trim(),
    }).catch((err) => ({ sent: false, reason: String(err?.message ?? err) }));
  }

  if (channels.push) {
    delivery.push = await sendPush(userId, { title, body, url }).catch((err) => ({
      sent: false,
      reason: String(err?.message ?? err),
    }));
  }

  return { created: true, notification: { ...row, delivery } };
}

/**
 * Notify every admin at once.
 *
 * Approvals are not assigned to an individual, so the work item goes to
 * all of them — and resolving it (see resolveSubject) clears it for
 * everyone, so two admins do not review the same application twice.
 */
export async function notifyAdmins(admins, payload) {
  const results = [];
  for (const admin of admins) {
    results.push(
      await notify({
        ...payload,
        userId: String(admin.id ?? admin._id),
        email: admin.email,
        key: payload.key ? `${payload.key}:${String(admin.id ?? admin._id)}` : null,
      })
    );
  }
  return results;
}
