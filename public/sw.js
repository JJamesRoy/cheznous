/* Chez Nous service worker — hand-written, see docs/DECISIONS.md (D9).
 * - App shell: navigations are network-first, falling back to the last cached copy of
 *   that page, then to /offline.html.
 * - Static build assets (/_next/static, icons): cache-first (they are content-hashed).
 * - Never caches /api/* or Supabase responses: data is user-specific. Offline reading
 *   uses the TanStack Query cache persisted on the device instead.
 * - Web Push: shows notifications sent by /api/push (Android, desktop, installed iOS PWAs).
 */
const VERSION = "cn-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const PRECACHE = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/oauth/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const res = await fetch(req);
          // Only cache real app pages (not redirects to the login page).
          if (res.ok && !res.redirected) cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await cache.match(url.pathname)) || (await cache.match("/")) || (await cache.match("/offline.html"));
        }
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Chez Nous", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Chez Nous", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/" },
      lang: "fr-CA",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
