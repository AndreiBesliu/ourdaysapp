// src/utils/sendOrderFresh.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for S02 (commit c7a303d, mutation testing m-sending). Unit (emu-run --unit): `sendOrder` only.
//
// "Oldest first: each owner's queue goes by instant, and so do the owners within a round" (remindersCore.ts,
// review of 17.10.2026). sendOrderAt.test.ts holds it inside the last-chance part; in the fresh part every
// case has equal instants, so a fresh part drawn from the read's order (S02) passed it. The fresh part is
// what a run that runs out of time defers: the older one there is nearer its last chance.
import { describe, it, expect } from 'vitest';
import { sendOrder } from '../../functions/src/remindersCore';

const WINDOW = 15 * 60_000;
const EVERY = 5 * 60_000;
const SLACK = 2 * 60_000;
const NOW = Date.UTC(2026, 6, 15, 12, 0);
const due = (key: string, ownerId: string, at: number) =>
  ({ key, eventId: key, ownerId, day: '2026-07-15', title: '', at, zone: 'UTC', recipients: [ownerId], bodyKey: '', bodyParam: '' });

/** Both fresh: an on-time next run, and the one after it, still see them. */
const NEWER = NOW - 60_000;
const OLDER = NOW - 5 * 60_000;

describe('inside the fresh part, oldest first too', () => {
  it('an owner’s older fresh reminder goes before that owner’s newer one', () => {
    const { order, lastChance } = sendOrder([due('newer', 'A', NEWER), due('older', 'A', OLDER)], NOW, WINDOW, EVERY, SLACK);
    expect([...lastChance]).toEqual([]);
    expect(order.map((d) => d.key)).toEqual(['older', 'newer']);
  });

  it('and the first turn of a round goes to the owner whose fresh reminder is the oldest', () => {
    const { order } = sendOrder([due('m', 'M', NEWER), due('a', 'A', OLDER)], NOW, WINDOW, EVERY, SLACK);
    expect(order.map((d) => d.key)).toEqual(['a', 'm']);
  });
});
