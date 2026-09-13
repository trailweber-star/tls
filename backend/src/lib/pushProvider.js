import webpush from "web-push";
import { pushSubscriptions, setPushProvider } from "./push.js";

/* ------------------------------------------------------------------ *
 * Web push, connected
 *
 * The same shape as registerMailer and registerPaymentProvider: this
 * file decides at boot whether a provider exists, and nothing else in
 * the codebase knows the difference. Without keys, push stays exactly
 * as it was — logged, reported as "not connected", and the bell says so
 * rather than implying a laptop buzzed.
 *
 * There is no vendor and no account here. Web push is a browser
 * standard: the keys are a pair you generate yourself, and the message
 * goes to whichever push service the browser nominates — Google's for
 * Chrome, Mozilla's for Firefox, Apple's for Safari. Generate a pair
 * with:
 *
 *   npx web-push generate-vapid-keys
 *
 * The public key is published to the browser on purpose; it is how a
 * subscription is tied to this server. The private key never leaves the
 * server and is the only half that matters to keep secret.
 * ------------------------------------------------------------------ */

let publicKey = null;

/** What the browser needs to subscribe. Null when push is not set up. */
export function vapidPublicKey() {
  return publicKey;
}

export function registerPushProvider() {
  const pub = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const priv = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? `mailto:${process.env.SUPPORT_EMAIL ?? "admin@toplocalspecialists.com"}`).trim();

  if (!pub || !priv) {
    console.log("[push] no VAPID keys — notifications stay in the app (see .env.example)");
    return false;
  }

  /* Half a pair is worse than none: the browser would accept the
     subscription and every send would then fail signature checks, which
     looks like "push is on" everywhere in the interface. */
  try {
    webpush.setVapidDetails(subject, pub, priv);
  } catch (err) {
    console.warn(`[push] VAPID keys rejected (${err.message}) — push stays off`);
    return false;
  }

  publicKey = pub;

  setPushProvider({
    name: "web-push",
    async send({ subscription, title, body, url }) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title, body, url, at: Date.now() })
        );
      } catch (err) {
        /* 404 and 410 mean the browser threw the subscription away —
           the person cleared their site data, or reinstalled. Keeping a
           dead endpoint means every future send retries a delivery that
           can never arrive, so it is removed on the spot. Anything else
           is a real failure and is raised to the caller. */
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await pushSubscriptions.remove(subscription.endpoint).catch(() => {});
          return;
        }
        throw err;
      }
    },
  });

  console.log(`[push] web push enabled for ${subject}`);
  return true;
}
