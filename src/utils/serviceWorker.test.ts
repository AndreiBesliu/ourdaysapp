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
// The app has no offline shell. Caching the document that POINTS at one, without the shell, is
// worse than caching nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = readFileSync(join(resolve(__dirname, '..', '..'), 'public', 'sw.js'), 'utf8');

type Handler = (event: Record<string, unknown>) => void;

interface Harness {
  handlers: Record<string, Handler>;
  caches: Map<string, Map<string, unknown>>;
  claimed: { value: boolean };
}

/**
 * Load the worker with fakes in place of the service-worker globals.
 *
 * `new Function` rather than an import: `sw.js` is not a module, it runs against `self`, and the
 * point is to exercise the shipped file byte for byte rather than a copy of it.
 */
function load(fetchImpl: (req: unknown) => Promise<unknown>): Harness {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Map<string, unknown>>();
  const claimed = { value: false };

  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const bucket = store.get(name)!;
      return {
        addAll: async (urls: string[]) => { urls.forEach((u) => bucket.set(u, { cached: u })); },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: { url?: string }) => {
      for (const bucket of store.values()) {
        const hit = bucket.get(typeof req === 'string' ? req : (req?.url ?? ''));
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => { claimed.value = true; } },
  };

  const ResponseFake = { error: () => ({ networkError: true }) };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', SRC)(self, caches, fetchImpl, ResponseFake);
  return { handlers, caches: store, claimed };
}

const never = async () => { throw new Error('the worker asked the network when it should not'); };

/** Drive one `fetch` event and report what the worker answered, if anything. */
async function onFetch(h: Harness, request: Record<string, unknown>) {
  let answered: unknown;
  let respondedAt: 'never' | 'once' = 'never';
  h.handlers.fetch({
    request,
    respondWith: (v: unknown) => { respondedAt = 'once'; answered = v; },
  });
  return { respondedAt, answered: await answered };
}

describe('what the worker puts in the cache at install', () => {
  it('never caches the entry document, under any spelling', async () => {
    const h = load(never);
    let done: Promise<unknown> = Promise.resolve();
    h.handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;

    const cached = [...h.caches.values()].flatMap((b) => [...b.keys()]);
    // This is the whole defect in one assertion. Both spellings, because the old file listed
    // them both and either one alone reproduces the blank page.
    expect(cached).not.toContain('/');
    expect(cached).not.toContain('/index.html');
    expect(cached.length).toBeGreaterThan(0); // ...and it does still cache SOMETHING
  });
});

describe('what it does with a navigation', () => {
  it('declines to answer, so the browser shows its own offline page', async () => {
    const h = load(never);
    const r = await onFetch(h, { mode: 'navigate', url: 'https://x/log' });
    // Not "answers correctly" — answers NOT AT ALL. An app with no offline shell cannot serve a
    // document offline without serving a blank page, so the honest move is to stay out of it.
    expect(r.respondedAt).toBe('never');
  });

  it('declines even when the old worker had a copy of that very document', async () => {
    const h = load(never);
    let done: Promise<unknown> = Promise.resolve();
    h.handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    // Plant the document the old worker used to hold, then prove it is still not served.
    [...h.caches.values()][0].set('https://x/index.html', { frozen: true });
    const r = await onFetch(h, { mode: 'navigate', url: 'https://x/index.html' });
    expect(r.respondedAt).toBe('never');
  });
});

describe('what it does with everything else', () => {
  it('goes to the network first', async () => {
    const h = load(async () => ({ fromNetwork: true }));
    const r = await onFetch(h, { mode: 'cors', url: 'https://x/manifest.json' });
    expect(r.respondedAt).toBe('once');
    expect(r.answered).toEqual({ fromNetwork: true });
  });

  it('falls back to the cache when the network is gone', async () => {
    const h = load(async () => { throw new TypeError('Failed to fetch'); });
    let done: Promise<unknown> = Promise.resolve();
    h.handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    const r = await onFetch(h, { mode: 'cors', url: '/manifest.json' });
    expect(r.answered).toEqual({ cached: '/manifest.json' });
  });

  it('answers with a real network error, not undefined, when there is nothing cached', async () => {
    // `respondWith(undefined)` also fails, but as a console error nobody can act on. This way
    // the request fails the way it would have failed with no worker installed at all.
    const h = load(async () => { throw new TypeError('Failed to fetch'); });
    const r = await onFetch(h, { mode: 'cors', url: '/never-seen.json' });
    expect(r.answered).toEqual({ networkError: true });
  });
});

describe('what it does to the worker it replaces', () => {
  it('deletes every cache that is not its own, then takes over the open tabs', async () => {
    // Without this, a phone that installed the old worker keeps being served the frozen document
    // for ever — the bug would be fixed everywhere except on the devices that have it.
    const h = load(never);
    h.caches.set('ourdays-cache-v1', new Map([['/index.html', { frozen: true }]]));
    h.caches.set('something-else', new Map());

    let done: Promise<unknown> = Promise.resolve();
    h.handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;

    expect([...h.caches.keys()]).not.toContain('ourdays-cache-v1');
    expect([...h.caches.keys()]).not.toContain('something-else');
    expect(h.claimed.value).toBe(true);
  });

  it('carries a cache name that differs from the one it is replacing', async () => {
    // The purge above only runs if the name CHANGED. A fix shipped under the old name activates
    // and finds nothing to delete, because its own cache is the one holding the stale document.
    expect(SRC).toContain('ourdays-cache-v2');
    expect(SRC).not.toContain("'ourdays-cache-v1'");
  });
});
