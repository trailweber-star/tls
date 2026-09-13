/* ------------------------------------------------------------------ *
 * Service worker — one job only
 *
 * A push notification can arrive when the site is not open, so the
 * browser needs somewhere to deliver it that is not a page. That is all
 * this file is for. It deliberately does NOT cache anything: an offline
 * cache on a directory whose whole promise is "this data is current"
 * would serve a clinician's old listing after it changed, and that is a
 * worse failure than being offline.
 * ------------------------------------------------------------------ */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Top Local Specialists", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Top Local Specialists";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      /* Same tag per destination, so five applications arriving while
         the laptop is shut collapse into one banner rather than five. */
      tag: payload.url || "tls",
      renotify: true,
      data: { url: payload.url || "/admin" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";

  /* Focus the tab that is already open rather than opening a sixth copy
     of the admin workspace. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
