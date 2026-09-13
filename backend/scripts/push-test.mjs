/* Proves the delivery path without a browser and without a push service.
 *
 * web-push insists on HTTPS, and a real push endpoint belongs to Google
 * or Mozilla, so there is nothing here to point at. What matters is not
 * the HTTP call — that is their library's job — but what this codebase
 * does with the answer: a 410 means the browser threw the subscription
 * away, and the row has to go with it. A dead endpoint left in the table
 * is a delivery retried forever.
 *
 * So the send itself is stubbed at the module boundary (web-push is
 * CommonJS, so the imported object is the real one) and the branch under
 * test is ours.
 *
 *   DATABASE_URL=... node scripts/push-test.mjs
 */
import "dotenv/config";
import webpush from "web-push";

if (!process.env.VAPID_PUBLIC_KEY) {
  const generated = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = generated.publicKey;
  process.env.VAPID_PRIVATE_KEY = generated.privateKey;
  console.log("[test] no keys in .env — generated a throwaway pair for this run");
}

let lastSend = null;
let nextStatus = 201;
webpush.sendNotification = async (subscription, payload) => {
  lastSend = { endpoint: subscription.endpoint, payload };
  if (nextStatus >= 400) {
    const err = new Error(`stubbed ${nextStatus}`);
    err.statusCode = nextStatus;
    throw err;
  }
  return { statusCode: nextStatus };
};

const { registerPushProvider, vapidPublicKey } = await import("../src/lib/pushProvider.js");
const { hasPushProvider, pushSubscriptions, sendPush } = await import("../src/lib/push.js");
const { connectDB, isDbConfigured } = await import("../src/config/db.js");
const { users } = await import("../src/db/repos.js");

if (!isDbConfigured()) {
  console.error("\n  DATABASE_URL is not set — this test needs one.\n");
  process.exit(1);
}
await connectDB();
registerPushProvider();

let failed = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "ok " : "FAIL"}  ${label}`);
  if (!ok) failed += 1;
};

console.log("\nweb push\n");
check("a provider is registered", hasPushProvider());
check("the public key is published for the browser", Boolean(vapidPublicKey()));

/* A real account: push_subscriptions has a foreign key to users, which
   is what stops orphan rows outliving a deleted member. */
const admin = await users.findByEmail(process.env.SEED_ADMIN_EMAIL || "admin@tls.test");
if (!admin) {
  console.error("\n  no account to test with — run npm run seed first\n");
  process.exit(1);
}
const USER = String(admin.id);
const endpoint = "https://fcm.example.test/push/stub-endpoint";
const keys = {
  p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  auth: "8eDyX_uCN0XRhSbY5hs7Hg",
};

await pushSubscriptions.remove(endpoint).catch(() => {});
await pushSubscriptions.add(USER, { endpoint, keys });
check("a subscription is stored", (await pushSubscriptions.forUser(USER)).some((d) => d.endpoint === endpoint));

nextStatus = 201;
await sendPush(USER, { title: "An application is waiting", body: "Dr Whitfield", url: "/admin/verifications" });
check("the title reaches the push service", Boolean(lastSend && JSON.parse(lastSend.payload).title === "An application is waiting"));
check("so does the destination", Boolean(lastSend && JSON.parse(lastSend.payload).url === "/admin/verifications"));
check("the subscription survives a successful send", (await pushSubscriptions.forUser(USER)).some((d) => d.endpoint === endpoint));

nextStatus = 410; // the browser threw this subscription away
await sendPush(USER, { title: "Test", body: "Body", url: "/admin" });
check("a 410 removes the dead subscription", !(await pushSubscriptions.forUser(USER)).some((d) => d.endpoint === endpoint));

/* A 500 is the push service having a bad day, not the subscription
   being wrong — losing it would silently unsubscribe somebody. */
await pushSubscriptions.add(USER, { endpoint, keys });
nextStatus = 500;
await sendPush(USER, { title: "Test", body: "Body", url: "/admin" });
check("a 500 keeps it", (await pushSubscriptions.forUser(USER)).some((d) => d.endpoint === endpoint));

await pushSubscriptions.remove(endpoint).catch(() => {});
console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
