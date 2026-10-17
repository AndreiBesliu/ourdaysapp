// functions/test/remindersRowIdSeparator.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for N02 (commit c7a303d, mutation testing m-sending).
//
// notify() keys a bell row by (rowKey, recipient) through a hash with a separator between the two, so
// that two different pairs never share a row. Without the separator (N02) a pair whose rowKey ends
// where the other's recipient begins hashes to the same id, and the second call overwrites the first
// recipient's row. Through the reminders that needs an event id holding "__<day>" and an assignee id
// written to match (both are member-written strings); here the pair is given to notify() directly.
// Run against the emulators through `npm run test:rules`.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
process.env.METADATA_SERVER_DETECTION = 'none';

let db: admin.firestore.Firestore;
let notify: typeof import('../src/notify')['notify'];

const rowsFor = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).size;

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  ({ notify } = await import('../src/notify'));
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

describe('a bell row is keyed by its rowKey AND its recipient, as a pair', () => {
  it('two pairs that read the same end to end keep a row each', async () => {
    // "reminder:e__2026-10-17" + "uid-ksep-1" and "reminder:e__2026-10-17uid-ksep-" + "1": one text end to end.
    const spec = { createdBy: '', type: 'reminder', titleKey: 'notifReminder', push: false } as const;
    const a = await notify({ ...spec, userIds: ['uid-ksep-1'], rowKey: 'reminder:e__2026-10-17' });
    const b = await notify({ ...spec, userIds: ['1'], rowKey: 'reminder:e__2026-10-17uid-ksep-' });
    expect(a.rows).toBe(1);
    expect(b.rows).toBe(1);
    expect(await rowsFor('uid-ksep-1')).toBe(1);
    expect(await rowsFor('1')).toBe(1);
  }, 30_000);

  it('the same pair twice is one row, rewritten (the property the key is for)', async () => {
    const spec = { createdBy: '', type: 'reminder', titleKey: 'notifReminder', push: false } as const;
    await notify({ ...spec, userIds: ['uid-ksep-2'], rowKey: 'reminder:e__2026-10-17' });
    await notify({ ...spec, userIds: ['uid-ksep-2'], rowKey: 'reminder:e__2026-10-17' });
    expect(await rowsFor('uid-ksep-2')).toBe(1);
  }, 30_000);
});
