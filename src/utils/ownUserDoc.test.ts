// src/utils/ownUserDoc.test.ts
//
// The birthday banner and the person's own entry on the calendar screen (utils/ownUserDoc.ts), and
// the wiring in CalendarHome that uses them. Andrei, 27.09.2026: the banner kept asking although his
// document held the birthday AND `hideBirthdayPrompt: true` — the screen trusted a one-off read that
// nothing refreshed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wantsBirthdayPrompt, withOwnEntry, sameDoc } from './ownUserDoc';

describe('wantsBirthdayPrompt', () => {
  it("Andrei's document asks nothing: a birthday, and the prompt dismissed", () => {
    expect(wantsBirthdayPrompt({ birthday: '1990-04-12', hideBirthdayPrompt: true }, true)).toBe(false);
  });

  it('either one alone is enough to stay quiet', () => {
    expect(wantsBirthdayPrompt({ birthday: '1990-04-12' }, true)).toBe(false);
    expect(wantsBirthdayPrompt({ hideBirthdayPrompt: true }, true)).toBe(false);
  });

  it('asks somebody the server says has neither', () => {
    expect(wantsBirthdayPrompt({ name: 'A' }, true)).toBe(true);
    expect(wantsBirthdayPrompt({ birthday: '', hideBirthdayPrompt: false }, true)).toBe(true);
    expect(wantsBirthdayPrompt({ birthday: null }, true)).toBe(true);
  });

  it('never on a cache — a claim about the account needs the server', () => {
    expect(wantsBirthdayPrompt({ name: 'A' }, false)).toBe(false);
  });

  it('never before the document is known, or when there is none', () => {
    expect(wantsBirthdayPrompt(undefined, true)).toBe(false);
    expect(wantsBirthdayPrompt(null, true)).toBe(false);
  });
});

describe('withOwnEntry', () => {
  const seed = { id: 'u1', email: 'a@example.test', name: 'Me' };
  const other = { id: 'u2', name: 'B' };

  it('lays the live document over the entry the map had, keeping what only the map knew', () => {
    const map = { u1: seed, u2: other };
    const out = withOwnEntry(map, 'u1', { id: 'u1', birthday: '1990-04-12', photoURL: 'p' });
    expect(out.u1).toEqual({ id: 'u1', email: 'a@example.test', name: 'Me', birthday: '1990-04-12', photoURL: 'p' });
    expect(out.u2).toBe(other);
  });

  it('where both have a value, the live document wins over the auth seed', () => {
    expect(withOwnEntry({ u1: seed }, 'u1', { name: 'Name from Settings' }).u1.name).toBe('Name from Settings');
  });

  it('the id is always the uid, whatever the document carries', () => {
    expect(withOwnEntry({}, 'u1', { id: 'something-else', name: 'X' }).u1.id).toBe('u1');
  });

  it('returns the SAME map when there is nothing to add — no new object for the form to reset on', () => {
    const map = { u1: seed };
    expect(withOwnEntry(map, 'u1', undefined)).toBe(map);
    expect(withOwnEntry(map, 'u1', null)).toBe(map);
    expect(withOwnEntry(map, undefined, { birthday: 'x' })).toBe(map);
  });
});

describe('sameDoc', () => {
  it('same content in a new object is the same document', () => {
    expect(sameDoc({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true);
  });

  it('a changed field is not', () => {
    expect(sameDoc({ hideBirthdayPrompt: false }, { hideBirthdayPrompt: true })).toBe(false);
  });

  it('absent and present differ; two absents do not', () => {
    expect(sameDoc(undefined, { a: 1 })).toBe(false);
    expect(sameDoc(null, { a: 1 })).toBe(false);
    expect(sameDoc(undefined, undefined)).toBe(true);
    expect(sameDoc(null, null)).toBe(true);
  });
});

describe('CalendarHome uses them', () => {
  // No DOM in this suite and the screen needs a signed-in Firestore, so the wiring is held on the
  // source — weaker than rendering it, and said so. The behaviour is the functions above.
  const src = readFileSync(resolve(process.cwd(), 'src/screens/CalendarHome.tsx'), 'utf8');

  it('the banner asks only through wantsBirthdayPrompt, on the live document and the server flag', () => {
    expect(src).toMatch(/\{wantsBirthdayPrompt\(ownData, ownFromServer\) && \(/);
    // The old condition, read off the one-off map, is gone.
    expect(src).not.toMatch(/!userMap\[auth\.currentUser\.uid\]\.birthday/);
    expect(src).not.toMatch(/!userMap\[auth\.currentUser\.uid\]\.hideBirthdayPrompt/);
  });

  it('the own document is listened to with metadata, and feeds both the flag and the data', () => {
    const call = /liveDoc<any>\(doc\(db, 'users', auth\.currentUser\.uid\), 'CalendarHome\.userDoc',[\s\S]*?\{ includeMetadataChanges: true \}\);/.exec(src);
    expect(call, 'the own-document listener with includeMetadataChanges').toBeTruthy();
    expect(call![0]).toContain('setOwnData((prev) => (sameDoc(prev, data) ? prev : data));');
    expect(call![0]).toContain('setOwnFromServer(!meta.fromCache);');
  });

  it('a listener stuck on the cache is reported once, 30 s in, through the reporter', () => {
    // Firestore "offline" for reads raises no error at all — the likeliest reading of Andrei's
    // banner on 27.09. The timer reads a ref: state captured by the closure would be stale.
    expect(src).toContain('if (!meta.fromCache) ownConfirmed.current = true;');
    const effect = /setTimeout\(\(\) => \{\s*if \(!ownConfirmed\.current && auth\.currentUser && navigator\.onLine !== false\) \{[\s\S]*?context: 'CalendarHome\.listenStale'[\s\S]*?\}, 30_000\);\s*return \(\) => clearTimeout\(timer\);\s*\}, \[\]\);/.exec(src);
    expect(effect, 'the one-shot stale-listener report').toBeTruthy();
  });

  it('every child gets the map WITH the live own entry', () => {
    expect(src).toMatch(/const userMap = useMemo\(\s*\(\) => withOwnEntry\(loadedUserMap, auth\.currentUser\?\.uid, ownData\),\s*\[loadedUserMap, ownData\],?\s*\);/);
    // The loop's setter writes the loaded map, never the one handed down.
    expect(src).toMatch(/const \[loadedUserMap, setUserMap\] = useState/);
  });
});
