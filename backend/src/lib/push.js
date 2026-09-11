/* ------------------------------------------------------------------ *
 * Push notifications
 *
 * Same shape as the mailer and the payment provider: the whole delivery
 * path is here, the vendor is not. Registering a provider is one call at
 * boot and nothing else in the codebase changes.
 *
 *   import webpush from "web-push";
 *   import { setPushProvider } from "./lib/push.js";
 *
 *   webpush.setVapidDetails(
 *     "mailto:admin@toplocalspecialists.com",
 *     process.env.VAPID_PUBLIC_KEY,
 *     process.env.VAPID_PRIVATE_KEY
 *   );
 *   setPushProvider({
 *     name: "web-push",
 *     async send({ subscription, title, body, url }) {
 *       await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
 *     },
 *   });
 *
 * Until then send() logs what it would have delivered and reports
 * `sent: false` with a reason, so the interface can say "push isn't
 * connected" instead of implying a phone buzzed.
 * ------------------------------------------------------------------ */

import { eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client.js";
import { pushSubscriptions as pushSubscriptionsTable } from "../db/schema.js";

let provider = null;

export function setPushProvider(impl) {
  provider = impl;
}

export function hasPushProvider() {
  return Boolean(provider);
}

export function pushProviderName() {
  return provider?.name ?? null;
}

/* ------------------------------------------------------------------ *
 * Device subscriptions
 *
 * A push subscription is per browser/device, so one account can hold
 * several. Rows when a database is configured, memory in demo mode.
 * ------------------------------------------------------------------ */

const subscriptions = [];

/** Row -> the shape web-push expects back. */
function toDevice(row) {
  return {
    userId: row.userId,
    endpoint: row.endpoint,
    subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export const pushSubscriptions = {
  async add(userId, subscription) {
    const endpoint = subscription?.endpoint;
    if (!endpoint) return null;

    if (!isDbConfigured()) {
      // Re-registering the same browser must not create a duplicate, or
      // every notification arrives twice.
      const existing = subscriptions.find((s) => s.endpoint === endpoint);
      if (existing) {
        existing.userId = userId;
        existing.subscription = subscription;
        return existing;
      }
      const record = { userId, endpoint, subscription, createdAt: new Date().toISOString() };
      subscriptions.push(record);
      return record;
    }

    const [row] = await getDb()
      .insert(pushSubscriptionsTable)
      .values({
        userId,
        endpoint,
        p256dh: subscription?.keys?.p256dh ?? "",
        auth: subscription?.keys?.auth ?? "",
      })
      // Same browser, same endpoint: move it to whoever is signed in now
      // rather than adding a second row that would double every send.
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          userId,
          p256dh: subscription?.keys?.p256dh ?? "",
          auth: subscription?.keys?.auth ?? "",
        },
      })
      .returning();
    return toDevice(row);
  },

  async remove(endpoint) {
    if (!isDbConfigured()) {
      const i = subscriptions.findIndex((s) => s.endpoint === endpoint);
      if (i >= 0) subscriptions.splice(i, 1);
      return;
    }
    await getDb().delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  },

  async forUser(userId) {
    if (!isDbConfigured()) return subscriptions.filter((s) => s.userId === userId);
    const rows = await getDb()
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
    return rows.map(toDevice);
  },

  async count() {
    if (!isDbConfigured()) return subscriptions.length;
    const [row] = await getDb().select({ count: sql`count(*)::int` }).from(pushSubscriptionsTable);
    return row?.count ?? 0;
  },
};

/**
 * Send a push to every device an account has registered.
 *
 * Never throws: a failed push must not take down the request that
 * triggered it, and the in-app notification is the durable record
 * anyway.
 */
export async function sendPush(userId, { title, body, url }) {
  const devices = await pushSubscriptions.forUser(userId);

  if (!provider) {
    console.log(`[push] (not sent — no provider configured) to ${userId}: ${title} — ${body}`);
    return { sent: false, reason: "no-push-provider", devices: devices.length };
  }
  if (devices.length === 0) {
    return { sent: false, reason: "no-registered-devices", devices: 0 };
  }

  let delivered = 0;
  for (const device of devices) {
    try {
      await provider.send({ subscription: device.subscription, title, body, url });
      delivered += 1;
    } catch (err) {
      // A 410 means the browser dropped the subscription — clean it up
      // rather than retrying it forever.
      if (err?.statusCode === 404 || err?.statusCode === 410) await pushSubscriptions.remove(device.endpoint);
      else console.error("[push] send failed:", err?.message ?? err);
    }
  }
  return { sent: delivered > 0, delivered, devices: devices.length };
}
