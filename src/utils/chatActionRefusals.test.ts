// src/utils/chatActionRefusals.test.ts
//
// A reaction, a pin or a delete the server refuses says so on screen (06.11.2026). Since 08.10 the rules
// judge each of them, and refuse all three once the person is out of the group; the screen put the change
// back without a word, and the refusal reached only the error log (the reaction), or nothing but an
// unhandled rejection (the pin and the delete). The behaviour was probed on a bench with the real widget
// and the emulators; this pins the wiring, so none of the three can lose its catch or its banner unseen,
// and no action can show another's sentence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = readFileSync(join(resolve(__dirname, '..', 'components'), 'GroupChatWidget.tsx'), 'utf8');

/** The body of `const <name> = async (...) => { ... };`, up to its closing line at two spaces. */
function handler(name: string): string {
  const start = src.indexOf(`const ${name} = async`);
  expect(start, name).toBeGreaterThan(-1);
  const end = src.indexOf('\n  };\n', start);
  expect(end, name).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('a refused chat action says so', () => {
  // The handler, the banner it sets (by which way the action went), and its error-log context.
  const CASES: [string, string, string][] = [
    ['handleReaction', "setActionNotSaved(adding ? 'reaction' : 'unreaction')", 'GroupChatWidget.reaction'],
    ['handlePin', "setActionNotSaved(msg.isPinned ? 'unpin' : 'pin')", 'GroupChatWidget.pin'],
    ['handleDelete', "setActionNotSaved('delete')", 'GroupChatWidget.delete'],
  ];

  it.each(CASES)('%s: the write is awaited inside a try, and its catch reports it and sets the banner', (name, sets, context) => {
    const body = handler(name);
    const tryAt = body.indexOf('try {');
    const writeAt = body.indexOf('await updateDoc(');
    const catchAt = body.indexOf('} catch (err) {');
    expect(tryAt, name).toBeGreaterThan(-1);
    expect(writeAt, name).toBeGreaterThan(tryAt);
    expect(catchAt, name).toBeGreaterThan(writeAt);
    const handled = body.slice(catchAt);
    expect(handled).toContain(`context: '${context}'`);
    expect(handled).toContain(sets);
    // A new action clears the old banner first, so the banner is about the latest one.
    expect(body.slice(0, tryAt)).toContain('setActionNotSaved(null)');
  });

  it('the reaction picker closes at the tap, before the write waits for the server', () => {
    const body = handler('handleReaction');
    const close = body.indexOf('setActiveReactionMsg(null)');
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeLessThan(body.indexOf('await updateDoc('));
    // Once: a second close after the write would shut whichever picker is open by then.
    expect(body.split('setActiveReactionMsg(null)')).toHaveLength(2);
  });

  it('the banner pairs each action with its own sentence, can be closed, and stands outside the message box', () => {
    const at = src.indexOf('{actionNotSaved && (');
    expect(at).toBeGreaterThan(-1);
    const banner = src.slice(at, src.indexOf('\n          )}\n', at));
    const flat = banner.replace(/\s+/g, ' ');
    expect(banner).toContain('role="alert"');
    for (const [kind, key] of [
      ['reaction', 'chatReactionNotSaved'], ['unreaction', 'chatReactionNotRemoved'],
      ['pin', 'chatPinNotSaved'], ['unpin', 'chatUnpinNotSaved'],
    ]) {
      expect(flat).toContain(`actionNotSaved === '${kind}' ? t('${key}', language)`);
    }
    expect(flat).toContain(`: t('chatDeleteNotSaved', language)}`);
    expect(banner).toContain('onClick={() => setActionNotSaved(null)}');
    // Before the closed-conversation note and the composer alike, not inside either branch.
    expect(at).toBeLessThan(src.indexOf('{closedNote ? ('));
  });
});
