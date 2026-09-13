import { z } from "zod";
import { hasPushProvider, pushProviderName, pushSubscriptions } from "../lib/push.js";
import { notificationStore } from "../lib/notifications.js";
import { vapidPublicKey } from "../lib/pushProvider.js";

/* ------------------------------------------------------------------ *
 * Notifications API
 *
 * Scoped to the signed-in account by construction: every read and write
 * takes the user id from the session, never from the request, so one
 * account can never see or clear another's bell.
 * ------------------------------------------------------------------ */

const userIdOf = (req) => String(req.user.id ?? req.user._id);

// GET /api/notifications?unread=1
export async function listNotifications(req, res) {
  const userId = userIdOf(req);
  const unreadOnly = req.query.unread === "1";
  res.json({
    results: await notificationStore.forUser(userId, { unreadOnly, limit: 50 }),
    unread: await notificationStore.unreadCount(userId),
    // Distinct from `unread`: how many of those are work still to do,
    // rather than things that merely happened. That is the number the
    // badge shows.
    actionable: await notificationStore.actionableCount(userId),
    push: {
      connected: hasPushProvider(),
      provider: pushProviderName(),
      devices: (await pushSubscriptions.forUser(userId)).length,
      /* Published deliberately. The VAPID public key is the browser's
         half of the pair — it has to reach the page to subscribe at
         all, and it grants nothing on its own. */
      publicKey: vapidPublicKey(),
    },
  });
}

// GET /api/notifications/count — cheap enough to poll.
export async function notificationCount(req, res) {
  const userId = userIdOf(req);
  res.json({
    unread: await notificationStore.unreadCount(userId),
    actionable: await notificationStore.actionableCount(userId),
  });
}

// POST /api/notifications/:id/read
export async function markNotificationRead(req, res) {
  const row = await notificationStore.markRead(userIdOf(req), req.params.id);
  if (!row) return res.status(404).json({ error: "Notification not found" });
  res.json({ ok: true, notification: row, unread: await notificationStore.unreadCount(userIdOf(req)) });
}

// POST /api/notifications/read-all
export async function markAllNotificationsRead(req, res) {
  const count = await notificationStore.markAllRead(userIdOf(req));
  res.json({ ok: true, marked: count, unread: 0, actionable: 0 });
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(300) }).optional(),
  expirationTime: z.union([z.number(), z.null()]).optional(),
});

/**
 * POST /api/notifications/subscribe
 *
 * Registers this browser for push. Called after the browser's own
 * permission prompt is granted — the prompt is the consent, this only
 * records where to send.
 */
export async function subscribeToPush(req, res) {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid subscription" });
  await pushSubscriptions.add(userIdOf(req), parsed.data);
  res.json({ ok: true, connected: hasPushProvider(), devices: (await pushSubscriptions.forUser(userIdOf(req))).length });
}

// POST /api/notifications/unsubscribe
export async function unsubscribeFromPush(req, res) {
  if (req.body?.endpoint) await pushSubscriptions.remove(req.body.endpoint);
  res.json({ ok: true, devices: (await pushSubscriptions.forUser(userIdOf(req))).length });
}
