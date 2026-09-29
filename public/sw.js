importScripts("./firebase-config.js");

const CACHE = "khana-v1";

if (self.VAPID_KEY) {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
  );
  firebase.initializeApp(self.FIREBASE_CONFIG);
  firebase.messaging().onBackgroundMessage(({ data = {} }) =>
    self.registration.showNotification(data.title || "Khana khatam!", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500, 200, 800],
      icon: "icon-192.png",
      badge: "icon-192.png",
      // Owner alerts send their own url (setup page); kitchen alarms open the kitchen screen.
      data: { url: data.url || `kitchen.html?pg=${data.pg || ""}` },
    })
  );
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "kitchen.html", self.registration.scope);
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname === url.pathname);
      return open ? open.focus() : self.clients.openWindow(url.href);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
