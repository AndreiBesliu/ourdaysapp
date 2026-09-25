// rules-tests/storage-window.test.ts
//
// The ten-minute window for legacy chat names CLOSES. A legacy name (`<millis>_<name>`, what the
// installed APK writes; `<millis>.webm` for voice notes from an old web tab) says nobody, so
// storage.rules lets it be read — and re-sent with identical bytes — for a short time after it
// was written, and then by nobody. See storage.rules.
//
// The emulator's clock cannot be moved, so this loads storage.rules with the window set to ZERO
// seconds, into its own environment. Everything else is the real file. The needle is asserted to
// occur exactly once, so renaming the window cannot turn this test into one that tests nothing.
// Both folders, since 25.09: a voice-note window that never closed passed every test before.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { emulatorAt } from './_harness';

const NEEDLE = "duration.value(10, 'm')";
const RULES = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8');
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ALICE = 'uid-alice';

let env: RulesTestEnvironment;

beforeAll(async () => {
  expect(RULES.split(NEEDLE).length - 1, `storage.rules must contain ${NEEDLE} exactly once`).toBe(1);
  env = await initializeTestEnvironment({
    projectId: 'demo-storage-window',
    storage: { rules: RULES.replace(NEEDLE, "duration.value(0, 's')"), ...emulatorAt('FIREBASE_STORAGE_EMULATOR_HOST', 9399) },
  });
});
afterAll(async () => { await env?.cleanup(); });

const files = () => env.authenticatedContext(ALICE).storage();

const SHAPES = [
  ['chat-images/group-one/1758000000200_p.png', `chat-images/group-one/${ALICE}_1758000000200_p.png`, { contentType: 'image/png' }],
  ['chat-audio/group-one/1758000000200.webm', `chat-audio/group-one/${ALICE}_1758000000200.webm`, { contentType: 'audio/webm' }],
] as const;

describe('the legacy window, closed', () => {
  it.each(SHAPES)('%s — not even the uploader reads it back', async (legacy, _named, meta) => {
    await assertSucceeds(uploadBytes(ref(files(), legacy), BYTES, meta));
    await assertFails(getDownloadURL(ref(files(), legacy)));
  });

  it.each(SHAPES)('%s — nor re-sends the same bytes', async (legacy, _named, meta) => {
    const path = legacy.replace('1758000000200', '1758000000210');
    await assertSucceeds(uploadBytes(ref(files(), path), BYTES, meta));
    await assertFails(uploadBytes(ref(files(), path), BYTES, meta));
  });

  it.each(SHAPES)('while its uid-named twin %s is unaffected — so it was the window, not the load', async (_legacy, named, meta) => {
    await assertSucceeds(uploadBytes(ref(files(), named), BYTES, meta));
    await assertSucceeds(getDownloadURL(ref(files(), named)));
  });
});
