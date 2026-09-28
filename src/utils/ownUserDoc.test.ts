// src/utils/ownUserDoc.test.ts
//
// The person's own document on the calendar and Settings screens (utils/ownUserDoc.ts), and the
// wiring that uses it. Andrei, 27.09.2026: the calendar's birthday banner kept asking although his
// document held the birthday AND `hideBirthdayPrompt: true` — the screen trusted a one-off read that
// nothing refreshed. 28.09, with the fix live: it showed for a second, and he moved the question to
// Settings, beside the field it is about.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asksForBirthday, birthdayClaimRetracted, withOwnEntry, sameDoc, type OwnDocStep } from './ownUserDoc';

describe('asksForBirthday', () => {
  it('asks once the server has answered and the field is empty', () => {
    expect(asksForBirthday('', true)).toBe(true);
    expect(asksForBirthday(null, true)).toBe(true);
    expect(asksForBirthday(undefined, true)).toBe(true);
  });

  it('a birthday in the field is enough to stay quiet', () => {
    expect(asksForBirthday('1990-04-12', true)).toBe(false);
  });

  it('never before the server has answered — an empty field on a loading form is not a missing birthday', () => {
    expect(asksForBirthday('', false)).toBe(false);
    expect(asksForBirthday(undefined, false)).toBe(false);
  });
});

describe('birthdayClaimRetracted', () => {
  const step = (ms: number, fromCache: boolean, birthday: boolean): OwnDocStep =>
    ({ ms, fromCache, pending: false, exists: true, birthday });

  it("Andrei's stale cache, then the server with the birthday: never asked, so nothing taken back", () => {
    expect(birthdayClaimRetracted([step(0, true, false), step(1500, false, true)])).toBe(false);
  });

  it('the server says none, then within 10 s a birthday: the flash', () => {
    expect(birthdayClaimRetracted([step(0, true, false), step(800, false, false), step(1600, false, true)])).toBe(true);
  });

  it('confirmation is kept once given, as the screen keeps it: a later cached step still asks', () => {
    expect(birthdayClaimRetracted([step(0, false, true), step(500, true, false), step(900, true, true)])).toBe(true);
  });

  it('asked and never taken back is no retraction; neither is one after the window', () => {
    expect(birthdayClaimRetracted([step(0, false, false), step(3000, false, false)])).toBe(false);
    expect(birthdayClaimRetracted([step(0, false, false), step(10_001, false, true)])).toBe(false);
    expect(birthdayClaimRetracted([step(0, false, false), step(10_000, false, true)])).toBe(true);
  });

  it('a birthday that was there all along is not a retraction', () => {
    expect(birthdayClaimRetracted([step(0, true, true), step(400, false, true)])).toBe(false);
    expect(birthdayClaimRetracted([])).toBe(false);
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

  it('the calendar has no birthday banner any more: no text of it, no dismissal', () => {
    expect(src).not.toContain('addBirthdayPromptDesc');
    expect(src).not.toContain('hideBirthdayPrompt');
    expect(src).not.toContain('BirthdayPrompt');
  });

  it('the own document is listened to with metadata, and feeds the data and the confirmation', () => {
    const call = /liveDoc<any>\(doc\(db, 'users', auth\.currentUser\.uid\), 'CalendarHome\.userDoc',[\s\S]*?\{ includeMetadataChanges: true \}\);/.exec(src);
    expect(call, 'the own-document listener with includeMetadataChanges').toBeTruthy();
    expect(call![0]).toContain('setOwnData((prev) => (sameDoc(prev, data) ? prev : data));');
    expect(call![0]).toContain('if (!meta.fromCache) ownConfirmed.current = true;');
    expect(call![0]).toContain('if (!meta.fromCache) setOwnFromServer(true);');
    // Nothing else sets it: a cached snapshot must not confirm.
    expect(src.match(/setOwnFromServer\(/g)).toHaveLength(1);
  });

  it('the dot asks through asksForBirthday, on the live document and the server confirmation', () => {
    expect(src).toContain('const askBirthday = asksForBirthday(ownData?.birthday, ownFromServer);');
    expect(src.match(/asksForBirthday\(/g)).toHaveLength(1);
  });

  it('the dot is on every way into Settings: the header button, the phone menu, and its Settings item', () => {
    const header = /onClick=\{\(\) => navigate\('\/settings'\)\}[\s\S]*?<\/button>/.exec(src);
    expect(header![0]).toContain('{askBirthday && <span className="absolute');
    const hamburger = /onClick=\{\(\) => setIsMobileMenuOpen\(!isMobileMenuOpen\)\}[\s\S]*?<\/button>/.exec(src);
    expect(hamburger![0]).toContain('{askBirthday && !isMobileMenuOpen && <span className="absolute');
    const item = /onClick=\{\(\) => \{ navigate\('\/settings'\); setIsMobileMenuOpen\(false\); \}\}[\s\S]*?<\/button>/.exec(src);
    expect(item![0]).toMatch(/\{askBirthday && \(\s*<>\s*<span className="ml-auto/);
  });

  it('a claim taken back within 10 s is reported once, with the snapshot trail and nothing personal', () => {
    const call = /'CalendarHome\.userDoc',[\s\S]*?\{ includeMetadataChanges: true \}\);/.exec(src)![0];
    expect(call).toContain('ownTrail.current.push({ ms, fromCache: meta.fromCache, pending: meta.hasPendingWrites, exists: !!data, birthday: !!data?.birthday });');
    expect(call).toMatch(/if \(!retractionReported\.current && birthdayClaimRetracted\(ownTrail\.current\)\) \{\s*retractionReported\.current = true;\s*reportError\([\s\S]*?context: 'CalendarHome\.birthdayRetracted', stack: JSON\.stringify\(ownTrail\.current\)/);
    // Only the first minute, and a bounded trail.
    expect(call).toContain('if (ms < 60_000 && ownTrail.current.length < 20) {');
  });

  it('a listener stuck on the cache is reported once, 30 s in, through the reporter', () => {
    // Firestore "offline" for reads raises no error at all. The timer reads a ref: state captured
    // by the closure would be stale.
    const effect = /setTimeout\(\(\) => \{\s*if \(!ownConfirmed\.current && auth\.currentUser && navigator\.onLine !== false\) \{[\s\S]*?context: 'CalendarHome\.listenStale'[\s\S]*?\}, 30_000\);\s*return \(\) => clearTimeout\(timer\);\s*\}, \[\]\);/.exec(src);
    expect(effect, 'the one-shot stale-listener report').toBeTruthy();
  });

  it('every child gets the map WITH the live own entry', () => {
    expect(src).toMatch(/const userMap = useMemo\(\s*\(\) => withOwnEntry\(loadedUserMap, auth\.currentUser\?\.uid, ownData\),\s*\[loadedUserMap, ownData\],?\s*\);/);
    // The loop's setter writes the loaded map, never the one handed down.
    expect(src).toMatch(/const \[loadedUserMap, setUserMap\] = useState/);
  });
});

describe('Settings asks for the birthday, on its own field', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/screens/Settings.tsx'), 'utf8');

  it("asks through asksForBirthday, on the field's own value and the server's answer", () => {
    expect(src).toContain('const askBirthday = asksForBirthday(birthday, fromServer);');
    // The row switches its wording on that one value, and nothing else asks.
    expect(src).toContain("{askBirthday ? t('addYourBirthday', language) : t('birthday', language)}");
    expect(src).toContain("{askBirthday ? t('addBirthdayPromptDesc', language) : t('birthdayDesc', language)}");
    expect(src.match(/asksForBirthday\(/g)).toHaveLength(1);
  });

  it('the server confirmation is read off a listener with metadata, before the no-document return', () => {
    const call = /liveDoc<any>\(doc\(db, 'users', auth\.currentUser\.uid\), 'Settings\.userDoc',[\s\S]*?\{ includeMetadataChanges: true \}\);/.exec(src);
    expect(call, 'the Settings listener with includeMetadataChanges').toBeTruthy();
    const body = call![0];
    const confirm = body.indexOf('if (!meta.fromCache) setFromServer(true);');
    const bail = body.indexOf('if (!data || sameDoc(appliedDoc.current, data)) return;');
    expect(confirm, 'the confirmation').toBeGreaterThan(-1);
    expect(bail, 'the same-document guard').toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(bail);
    // Nothing else flips it: a cached snapshot must not.
    expect(src.match(/setFromServer\(/g)).toHaveLength(1);
  });

  it('a metadata-only event does not copy the document back over the fields', () => {
    const call = /'Settings\.userDoc',[\s\S]*?\{ includeMetadataChanges: true \}\);/.exec(src)![0];
    const bail = call.indexOf('sameDoc(appliedDoc.current, data)) return;');
    const record = call.indexOf('appliedDoc.current = data;');
    const setName = call.indexOf('setName(');
    expect(bail).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(bail);
    expect(setName).toBeGreaterThan(record);
  });
});
