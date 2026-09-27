// src/utils/describeThrown.test.ts
//
// Whatever is thrown gets a message that names it — and an Error with a message is described
// exactly as before, so the groups already in the error panel keep their fingerprints.

import { describe, it, expect } from 'vitest';
import { describeThrown } from './describeThrown';

describe('describeThrown', () => {
  it('an Error with a message: its own message and stack, untouched', () => {
    const e = new TypeError('t is not a function');
    expect(describeThrown(e)).toEqual({ message: 't is not a function', stack: e.stack, kind: 'TypeError' });
  });

  it('an Error with NO message is named, and keeps its stack', () => {
    const e = new RangeError();
    const d = describeThrown(e);
    expect(d.message).toBe('RangeError with no message');
    expect(d.stack).toBe(e.stack);
  });

  it('a string is the message — as `String(reason)` already logged it', () => {
    expect(describeThrown('quota exceeded')).toEqual({ message: 'quota exceeded', stack: null, kind: 'string' });
    expect(describeThrown('   ').message).toBe('Thrown an empty string');
  });

  it('null and undefined say so, instead of "Render error"', () => {
    expect(describeThrown(null).message).toBe('Thrown null');
    expect(describeThrown(undefined).message).toBe('Thrown undefined');
  });

  it('a thrown Promise is named for what it usually means', () => {
    expect(describeThrown(Promise.resolve()).message).toMatch(/^Thrown a Promise/);
  });

  it('an error-LIKE object (a library exception, another realm) keeps its name and message', () => {
    const lib = { name: 'InvalidInputException', message: '"12" is not a valid input for EAN13' };
    expect(describeThrown(lib).message).toBe('InvalidInputException: "12" is not a valid input for EAN13');
    const foreign = { name: 'Error', message: 'from an iframe', stack: 'at x' };
    expect(describeThrown(foreign)).toEqual({ message: 'Error: from an iframe', stack: 'at x', kind: 'Error' });
  });

  it('a plain object shows what it carries, not "[object Object]"', () => {
    const d = describeThrown({ code: 'permission-denied', detail: 5 });
    expect(d.message).toBe('Thrown Object (code permission-denied): {"code":"permission-denied","detail":5}');
    class Weird { x = 1; }
    expect(describeThrown(new Weird()).message).toBe('Thrown Weird: {"x":1}');
  });

  it('survives what JSON cannot write', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(describeThrown(loop).message).toBe('Thrown Object: [object Object]');
    expect(describeThrown({}).message).toBe('Thrown Object: [object Object]');
  });

  it('primitives', () => {
    expect(describeThrown(42).message).toBe('Thrown number: 42');
    expect(describeThrown(false).message).toBe('Thrown boolean: false');
    expect(describeThrown(10n).message).toBe('Thrown bigint: 10');
    expect(describeThrown(Symbol('s')).message).toBe('Thrown symbol: Symbol(s)');
  });

  it('never returns an empty message, and caps a long one', () => {
    for (const v of [new Error(''), '', null, undefined, {}, [], 0, NaN]) {
      expect(describeThrown(v).message.length).toBeGreaterThan(0);
    }
    expect(describeThrown('x'.repeat(5000)).message).toHaveLength(500);
    expect(describeThrown(new Error('y'.repeat(5000))).message).toHaveLength(500);
  });
});
