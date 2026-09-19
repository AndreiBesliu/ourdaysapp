// Service Worker for OurDaysApp PWA
//
// ── What this worker must NOT do ──────────────────────────────────────────────────────
//
// It used to cache `/` and `/index.html` under a fixed name, install once per device, and never
// revalidate. Two things followed, and both were found by an audit on 19.09:
//
//   * offline, `checkForNewVersion` fetched `/index.html`, got the FROZEN copy back from this
//     worker, compared its entry hash with the running one and concluded a new version existed.
//     A pill appeared offering a reload of a build that does not exist;
//   * taking that offer reloaded onto the cached document, whose `/assets/index-<old>.js` is in no
//     cache at all — nothing hashed was ever cached — so the page rendered `<div id="root">` and
//     stopped. A white screen, with whatever was half-typed gone.
//
// The app has no offline shell. Caching the document that POINTS at an offline shell, without the
// shell, is worse than caching nothing: it converts the browser's honest "no internet" page into
// something that reads as "the app is broken".
//
// So: navigations are the browser's, and the entry document is never served from here.
const CACHE_NAME = 'ourdays-cache-v2';
const URLS_TO_CACHE = [
  // Deliberately NOT '/' or '/index.html' — see above.
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

// The name changed to v2 precisely so this runs on devices that already hold the frozen document.
// Without a purge, every phone that installed the old worker would keep serving it for ever.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // A navigation answered from cache is the blank page described above. Declining to respond hands
  // it back to the browser, which shows its own offline page — honest, and clearly not the app.
  if (event.request.mode === 'navigate') return;

  // Everything else: network first, cache only as a fallback, and a real network error when there
  // is nothing cached. `respondWith(undefined)` would also fail, but not in a way anybody reading
  // this could predict.
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(event.request)) || Response.error())
  );
});
