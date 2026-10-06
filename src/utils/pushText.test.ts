// src/utils/pushText.test.ts
//
// functions/src/pushText.ts: what a push may carry (06.10.2026). Pure, so it is tested here too;
// the emulator suite (functions/test/gamePush.test.ts) runs it through the triggers and notify().

import { describe, it, expect } from 'vitest';
import { clampText, pushName, wellFormed, PUSH_NAME_MAX } from '../../functions/src/pushText';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('wellFormed', () => {
  it('drops a lone half wherever it is, and keeps whole pairs', () => {
    expect(wellFormed('a\uD83Db')).toBe('ab');
    expect(wellFormed('a\uDE00b')).toBe('ab');
    expect(wellFormed('\uD83D')).toBe('');
    expect(wellFormed('\uDE00\uD83D')).toBe('');
    expect(wellFormed('x\u{1F600}y\u{1F600}')).toBe('x\u{1F600}y\u{1F600}');
    expect(wellFormed('plain text, ăîșț')).toBe('plain text, ăîșț');
  });
});

describe('clampText', () => {
  it('cuts to the length, and never ends in half a character', () => {
    expect(clampText('abcdef', 3)).toBe('abc');
    expect(clampText('ab\u{1F600}', 3)).toBe('ab');
    expect(clampText('ab\u{1F600}', 4)).toBe('ab\u{1F600}');
    for (let max = 0; max < 12; max++) {
      const out = clampText('\u{1F600}a\u{1F600}\u{1F600}b\u{1F600}', max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(LONE.test(out), `max ${max}`).toBe(false);
    }
  });

  it('anything that is not text is empty', () => {
    for (const v of [undefined, null, 42, {}, ['a']]) expect(clampText(v, 10)).toBe('');
  });
});

describe('pushName', () => {
  it('the name, as it was', () => {
    expect(pushName({ name: 'Andrei', email: 'a@x.ro' })).toBe('Andrei');
  });

  it('one line, of at most 40', () => {
    expect(pushName({ name: '  Ana\r\n\tMaria\u0000 Pop ' })).toBe('Ana Maria Pop');
    expect(pushName({ name: 'x'.repeat(500) })).toBe('x'.repeat(PUSH_NAME_MAX));
    expect(PUSH_NAME_MAX).toBe(40);
    // A cut that leaves a space at the end does not keep it.
    expect(pushName({ name: 'a'.repeat(39) + ' b' })).toBe('a'.repeat(39));
    expect(LONE.test(pushName({ name: 'a'.repeat(39) + '\u{1F600}' }))).toBe(false);
  });

  it('then the first part of the email, then “Someone”', () => {
    expect(pushName({ name: '   ', email: 'ana.pop@example.com' })).toBe('ana.pop');
    expect(pushName({ name: { first: 'Ana' }, email: 'ana@example.com' })).toBe('ana');
    expect(pushName({ email: '@example.com' })).toBe('Someone');
    expect(pushName({ name: 7, email: 7 })).toBe('Someone');
    for (const u of [undefined, null, 'Ana', 42]) expect(pushName(u)).toBe('Someone');
  });
});
