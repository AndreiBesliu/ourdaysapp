// src/utils/appVersion.test.ts
//
// The whole value of the update notice is that it is never wrong. A bar that cries "new version"
// at a tab which is already current teaches people to ignore it, and then it is worse than absent.
// So the tests here are mostly about the AMBIGUOUS cases resolving to `unknown`, not about the
// happy path.

import { describe, it, expect } from 'vitest';
import { entryFromHtml, runningEntry, checkForNewVersion } from './appVersion';

const BUILT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script>
      const version = 'v1.0.2';
    </script>
    <title>Our Days</title>
    <script type="module" crossorigin src="/assets/index-D1OdOYH2.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/serverActions-6MC6Xwwb.js">
    <link rel="stylesheet" crossorigin href="/assets/index-DmCxyFYw.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('reading the entry bundle out of the served HTML', () => {
  it('finds it in the real built document', () => {
    expect(entryFromHtml(BUILT_HTML)).toBe('index-D1OdOYH2.js');
  });

  it('is not fooled by the modulepreload or the stylesheet that sit right next to it', () => {
    // Both are under /assets/ and both are hashed; only the <script src> is the entry.
    expect(entryFromHtml(BUILT_HTML)).not.toContain('serverActions');
    expect(entryFromHtml(BUILT_HTML)).not.toContain('.css');
  });

  it('returns null rather than guessing when there is no entry script', () => {
    expect(entryFromHtml('<html><body>nothing here</body></html>')).toBeNull();
    // The dev server's entry is unhashed; treating it as an answer would compare a constant.
    expect(entryFromHtml('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(entryFromHtml('')).toBeNull();
  });
});

describe('reading the entry bundle the tab is actually running', () => {
  it('picks the app entry out of a document that also has Google scripts in it', () => {
    // This is the real shape on live: App Check loads reCAPTCHA and the GSI api.js.
    const scripts = [
      { src: 'https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js' },
      { src: 'https://our-days-2a939.web.app/assets/index-D1OdOYH2.js' },
      { src: 'https://apis.google.com/js/api.js' },
    ];
    expect(runningEntry(scripts)).toBe('index-D1OdOYH2.js');
  });

  it('would have been wrong if it matched any hashed script — the Google ones change on their schedule', () => {
    const onlyGoogle = [{ src: 'https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js' }];
    expect(runningEntry(onlyGoogle)).toBeNull();
  });

  it('returns null in dev, where the entry is not hashed', () => {
    expect(runningEntry([{ src: 'http://localhost:5174/src/main.tsx' }])).toBeNull();
    expect(runningEntry([])).toBeNull();
    expect(runningEntry([{ src: '' }])).toBeNull();
  });
});

const RUNNING = [{ src: '/assets/index-D1OdOYH2.js' }];
const ok = (body: string) => async () => ({ ok: true, text: async () => body }) as unknown as Response;

describe('the comparison, and everything it refuses to claim', () => {
  it('says `new` only when the served entry really differs', async () => {
    const served = BUILT_HTML.replace('index-D1OdOYH2.js', 'index-ZZZZZZZZ.js');
    expect(await checkForNewVersion(ok(served) as unknown as typeof fetch, RUNNING)).toBe('new');
  });

  it('says `same` when they match', async () => {
    expect(await checkForNewVersion(ok(BUILT_HTML) as unknown as typeof fetch, RUNNING)).toBe('same');
  });

  it('says `unknown` when offline — never `new`', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await checkForNewVersion(offline, RUNNING)).toBe('unknown');
  });

  it('says `unknown` on a non-200, even though the body might parse', async () => {
    // A 503 page from an edge cache could still contain an old <script src>. Trusting it would
    // announce a downgrade as an upgrade.
    const down = (async () => ({ ok: false, text: async () => BUILT_HTML })) as unknown as typeof fetch;
    expect(await checkForNewVersion(down, RUNNING)).toBe('unknown');
  });

  it('says `unknown` when the served markup has no entry script', async () => {
    expect(await checkForNewVersion(ok('<html></html>') as unknown as typeof fetch, RUNNING)).toBe('unknown');
  });

  it('says `unknown` in dev instead of comparing against nothing', async () => {
    const dev = [{ src: 'http://localhost:5174/src/main.tsx' }];
    expect(await checkForNewVersion(ok(BUILT_HTML) as unknown as typeof fetch, dev)).toBe('unknown');
  });

  it('asks the network for a fresh copy rather than trusting a cached one', async () => {
    // The browser may still hold the pre-fix `max-age=3600` entry document. Without no-store this
    // check would compare that stale copy against itself and never fire.
    let seen: RequestInit | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return { ok: true, text: async () => BUILT_HTML };
    }) as unknown as typeof fetch;
    await checkForNewVersion(spy, RUNNING);
    expect(seen?.cache).toBe('no-store');
  });
});
