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
// So: the app's document and its chunks are never stored and never answered from here.
//
// ── The one page that IS stored: offline Cards (28.09.2026) ─────────────────────────────
//
// Andrei: "codurile de bare și QR vreau sa fie disponibile offline, dar sa se faca sync la
// modificari". The codes are shown offline by a separate page, /offline/cards.html: ONE file with its
// script and style inlined, no Firebase, no subresource (src/offline/, vite.offline.config.ts). It
// reads the card copy the app keeps in localStorage (src/utils/offlineWallet.ts).
//
// The invariant, which is why 19.09 cannot come back through it:
//   * the only document stored is that one self-contained file, stored whole in one put, and only
//     when its body carries the exact revision this worker was stamped with (scripts/stamp-offline.mjs);
//   * it lives at a URL the version check never requests, and the worker no longer answers
//     `/index.html` or any `/assets/*` request — those are the browser's, online or not;
//   * it is served for a navigation ONLY when the network REJECTS it (no timeout: a slow connection
//     still gets the real app), and its "Open the full app" button acts only when tapped.
//
// Unstamped (dev server, tests) or stamped 'off' (the kill switch, VITE_OFFLINE_CARDS=0): disabled —
// every navigation is the browser's, as before, and any stored page is deleted.
//
// Rollback: CACHE_NAME stays 'ourdays-cache-v2' so the previous worker is a valid, self-cleaning
// rollback — its activate deletes every cache not named v2, including every ourdays-offline-*.
const CACHE_NAME = 'ourdays-cache-v2';
const URLS_TO_CACHE = [
  // Deliberately NOT '/' or '/index.html' — see above.
  '/manifest.json',
];

const OFFLINE_REV = '__OFFLINE_REV__';
const OFFLINE_ENABLED = /^[0-9a-f]{16}$/.test(OFFLINE_REV);
const OFFLINE_URL = '/offline/cards.html';
const OFFLINE_PREFIX = 'ourdays-offline-';
const OFFLINE_CACHE = OFFLINE_PREFIX + OFFLINE_REV;
const OFFLINE_MARK = 'data-ourdays-offline-cards="' + OFFLINE_REV + '"';

// Whether THIS revision's page is stored: the entry, not merely the cache. `caches.open()` creates a
// cache that does not exist, so a read path must never use it — an empty cache taken for a stored page
// once skipped the retry and let activate delete the only working page (review, 28.09.2026).
async function ownPageStored() {
  try {
    return !!(await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE }));
  } catch {
    return false;
  }
}

// Older revisions go once this one is stored: from then on they are only dead weight (up to 700 KB).
async function pruneOlderPages() {
  for (const name of await caches.keys()) {
    if (name.startsWith(OFFLINE_PREFIX) && name !== OFFLINE_CACHE) await caches.delete(name);
  }
}

// Fetch the page and store it — whole, and only if it is the page this worker was built with.
// Never rejects: a failure leaves the previous page (if any) in place, and is retried after a later
// successful navigation.
async function precacheOffline() {
  if (!OFFLINE_ENABLED) return false;
  let opened = false;
  try {
    const res = await fetch(OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' });
    if (!res.ok || res.redirected) return false;
    if (!(res.headers.get('content-type') || '').includes('text/html')) return false;
    const body = await res.text();
    if (!body.includes(OFFLINE_MARK)) return false;
    const cache = await caches.open(OFFLINE_CACHE);
    opened = true;
    await cache.put(OFFLINE_URL, new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await pruneOlderPages();
    return true;
  } catch {
    // A cache opened for a put that failed (a full phone) must not stay behind looking like a page.
    if (opened && !(await ownPageStored())) await caches.delete(OFFLINE_CACHE).catch(() => {});
    return false;
  }
}

// The stored page: this revision's, else the NEWEST previous one still present (`keys()` is in
// creation order). Looked up with `caches.match(…, { cacheName })`, which creates nothing.
async function offlinePage() {
  try {
    const own = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
    if (own) return own;
    for (const name of (await caches.keys()).reverse()) {
      if (!name.startsWith(OFFLINE_PREFIX) || name === OFFLINE_CACHE) continue;
      const hit = await caches.match(OFFLINE_URL, { cacheName: name });
      if (hit) return hit;
    }
  } catch { /* no cache is not an error */ }
  return null;
}

// When no page is stored at all (it could not be fetched yet): an honest "no connection" page with a
// retry, in the browser's language — not Response.error(), which browsers render as "the site is broken".
const NO_CONNECTION = {
  en: ['No connection', 'Our Days needs the internet to open. Your cards will be available here once you open the app with a connection.', 'Try again'],
  ro: ['Fără conexiune', 'Our Days are nevoie de internet ca să se deschidă. Cardurile vor fi disponibile aici după ce deschizi aplicația cu conexiune.', 'Încearcă din nou'],
  fr: ['Pas de connexion', "Our Days a besoin d'Internet pour s'ouvrir. Vos cartes seront disponibles ici après une ouverture de l'application avec une connexion.", 'Réessayer'],
  es: ['Sin conexión', 'Our Days necesita internet para abrirse. Tus tarjetas estarán disponibles aquí cuando abras la aplicación con conexión.', 'Reintentar'],
  it: ['Nessuna connessione', "Our Days ha bisogno di internet per aprirsi. Le tue carte saranno disponibili qui dopo aver aperto l'app con una connessione.", 'Riprova'],
  de: ['Keine Verbindung', 'Our Days braucht Internet zum Öffnen. Deine Karten sind hier verfügbar, sobald du die App einmal mit Verbindung öffnest.', 'Erneut versuchen'],
};

function noConnectionPage() {
  const lang = String((self.navigator && self.navigator.language) || 'en').slice(0, 2).toLowerCase();
  const [title, body, retry] = NO_CONNECTION[lang] || NO_CONNECTION.en;
  const html = '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title></head>'
    + '<body data-ourdays-no-connection style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;text-align:center;color:#18181b">'
    + '<h1 style="font-size:1.4rem">' + title + '</h1><p style="color:#52525b">' + body + '</p>'
    + '<button onclick="location.reload()" style="margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:.75rem;background:#2563eb;color:#fff;font-size:1rem">' + retry + '</button>'
    + '</body></html>';
  return new Response(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)),
    precacheOffline(),
  ]));
  self.skipWaiting();
});

// The name changed to v2 precisely so this runs on devices that already hold the frozen document.
// Without a purge, every phone that installed the old worker would keep serving it for ever.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Everything that is neither v2 nor an offline page goes — v1's frozen index.html included.
    await Promise.all(names
      .filter((name) => name !== CACHE_NAME && !name.startsWith(OFFLINE_PREFIX))
      .map((name) => caches.delete(name)));
    const offline = names.filter((name) => name.startsWith(OFFLINE_PREFIX));
    if (!OFFLINE_ENABLED) {
      await Promise.all(offline.map((name) => caches.delete(name)));
    } else if (await ownPageStored()) {
      // Older revisions go only once this one is stored: until then they are the offline page.
      await Promise.all(offline.filter((name) => name !== OFFLINE_CACHE).map((name) => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});

let retriedPrecache = false;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Other origins (Firestore, Storage, fonts) and Firebase's reserved paths are never touched.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__/')) return;

  if (req.mode === 'navigate') {
    // Disabled: the browser's, as before — including its honest "no internet" page.
    if (!OFFLINE_ENABLED) return;
    if (url.pathname === OFFLINE_URL) {
      event.respondWith(offlinePage().then((page) => page || fetch(req)).catch(() => noConnectionPage()));
      return;
    }
    const network = fetch(req);
    event.respondWith(network.then(
      // The network answered: that answer, untouched and never stored.
      (res) => res,
      // Only when the network REJECTS the navigation: the offline Cards page, or "no connection".
      async () => (await offlinePage()) || noConnectionPage(),
    ));
    // If the page was not stored at install (offline then), try once more after a navigation that
    // reached the network.
    event.waitUntil(network.then(async () => {
      if (retriedPrecache) return;
      retriedPrecache = true;
      if (!(await ownPageStored())) await precacheOffline();
    }, () => {}));
    return;
  }

  // Same-origin sub-requests are the browser's — `/index.html` for the version check and every
  // `/assets/*` above all — except the manifest, kept as before.
  if (url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req, { cacheName: CACHE_NAME })) || Response.error()),
    );
  }
});
