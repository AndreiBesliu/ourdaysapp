// src/utils/sendOrderLastChance.test.ts
//
// Written by the review of 17.10.2026.
// too — the promise of 106729a ("within each part the turns go round the owners") that no existing
// test holds: every existing case has at most one last-chance reminder per owner.
import { describe, it, expect } from 'vitest';
import { sendOrder } from '../../functions/src/remindersCore';

const WINDOW = 15 * 60_000;
const EVERY = 5 * 60_000;
const SLACK = 2 * 60_000;
const NOW = Date.UTC(2026, 6, 15, 12, 0);
const due = (key: string, ownerId: string, at: number) =>
  ({ key, eventId: key, ownerId, day: '2026-07-15', title: '', at, zone: 'UTC', recipients: [ownerId], bodyKey: '', bodyParam: '' });

describe('the last-chance part goes round the owners too', () => {
  it('one account’s many last chances wait behind everybody else’s first', () => {
    const last = NOW - 11 * 60_000;
    const { order, lastChance } = sendOrder(
      [due('m1', 'M', last), due('m2', 'M', last), due('m3', 'M', last), due('a1', 'A', last)],
      NOW, WINDOW, EVERY, SLACK,
    );
    expect([...lastChance].sort()).toEqual(['a1', 'm1', 'm2', 'm3']);
    expect(order.map((d) => d.key)).toEqual(['m1', 'a1', 'm2', 'm3']);
  });
});
