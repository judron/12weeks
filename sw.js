/* Service worker for "תוכנית 12 השבועות" PWA.
   Strategy:
   - Navigations  -> network-first, fall back to the cached app shell (works offline).
   - Firebase SDK -> cache-first (the gstatic URLs are versioned/immutable).
   - Same-origin   -> stale-while-revalidate (fast, refreshes in the background).
   Bump CACHE when shipping breaking changes to force a clean refresh. */
const CACHE = "el12w-pwa-v3";
const CORE = [
  "app.html",
  "dashboard.html",
  "privacy.html",
  "firebase-config.js",
  "manifest.webmanifest",
  "manifest-dashboard.webmanifest",
  "logo-white.png",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "dash-icon-192.png",
  "dash-icon-512.png",
  "dash-apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // App navigations: network-first so updates land when online, cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const c = await caches.open(CACHE);
        // serve the cached shell for the requested page (app.html or dashboard.html),
        // ignoring query strings like ?c=; fall back to the client app shell.
        const hit = await c.match(req, { ignoreSearch: true });
        return hit || (await c.match("app.html", { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  // Firebase SDK from gstatic: cache-first (immutable versioned files).
  if (url.hostname === "www.gstatic.com") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        c.put(req, net.clone());
        return net;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then((r) => {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});
