// rules-tests/ai-config.test.ts
//
// The live AI budget, and the record of who changed it.
//
// ── What is being protected ───────────────────────────────────────────────────────────
//
// `aiConfig/live` decides how much money this app may spend in a day, and whether it may spend
// any at all. `aiConfigLog` is the only answer to "who raised the cap last Tuesday". Both are
// written exclusively through `adminSetAiConfig`, over the Admin SDK, which these rules do not
// constrain — so from a browser they are closed to everybody, admins included.
//
// ── The gap this file closes in the model it copies ───────────────────────────────────
//
// `games.test.ts` probes `warlordConfig` by asserting that Alice and Dave are refused — and both
// are non-admins. `allow write: if false` passes that unchanged, and so does an admin-gated rule.
// It proves non-admins are refused and proves nothing about the shape of the gate.
//
// So this file asserts that an ADMIN is refused too. That is the assertion that catches a future
// contributor "helpfully" adding `exists(/admins/$(uid))` here, which would look like an
// improvement and would quietly move a money control behind a door that any admin can open —
// `adminSetAdmin` is gated by `assertAdmin` alone, so any admin can mint another.

import { assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { ALICE, BOB, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-aiconfig'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    // ALICE is an ADMIN. That is the whole point of this file.
    await setDoc(doc(db, 'admins', ALICE), { email: 'alice@example.com' });
    await setDoc(doc(db, 'aiConfig', 'live'), {
      globalDailyUsd: 5, userDailyUsd: 0.25, killSwitch: false, updatedBy: ALICE,
    });
    await setDoc(doc(db, 'aiConfigLog', 'entry1'), {
      schema: 1, by: { uid: ALICE, email: 'alice@example.com' },
      from: { globalDailyUsd: 5 }, to: { globalDailyUsd: 5 },
    });
    await setDoc(doc(db, 'ai_budget', '_global'), { date: '2026-09-20', microUsd: 3537 });
  });
});

describe('aiConfig/live is closed to the browser', () => {
  it('refuses an ADMIN every operation', async () => {
    // The assertion `games.test.ts` is missing. An admin-gated rule would pass a non-admin test
    // and fail this one, which is exactly the drift worth catching.
    const db = as(ALICE);
    await assertFails(getDoc(doc(db, 'aiConfig', 'live')));
    await assertFails(setDoc(doc(db, 'aiConfig', 'live'), { globalDailyUsd: 50 }));
    await assertFails(updateDoc(doc(db, 'aiConfig', 'live'), { killSwitch: false }));
    await assertFails(deleteDoc(doc(db, 'aiConfig', 'live')));
    await assertFails(getDocs(collection(db, 'aiConfig')));
  });

  it('refuses a plain member and an anonymous caller', async () => {
    await assertFails(getDoc(doc(as(BOB), 'aiConfig', 'live')));
    await assertFails(updateDoc(doc(as(BOB), 'aiConfig', 'live'), { globalDailyUsd: 50 }));
    // `anon()`, not `as(null)` — `as` takes a uid. My first draft passed null and the harness
    // built a context for a user literally called "null", which is not the anonymous case.
    await assertFails(setDoc(doc(anon(), 'aiConfig', 'live'), { killSwitch: false }));
    await assertFails(getDoc(doc(anon(), 'aiConfig', 'live')));
  });

  it('refuses a document that does not exist yet, so nobody can CREATE the first one', async () => {
    // The day this ships, the document is absent and the app runs on compiled defaults. If create
    // were open, the first write would be anybody's.
    await assertFails(setDoc(doc(as(ALICE), 'aiConfig', 'other'), { globalDailyUsd: 50 }));
    await assertFails(setDoc(doc(as(BOB), 'aiConfig', 'live'), { globalDailyUsd: 50 }));
  });
});

describe('the log cannot be written or rewritten from a browser', () => {
  it('refuses an admin reading, appending, editing or deleting a row', async () => {
    // Append-only is worth nothing if the appender can also edit. Here nobody can do either.
    const db = as(ALICE);
    await assertFails(getDocs(collection(db, 'aiConfigLog')));
    await assertFails(setDoc(doc(db, 'aiConfigLog', 'forged'), { schema: 1 }));
    await assertFails(updateDoc(doc(db, 'aiConfigLog', 'entry1'), { to: { globalDailyUsd: 50 } }));
    await assertFails(deleteDoc(doc(db, 'aiConfigLog', 'entry1')));
  });
});

describe('the SPEND counter stays out of reach, which is why the limits are not stored on it', () => {
  it('refuses an admin resetting the day, by either field', async () => {
    // `ai_budget/_global` holds `microUsd` — the day's live spend — and `date`, the rollover key.
    // Had the limits been hung here and an admin write opened to change them, the same permission
    // would allow `microUsd: 0` (a full reset of the cap, from a browser, with no ledger row) and
    // `date: '1970-01-01'`, which makes every spend read as zero for the rest of the day. The
    // second is invisible to anyone looking at `microUsd`.
    const db = as(ALICE);
    await assertFails(updateDoc(doc(db, 'ai_budget', '_global'), { microUsd: 0 }));
    await assertFails(updateDoc(doc(db, 'ai_budget', '_global'), { date: '1970-01-01' }));
    await assertFails(getDoc(doc(db, 'ai_budget', '_global')));
  });
});
