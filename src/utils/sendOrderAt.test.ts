// src/utils/sendOrderAt.test.ts
//
// Written by the review of 17.10.2026.
// src/utils/ (run with emu-run --unit). Pure: `sendOrder` only.
import { describe, it, expect } from 'vitest';
import { sendOrder } from '../../functions/src/remindersCore';

const WINDOW = 15 * 60_000;
const EVERY = 5 * 60_000;
const SLACK = 2 * 60_000;
const NOW = Date.UTC(2026, 6, 15, 12, 0);
const due = (key: string, ownerId: string, at: number) =>
  ({ key, eventId: key, ownerId, day: '2026-07-15', title: '', at, zone: 'UTC', recipients: [ownerId], bodyKey: '', bodyParam: '' });

/** In (NOW-10, NOW-8]: on its last chance only by the slack; an on-time next run (NOW+5) still sees it. */
const SLACK_BAND = NOW - 9 * 60_000;
/** In (NOW-15, NOW-10]: no later run sees it. */
const GONE = NOW - 14 * 60_000;
const FRESH = NOW - 60_000;

describe('inside the last-chance part, oldest first', () => {
  it('an owner’s reminder no later run sees goes before that owner’s slack-band one', () => {
    // The read's order (date, then id) puts 'a' first; both are on the last-chance list.
    const { order, lastChance } = sendOrder([due('a', 'A', SLACK_BAND), due('b', 'A', GONE)], NOW, WINDOW, EVERY, SLACK);
    expect([...lastChance].sort()).toEqual(['a', 'b']);
    expect(order.map((d) => d.key)).toEqual(['b', 'a']);
  });

  it('and the first turn of a round goes to the owner whose reminder is the oldest', () => {
    const { order } = sendOrder([due('m', 'M', SLACK_BAND), due('a', 'A', GONE)], NOW, WINDOW, EVERY, SLACK);
    expect(order.map((d) => d.key)).toEqual(['a', 'm']);
  });
});

describe('what the sort must not change', () => {
  it('the rounds: one account’s old reminders do not push another’s slack-band one out of the first round', () => {
    const { order } = sendOrder(
      [due('m1', 'M', GONE), due('m2', 'M', GONE), due('m3', 'M', GONE), due('a', 'A', SLACK_BAND)],
      NOW, WINDOW, EVERY, SLACK,
    );
    expect(order.map((d) => d.key)).toEqual(['m1', 'a', 'm2', 'm3']);
  });

  it('the last-chance part before the fresh one, and the set that is counted', () => {
    const { order, lastChance } = sendOrder(
      [due('f', 'A', FRESH), due('s', 'B', SLACK_BAND), due('g', 'C', GONE)],
      NOW, WINDOW, EVERY, SLACK,
    );
    expect(order.map((d) => d.key).slice(2)).toEqual(['f']);
    expect([...lastChance].sort()).toEqual(['g', 's']);
  });

  it('equal instants keep the order they were read in', () => {
    const order = sendOrder(
      [due('a1', 'A', FRESH), due('a2', 'A', FRESH), due('a3', 'A', FRESH), due('b1', 'B', FRESH), due('c1', 'C', FRESH), due('c2', 'C', FRESH)],
      NOW, WINDOW, EVERY, SLACK,
    ).order;
    expect(order.map((d) => d.key)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });

  it('the input is not reordered in place', () => {
    const input = [due('a', 'A', SLACK_BAND), due('b', 'A', GONE)];
    sendOrder(input, NOW, WINDOW, EVERY, SLACK);
    expect(input.map((d) => d.key)).toEqual(['a', 'b']);
  });
});
