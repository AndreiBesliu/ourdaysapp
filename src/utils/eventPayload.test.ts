// src/utils/eventPayload.test.ts
// The autosave and the save button must write the same fields.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// AddEventModal builds `baseEventData` TWICE: once in the debounced autosave effect, once in
// handleSubmit. They drifted. The submit payload was missing `location` and `reminderMinutes` —
// both collected by the form, both accepted by the server's override whitelist, both written by
// the autosave copy, and both silently dropped by the path that actually creates the event.
//
// The result was not a crash. The location you typed simply never appeared on the event, and the
// reminder you set never fired, because the two readers (EventDetailsModal and the notification
// scheduler in CalendarHome) gate on exactly those fields. Nothing anywhere said so.
//
// Two literals that must agree, with nothing making them agree — the same shape as the theme
// toggle and the background picker. So this is the thing worth pinning, rather than the two
// field names: any field the autosave learns about from now on must reach the save button too.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, '..', 'components', 'AddEventModal.tsx');

/**
 * Fields the autosave writes that the submit payload legitimately supplies elsewhere.
 *
 * `date` is spread in at every one of submit's four call sites
 * (`{ ...baseEventData, date: new Date(eventDate).toISOString() }`) because the create path also
 * needs `createdAt` and the recurrence fields alongside it. Keep this list at exactly one entry
 * unless you can point at the line that supplies the field.
 */
const SUPPLIED_SEPARATELY = new Set(['date']);

/** Top-level keys of each `const baseEventData = {…}` literal, by brace matching. */
function payloadLiterals(src: string): { line: number; keys: string[] }[] {
  const out: { line: number; keys: string[] }[] = [];
  const opener = /const baseEventData = \{/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    const open = src.indexOf('{', m.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = src.slice(open + 1, end);
    const keys: string[] = [];
    let nested = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      // Only keys at the literal's own level; skip anything inside a nested object or array.
      const k = /^([a-zA-Z][A-Za-z0-9_]*):/.exec(trimmed);
      if (nested === 0 && k && !trimmed.startsWith('//')) keys.push(k[1]);
      nested += (line.split('{').length - 1) + (line.split('[').length - 1)
              - (line.split('}').length - 1) - (line.split(']').length - 1);
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, keys });
  }
  return out;
}

describe('the two event payloads do not drift', () => {
  const src = readFileSync(FILE, 'utf8');
  const literals = payloadLiterals(src);

  it('finds both of them, so this cannot pass by finding one', () => {
    expect(literals.length, 'expected an autosave payload and a submit payload').toBe(2);
    expect(literals[0].keys.length).toBeGreaterThan(8);
    expect(literals[1].keys.length).toBeGreaterThan(8);
  });

  it('every field the autosave writes is also written by the save button', () => {
    const [autosave, submit] = literals;
    const submitKeys = new Set(submit.keys);
    const missing = autosave.keys.filter((k) => !submitKeys.has(k) && !SUPPLIED_SEPARATELY.has(k));
    expect(
      missing,
      `autosave (line ${autosave.line}) writes fields the save button at line ${submit.line} drops: ` +
        `${missing.join(', ')}. A field that only autosave writes is lost whenever the user presses Save.`,
    ).toEqual([]);
  });

  it('the two fields this was found through are present in both', () => {
    // Named explicitly: they are the ones that were actually lost, and a regression here is worth
    // a message that says so rather than a generic set difference.
    for (const field of ['location', 'reminderMinutes']) {
      for (const lit of literals) {
        expect(lit.keys, `${field} missing from the payload at line ${lit.line}`).toContain(field);
      }
    }
  });
});
