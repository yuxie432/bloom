/* One-time RESET worker.
 * Purpose: escape a stuck cache-first service worker that was serving stale code.
 * When any browser with an old worker checks for an update, it fetches THIS file,
 * which unregisters itself, deletes all caches, and reloads open windows with a
 * cache-busting query so the freshest HTML/JS/CSS load from the network.
 * The app no longer registers a service worker, so this runs once and stays gone. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => {
        try {
          const u = new URL(c.url);
          u.searchParams.set('fresh', Date.now().toString());
          c.navigate(u.href);
        } catch (_) {}
      });
    } catch (_) {}
  })());
});

// While this worker is briefly alive, never serve from cache — always go to network.
self.addEventListener('fetch', () => {});
