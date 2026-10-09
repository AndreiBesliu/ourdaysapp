// scripts/offlineStamp.test.mjs — the revision that ties the offline page to the service worker.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PLACEHOLDER, SW_LINE_PLACEHOLDER, MAX_PAGE_BYTES, revOf, pageProblems, swProblems, stampPage, stampSw,
  pageRev, swRev, distProblems,
} from './offlineStamp.mjs';

const PAGE = `<!doctype html><div id="root" data-ourdays-offline-cards="${PLACEHOLDER}"></div><script type="module">const a = "href=x"; el.src = y;</script><style>a{}</style>`;
const PUBLIC_SW = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('revOf', () => {
  it('16 hex characters of the unstamped page, stable', () => {
    expect(revOf(PAGE)).toMatch(/^[0-9a-f]{16}$/);
    expect(revOf(PAGE)).toBe(revOf(PAGE));
    expect(revOf(PAGE + ' ')).not.toBe(revOf(PAGE));
  });
});

describe('pageProblems', () => {
  it('a clean page: none (code may say href= and src= inside the inline script)', () => {
    expect(pageProblems(PAGE)).toEqual([]);
  });
  it('refuses a placeholder count other than one', () => {
    expect(pageProblems(PAGE.replace(PLACEHOLDER, 'x'))).toHaveLength(1);
    expect(pageProblems(PAGE + PLACEHOLDER)).toHaveLength(1);
  });
  it('refuses anything loaded from elsewhere in the markup', () => {
    expect(pageProblems(PAGE + '<script src="/offline/assets/a.js"></script>')).toHaveLength(1);
    expect(pageProblems(PAGE + '<link rel="stylesheet" href="/a.css">')).toHaveLength(1);
  });
  it('refuses Firebase, and a page over the size limit', () => {
    expect(pageProblems(PAGE + '<!-- firestore.googleapis.com -->').length).toBeGreaterThan(0);
    expect(pageProblems(PAGE + 'x'.repeat(MAX_PAGE_BYTES)).length).toBeGreaterThan(0);
  });
});

describe('stamping', () => {
  const rev = revOf(PAGE);
  it('the same rev in the page and in the worker', () => {
    expect(pageRev(stampPage(PAGE, rev))).toBe(rev);
    expect(swRev(stampSw(PUBLIC_SW, rev))).toBe(rev);
  });
  it("'off' only in the worker; nothing but a rev or 'off' anywhere", () => {
    expect(swRev(stampSw(PUBLIC_SW, 'off'))).toBe('off');
    expect(() => stampPage(PAGE, 'off')).toThrow();
    expect(() => stampSw(PUBLIC_SW, 'nope')).toThrow();
  });
  it('the shipped worker carries the placeholder line exactly once; a stamped one cannot be stamped again', () => {
    expect(swProblems(PUBLIC_SW)).toEqual([]);
    expect(PUBLIC_SW.split(SW_LINE_PLACEHOLDER)).toHaveLength(2);
    expect(swProblems(stampSw(PUBLIC_SW, rev))).toHaveLength(1);
  });
});

describe('distProblems (check-offline)', () => {
  const rev = revOf(PAGE);
  const good = { html: stampPage(PAGE, rev), sw: stampSw(PUBLIC_SW, rev), publicSw: PUBLIC_SW, killSwitch: false };

  it('a matching pair: none', () => {
    expect(distProblems(good)).toEqual([]);
  });
  it('an unstamped worker, a missing page, mismatched revisions, an edited page', () => {
    expect(distProblems({ ...good, sw: PUBLIC_SW }).length).toBeGreaterThan(0);
    expect(distProblems({ ...good, html: null }).length).toBeGreaterThan(0);
    expect(distProblems({ ...good, sw: stampSw(PUBLIC_SW, 'aaaaaaaaaaaaaaaa') }).length).toBeGreaterThan(0);
    expect(distProblems({ ...good, html: good.html.replace('a{}', 'b{}') }).length).toBeGreaterThan(0);
  });
  it('a worker in dist that is not the source beyond the stamped line (a sync client replaying an old file)', () => {
    expect(distProblems({ ...good, sw: good.sw + '\n// replayed' })).toContain('dist/sw.js differs from public/sw.js beyond the stamped line');
  });
  it("'off' only with the kill switch set — and the kill switch only with 'off'", () => {
    const off = { ...good, sw: stampSw(PUBLIC_SW, 'off') };
    expect(distProblems(off).length).toBeGreaterThan(0);
    expect(distProblems({ ...off, killSwitch: true })).toEqual([]);
    expect(distProblems({ ...good, killSwitch: true }).length).toBeGreaterThan(0);
  });
  it('line endings do not count (public/sw.js re-checked-out as CRLF, or the worker built from a CRLF one)', () => {
    // Both variants from an LF base. On a Windows checkout PUBLIC_SW is CRLF already, and turning every
    // `\n` into `\r\n` again made `\r\r\n`, which no checkout writes: the test failed, not the check (09.10.2026).
    const lfSw = PUBLIC_SW.replace(/\r\n/g, '\n');
    const crlfSw = lfSw.replace(/\n/g, '\r\n');
    expect(lfSw).not.toContain('\r');
    expect(crlfSw).toContain('\r\n');
    expect(distProblems({ ...good, sw: stampSw(lfSw, rev), publicSw: crlfSw })).toEqual([]);
    expect(distProblems({ ...good, sw: stampSw(crlfSw, rev), publicSw: lfSw })).toEqual([]);
  });
});
