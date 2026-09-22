// rules-tests/storage.test.ts
//
// The bucket. Until today, the only rules file in this project nothing had ever run.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────
//
// Storage rules match on the OBJECT PATH, folder by folder, and they do not fall through the way
// a reader expects: a path that no `match` block covers lands on the default deny. So a rule and
// an uploader can disagree for ever and the symptom is a refusal, not an error anybody reads —
// which is how two orphaned objects ended up in this bucket.
//
// The first thing asserted here is therefore not a permission at all: it is that each of the seven
// paths the app actually builds is reachable by the person who builds it.
//
//   assets/{uid}/{ts}_{name}        events/{uid}/…      checklists/{uid}/…
//   profiles/{uid}_{ts}             backgrounds/{uid}_{ts}
//   chat-images/{convId}/…          chat-audio/{convId}/{ts}.webm
//
// Two things below are recorded rather than repaired, because the rules cannot express them:
// Storage cannot ask Firestore whether you are in a group, so chat media is gated on being signed
// in and nothing more. That is a decision already written into storage.rules; the tests pin it so
// it stays a decision.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getBytes, listAll, ref, uploadBytes } from 'firebase/storage';
import { beforeAll, afterAll, describe, it } from 'vitest';
import { ALICE, BOB, filesAnon, filesAs, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-storage'); });
afterAll(stopEnv);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = { contentType: 'image/png' };
const audio = { contentType: 'audio/webm' };

/** A payload big enough to cross a limit, without holding it all in one allocation twice. */
const bytes = (n: number) => new Uint8Array(n);

describe('the seven paths the app actually writes', () => {
  // Not permissions — reachability. A storage rule that does not match the uploader's path denies
  // it, and the app reports that as a failed upload with no clue which half is wrong.
  it('a wallet card, an event image and a checklist image, into my own folder', async () => {
    const s = filesAs(ALICE);
    await assertSucceeds(uploadBytes(ref(s, `assets/${ALICE}/1758000000000_card.png`), PNG, image));
    await assertSucceeds(uploadBytes(ref(s, `events/${ALICE}/1758000000000_photo.png`), PNG, image));
    await assertSucceeds(uploadBytes(ref(s, `checklists/${ALICE}/1758000000000_item.png`), PNG, image));
  });

  it('a profile picture and a background, named {uid}_{timestamp}', async () => {
    const s = filesAs(ALICE);
    await assertSucceeds(uploadBytes(ref(s, `profiles/${ALICE}_1758000000000`), PNG, image));
    await assertSucceeds(uploadBytes(ref(s, `backgrounds/${ALICE}_1758000000000`), PNG, image));
  });

  it('a chat picture and a voice note, named by their uploader', async () => {
    // The uid leads the filename so the rules can ask WHO wrote this. They cannot read Firestore,
    // so membership stays unknowable — but ownership of a name does not, and that is the
    // difference between "any account may write anything here" and "only files that are theirs".
    const s = filesAs(ALICE);
    await assertSucceeds(uploadBytes(ref(s, `chat-images/group-one/${ALICE}_1758000000000_pic.png`), PNG, image));
    await assertSucceeds(uploadBytes(ref(s, `chat-audio/group-one/${ALICE}_1758000000000.webm`), PNG, audio));
  });

  it('but NOT one attributed to somebody else', async () => {
    const s = filesAs(ALICE);
    await assertFails(uploadBytes(ref(s, `chat-images/group-one/${BOB}_1758000000000_pic.png`), PNG, image));
    await assertFails(uploadBytes(ref(s, `chat-audio/group-one/${BOB}_1758000000000.webm`), PNG, audio));
  });

  it('nor one where my uid merely APPEARS, which is what anchoring buys', async () => {
    // `matches()` takes a REGEX with the uid interpolated into it. The whole scheme rests on that
    // pattern being anchored: if it matched anywhere in the name, `<victim>_<me>_x.png` would
    // satisfy it and the object would read as the victim's while being mine. Measured on the
    // emulator before this was relied on — it is a FULL match, at both ends.
    const s = filesAs(ALICE);
    await assertFails(uploadBytes(ref(s, `chat-images/group-one/${BOB}_${ALICE}_pic.png`), PNG, image));
    // And a uid that is a prefix of mine does not let me write in their name either.
    await assertFails(uploadBytes(ref(s, `chat-images/group-one/${ALICE.slice(0, 5)}_pic.png`), PNG, image));
  });

  it('an UNATTRIBUTED name is still accepted — deliberately, and not for ever', async () => {
    // The shape the previous bundle writes. I was about to refuse it, and a pre-deploy review
    // caught what that would do: this app is also a native Android build, `capacitor.config.ts`
    // sets `webDir: 'dist'` with no `server` block, so the APK carries a FROZEN copy of the
    // bundle. A hosting deploy cannot reach it. Refusing the old shape would break every chat
    // photo sent from an installed phone, silently, until somebody built and installed a new APK.
    //
    // So both shapes are accepted for now. This test is the record of that being a TRANSITION,
    // not the intended end state.
    //
    // TO CLOSE IT: rebuild the APK (`npx cap sync android` + a build), install it on every phone
    // that has one, then drop the second branch in storage.rules and invert these two lines.
    const s = filesAs(ALICE);
    await assertSucceeds(uploadBytes(ref(s, 'chat-images/group-one/1758000000000_pic.png'), PNG, image));
    await assertSucceeds(uploadBytes(ref(s, 'chat-audio/group-one/1758000000000.webm'), PNG, audio));
  });

  it('but a name that is neither attributed nor the old shape is refused', async () => {
    // The transition widens the door by exactly one known shape, not into a hole: an arbitrary
    // name still fails, so the rule has not simply become "anything goes".
    const s = filesAs(ALICE);
    await assertFails(uploadBytes(ref(s, 'chat-images/group-one/whatever.png'), PNG, image));
    await assertFails(uploadBytes(ref(s, `chat-images/group-one/${BOB}x_pic.png`), PNG, image));
  });
});

describe('somebody else’s folder', () => {
  it('is not writable', async () => {
    await assertFails(uploadBytes(ref(filesAs(BOB), `assets/${ALICE}/mine.png`), PNG, image));
    await assertFails(uploadBytes(ref(filesAs(BOB), `events/${ALICE}/mine.png`), PNG, image));
    await assertFails(uploadBytes(ref(filesAs(BOB), `checklists/${ALICE}/mine.png`), PNG, image));
  });

  it('is not LISTABLE, which is what keeps a path from being guessed', async () => {
    // `get` on a known path stays open to any signed-in reader — the paths carry a timestamp and
    // a download token. Enumeration is the part that would turn that into a browsable album.
    await assertSucceeds(listAll(ref(filesAs(ALICE), `assets/${ALICE}`)));
    await assertFails(listAll(ref(filesAs(BOB), `assets/${ALICE}`)));
  });

  it('and a profile picture cannot be overwritten by naming it after somebody else', async () => {
    await assertFails(uploadBytes(ref(filesAs(BOB), `profiles/${ALICE}_1758000000000`), PNG, image));
    await assertFails(uploadBytes(ref(filesAs(BOB), `backgrounds/${ALICE}_1758000000000`), PNG, image));
  });
});

describe('signed out', () => {
  it('reaches nothing at all', async () => {
    await assertFails(uploadBytes(ref(filesAnon(), `assets/${ALICE}/x.png`), PNG, image));
    await assertFails(getBytes(ref(filesAnon(), `assets/${ALICE}/1758000000000_card.png`)));
  });
});

describe('what may be uploaded, not just where', () => {
  it('an image folder takes images and nothing else', async () => {
    const s = filesAs(ALICE);
    await assertFails(uploadBytes(ref(s, `assets/${ALICE}/note.txt`), PNG, { contentType: 'text/plain' }));
    await assertFails(uploadBytes(ref(s, `assets/${ALICE}/page.html`), PNG, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(s, `assets/${ALICE}/app.js`), PNG,
      { contentType: 'application/javascript' }));
  });

  it('and refuses one that is over the size limit', async () => {
    // 10 MiB for an image. The uploader has its own limit; this is the one that holds when the
    // uploader is not the thing doing the uploading.
    await assertFails(uploadBytes(ref(filesAs(ALICE), `assets/${ALICE}/huge.png`),
      bytes(11 * 1024 * 1024), image));
  });

  it('a voice note folder takes audio and nothing else', async () => {
    // The recorder wraps its chunks in `new Blob(chunks, { type: 'audio/webm' })`, so the type the
    // app sends is not the recorder's guess — it is exactly this.
    // Names carry the uploader's uid since 22.09; the type check is what this test is about.
    const s = filesAs(ALICE);
    await assertSucceeds(uploadBytes(ref(s, `chat-audio/group-one/${ALICE}_1.webm`), PNG, audio));
    await assertFails(uploadBytes(ref(s, `chat-audio/group-one/${ALICE}_2.html`), PNG,
      { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(s, `chat-audio/group-one/${ALICE}_3.exe`), PNG,
      { contentType: 'application/x-msdownload' }));
  });
});

describe('what the rules cannot ask, written down so it stays a decision', () => {
  it('chat media is gated on being signed in, not on being in the conversation', async () => {
    // Storage rules cannot read Firestore, so "is Bob in this group" is a question this file
    // cannot pose. Bob writing into a conversation he is not part of is therefore ALLOWED, and
    // that is a known trade recorded in storage.rules — pinned here so that changing it has to be
    // a deliberate act rather than a silent drift.
    //
    // What DID change on 22.09 is the other half: he must write under his own name. So the file
    // lands where he should not be able to put it, but it is unmistakably his. Membership is
    // still unknowable here; attribution no longer is.
    await assertSucceeds(uploadBytes(ref(filesAs(BOB), `chat-images/a-group-bob-is-not-in/${BOB}_x.png`),
      PNG, image));
    await assertFails(uploadBytes(ref(filesAs(BOB), `chat-images/a-group-bob-is-not-in/${ALICE}_x.png`),
      PNG, image));
  });

  it('a path no rule names is denied, which is the safe direction', async () => {
    // The default-deny block at the bottom. It is also the trap: an uploader that builds a path
    // outside these seven folders fails with a permission error and no hint of which half is wrong.
    await assertFails(uploadBytes(ref(filesAs(ALICE), 'scratch/whatever.png'), PNG, image));
    await assertFails(uploadBytes(ref(filesAs(ALICE), `assets/${ALICE}.png`), PNG, image));
  });
});
