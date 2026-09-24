// functions/test/claimWarlordTimeout.test.ts
//
// A battle from before `lastMoveAt` existed has no clock, so the first timeout claim starts one.
// It did that with `tx.update(...)` followed by `throw` INSIDE the transaction — and a throw rolls
// the transaction back, the update with it. The clock never started, every claim said it just had,
// and such a battle could never time out. Run through the real handler, on the emulator.

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let claim: { run: (req: CallableRequest<any>) => Promise<any> };
let db: admin.firestore.Firestore;

const A = 'uid-a';
const B = 'uid-b';

const call = (uid: string, gameId: string) =>
  claim.run({ data: { gameId }, auth: { uid, token: { uid } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  claim = (await import('../src/index')).claimWarlordTimeout as never;
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  // It is A's turn (side PLAYER = players[0]), so B is the one who may claim. No lastMoveAt and no
  // startedAt: a battle from before the clock.
  await db.doc('games/old-battle').set({
    gameType: 'warlord-battle', status: 'playing', players: [A, B],
    state: { status: 'ONGOING', side: 'PLAYER' },
  });
});

describe('a battle with no clock', () => {
  it('starts the clock on the first claim — and it STAYS started', async () => {
    await expect(call(B, 'old-battle')).rejects.toMatchObject({
      code: 'failed-precondition', message: expect.stringMatching(/clock has just started/),
    });
    // The write that used to be rolled back by the throw.
    expect((await db.doc('games/old-battle').get()).data()?.lastMoveAt).toBeDefined();
  });

  it('so the next claim is measured against that clock, instead of starting it again', async () => {
    await call(B, 'old-battle').catch(() => {});
    await expect(call(B, 'old-battle')).rejects.toMatchObject({
      code: 'failed-precondition', message: expect.stringMatching(/Not yet/),
    });
  });
});
