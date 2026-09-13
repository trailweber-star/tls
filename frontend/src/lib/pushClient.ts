import { notificationsApi } from "./dashboardApi";

/* ------------------------------------------------------------------ *
 * Turning on desktop notifications
 *
 * Three things have to line up, and any of them can be absent: the
 * browser has to support push at all, the person has to allow it, and
 * the server has to have VAPID keys. Each is checked separately so the
 * interface can say which one is missing instead of a dead button.
 *
 * The permission prompt is only ever raised from a click. A site that
 * asks on load is the reason browsers now bury the prompt, and Chrome
 * blocks it outright for anyone who has dismissed one before.
 * ------------------------------------------------------------------ */

export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * The server's base64url VAPID key, as the bytes the browser wants.
 *
 * Returns the ArrayBuffer rather than a typed array: applicationServerKey
 * takes a BufferSource, and a Uint8Array's element type is generic in
 * current TypeScript, which does not satisfy it.
 */
function toKeyBytes(base64Url: string): ArrayBuffer {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  return existing ?? (await navigator.serviceWorker.register("/sw.js"));
}

/** What to show, without asking for anything. */
export async function currentState(serverHasKeys: boolean): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!serverHasKeys) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

/**
 * Ask, subscribe, and tell the server where to send.
 *
 * Returns the resulting state rather than throwing for a refusal: being
 * told no is an answer, not an error, and the caller needs to render it
 * either way.
 */
export async function enablePush(publicKey: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await registration();
  /* userVisibleOnly is required by every browser that implements this:
     a push that shows nothing is a tracking beacon, and they refuse to
     deliver one. */
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKeyBytes(publicKey),
    }));

  await notificationsApi.subscribePush(sub.toJSON());
  return "on";
}

/** Off on this device. Other devices keep theirs. */
export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      // The server is told first: a subscription unsubscribed in the
      // browser but still in our table is one we would send to forever.
      await notificationsApi.unsubscribePush(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* Nothing to undo. */
  }
  return "off";
}
