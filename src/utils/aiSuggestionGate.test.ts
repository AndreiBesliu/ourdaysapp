// src/utils/aiSuggestionGate.test.ts
//
// The measured waste, stated as a test: filling in a six-item checklist used to send roughly
// thirteen AI calls, because every item was asked about when it was added AND again every time it
// lost focus — whether or not it had been touched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askKey, shouldAskFor, createAskScheduler, MIN_ASK_LENGTH, ASK_DEBOUNCE_MS } from './aiSuggestionGate';

/** Plays the real sequence: title, then each item added, then each item blurred. */
function callsFor(title: string, items: string[]): number {
  const asked = new Set<string>();
  let spent = 0;
  const ask = (text: string) => {
    if (!shouldAskFor(text, asked)) return;
    asked.add(askKey(text));
    spent += 1;
  };

  ask(title);
  for (const item of items) ask(item);        // added
  for (const item of items) ask(item);        // blurred, untouched
  return spent;
}

describe('the waste this file exists to stop', () => {
  const ITEMS = ['milk', 'bread', 'washing powder', 'tomatoes', 'coffee beans', 'olive oil'];

  it('asks once per distinct thing, not twice', () => {
    // Seven: the title plus six items. The six blur events add nothing, because they ask a
    // question that has already been answered.
    expect(callsFor('weekly shop', ITEMS)).toBe(7);
  });

  it('is measurably fewer than asking every time', () => {
    const naive = 1 + ITEMS.length * 2;       // what the old code did
    expect(callsFor('weekly shop', ITEMS)).toBeLessThan(naive);
    expect(naive - callsFor('weekly shop', ITEMS)).toBe(6);
  });

  it('still asks when an item is genuinely edited', () => {
    const asked = new Set<string>();
    expect(shouldAskFor('milk', asked)).toBe(true);
    asked.add(askKey('milk'));
    expect(shouldAskFor('milk', asked)).toBe(false);
    expect(shouldAskFor('oat milk', asked)).toBe(true);
  });
});

describe('what counts as the same question', () => {
  it('ignores case and surrounding space', () => {
    expect(askKey('  Milk ')).toBe('milk');
    expect(askKey('MILK')).toBe(askKey('milk'));
  });

  it('collapses inner whitespace, which a re-edited textarea collects', () => {
    expect(askKey('washing   powder')).toBe('washing powder');
    expect(askKey('washing\npowder')).toBe('washing powder');
  });

  it('treats different words as different questions', () => {
    expect(askKey('milk')).not.toBe(askKey('bread'));
  });

  it('survives anything that is not a string', () => {
    for (const junk of [null, undefined, 42, {}, []]) {
      expect(() => askKey(junk)).not.toThrow();
      expect(askKey(junk)).toBe('');
    }
  });
});

describe('refusing to ask at all', () => {
  const none = new Set<string>();

  it('says no to empty and whitespace', () => {
    expect(shouldAskFor('', none)).toBe(false);
    expect(shouldAskFor('   ', none)).toBe(false);
    expect(shouldAskFor('\n\t', none)).toBe(false);
  });

  it('says no to a fragment too short to match anything', () => {
    // A call costs the same whether the question is good or not.
    expect(shouldAskFor('a', none)).toBe(false);
    expect(shouldAskFor('ab', none)).toBe(false);
    expect(shouldAskFor('abc', none)).toBe(true);
    expect(MIN_ASK_LENGTH).toBe(3);
  });

  it('says no to junk rather than sending it', () => {
    for (const junk of [null, undefined, 42, {}, []]) {
      expect(shouldAskFor(junk, none)).toBe(false);
    }
  });

  it('counts length after normalising, not before', () => {
    // "  a  " looks five characters long and is one real one.
    expect(shouldAskFor('  a  ', none)).toBe(false);
  });
});

describe('the debounce interval', () => {
  it('is long enough to cover typing the next item, short enough not to feel stuck', () => {
    expect(ASK_DEBOUNCE_MS).toBeGreaterThanOrEqual(400);
    expect(ASK_DEBOUNCE_MS).toBeLessThanOrEqual(1500);
  });
});

describe('the scheduler, on a fake clock', () => {
  // The timing half. Run rather than asserted in a comment, because "the latest one wins" and
  // "check again on the way out" are exactly the parts that look obviously right and are not.
  const setup = () => {
    const sent: string[] = [];
    const s = createAskScheduler((t) => sent.push(t), 700);
    return { sent, s };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks nothing until the person stops', () => {
    const { sent, s } = setup();
    s.request('milk');
    vi.advanceTimersByTime(699);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['milk']);
  });

  it('collapses a burst into one call, keeping the latest', () => {
    const { sent, s } = setup();
    s.request('mi');       // too short, ignored outright
    s.request('milk');
    vi.advanceTimersByTime(100);
    s.request('milk and bread');
    vi.advanceTimersByTime(100);
    s.request('milk and bread and jam');
    vi.advanceTimersByTime(700);
    expect(sent).toEqual(['milk and bread and jam']);
  });

  it('asks about each item when there is a real pause between them', () => {
    const { sent, s } = setup();
    s.request('milk');
    vi.advanceTimersByTime(700);
    s.request('bread');
    vi.advanceTimersByTime(700);
    expect(sent).toEqual(['milk', 'bread']);
  });

  it('never asks the same question twice, however it arrives', () => {
    const { sent, s } = setup();
    s.request('milk');
    vi.advanceTimersByTime(700);
    s.request('milk');            // the blur, on an item nobody edited
    s.request('  MILK  ');        // and the same thing differently spelled
    vi.advanceTimersByTime(700);
    expect(sent).toEqual(['milk']);
    expect(s.askedCount()).toBe(1);
  });

  it('drops a pending ask when the modal closes', () => {
    // Otherwise it spends a call on a form nobody is looking at, and sets a suggestion on the
    // NEXT event opened.
    const { sent, s } = setup();
    s.request('milk');
    s.cancel();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
  });

  it('forgets the questions when reset, so a new event may ask them again', () => {
    const { sent, s } = setup();
    s.request('milk');
    vi.advanceTimersByTime(700);
    s.reset();
    s.request('milk');
    vi.advanceTimersByTime(700);
    expect(sent).toEqual(['milk', 'milk']);
  });

  it('replays the real six-item list and sends seven, not thirteen', () => {
    const { sent, s } = setup();
    const items = ['milk', 'bread', 'washing powder', 'tomatoes', 'coffee beans', 'olive oil'];
    s.request('weekly shop');
    vi.advanceTimersByTime(700);
    for (const it of items) { s.request(it); vi.advanceTimersByTime(700); }   // added
    for (const it of items) { s.request(it); vi.advanceTimersByTime(700); }   // blurred, untouched
    expect(sent).toHaveLength(7);
    expect(sent).toEqual(['weekly shop', ...items]);
  });
});
