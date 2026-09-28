// src/utils/serviceWorker.test.ts
//
// `public/sw.js` is the one file in this app that keeps running after it is replaced. A worker
// installed on somebody's phone serves that phone until a new one activates, so a mistake here
// outlives the deploy that made it — which is the opposite of every other file, and the reason
// this is tested by RUNNING the handlers rather than by reading the source for the right words.
//
// What it used to do, until 19.09: cache `/` and `/index.html` under a fixed name and answer
// navigations from that cache for ever. Two consequences, both found by audit rather than by a
// report, because both look like "the app is broken" from the outside:
//
//   * offline, `checkForNewVersion` fetched `/index.html`, got the FROZEN copy, compared its
//     entry hash against the running one and concluded there was a new version. A pill appeared
//     offering a reload of a build that does not exist;
//   * taking that offer reloaded onto the cached document, whose `/assets/index-<old>.js` was in
//     no cache at all — nothing hashed was ever cached — so the page rendered an empty root and
//     stopped. A white screen, with whatever was half-typed gone.
//
// Since 28.09.2026 it stores ONE document: the offline Cards page, a self-contained file at a URL the
// version check never asks for, served only when a navigation's network fetch REJECTS. Everything
// below runs the shipped bytes, stamped the way scripts/stamp-offline.mjs stamps them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stampSw } from '../../scripts/offlineStamp.mjs';

const ROOT = resolve(__dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
// Today's worker before the offline page (acc7be7), kept byte for byte: the rollback target.
const V2 = readFileSync(join(__dirname, 'serviceWorker.rollback.fixture.js'), 'utf8');
const ORIGIN = 'https://app.test';
const REV = '0123456789abcdef';
const PAGE_URL = '/offline/cards.html';
const pageBody = (rev = REV) => `<!doctype html><div id="root" data-ourdays-offline-cards="${rev}"></div><script type="module">1</script>`;
const htmlResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

type Handler = (event: Record<string, unknown>) => void;
type FetchImpl = (req: unknown, init?: Record<string, unknown>) => Promise<Response>;

interface Harness {
  handlers: Record<string, Handler>;
  caches: Map<string, Map<string, Response>>;
  claimed: { value: boolean };
  fetchCalls: Array<{ url: string; init?: Record<string, unknown> }>;
}

const keyOf = (k: unknown): string => {
  const raw = typeof k === 'string' ? k : ((k as { url?: string })?.url ?? '');
  return raw.startsWith(ORIGIN) ? raw.slice(ORIGIN.length) : raw;
};

/**
 * Load a worker source with fakes in place of the service-worker globals, sharing `store` so two
 * workers (the new one, then the rollback) can run against the same caches. `Response` is Node's
 * real one.
 */
function load(src: string, fetchImpl: FetchImpl, store = new Map<string, Map<string, Response>>()): Harness {
  const handlers: Record<string, Handler> = {};
  const claimed = { value: false };
  const fetchCalls: Harness['fetchCalls'] = [];
  const bucketOf = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  const cacheApi = (name: string) => ({
    addAll: async (urls: string[]) => { urls.forEach((u) => bucketOf(name).set(u, new Response(`cached:${u}`))); },
    put: async (key: unknown, res: Response) => { bucketOf(name).set(keyOf(key), res); },
    match: async (key: unknown) => store.get(name)?.get(keyOf(key))?.clone(),
  });
  // As in the browser: `open` CREATES a missing cache; `match` with a cacheName creates nothing.
  const caches = {
    open: async (name: string) => { bucketOf(name); return cacheApi(name); },
    has: async (name: string) => store.has(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (key: unknown, opts?: { cacheName?: string }) => {
      if (opts?.cacheName) return store.get(opts.cacheName)?.get(keyOf(key))?.clone();
      for (const b of store.values()) { const hit = b.get(keyOf(key)); if (hit) return hit.clone(); }
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    navigator: { language: 'ro-RO' },
    addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => { claimed.value = true; } },
  };
  const trackedFetch: FetchImpl = (req, init) => {
    fetchCalls.push({ url: keyOf(req), init });
    return fetchImpl(req, init);
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', src)(self, caches, trackedFetch, Response, URL);
  return { handlers, caches: store, claimed, fetchCalls };
}

const stamped = (rev: string = REV) => stampSw(SRC, rev);
const never: FetchImpl = async () => { throw new Error('the worker asked the network when it should not'); };
const offlineNet: FetchImpl = async () => { throw new TypeError('Failed to fetch'); };
/** A network that serves the offline page (for install) and records everything else. */
const serving = (page: () => Response): FetchImpl => async (req) => (keyOf(req) === PAGE_URL ? page() : htmlResponse('<html>app</html>'));

async function lifecycle(h: Harness, name: 'install' | 'activate') {
  const pending: Promise<unknown>[] = [];
  h.handlers[name]({ waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
  await Promise.all(pending);
}

/** Drive one `fetch` event: what the worker answered, if anything, once its extra work settled. */
async function onFetch(h: Harness, request: Record<string, unknown>) {
  let answered: unknown;
  let respondedAt: 'never' | 'once' = 'never';
  const extra: Promise<unknown>[] = [];
  h.handlers.fetch({
    request: { method: 'GET', ...request },
    respondWith: (v: unknown) => { respondedAt = 'once'; answered = v; },
    waitUntil: (p: Promise<unknown>) => { extra.push(p); },
  });
  const value = await answered;
  await Promise.all(extra);
  return { respondedAt, answered: value as Response | undefined };
}

const nav = (path: string) => ({ mode: 'navigate', url: ORIGIN + path });
const offlineCacheName = (rev = REV) => `ourdays-offline-${rev}`;

describe('install', () => {
  it('never caches the entry document, under any spelling — stamped or not', async () => {
    for (const src of [SRC, stamped()]) {
      const h = load(src, serving(() => htmlResponse(pageBody())));
      await lifecycle(h, 'install');
      const cached = [...h.caches.values()].flatMap((b) => [...b.keys()]);
      expect(cached).not.toContain('/');
      expect(cached).not.toContain('/index.html');
      expect(cached).toContain('/manifest.json');
    }
  });

  it('unstamped (dev server, tests) stores no offline page at all', async () => {
    const h = load(SRC, serving(() => htmlResponse(pageBody())));
    await lifecycle(h, 'install');
    expect([...h.caches.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([]);
    expect(h.fetchCalls.map((c) => c.url)).not.toContain(PAGE_URL);
  });

  it('stamped, fetches the page past the HTTP cache and stores it under its own revision', async () => {
    const h = load(stamped(), serving(() => htmlResponse(pageBody())));
    await lifecycle(h, 'install');
    const call = h.fetchCalls.find((c) => c.url === PAGE_URL);
    expect(call?.init).toMatchObject({ cache: 'reload' });
    const stored = h.caches.get(offlineCacheName())?.get(PAGE_URL);
    expect(await stored?.clone().text()).toContain(`data-ourdays-offline-cards="${REV}"`);
  });

  it('refuses to store anything that is not exactly its page — and install still succeeds', async () => {
    const wrong: Array<[string, () => Response]> = [
      ['the app document', () => htmlResponse('<!doctype html><div id="root"></div><script src="/assets/index-x.js"></script>')],
      ['a page of another revision', () => htmlResponse(pageBody('fedcba9876543210'))],
      ['a 404', () => htmlResponse(pageBody(), { status: 404 })],
      ['not HTML', () => new Response(pageBody(), { headers: { 'content-type': 'text/plain' } })],
      ['a redirect', () => { const r = htmlResponse(pageBody()); Object.defineProperty(r, 'redirected', { value: true }); return r; }],
    ];
    for (const [label, page] of wrong) {
      const h = load(stamped(), serving(page));
      await expect(lifecycle(h, 'install'), label).resolves.toBeUndefined();
      expect(h.caches.get(offlineCacheName())?.get(PAGE_URL), label).toBeUndefined();
    }
  });
});

describe('navigations', () => {
  it('unstamped or stamped off: declined, even with a page planted in the cache', async () => {
    for (const src of [SRC, stamped('off')]) {
      const h = load(src, never);
      h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
      const r = await onFetch(h, nav('/wallet'));
      expect(r.respondedAt).toBe('never');
    }
  });

  it('online: the network answer itself, untouched and never stored', async () => {
    const answer = htmlResponse('<html>the real app</html>');
    const h = load(stamped(), async (req) => (keyOf(req) === PAGE_URL ? htmlResponse(pageBody()) : answer));
    h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    const r = await onFetch(h, nav('/wallet'));
    expect(r.answered).toBe(answer);
    const keys = [...h.caches.values()].flatMap((b) => [...b.keys()]);
    expect(keys).not.toContain('/wallet');
  });

  it('when the network REJECTS: the stored Cards page, whatever the URL', async () => {
    for (const path of ['/wallet', '/', '/chat', '/join/abc', '/index.html']) {
      const h = load(stamped(), offlineNet);
      h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
      const r = await onFetch(h, nav(path));
      expect(await r.answered!.text(), path).toContain('data-ourdays-offline-cards');
    }
  });

  it('a previous revision still serves until this one is stored', async () => {
    const h = load(stamped(), offlineNet);
    h.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    const r = await onFetch(h, nav('/wallet'));
    expect(await r.answered!.text()).toContain('aaaaaaaaaaaaaaaa');
  });

  it('rejects with nothing stored: an honest "no connection" page with a retry, in the browser language — not a broken-site error', async () => {
    const h = load(stamped(), offlineNet);
    const r = await onFetch(h, nav('/wallet'));
    expect(r.answered!.status).toBe(503);
    const html = await r.answered!.text();
    expect(html).toContain('data-ourdays-no-connection');
    expect(html).toContain('Fără conexiune');
    expect(html).toContain('location.reload()');
    // …and looking for a page created nothing.
    expect([...h.caches.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([]);
  });

  it('the page opened directly with nothing stored and no network: the same honest page', async () => {
    const h = load(stamped(), offlineNet);
    const r = await onFetch(h, nav(PAGE_URL));
    expect(await r.answered!.text()).toContain('data-ourdays-no-connection');
  });

  it('the page itself is served from the cache without asking the network', async () => {
    // Not merely "falls back to the cache": with signal but no data a fetch neither answers nor
    // rejects for a long time, and the "Cards" shortcut exists for exactly that till (mutation W14,
    // network-first, passed while this only checked the answer).
    const h = load(stamped(), never);
    h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    const r = await onFetch(h, nav(PAGE_URL));
    expect(await r.answered!.text()).toContain('data-ourdays-offline-cards');
    expect(h.fetchCalls).toEqual([]);
  });

  it("Firebase's own paths, other origins and non-GET navigations are never touched", async () => {
    const h = load(stamped(), never);
    h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    expect((await onFetch(h, nav('/__/auth/handler'))).respondedAt).toBe('never');
    expect((await onFetch(h, { mode: 'navigate', url: 'https://elsewhere.test/x' })).respondedAt).toBe('never');
    expect((await onFetch(h, { ...nav('/wallet'), method: 'POST' })).respondedAt).toBe('never');
  });

  it('a page not stored at install is stored after the next navigation that reaches the network', async () => {
    const h = load(stamped(), serving(() => htmlResponse(pageBody())));
    await onFetch(h, nav('/'));
    expect(h.caches.get(offlineCacheName())?.get(PAGE_URL)).toBeDefined();
  });

  it('review 28.09: install without the page, an OFFLINE navigation, then online — the retry still stores it', async () => {
    const store = new Map<string, Map<string, Response>>();
    // Install: the manifest arrives, the page fetch fails.
    let pageUp = false;
    const net: FetchImpl = async (req) => {
      if (keyOf(req) === PAGE_URL && !pageUp) throw new TypeError('blip');
      return keyOf(req) === PAGE_URL ? htmlResponse(pageBody()) : new Response('ok');
    };
    const installing = load(stamped(), net, store);
    await lifecycle(installing, 'install');
    expect(store.get(offlineCacheName())?.get(PAGE_URL)).toBeUndefined();
    // Offline navigation (and a tap on the direct link): must not leave an empty cache behind.
    const offline = load(stamped(), offlineNet, store);
    await onFetch(offline, nav('/wallet'));
    await onFetch(offline, nav(PAGE_URL));
    // Back online, a fresh worker instance (restarted): the retry must run and store the page.
    pageUp = true;
    const online = load(stamped(), net, store);
    await onFetch(online, nav('/'));
    expect(await store.get(offlineCacheName())?.get(PAGE_URL)?.clone().text()).toContain(REV);
  });

  it('several older revisions and none of this one: the NEWEST is served', async () => {
    const h = load(stamped(), offlineNet);
    h.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    h.caches.set(offlineCacheName('bbbbbbbbbbbbbbbb'), new Map([[PAGE_URL, htmlResponse(pageBody('bbbbbbbbbbbbbbbb'))]]));
    const r = await onFetch(h, nav('/wallet'));
    expect(await r.answered!.text()).toContain('bbbbbbbbbbbbbbbb');
  });

  it('once this revision is stored — at install or by the retry — older ones are pruned', async () => {
    const h = load(stamped(), serving(() => htmlResponse(pageBody())));
    h.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    await onFetch(h, nav('/'));
    expect([...h.caches.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([offlineCacheName()]);
  });

  it('a put that fails (a full phone) leaves no empty cache that could pass for a stored page', async () => {
    const h = load(stamped(), serving(() => htmlResponse(pageBody())));
    // Make the next put on this revision's cache fail.
    const realSet = Map.prototype.set;
    const bucket = new Map<string, Response>();
    bucket.set = function (this: Map<string, Response>, k: string, v: Response) {
      if (k === PAGE_URL) throw new DOMException('full', 'QuotaExceededError');
      return realSet.call(this, k, v) as Map<string, Response>;
    };
    h.caches.set(offlineCacheName(), bucket);
    await lifecycle(h, 'install');
    expect(h.caches.has(offlineCacheName())).toBe(false);
  });
});

describe('19.09 cannot come back: sub-requests are the browser\'s', () => {
  it('the version check\'s /index.html, /, and every /assets/* are never answered — not even offline with a frozen copy planted', async () => {
    const h = load(stamped(), offlineNet);
    h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    h.caches.set('ourdays-cache-v1', new Map([['/index.html', htmlResponse('<html>frozen</html>')]]));
    for (const path of ['/index.html', '/', '/assets/index-abc.js', '/assets/style.css', PAGE_URL]) {
      const r = await onFetch(h, { mode: 'cors', url: ORIGIN + path, cache: 'no-store' });
      expect(r.respondedAt, path).toBe('never');
    }
  });

  it('other origins are never answered', async () => {
    const h = load(stamped(), offlineNet);
    const r = await onFetch(h, { mode: 'cors', url: 'https://firestore.googleapis.com/x' });
    expect(r.respondedAt).toBe('never');
  });

  it('the manifest: network first, then the v2 copy, then a real network error', async () => {
    const online = load(stamped(), async () => new Response('fresh manifest'));
    expect(await (await onFetch(online, { mode: 'cors', url: ORIGIN + '/manifest.json' })).answered!.text()).toBe('fresh manifest');

    const offline = load(stamped(), offlineNet);
    await lifecycle(offline, 'install');
    expect(await (await onFetch(offline, { mode: 'cors', url: ORIGIN + '/manifest.json' })).answered!.text()).toBe('cached:/manifest.json');

    const bare = load(stamped(), offlineNet);
    expect((await onFetch(bare, { mode: 'cors', url: ORIGIN + '/manifest.json' })).answered!.type).toBe('error');
  });
});

describe('activate', () => {
  it('deletes v1 and anything foreign, keeps v2, and takes over the open tabs', async () => {
    const h = load(stamped(), never);
    h.caches.set('ourdays-cache-v1', new Map([['/index.html', htmlResponse('frozen')]]));
    h.caches.set('something-else', new Map());
    h.caches.set('ourdays-cache-v2', new Map());
    await lifecycle(h, 'activate');
    expect([...h.caches.keys()]).toEqual(['ourdays-cache-v2']);
    expect(h.claimed.value).toBe(true);
  });

  it('review 28.09: an EMPTY cache of this revision is not a stored page — the older page stays', async () => {
    const h = load(stamped(), never);
    h.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    h.caches.set(offlineCacheName(), new Map());
    await lifecycle(h, 'activate');
    expect([...h.caches.keys()]).toContain(offlineCacheName('aaaaaaaaaaaaaaaa'));
  });

  it('an older offline page goes only once this revision is stored', async () => {
    const without = load(stamped(), never);
    without.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    await lifecycle(without, 'activate');
    expect([...without.caches.keys()]).toContain(offlineCacheName('aaaaaaaaaaaaaaaa'));

    const withOwn = load(stamped(), never);
    withOwn.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map([[PAGE_URL, htmlResponse(pageBody('aaaaaaaaaaaaaaaa'))]]));
    withOwn.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    await lifecycle(withOwn, 'activate');
    expect([...withOwn.caches.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([offlineCacheName()]);
  });

  it('the kill switch (stamped off) deletes every offline page', async () => {
    const h = load(stamped('off'), never);
    h.caches.set(offlineCacheName(), new Map([[PAGE_URL, htmlResponse(pageBody())]]));
    h.caches.set(offlineCacheName('aaaaaaaaaaaaaaaa'), new Map());
    await lifecycle(h, 'activate');
    expect([...h.caches.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([]);
  });

  it('carries a cache name that differs from the one it replaced, and the same one as the rollback', () => {
    expect(SRC).toContain("const CACHE_NAME = 'ourdays-cache-v2';");
    expect(SRC).not.toContain("'ourdays-cache-v1'");
    expect(V2).toContain("const CACHE_NAME = 'ourdays-cache-v2';");
  });
});

describe('rollback to the worker before the offline page', () => {
  it("today's v2 worker, activated after the new one, removes every offline page and declines navigations again", async () => {
    const store = new Map<string, Map<string, Response>>();
    const now = load(stamped(), serving(() => htmlResponse(pageBody())), store);
    await lifecycle(now, 'install');
    await lifecycle(now, 'activate');
    expect([...store.keys()]).toContain(offlineCacheName());

    const back = load(V2, never, store);
    await lifecycle(back, 'activate');
    expect([...store.keys()].filter((n) => n.startsWith('ourdays-offline-'))).toEqual([]);
    expect((await onFetch(back, nav('/wallet'))).respondedAt).toBe('never');
  });
});
