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
// One thing below is recorded rather than repaired: chat media is gated on being signed in, not
// on being in the conversation. Storage rules CAN ask Firestore (cross-service rules) — an older
// version of this header said they could not — but it costs an IAM grant and a billed read per
// request, and storage.rules declines it. The tests pin that so it stays a decision.
//
// Since 25.09 reading is the uploader's (see the header of storage.rules), chat media is truly
// create-only, and owners can delete what they uploaded.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { ALICE, BOB, filesAnon, filesAs, resetBucket, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-storage'); });
afterAll(stopEnv);
beforeEach(resetBucket);

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
    // Enumeration would turn a guessed prefix into a browsable album. (Reading a KNOWN path is the
    // uploader's too since 25.09 — see 'reading' below.)
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
    // "Is Bob in this group" is a question storage.rules chooses not to pose (it could, with a
    // cross-service read — an IAM grant and a billed read per request). Bob writing into a
    // conversation he is not part of is therefore ALLOWED, and that is a known trade recorded in
    // storage.rules — pinned here so that changing it has to be a deliberate act.
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

// ── 25.09.2026: reading is the uploader's ──────────────────────────────────────────────────
//
// Every document stores the TOKENIZED url, and a request carrying the token never reaches these
// rules. So `get` guards only SDK reads — getDownloadURL, getBytes — and only the uploader makes
// one, right after uploading. It was `isSignedIn()`: any account holding a path could mint a
// permanent public url for it, and revoking a leaked one bought nothing.

/** The seven kinds of object, each as Alice's, with a uid-led name where the name is what counts. */
const ALICES = [
  [`assets/${ALICE}/1758000000100_a.png`, image],
  [`events/${ALICE}/1758000000100_e.png`, image],
  [`checklists/${ALICE}/1758000000100_c.png`, image],
  [`profiles/${ALICE}_1758000000100`, image],
  [`backgrounds/${ALICE}_1758000000100`, image],
  [`chat-images/group-one/${ALICE}_1758000000100_p.png`, image],
  [`chat-audio/group-one/${ALICE}_1758000000100.webm`, audio],
] as const;

describe('reading: only whoever wrote it', () => {
  it.each(ALICES)('%s — Alice reads back her own upload', async (path, meta) => {
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, meta));
    await assertSucceeds(getDownloadURL(ref(filesAs(ALICE), path)));
  });

  it.each(ALICES)('%s — Bob cannot, not even to mint a url', async (path, meta) => {
    // Bob IS in group-one in the harness world: members render the token url and never need this.
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, meta));
    await assertFails(getDownloadURL(ref(filesAs(BOB), path)));
    await assertFails(getBytes(ref(filesAs(BOB), path)));
  });

  it('and nobody renders through the rules: the url works with its token, and not without', async () => {
    // The pair that must differ. If the tokenless request ever succeeded, the rules would not be
    // consulted for this object at all, and the refusals above would prove nothing.
    const path = `assets/${ALICE}/1758000000101_r.png`;
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, image));
    const url = await getDownloadURL(ref(filesAs(ALICE), path));
    const withToken = await fetch(url);
    expect(withToken.status).toBe(200);
    expect(new Uint8Array(await withToken.arrayBuffer())).toEqual(PNG);
    const bare = new URL(url);
    bare.searchParams.delete('token');
    expect((await fetch(bare)).status).toBe(403);
  });

  it('listing a whole ROOT stays refused — which is why the old APK’s picker is empty, not new', async () => {
    // The APK's "past images" lists `assets`, `chat-images`… at the bucket root. No rule covers a
    // bare root, so it was refused before this change and still is.
    await assertFails(listAll(ref(filesAs(ALICE), 'assets')));
    await assertFails(listAll(ref(filesAs(ALICE), 'chat-images')));
  });
});

describe('legacy chat names: readable briefly after being written, by design', () => {
  it('the uploader reads back an unattributed upload at once — what the APK does', async () => {
    const path = 'chat-images/group-one/1758000000300_p.png';
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, image));
    await assertSucceeds(getDownloadURL(ref(filesAs(ALICE), path)));
    const note = 'chat-audio/group-one/1758000000300.webm';
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), note), PNG, audio));
    await assertSucceeds(getDownloadURL(ref(filesAs(ALICE), note)));
  });

  it('and so, inside the window, can anyone signed in who holds the exact path — the price', async () => {
    // A legacy name says nobody, so the rule cannot tell the uploader from Bob. The window is ten
    // minutes; outside it, refused (rules-tests/storage-window.test.ts). Gone with the APK rebuild.
    const path = 'chat-images/group-one/1758000000301_p.png';
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, image));
    await assertSucceeds(getDownloadURL(ref(filesAs(BOB), path)));
    // A NAMED file carries no such exception.
    const named = `chat-images/group-one/${ALICE}_1758000000301_p.png`;
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), named), PNG, image));
    await assertFails(getDownloadURL(ref(filesAs(BOB), named)));
  });
});

describe('an upload never replaces what is already there', () => {
  // storage.rules said `resource == null` made chat media create-only; no rule contained it. An
  // upload is a `create` even over an existing object, so any signed-in account could swap any
  // legacy-named photo in any conversation for another, keeping its url.
  it.each([
    ['chat-images/group-one/1758000000400_p.png', image],
    ['chat-audio/group-one/1758000000400.webm', audio],
  ] as const)('%s — Bob cannot overwrite it, and neither can its uploader', async (path, meta) => {
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, meta));
    await assertFails(uploadBytes(ref(filesAs(BOB), path), new Uint8Array([1, 2, 3]), meta));
    await assertFails(uploadBytes(ref(filesAs(ALICE), path), new Uint8Array([4, 5, 6]), meta));
    // …while a NEW legacy name still goes through: the APK always writes a fresh one.
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path.replace('1758000000400', '1758000000401')), PNG, meta));
  });
});

describe('deleting what I uploaded', () => {
  // `delete` sat inside `write`, next to `isImage()`, which reads the incoming object — and a
  // delete has none. So every owner delete was refused with a null-value error. No client deletes
  // today; this is so the rule is not the reason one never can.
  it.each(ALICES.slice(0, 5))('%s — Alice deletes her own', async (path, meta) => {
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, meta));
    await assertSucceeds(deleteObject(ref(filesAs(ALICE), path)));
  });

  it.each(ALICES.slice(0, 5))('%s — Bob cannot delete it', async (path, meta) => {
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, meta));
    await assertFails(deleteObject(ref(filesAs(BOB), path)));
  });

  it('a uid that merely PREFIXES Alice’s cannot delete her profile picture', async () => {
    const path = `profiles/${ALICE}_1758000000500`;
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), path), PNG, image));
    await assertFails(deleteObject(ref(filesAs(ALICE.slice(0, 6)), path)));
  });

  it('deleting a missing object of my own says "not found", not "unauthorized"', async () => {
    // The discriminating case: the old rule raised on the missing incoming object and answered
    // unauthorized, whatever the truth was.
    await expect(deleteObject(ref(filesAs(ALICE), `assets/${ALICE}/missing.png`)))
      .rejects.toMatchObject({ code: 'storage/object-not-found' });
  });

  it('chat media stays undeletable from a client, even by its uploader', async () => {
    const pic = `chat-images/group-one/${ALICE}_1758000000600_p.png`;
    await assertSucceeds(uploadBytes(ref(filesAs(ALICE), pic), PNG, image));
    await assertFails(deleteObject(ref(filesAs(ALICE), pic)));
  });
});
