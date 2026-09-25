// rules-tests/storage-window.test.ts
//
// The ten-minute window for legacy chat names CLOSES. A legacy name (`<millis>_<name>`, what the
// installed APK writes) says nobody, so storage.rules lets it be read for a short time after it
// was written — the uploader's own getDownloadURL — and then by nobody. See storage.rules.
//
// The emulator's clock cannot be moved, so this loads storage.rules with the window set to ZERO
// seconds, into its own environment. Everything else is the real file. The needle is asserted to
// occur exactly once, so renaming the window cannot turn this test into one that tests nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { emulatorAt } from './_harness';

const NEEDLE = "duration.value(10, 'm')";
const RULES = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
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

describe('the legacy window', () => {
  it('once closed, not even the uploader reads a legacy name back', async () => {
    const path = 'chat-images/group-one/1758000000200_p.png';
    await assertSucceeds(uploadBytes(ref(files(), path), PNG, { contentType: 'image/png' }));
    await assertFails(getDownloadURL(ref(files(), path)));
  });

  it('while a uid-named file is unaffected — so it was the window that refused, not the load', async () => {
    const path = `chat-images/group-one/${ALICE}_1758000000200_p.png`;
    await assertSucceeds(uploadBytes(ref(files(), path), PNG, { contentType: 'image/png' }));
    await assertSucceeds(getDownloadURL(ref(files(), path)));
  });
});
