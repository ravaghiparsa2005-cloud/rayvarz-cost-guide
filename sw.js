/* Rayvarz cost-accounting guide — service worker
   Offline-first for a static, published build (e.g. GitHub Pages).
   Bump CACHE_VERSION on every content release to invalidate old caches. */
const CACHE_VERSION = 'v1';
const CACHE = 'rayvarz-cost-guide-' + CACHE_VERSION;

/* Core shell. Paths are relative to the SW scope so the same file works
   whether the app is served as index.html or under a sub-path. Precaching is
   best-effort: a missing entry (e.g. assets already inlined into a single-file
   build) must not fail the whole install. */
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (e) { /* ignore */ }
    }));
    // also cache the exact page that registered us
    try { await cache.add(new Request(self.registration.scope, { cache: 'reload' })); } catch (e) {}
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

// let the page trigger an immediate update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isFontRequest(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations: network-first (fresh content when online), cache fallback offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) { (await caches.open(CACHE)).put(req, preload.clone()); return preload; }
        const net = await fetch(req);
        (await caches.open(CACHE)).put(req, net.clone());
        return net;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) ||
               (await cache.match('index.html')) ||
               (await cache.match('./')) ||
               (await cache.match(self.registration.scope)) ||
               Response.error();
      }
    })());
    return;
  }

  // Static assets (same-origin) + Google Fonts: stale-while-revalidate.
  if (sameOrigin || isFontRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});
