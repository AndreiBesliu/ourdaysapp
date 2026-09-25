// rules-tests/apk-compat.test.ts
//
// What the INSTALLED Android app sends, replayed against the rules — so a rules change that would
// break the phones turns this suite red instead of turning the phones silent.
//
// ── Why this exists ─────────────────────────────────────────────────────────────────────────
//
// The app also ships as an APK, and `capacitor.config.ts` has no `server` block, so the APK
// carries a FROZEN copy of the web bundle. Hosting deploys never reach it. But it talks to the
// SAME rules and functions as the web app, so every rule written since that bundle was frozen is
// a rule the phones meet with code that has never heard of it.
//
// Andrei confirmed on 24.09 that the APK IS installed. The rule since then: a change to the rules
// or a callable is checked against what the APK sends, and does not refuse it unless the loss has
// been accepted explicitly.
//
// ── Where the payloads come from ────────────────────────────────────────────────────────────
//
// Copied field for field from `android/app/src/main/assets/public/assets/index-DTbgbzyX.js`, the
// bundle `npx cap sync` last copied into the Android project, on 9 May 2026 at 08:27. No APK
// build output exists on disk, so that the phones run exactly this bundle is INFERRED from the
// sync date, not proved — Andrei confirms when he installed it. If the phones turn out to run a
// later bundle, re-extract the payloads and rewrite these, do not reason about the difference.
//
// ── ALREADY BROKEN on the phones, measured 24.09, and therefore NOT pinned here ───────────────
//
//   * Adding an expense. The APK writes `{ amount, description, paidBy, createdAt }` to the
//     top-level `expenses` collection; the rule now requires `ownerId`, which it never sends.
//     Refused, and the APK swallows the error in a `console.error`, so the person sees nothing.
//   * The in-app notification when a task is assigned to somebody else. The APK writes the row
//     itself; the rule refuses it. The event is still created — only the notice is lost.
//
// Pinning those as `assertFails` would make this file defend the breakage. They are recorded in
// the DEVLOG and in the report on the rebuild; they are fixed by rebuilding, not by loosening.
//
// ── And its READS, found by the pre-deploy review of 24.09 ───────────────────────────────────
//
// The list above was only what the APK WRITES. Its reads fare worse. The calendar listens on
// `query(collection(db, 'events'))` with no filter at all (checked in the bundle), and since the
// rules of 22 May (`ee9e401`) the events read rule depends on the document's fields — so that
// query cannot be proven and is refused whole: the calendar on the phones is empty. The review
// found the wallet, the expenses, `users` reads and the invite lookup refused the same way, which
// means the phones cannot send an invite, and accepting one leaves it 'accepted' without joining.
// So every case below passing says the rules still take these WRITES — not that the APK works.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, arrayUnion, collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { ALICE, BOB, G1, EMAIL, as, filesAs, resetBucket, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(() => startEnv('demo-apk-compat'));
afterAll(stopEnv);
beforeEach(resetWorld);

const NOW = '2026-09-24T09:00:00.000Z';

const EVENT = {
  title: 'Dentist', description: '', checklistItems: [], categoryId: 'personal',
  ownerId: BOB, sharedWithFamily: false, imageUrl: null, isTask: false,
  taskStatus: 'none', assigneeIds: [], assigneeId: null, assetId: null,
  updatedAt: NOW, date: NOW, createdAt: NOW,
};

describe('what the installed APK creates', () => {
  it('a message in a group chat', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), `groups/${G1}/messages`), {
      text: 'hi', imageUrl: null, senderId: BOB, createdAt: serverTimestamp(),
      seenBy: [BOB], replyToId: null,
    }));
  });

  it('a group invite, as the APK would write it — which, on the phones, it never gets to', async () => {
    // The payload is the APK's, field for field. But the pre-deploy review of 24.09 found that
    // sending an invite from the APK first looks the recipient up in `users` by email, and that
    // read has been refused since 25 May — so no phone reaches this write at all. This case is kept
    // as the shape of the payload, NOT as a reason the fromEmail/groupName rule must wait: what
    // still writes these fields today is the WEB client. See OWNER_VERIFY.md.
    await assertSucceeds(addDoc(collection(as(BOB), 'group_invites'), {
      fromId: BOB, fromEmail: EMAIL[BOB], toId: null, toEmail: 'someone@example.test',
      groupId: G1, groupName: 'Family', status: 'pending', createdAt: NOW,
    }));
  });

  it('a group', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'groups'), {
      name: 'New', ownerId: BOB, members: [BOB], createdAt: NOW,
    }));
  });

  it('an event — personal, in a group, and as a task assigned to yourself', async () => {
    // The APK has no server-side recurrence: a recurring event is 14, 12 or 6 SEPARATE documents
    // of exactly this shape. So recurrence changes cannot break its writes — only this shape can.
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), { ...EVENT, groupId: null, visibleTo: [] }));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), { ...EVENT, groupId: G1, visibleTo: [ALICE, BOB] }));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), {
      ...EVENT, groupId: G1, visibleTo: [ALICE, BOB], isTask: true,
      taskStatus: 'not-started', assigneeIds: [BOB], assigneeId: BOB,
    }));
  });

  it('a game', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'games'), {
      groupId: G1, date: '2026-09-24', gameType: 'connect4', status: 'waiting',
      createdAt: serverTimestamp(), createdBy: BOB, state: {}, winner: null,
    }));
  });

  it('an asset', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'assets'), {
      name: 'Event Image', category: 'Uncategorized', categories: ['Uncategorized'],
      imageUrl: 'https://example.test/x.png', ownerId: BOB, createdAt: NOW, sharedWithFamily: true,
    }));
  });

  it('its own users document at sign-up', async () => {
    await assertSucceeds(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), {
      name: 'New', email: 'new@example.test', createdAt: new Date(),
      theme: { primaryColor: '#3b82f6', isDarkMode: false },
    }));
  });
});

describe('Storage: what the installed APK uploads, then reads straight back', () => {
  // Bundle: every flow is `JT(ref, file)` (uploadBytes) followed at once by `XT(ref)`
  // (getDownloadURL) on the SAME ref. Since 25.09 `get` is the uploader's — by folder, by name, or,
  // for the unattributed chat name, within ten minutes of the upload. These are the APK's six
  // shapes; a File from the phone carries its own type, which a typed Blob stands in for.
  const TS = 1758000000000;
  const photo = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  beforeEach(resetBucket);

  it.each([
    [`assets/${BOB}/${TS}_card.png`, { contentType: 'image/png' }],
    [`events/${BOB}/${TS}_photo.png`, undefined],
    [`checklists/${BOB}/${TS}_item.png`, undefined],
    [`profiles/${BOB}_${TS}`, { contentType: 'image/png' }],
    [`backgrounds/${BOB}_${TS}`, { contentType: 'image/png' }],
    [`chat-images/${G1}/${TS}_pic.png`, undefined],
  ] as const)('%s', async (path, meta) => {
    const r = ref(filesAs(BOB), path);
    await assertSucceeds(uploadBytes(r, photo(), meta));
    await assertSucceeds(getDownloadURL(r));
  });
});

describe('what the installed APK answers on an invitation', () => {
  // Bundle: `MC(q(Y,'group_invites',e.id),{status:'accepted'})` and `…{status:'declined'}` — the
  // only two invitation writes it makes. Since 25.09 the rule lets a status move only from pending
  // to an answer; these two are exactly that, and must stay allowed.
  beforeEach(async () => {
    await seed(async (db) => {
      for (const id of ['apk-inv-1', 'apk-inv-2']) {
        await setDoc(doc(db, 'group_invites', id), {
          fromId: ALICE, fromEmail: EMAIL[ALICE], toId: null, toEmail: EMAIL[BOB],
          groupId: null, groupName: null, status: 'pending', createdAt: NOW,
        });
      }
    });
  });

  it('accepts', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'group_invites', 'apk-inv-1'), { status: 'accepted' }));
  });

  it('declines', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'group_invites', 'apk-inv-2'), { status: 'declined' }));
  });
});

describe('what the installed APK updates on somebody else’s message', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm1'), {
        senderId: ALICE, text: 'hello', seenBy: [ALICE], reactions: {}, isPinned: false,
      });
      await setDoc(doc(db, 'groups', G1, 'messages', 'm2'), {
        senderId: ALICE, text: 'again', seenBy: [ALICE],
      });
    });
  });

  it('marks it seen — in a BATCH, with arrayUnion', async () => {
    // The read-receipt guard was written against this exact write. ONE Firestore instance for the
    // batch and its refs: the harness mints a fresh one per `as()` call, and mixing two throws
    // before any rule is consulted.
    const bob = as(BOB);
    const batch = writeBatch(bob);
    batch.update(doc(bob, 'groups', G1, 'messages', 'm1'), { seenBy: arrayUnion(BOB) });
    batch.update(doc(bob, 'groups', G1, 'messages', 'm2'), { seenBy: arrayUnion(BOB) });
    await assertSucceeds(batch.commit());
  });

  it('reacts — by rewriting the WHOLE map, keyed by emoji', async () => {
    // Why the reactions fix waits for the rebuild: both known ways of securing reactions (re-key by
    // uid, or a palette rule on this shape) refuse this write. When one ships, this test is meant
    // to go red, and the APK must already be rebuilt when it does.
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      reactions: { '👍': [BOB] },
    }));
  });
});
